/**
 * FHIR `Observation` to a v2 ORU-shaped message carrying an OBX: the value-type discrimination, the
 * refusals that never emit a confidently wrong result, and the never-throw guardrail.
 *
 * Every fixture is synthetic; no fixture carries a patient identity at all (this shape's input is an
 * `Observation` alone).
 */

import { describe, it, expect } from "vitest";
import { parseHL7 } from "@cosyte/hl7";
import { complex, primitive, parseResource, type FhirComplex } from "@cosyte/fhir";

import { toV2Observation, ISSUE_CODES, OBSERVATION_STATUS_TO_V2 } from "../../src/index.js";

const LOINC = { system: "http://loinc.org", code: "789-8", display: "Hemoglobin" };
const UCUM = "http://unitsofmeasure.org";

function observation(json: Record<string, unknown>): FhirComplex {
  return parseResource(
    JSON.stringify({ resourceType: "Observation", code: { coding: [LOINC] }, ...json }),
  ).resource;
}

const codes = (result: { issues: readonly { code: string }[] }): string[] =>
  result.issues.map((i) => i.code);

describe("toV2Observation: the emitted message", () => {
  it("builds a complete ORU message whose OBX carries the code, value, units and status", () => {
    const { value, issues } = toV2Observation(
      observation({
        status: "final",
        effectiveDateTime: "2026-01-02T10:15:00-05:00",
        valueQuantity: { value: 120.5, unit: "g/L", system: UCUM, code: "g/L" },
        referenceRange: [{ text: "130-170" }],
        interpretation: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: "L",
              },
            ],
          },
        ],
      }),
      "R01",
    );

    expect(issues).toEqual([]);
    const round = parseHL7(value?.toString() ?? "");
    expect(round.meta.type).toBe("ORU^R01");
    expect(round.get("OBX.2")).toBe("NM");
    expect(round.get("OBX.3.1")).toBe("789-8");
    expect(round.get("OBX.3.2")).toBe("Hemoglobin");
    expect(round.get("OBX.3.3")).toBe("LN");
    expect(round.get("OBX.5")).toBe("120.5");
    expect(round.get("OBX.6.1")).toBe("g/L");
    expect(round.get("OBX.6.3")).toBe("UCUM");
    expect(round.get("OBX.7")).toBe("130-170");
    expect(round.get("OBX.8")).toBe("L");
    expect(round.get("OBX.11")).toBe("F");
    expect(round.get("OBX.14")).toBe("20260102101500-0500");
  });

  it("carries a magnitude's exact lexical precision, never through a JS number", () => {
    // A trailing zero is significant in FHIR and a JS number would drop it: raw JSON in, raw out.
    const { value } = toV2Observation(
      parseResource(
        '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]},"valueQuantity":{"value":120.50}}',
      ).resource,
      "R01",
    );
    expect(parseHL7(value?.toString() ?? "").get("OBX.5")).toBe("120.50");
  });

  it.each([
    ["a coded value", { valueCodeableConcept: { coding: [LOINC] } }, "CWE", "789-8"],
    ["a string value", { valueString: "positive" }, "ST", "positive"],
    ["a date-time value", { valueDateTime: "2026-01-02" }, "DTM", "20260102"],
  ])("derives OBX-2 from %s rather than assuming a type", (_label, json, type, first) => {
    const { value } = toV2Observation(observation({ status: "final", ...json }), "R01");
    const round = parseHL7(value?.toString() ?? "");
    expect(round.get("OBX.2")).toBe(type);
    expect(round.get("OBX.5.1")).toBe(first);
  });

  it("writes a comparator-bearing quantity as a structured numeric, never as a bare magnitude", () => {
    const { value, issues } = toV2Observation(
      observation({ status: "final", valueQuantity: { comparator: "<", value: 5, unit: "mg/L" } }),
      "R01",
    );
    expect(issues).toEqual([]);
    const round = parseHL7(value?.toString() ?? "");
    expect(round.get("OBX.2")).toBe("SN");
    expect(round.get("OBX.5.1")).toBe("<");
    expect(round.get("OBX.5.2")).toBe("5");
  });
});

describe("toV2Observation: the required trigger", () => {
  it("refuses an empty trigger without building a message", () => {
    const result = toV2Observation(observation({ status: "final" }), "");
    expect(result.value).toBeUndefined();
    expect(codes(result)).toEqual([ISSUE_CODES.TRANSFORM_MISSING_TRIGGER]);
  });

  it("uses the trigger verbatim under the ORU message code the shape fixes", () => {
    const { value } = toV2Observation(observation({ status: "final" }), "R30");
    expect(parseHL7(value?.toString() ?? "").meta.type).toBe("ORU^R30");
  });
});

describe("toV2Observation: refusals that never guess", () => {
  it("emits nothing when the observation code has no v2-nameable system", () => {
    const result = toV2Observation(
      parseResource(
        '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://example.org/local","code":"X"}]}}',
      ).resource,
      "R01",
    );
    expect(result.value).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2);
  });

  it("flags a status whose inverse is ambiguous and leaves OBX-11 absent", () => {
    const result = toV2Observation(observation({ status: "entered-in-error" }), "R01");
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE);
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.11")).toBe(undefined);
    expect(OBSERVATION_STATUS_TO_V2["entered-in-error"]).toBeUndefined();
    expect(OBSERVATION_STATUS_TO_V2["corrected"]).toBe("C");
  });

  it.each([
    ["a range value", { valueRange: { low: { value: 1 }, high: { value: 2 } } }],
    ["a ratio value", { valueRatio: { numerator: { value: 1 }, denominator: { value: 2 } } }],
    ["a boolean value", { valueBoolean: true }],
  ])("emits no OBX-5 for %s and flags it", (_label, json) => {
    const result = toV2Observation(observation({ status: "final", ...json }), "R01");
    const round = parseHL7(result.value?.toString() ?? "");
    expect(round.get("OBX.5")).toBe(undefined);
    expect(round.get("OBX.2")).toBe(undefined);
    const flagged = result.issues.filter((i) => i.code === ISSUE_CODES.TRANSFORM_NO_V2_TARGET);
    expect(flagged[0]?.v2Location).toBe("OBX.5");
  });

  it("refuses a magnitude in exponent form rather than rewriting it", () => {
    // Written as raw JSON: the exponent form has to survive to the reader as a lexical literal.
    const result = toV2Observation(
      parseResource(
        '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]},"valueQuantity":{"value":1e3}}',
      ).resource,
      "R01",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE);
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.5")).toBe(undefined);
  });

  it("flags a unit whose system is not UCUM and keeps only its display text", () => {
    const result = toV2Observation(
      observation({
        status: "final",
        valueQuantity: {
          value: 5,
          unit: "widgets",
          system: "http://example.org/units",
          code: "wid",
        },
      }),
      "R01",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2);
    const round = parseHL7(result.value?.toString() ?? "");
    expect(round.get("OBX.6.1")).toBe("");
    expect(round.get("OBX.6.2")).toBe("widgets");
  });

  it.each([
    [
      "an abnormal flag the HL70078 map does not carry",
      "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
      "ZZ",
      ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE,
    ],
    [
      "an interpretation from an unrelated system",
      "http://example.org/flags",
      "H",
      ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2,
    ],
  ])("flags %s and emits no OBX-8", (_label, system, code, expected) => {
    const result = toV2Observation(
      observation({ status: "final", interpretation: [{ coding: [{ system, code }] }] }),
      "R01",
    );
    expect(codes(result)).toContain(expected);
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.8")).toBe(undefined);
  });

  it("never composes OBX-7 from structured range endpoints", () => {
    const result = toV2Observation(
      observation({
        status: "final",
        referenceRange: [{ low: { value: 130 }, high: { value: 170 } }],
      }),
      "R01",
    );
    const flagged = result.issues.filter((i) => i.code === ISSUE_CODES.TRANSFORM_NO_V2_TARGET);
    expect(flagged[0]?.v2Location).toBe("OBX.7");
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.7")).toBe(undefined);
  });

  it("flags a second reference range rather than dropping it silently", () => {
    const result = toV2Observation(
      observation({ status: "final", referenceRange: [{ text: "130-170" }, { text: "120-160" }] }),
      "R01",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE);
  });

  it("flags the subject and encounter rather than assembling a segment for them", () => {
    const result = toV2Observation(
      observation({
        status: "final",
        subject: { reference: "Patient/1" },
        encounter: { reference: "Encounter/1" },
      }),
      "R01",
    );
    const flagged = result.issues.filter((i) => i.code === ISSUE_CODES.TRANSFORM_NO_V2_TARGET);
    expect(flagged.map((i) => i.v2Location)).toEqual(["PID", "PV1"]);
    expect(parseHL7(result.value?.toString() ?? "").segments("PID")).toHaveLength(0);
  });

  it("refuses a resource of another type", () => {
    const result = toV2Observation(parseResource('{"resourceType":"Patient"}').resource, "R01");
    expect(result.value).toBeUndefined();
    expect(result.issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE);
    expect(result.issues[0]?.fhirPath).toBe("Patient");
  });
});

describe("toV2Observation: the never-throw guardrail on malformed input", () => {
  it("flags an observation with no code rather than emitting a code-less OBX", () => {
    const result = toV2Observation(
      parseResource('{"resourceType":"Observation","status":"final"}').resource,
      "R01",
    );
    expect(result.value).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED);
  });

  it("flags a code that is a string where a CodeableConcept belongs, without throwing", () => {
    const result = toV2Observation(
      complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "code", value: primitive("789-8") },
      ]),
      "R01",
    );
    expect(result.value).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED);
  });

  it.each([
    ["a quantity magnitude that is a boolean", primitive(true)],
    ["a quantity magnitude with no value at all", primitive(undefined)],
  ])("flags %s, without throwing", (_label, magnitude) => {
    const result = toV2Observation(
      complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "code", value: complex([{ name: "text", value: primitive("Hemoglobin") }]) },
        { name: "valueQuantity", value: complex([{ name: "value", value: magnitude }]) },
      ]),
      "R01",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED);
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.5")).toBe(undefined);
  });

  it("reads a magnitude that arrived as a JSON string, and carries it verbatim", () => {
    const result = toV2Observation(
      complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "code", value: complex([{ name: "text", value: primitive("Hemoglobin") }]) },
        { name: "valueQuantity", value: complex([{ name: "value", value: primitive("12.50") }]) },
      ]),
      "R01",
    );
    expect(parseHL7(result.value?.toString() ?? "").get("OBX.5")).toBe("12.50");
  });

  it("flags a status that is a boolean, without throwing", () => {
    const result = toV2Observation(
      complex([
        { name: "resourceType", value: primitive("Observation") },
        { name: "code", value: complex([{ name: "text", value: primitive("Hemoglobin") }]) },
        { name: "status", value: primitive(true) },
      ]),
      "R01",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED);
  });

  it("carries CodeableConcept.text into CWE.9 when no coding resolves", () => {
    const { value } = toV2Observation(
      parseResource('{"resourceType":"Observation","status":"final","code":{"text":"Hemoglobin"}}')
        .resource,
      "R01",
    );
    expect(parseHL7(value?.toString() ?? "").get("OBX.3.9")).toBe("Hemoglobin");
  });
});

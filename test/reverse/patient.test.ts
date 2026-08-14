/**
 * FHIR `Patient` to a v2 ADT-shaped message carrying a PID: the happy path, the fail-safe refusals,
 * and the never-throw guardrail on structurally malformed input.
 *
 * Every fixture is synthetic: the person tokens, MRN and date of birth are the ones declared in
 * `scripts/phi-allow-list.txt`.
 */

import { describe, it, expect } from "vitest";
import { parseHL7 } from "@cosyte/hl7";
import { complex, list, primitive, parseResource, type FhirComplex } from "@cosyte/fhir";

import { toV2Patient, ISSUE_CODES, GENDER_TO_V2, NAME_USE_TO_V2 } from "../../src/index.js";

function patient(json: Record<string, unknown>): FhirComplex {
  return parseResource(JSON.stringify({ resourceType: "Patient", ...json })).resource;
}

const codes = (result: { issues: readonly { code: string }[] }): string[] =>
  result.issues.map((i) => i.code);

describe("toV2Patient: the emitted message", () => {
  it("builds a complete ADT message whose MSH-9 carries the caller's trigger verbatim", () => {
    const { value, issues } = toV2Patient(
      patient({
        identifier: [
          {
            value: "MRN1",
            type: {
              coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }],
            },
          },
        ],
        name: [{ use: "maiden", family: "Public", given: ["Jane", "Q"] }],
        birthDate: "1980-01-15",
        gender: "female",
        address: [
          { use: "home", line: ["123 Main St"], city: "Boston", state: "MA", postalCode: "02101" },
        ],
      }),
      "A28",
      { assigningAuthorities: { "urn:oid:1.2.3": "HOSP" } },
    );

    expect(issues).toEqual([]);
    const wire = value?.toString() ?? "";
    expect(wire.startsWith("MSH|^~\\&|")).toBe(true);

    // Parses back under the parser that owns the wire format: no fatal error, MSH-led, fields intact.
    const round = parseHL7(wire);
    expect(round.meta.type).toBe("ADT^A28");
    expect(round.get("PID.3.1")).toBe("MRN1");
    expect(round.get("PID.3.5")).toBe("MR");
    expect(round.get("PID.5.1")).toBe("Public");
    expect(round.get("PID.5.2")).toBe("Jane");
    expect(round.get("PID.5.3")).toBe("Q");
    expect(round.get("PID.5.7")).toBe("M");
    expect(round.get("PID.7")).toBe("19800115");
    expect(round.get("PID.8")).toBe("F");
    expect(round.get("PID.11.1")).toBe("123 Main St");
    expect(round.get("PID.11.3")).toBe("Boston");
    expect(round.get("PID.11.5")).toBe("02101");
    expect(round.get("PID.11.7")).toBe("H");
  });

  it("carries the MSH envelope the caller supplies, and repeats a repeating field", () => {
    const { value } = toV2Patient(
      patient({ name: [{ family: "Public" }, { family: "Doe" }] }),
      "A31",
      { envelope: { sendingApp: "EHR", sendingFacility: "MAIN", controlId: "MSGID1" } },
    );
    const round = parseHL7(value?.toString() ?? "");
    expect(round.meta.sendingApp).toBe("EHR");
    expect(round.meta.controlId).toBe("MSGID1");
    expect(round.get("PID.5.1")).toBe("Public");
    expect(round.get("PID.5[1].1")).toBe("Doe");
  });

  it("escapes delimiter-bearing content instead of splitting a composite", () => {
    const { value } = toV2Patient(patient({ name: [{ family: "Do^e|Public" }] }), "A28");
    const wire = value?.toString() ?? "";
    expect(wire).toContain("Do\\S\\e\\F\\Public");
    expect(parseHL7(wire).get("PID.5.1")).toBe("Do^e|Public");
  });

  it("emits no message when nothing in the resource maps to a PID field", () => {
    const result = toV2Patient(patient({ active: true }), "A28");
    expect(result.value).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_NO_V2_TARGET);
  });

  it("seeds the assigning authority only from the caller, never from the system URI", () => {
    const withSeed = toV2Patient(
      patient({ identifier: [{ value: "MRN1", system: "urn:oid:1.2.3" }] }),
      "A28",
      { assigningAuthorities: { "urn:oid:1.2.3": "HOSP" } },
    );
    expect(parseHL7(withSeed.value?.toString() ?? "").get("PID.3.4")).toBe("HOSP");
    expect(withSeed.issues).toEqual([]);

    const unseeded = toV2Patient(
      patient({ identifier: [{ value: "MRN1", system: "urn:oid:1.2.3" }] }),
      "A28",
    );
    expect(parseHL7(unseeded.value?.toString() ?? "").get("PID.3.4")).toBe(undefined);
    expect(codes(unseeded)).toEqual([ISSUE_CODES.TRANSFORM_NO_V2_TARGET]);
  });
});

describe("toV2Patient: the required trigger", () => {
  it.each([
    ["empty", ""],
    ["whitespace only", "   "],
  ])("refuses a %s trigger without building a message", (_label, trigger) => {
    const result = toV2Patient(patient({ gender: "female" }), trigger);
    expect(result.value).toBeUndefined();
    expect(codes(result)).toEqual([ISSUE_CODES.TRANSFORM_MISSING_TRIGGER]);
  });

  it("refuses a non-string trigger from an untyped caller without throwing", () => {
    // Deliberate: the parameter is typed `string`, and a JavaScript caller can still pass anything.
    const result = toV2Patient(patient({ gender: "female" }), undefined as unknown as string);
    expect(result.value).toBeUndefined();
    expect(codes(result)).toEqual([ISSUE_CODES.TRANSFORM_MISSING_TRIGGER]);
  });

  it("uses the trigger verbatim, never padded or normalized", () => {
    const { value } = toV2Patient(patient({ gender: "male" }), "a08");
    expect(parseHL7(value?.toString() ?? "").meta.type).toBe("ADT^a08");
  });
});

describe("toV2Patient: refusals that never guess", () => {
  it("refuses a resource of another supported type and names it", () => {
    const result = toV2Patient(
      parseResource('{"resourceType":"Observation","status":"final"}').resource,
      "A28",
    );
    expect(result.value).toBeUndefined();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE);
    expect(result.issues[0]?.fhirPath).toBe("Observation");
  });

  it("reports an unrecognized resource type generically, so no input text reaches a diagnostic", () => {
    const result = toV2Patient(parseResource('{"resourceType":"Zzz9"}').resource, "A28");
    expect(result.issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE);
    expect(result.issues[0]?.fhirPath).toBe("Resource");
  });

  it.each([
    ["a gender with an ambiguous inverse", { gender: "other" }, "PID.8"],
    [
      "a name use with an ambiguous inverse",
      { name: [{ use: "official", family: "Public" }] },
      "XPN.7",
    ],
    [
      "an address use with an ambiguous inverse",
      { address: [{ use: "work", city: "Boston" }] },
      "XAD.7",
    ],
    [
      "an address type, which XAD.7 cannot carry alongside use",
      { address: [{ type: "postal", city: "Boston" }] },
      "XAD.7",
    ],
  ])("flags %s rather than picking one v2 code", (_label, json, location) => {
    const result = toV2Patient(patient(json), "A28");
    const flagged = result.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.v2Location).toBe(location);
    expect(
      parseHL7(result.value?.toString() ?? "MSH|^~\\&|||||20260101||ADT^A28|1|P|2.5").get("PID.8"),
    ).toBe(undefined);
  });

  it("keeps the invertible rows of the same maps", () => {
    expect(GENDER_TO_V2["female"]).toBe("F");
    expect(GENDER_TO_V2["other"]).toBeUndefined();
    expect(NAME_USE_TO_V2["maiden"]).toBe("M");
    expect(NAME_USE_TO_V2["official"]).toBeUndefined();
  });

  it.each([
    ["a third given name", { name: [{ family: "Public", given: ["Jane", "Q", "X"] }] }, "XPN.3"],
    ["a second prefix", { name: [{ family: "Public", prefix: ["Dr", "Prof"] }] }, "XPN.5"],
    ["a second suffix", { name: [{ family: "Public", suffix: ["Jr", "III"] }] }, "XPN.4"],
    ["a third address line", { address: [{ line: ["123 Main St", "Apt 4", "1 St"] }] }, "XAD.2"],
    ["a birth date carrying a time", { birthDate: "1980-01-15T10:00:00-05:00" }, "PID.7"],
  ])("flags %s rather than truncating it", (_label, json, location) => {
    const result = toV2Patient(patient(json), "A28");
    const flagged = result.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE,
    );
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.v2Location).toBe(location);
  });

  it("flags an identifier type coding from an unrelated table", () => {
    const result = toV2Patient(
      patient({
        identifier: [
          { value: "MRN1", type: { coding: [{ system: "http://example.org/local", code: "MR" }] } },
        ],
      }),
      "A28",
    );
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2);
    expect(parseHL7(result.value?.toString() ?? "").get("PID.3.5")).toBe(undefined);
  });

  it("flags a populated element with no v2 field in this map", () => {
    const result = toV2Patient(
      patient({ gender: "female", telecom: [{ value: "555-1234" }] }),
      "A28",
    );
    const flagged = result.issues.filter((i) => i.code === ISSUE_CODES.TRANSFORM_NO_V2_TARGET);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]?.v2Location).toBe("PID.13");
    expect(flagged[0]?.fhirPath).toBe("Patient.telecom");
  });
});

describe("toV2Patient: the never-throw guardrail on malformed input", () => {
  it.each([
    ["a node that is not a resource", primitive("Patient")],
    ["a resource with no resourceType", complex([{ name: "gender", value: primitive("female") }])],
  ])("returns a typed diagnostic for %s", (_label, node) => {
    const result = toV2Patient(node, "A28");
    expect(result.value).toBeUndefined();
    expect(codes(result)).toEqual([ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED]);
  });

  it.each([
    [
      "a name that is a string where a HumanName belongs",
      complex([
        { name: "resourceType", value: primitive("Patient") },
        { name: "name", value: primitive("Public") },
      ]),
    ],
    [
      "a birthDate that is a boolean",
      complex([
        { name: "resourceType", value: primitive("Patient") },
        { name: "birthDate", value: primitive(true) },
      ]),
    ],
    [
      "a given name list holding a complex",
      complex([
        { name: "resourceType", value: primitive("Patient") },
        { name: "name", value: list([complex([{ name: "given", value: list([complex([])]) }])]) },
      ]),
    ],
  ])("flags %s without throwing", (_label, node) => {
    const result = toV2Patient(node, "A28");
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED);
  });
});

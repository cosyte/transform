/**
 * Refuter probe suite for the reverse (FHIR to v2) phase (spec S0013-transform-advance).
 *
 * This file is the PASS evidence for the impl gate: it EXECUTES the acceptance criteria that hold
 * rather than reasoning about them. The one criterion that does not hold is in `regress_0013_F1.ts`,
 * where it fails. Run with:
 *
 *   pnpm exec vitest run --config regress_0013_vitest.mjs test/reverse/regress_0013_probe.ts
 */

import { describe, it, expect } from "vitest";
import * as hl7 from "@cosyte/hl7";
import { parseHL7 } from "@cosyte/hl7";
import { parseResource, type FhirNode } from "@cosyte/fhir";

import { toV2Patient, toV2Observation, ISSUE_CODES } from "../../src/index.js";

const node = (json: string) => parseResource(json).resource;
const bag = hl7 as unknown as Record<string, unknown>;

describe("probe: the consumed @cosyte/hl7 public surface (criteria 2, 3, 13)", () => {
  it("exports exactly two build* entry points, and neither is an ADT or ORU assembler", () => {
    expect(
      Object.keys(hl7)
        .filter((k) => k.startsWith("build"))
        .sort(),
    ).toEqual(["buildAck", "buildMessage"]);
  });

  it("exports no buildAdt, no buildOru and no encodeComposite: none can be called at all", () => {
    expect(typeof bag["buildAdt"]).toBe("undefined");
    expect(typeof bag["buildOru"]).toBe("undefined");
    expect(typeof bag["encodeComposite"]).toBe("undefined");
    expect(typeof bag["buildMessage"]).toBe("function");
    expect(typeof bag["parseHL7"]).toBe("function");
  });
});

describe("probe: trigger boundaries (criteria 4, 5, 6)", () => {
  const patient = () => node('{"resourceType":"Patient","gender":"female"}');
  const observation = () =>
    node(
      '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]}}',
    );
  const cases: readonly (readonly [string, unknown])[] = [
    ["undefined", undefined],
    ["null", null],
    ["empty string", ""],
    ["whitespace only", "   "],
    ["tab only", "\t"],
    ["number", 28],
    ["object", { toString: () => "A28" }],
    ["array", ["A28"]],
    ["boolean", true],
  ];
  for (const [name, value] of cases) {
    it(`refuses a ${name} trigger with TRANSFORM_MISSING_TRIGGER and no message`, () => {
      const p = toV2Patient(patient(), value as string);
      expect(p.value).toBeUndefined();
      expect(p.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_MISSING_TRIGGER);
      const o = toV2Observation(observation(), value as string);
      expect(o.value).toBeUndefined();
      expect(o.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_MISSING_TRIGGER);
    });
  }

  it("uses a bare trigger verbatim in MSH-9 for both shapes", () => {
    expect(parseHL7(String(toV2Patient(patient(), "A31").value)).meta.type).toBe("ADT^A31");
    expect(parseHL7(String(toV2Observation(observation(), "R30").value)).meta.type).toBe("ORU^R30");
  });

  it("refuses a padded / delimiter-bearing trigger instead of using it verbatim", () => {
    for (const trig of [" A01 ", "A^28", "A 28", "A|28"]) {
      const p = toV2Patient(patient(), trig);
      expect(p.value).toBeUndefined();
      expect(p.issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE]);
    }
  });
});

describe("probe: never-throw on structurally malformed input (criterion 9)", () => {
  const hostile: readonly string[] = [
    '{"resourceType":"Patient","name":"not-a-list"}',
    '{"resourceType":"Patient","name":[{"family":{"nested":"object"}}]}',
    '{"resourceType":"Patient","name":[[["deep"]]]}',
    '{"resourceType":"Patient","identifier":"scalar"}',
    '{"resourceType":"Patient","identifier":[{"value":true}]}',
    '{"resourceType":"Patient","birthDate":12345}',
    '{"resourceType":"Patient","birthDate":{"a":1}}',
    '{"resourceType":"Patient","gender":[]}',
    '{"resourceType":"Patient","address":[null]}',
    '{"resourceType":"Patient","address":[{"line":[{"x":1}]}]}',
    '{"resourceType":"Patient"}',
    '{"resourceType":123}',
    '{"resourceType":null}',
    "{}",
    '{"resourceType":"Patient","name":null}',
    '{"resourceType":"Observation","status":123}',
    '{"resourceType":"Observation","code":"scalar"}',
    '{"resourceType":"Observation","code":{"coding":"scalar"}}',
    '{"resourceType":"Observation","code":{"coding":[{"code":true}]}}',
    '{"resourceType":"Observation","valueQuantity":{"value":true}}',
    '{"resourceType":"Observation","valueQuantity":"scalar"}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"valueQuantity":{"value":1,"comparator":{"x":1}}}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"referenceRange":"scalar"}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"interpretation":[[]]}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"effectiveDateTime":[1,2]}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"valueQuantity":{"value":1e400}}',
    '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"1"}]},"valueString":{"deep":{"deeper":[1,2,3]}}}',
  ];
  for (const json of hostile) {
    it(`does not throw for ${json.slice(0, 52)}`, () => {
      expect(() => toV2Patient(node(json), "A28")).not.toThrow();
      expect(() => toV2Observation(node(json), "R01")).not.toThrow();
    });
  }

  const forged: readonly (readonly [string, FhirNode])[] = [
    ["a primitive node", { kind: "primitive", value: "x" }],
    ["a list node", { kind: "list", items: [] }],
    ["a complex node with no properties", { kind: "complex", properties: [] }],
  ];
  for (const [name, forgedNode] of forged) {
    it(`does not throw, and flags, for a hand-forged ${name}`, () => {
      expect(() => toV2Patient(forgedNode, "A28")).not.toThrow();
      expect(() => toV2Observation(forgedNode, "R01")).not.toThrow();
      expect(toV2Patient(forgedNode, "A28").issues.map((i) => i.code)).toEqual([
        ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED,
      ]);
    });
  }
});

describe("probe: delimiter-bearing values must not corrupt the wire (criteria 7, 12)", () => {
  for (const family of ["Do^e", "Do&e", "Do~e", "Do|e", "Do\\e", "Do^e&f|g~h\\i"]) {
    it(`round-reads PID-5.1 unchanged for ${JSON.stringify(family)}`, () => {
      const result = toV2Patient(
        node(JSON.stringify({ resourceType: "Patient", name: [{ family }] })),
        "A28",
      );
      expect(parseHL7(String(result.value)).get("PID.5.1")).toBe(family);
    });
  }
});

// (criterion 15 lives in regress_0013_F1.ts, where it fails: that is finding F1.)

describe("probe: out-of-scope resource refusal (criterion 8)", () => {
  for (const type of [
    "Encounter",
    "DiagnosticReport",
    "MedicationRequest",
    "ServiceRequest",
    "Immunization",
    "Appointment",
    "DocumentReference",
  ]) {
    it(`refuses ${type} with a typed diagnostic naming it, and no message`, () => {
      const result = toV2Patient(node(JSON.stringify({ resourceType: type })), "A28");
      expect(result.value).toBeUndefined();
      const unsupported = result.issues.find(
        (i) => i.code === ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE,
      );
      expect(unsupported?.fhirPath).toBe(type);
    });
  }

  it("degrades to the generic Resource for a type outside its own vocabulary", () => {
    for (const type of ["Practitioner", "Organization", "Condition"]) {
      const result = toV2Patient(node(JSON.stringify({ resourceType: type })), "A28");
      expect(result.value).toBeUndefined();
      expect(result.issues.map((i) => [i.code, i.fhirPath])).toEqual([
        [ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE, "Resource"],
      ]);
    }
  });
});

describe("probe: unrecognized coding systems (criterion 16)", () => {
  it("flags a CodeableConcept whose system has no v2 mnemonic, emits no borrowed code", () => {
    const result = toV2Observation(
      node(
        '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://example.org/local","code":"XYZ"}]}}',
      ),
      "R01",
    );
    const wire = result.value === undefined ? "" : String(result.value);
    expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2);
    expect(wire).not.toContain("XYZ");
  });
});

describe("probe: no PHI-bearing value reaches a diagnostic (criteria 7, 12, 15, 16)", () => {
  it("does not interpolate an offending Patient value into any issue", () => {
    const result = toV2Patient(
      node(
        JSON.stringify({
          resourceType: "Patient",
          gender: "SECRETVALUE",
          birthDate: "SECRETVALUE",
          name: [{ use: "SECRETVALUE", family: "SECRETVALUE", given: ["a", "b", "c", "d"] }],
          identifier: [{ value: "SECRETVALUE", system: "http://SECRETVALUE" }],
          address: [{ use: "SECRETVALUE", type: "postal", line: ["1", "2", "3"] }],
          telecom: [{ value: "SECRETVALUE" }],
        }),
      ),
      "A28",
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.issues)).not.toContain("SECRET");
  });

  it("does not leak an unrepresentable Observation value into a diagnostic", () => {
    const result = toV2Observation(
      node(
        JSON.stringify({
          resourceType: "Observation",
          status: "SECRETSTATUS",
          code: {
            coding: [{ system: "http://SECRETSYS", code: "SECRETCODE" }],
            text: "SECRETTEXT",
          },
          valueQuantity: { value: 1e3, unit: "SECRETUNIT", system: "http://SECRETSYS" },
          effectiveDateTime: "SECRETDATE",
        }),
      ),
      "R01",
    );
    expect(result.issues.length).toBeGreaterThan(0);
    expect(JSON.stringify(result.issues)).not.toContain("SECRET");
  });
});

describe("probe: parses back, never a bare segment (criteria 10, 11)", () => {
  const shapes: readonly string[] = [
    '{"resourceType":"Patient","identifier":[{"value":"MRN1"}],"name":[{"family":"Public","given":["Jane"]}],"birthDate":"1980-01-15","gender":"female","address":[{"line":["1 Main"],"city":"Town","state":"ST","postalCode":"00000"}]}',
    '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]},"valueQuantity":{"value":12.5,"unit":"g/dL","code":"g/dL","system":"http://unitsofmeasure.org"},"effectiveDateTime":"2026-01-02T10:15:00-05:00"}',
    '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]},"valueQuantity":{"value":5,"comparator":"<"}}',
  ];
  for (const json of shapes) {
    it(`emits a message parseHL7 accepts for ${json.slice(0, 40)}`, () => {
      const result = json.includes('"Patient"')
        ? toV2Patient(node(json), "A28")
        : toV2Observation(node(json), "R01");
      const wire = String(result.value);
      expect(() => parseHL7(wire)).not.toThrow();
      expect(wire.startsWith("MSH|")).toBe(true);
    });
  }
});

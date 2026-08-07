import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  OBSERVATION_STATUS_MAP,
  DIAGNOSTIC_REPORT_STATUS_MAP,
  HL70078_INTERPRETATION_CODES,
  type TransformResult,
} from "../../src/index.js";

/** A deterministic urn:uuid generator so fullUrls/reference wiring can be asserted exactly. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function msg(lines: readonly string[]) {
  return parseHL7(lines.join("\r"));
}

/** Build a segment string placing values at their 1-indexed HL7 field positions. */
function seg(type: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(...Object.keys(fields).map(Number));
  const parts = [type];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}
const obr = (f: Readonly<Record<number, string>>) => seg("OBR", f);
const obx = (f: Readonly<Record<number, string>>) => seg("OBX", f);

function entryTypes(result: TransformResult): string[] {
  const parsed = parseResource(serializeResource(result.bundle)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry === undefined || !isList(entry)) return [];
  return entry.items.map((e) => {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    return rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
  });
}

function references(result: TransformResult): string[] {
  const json = serializeResource(result.bundle);
  return [...json.matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1] ?? "");
}
function fullUrls(result: TransformResult): string[] {
  const json = serializeResource(result.bundle);
  return [...json.matchAll(/"fullUrl":"([^"]+)"/g)].map((m) => m[1] ?? "");
}
function has(result: TransformResult, code: string, fhirPath?: string): boolean {
  return result.issues.some(
    (i) => i.code === code && (fhirPath === undefined || i.fhirPath === fhirPath),
  );
}

const registry = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } });

const ORU_R01 = [
  "MSH|^~\\&|LAB|LABFAC|EHR|HOSP|20260721150000-0500||ORU^R01^ORU_R01|MSG0002|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  seg("PV1", { 2: "O" }),
  obr({
    1: "1",
    2: "PLACER1",
    3: "FILLER1",
    4: "24331-1^Lipid Panel^LN",
    7: "20260721143000-0500", // observation date/time → effectiveDateTime
    22: "20260721150000-0500", // status change → issued (zoned instant)
    24: "LAB", // diagnostic service section → category
    25: "F", // result status → final
  }),
  obx({
    1: "1",
    2: "NM",
    3: "2093-3^Cholesterol^LN",
    5: "210.50", // exact lexical precision must survive
    6: "mg/dL^mg/dL^UCUM",
    7: "<200",
    8: "H",
    11: "F",
    14: "20260721143000-0500",
  }),
  obx({ 1: "2", 2: "CWE", 3: "32207-3^Appearance^LN", 5: "NORMAL^Normal^L", 11: "F" }),
  obx({ 1: "3", 2: "SN", 3: "1234-5^Titer^LN", 5: "^1600", 6: "^titer", 11: "F" }), // comparator absent
  obx({ 1: "4", 2: "ST", 3: "NOTE^Comment^LN", 5: "See attached report", 11: "F" }),
];

describe("toFhir: ORU^R01 → DiagnosticReport + Observation graph", () => {
  const result = toFhir(msg(ORU_R01), { namingSystem: registry, generateId: seq() });

  it("assembles MessageHeader, Patient, Encounter, then DiagnosticReport followed by its Observations", () => {
    expect(entryTypes(result)).toEqual([
      "MessageHeader",
      "Patient",
      "Encounter",
      "DiagnosticReport",
      "Observation",
      "Observation",
      "Observation",
      "Observation",
    ]);
  });

  it("does not flag TRANSFORM_SEGMENT_ASSEMBLED for the IG-mapped ORU^R01 trigger", () => {
    expect(has(result, ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(false);
  });

  it("maps OBR-4 → DiagnosticReport.code and OBR-25 F → status final", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"code":"24331-1"');
    expect(json).toContain('"status":"final"');
  });

  it("wires DiagnosticReport.subject → Patient and .result → the Observations (references resolve)", () => {
    const urls = new Set(fullUrls(result));
    const refs = references(result);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
    // Every emitted Observation is referenced by the DiagnosticReport.result.
    const json = serializeResource(result.bundle);
    const resultBlock = json.slice(json.indexOf('"result"'));
    expect(resultBlock).toContain("urn:uuid:");
  });

  it("carries OBR-7 → effectiveDateTime, OBR-22 → issued (zoned instant), OBR-24 → category", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"effectiveDateTime":"2026-07-21T14:30:00-05:00"');
    expect(json).toContain('"issued":"2026-07-21T15:00:00-05:00"');
    expect(json).toContain("http://terminology.hl7.org/CodeSystem/v2-0074");
  });

  it("NM → valueQuantity carrying the EXACT lexical magnitude (210.50, no precision loss) + UCUM", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"value":210.50');
    expect(json).toContain('"system":"http://unitsofmeasure.org"');
    expect(json).toContain('"code":"mg/dL"');
  });

  it("OBX-8 H → Observation.interpretation (v3 ObservationInterpretation, code-preserving)", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain(
      '"system":"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"',
    );
    expect(json).toContain('"code":"H"');
  });

  it("OBX-7 → Observation.referenceRange.text (never decomposed)", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"referenceRange":[{"text":"<200"}]');
  });

  it("CWE OBX → valueCodeableConcept (never a fabricated Quantity)", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueCodeableConcept"');
    expect(json).toContain('"code":"NORMAL"');
  });

  it("SN OBX with a comparator → valueQuantity with Quantity.comparator (structured, not string)", () => {
    const json = serializeResource(result.bundle);
    // `^1600` has no comparator/separator → a plain valueQuantity of 1600.
    expect(json).toContain('"value":1600');
  });

  it("ST OBX → valueString", () => {
    expect(serializeResource(result.bundle)).toContain('"valueString":"See attached report"');
  });

  it("every issue is registered, value-free, and carries a v2 location", () => {
    for (const i of result.issues) {
      expect(Object.values(ISSUE_CODES)).toContain(i.code);
      expect(i.v2Location.length).toBeGreaterThan(0);
      expect(i.message.length).toBeGreaterThan(0);
    }
  });
});

describe("toFhir: ORU result-status safety (never a confident wrong result)", () => {
  // OBR-25 defaults to `P` (preliminary) so a stray `final` in the JSON can only be an Observation's.
  const base = (obxFields: Record<number, string>, obrStatus = "P") => [
    "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1",
    "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
    obr({ 1: "1", 3: "FILLER1", 4: "GLU^Glucose^LN", 25: obrStatus }),
    obx({ 1: "1", 2: "NM", 3: "GLU^Glucose^LN", 5: "99", 6: "mg/dL^^UCUM", ...obxFields }),
  ];

  it("OBX-11 C → corrected and X → cancelled (never emitted as final)", () => {
    for (const [code, expected] of [
      ["C", "corrected"],
      ["X", "cancelled"],
    ] as const) {
      const result = toFhir(msg(base({ 11: code })), { namingSystem: registry, generateId: seq() });
      const json = serializeResource(result.bundle);
      expect(json).toContain(`"status":"${expected}"`);
      // No Observation with status "final".
      expect(json).not.toContain('"status":"final"');
    }
  });

  it("an unmapped OBX-11 status leaves status absent → the Observation is withheld (never guessed final)", () => {
    // `R` (entered, not verified) has no HL70085 target.
    const result = toFhir(msg(base({ 11: "R" })), { namingSystem: registry, generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "DiagnosticReport"]);
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "Observation.status")).toBe(true);
    expect(has(result, ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, "Observation")).toBe(true);
    // The DiagnosticReport still emits, just with no result reference to the withheld Observation.
    expect(serializeResource(result.bundle)).not.toContain('"status":"final"');
  });

  it("an unmapped OBR-25 status withholds the DiagnosticReport (never guessed)", () => {
    // `M` (corrected, not final) has no HL70123 target.
    const result = toFhir(msg(base({ 11: "F" }, "M")), {
      namingSystem: registry,
      generateId: seq(),
    });
    expect(entryTypes(result)).not.toContain("DiagnosticReport");
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "DiagnosticReport.status")).toBe(true);
    expect(has(result, ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, "DiagnosticReport")).toBe(true);
    // The valid Observation is still emitted (a standalone result is not lost with its report).
    expect(entryTypes(result)).toContain("Observation");
  });

  it("OBR-25 = N (results pending) is unmapped → report withheld, NEVER emitted as `appended`", () => {
    // HL70123 `N` "Procedure completed, results pending" is in the IG's (not mapped) group. Emitting
    // it as the post-final `appended` would misrepresent a pending report: a fabricated status.
    const result = toFhir(msg(base({ 11: "F" }, "N")), {
      namingSystem: registry,
      generateId: seq(),
    });
    expect(entryTypes(result)).not.toContain("DiagnosticReport");
    expect(serializeResource(result.bundle)).not.toContain('"status":"appended"');
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "DiagnosticReport.status")).toBe(true);
  });

  it("an unrecognized OBX-8 abnormal flag is flagged and dropped: NEVER coerced to normal", () => {
    const result = toFhir(msg(base({ 8: "ZZ", 11: "F" })), {
      namingSystem: registry,
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "Observation.interpretation")).toBe(
      true,
    );
    expect(json).not.toContain('"interpretation"');
  });

  it("a non-numeric NM value is preserved as a string, never a fabricated Quantity", () => {
    const result = toFhir(msg(base({ 5: "PENDING", 11: "F" })), {
      namingSystem: registry,
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueString":"PENDING"');
    expect(json).not.toContain('"valueQuantity"');
  });

  it("a non-UCUM unit is preserved verbatim in Quantity.unit with no code/system, flagged", () => {
    const result = toFhir(msg(base({ 6: "widgets^widgets^LOCAL", 11: "F" })), {
      namingSystem: registry,
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"unit":"widgets"');
    expect(json).not.toContain('"system":"http://unitsofmeasure.org"');
    expect(has(result, ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM)).toBe(true);
  });
});

describe("toFhir: ORU value-type discrimination edges", () => {
  const wrap = (obxLine: string) =>
    msg([
      "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      obr({ 1: "1", 4: "T^Test^LN", 25: "F" }),
      obxLine,
    ]);

  it("SN range (10-20) → valueRange with low/high Quantities", () => {
    const result = toFhir(
      wrap(obx({ 1: "1", 2: "SN", 3: "R^Range^LN", 5: "^10^-^20", 6: "^mm", 11: "F" })),
      {
        generateId: seq(),
      },
    );
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueRange"');
    expect(json).toContain('"low"');
    expect(json).toContain('"high"');
  });

  it("SN ratio (1:2) → valueRatio with numerator/denominator Quantities", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "SN", 3: "R^Ratio^LN", 5: "^1^:^2", 11: "F" })), {
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueRatio"');
    expect(json).toContain('"numerator"');
    expect(json).toContain('"denominator"');
  });

  it("an SN range with a non-decimal endpoint falls back to valueString (never a wrong Quantity)", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "SN", 3: "R^Range^LN", 5: "^1O^-^20", 11: "F" })), {
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueString"');
    expect(json).not.toContain('"valueRange"');
  });

  it("an SN `<>` (unequal) comparator has no FHIR comparator → valueString, never a plain Quantity", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "SN", 3: "N^NotEqual^LN", 5: "<>^5", 11: "F" })), {
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueString"');
    expect(json).not.toContain('"valueQuantity"');
  });

  it("a DT-typed OBX → valueDateTime", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "DT", 3: "D^Date^LN", 5: "20260721", 11: "F" })), {
      generateId: seq(),
    });
    expect(serializeResource(result.bundle)).toContain('"valueDateTime":"2026-07-21"');
  });

  it("a value type with no first-class FHIR target (NA) preserves the raw value as string + flags it", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "NA", 3: "W^Waveform^LN", 5: "1^2^3", 11: "F" })), {
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"valueString"');
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.fhirPath === "Observation.value[x]",
      ),
    ).toBe(true);
  });

  it("an OBX with no OBX-3 code is not emitted (Observation.code is required)", () => {
    const result = toFhir(wrap(obx({ 1: "1", 2: "NM", 5: "5", 11: "F" })), { generateId: seq() });
    expect(entryTypes(result)).not.toContain("Observation");
  });
});

describe("toFhir: ORU dispatch & non-R01 fallback", () => {
  it("a non-R01 ORU trigger builds the results graph but is flagged segment-assembled", () => {
    const oruR30 = [
      "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R30|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      obr({ 1: "1", 4: "GLU^Glucose^LN", 25: "F" }),
      obx({ 1: "1", 2: "NM", 3: "GLU^Glucose^LN", 5: "99", 6: "mg/dL^^UCUM", 11: "F" }),
    ];
    const result = toFhir(msg(oruR30), { generateId: seq() });
    expect(has(result, ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(true);
    expect(entryTypes(result)).toContain("DiagnosticReport");
    expect(entryTypes(result)).toContain("Observation");
  });

  it("an OBX preceding any OBR is surfaced (no report to anchor it), never silently dropped", () => {
    const orphan = [
      "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      obx({ 1: "1", 2: "NM", 3: "GLU^Glucose^LN", 5: "99", 11: "F" }),
    ];
    const result = toFhir(msg(orphan), { generateId: seq() });
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED &&
          i.fhirPath === "DiagnosticReport.result",
      ),
    ).toBe(true);
  });
});

describe("exported Phase-3 table maps mirror the IG ConceptMaps", () => {
  it("HL70085 → observation-status (C corrected, X cancelled, D/W entered-in-error; no final coercion)", () => {
    expect(OBSERVATION_STATUS_MAP).toMatchObject({
      A: "amended",
      C: "corrected",
      D: "entered-in-error",
      F: "final",
      P: "preliminary",
      W: "entered-in-error",
      X: "cancelled",
    });
    // The IG leaves these unmapped: they must NOT resolve (never coerced to final).
    for (const c of ["B", "I", "N", "O", "R", "S", "U", "V"]) {
      expect(Object.hasOwn(OBSERVATION_STATUS_MAP, c)).toBe(false);
    }
  });

  it("HL70123 → diagnostic-report-status (F final, C corrected, X cancelled; A/M/N/Y/Z unmapped)", () => {
    expect(DIAGNOSTIC_REPORT_STATUS_MAP).toMatchObject({
      O: "registered",
      I: "registered",
      S: "registered",
      P: "preliminary",
      R: "partial",
      C: "corrected",
      F: "final",
      X: "cancelled",
    });
    // The IG leaves these unmapped. `N` (results *pending*) in particular must NOT resolve: mapping it
    // to the post-final `appended` would misrepresent a pending report (a fabricated status).
    for (const c of ["A", "M", "N", "Y", "Z"]) {
      expect(Object.hasOwn(DIAGNOSTIC_REPORT_STATUS_MAP, c)).toBe(false);
    }
  });

  it("HL70078 → interpretation is code-preserving and excludes the IG-unmapped flags", () => {
    for (const c of ["H", "HH", "L", "LL", "A", "AA", "N", "HU", "LU"]) {
      expect(HL70078_INTERPRETATION_CODES.has(c)).toBe(true);
    }
    for (const c of ["AC", "HM", "OBX", "QCF", "TOX", "ZZ"]) {
      expect(HL70078_INTERPRETATION_CODES.has(c)).toBe(false);
    }
  });
});

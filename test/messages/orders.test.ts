import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  REQUEST_STATUS_MAP,
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
const orc = (f: Readonly<Record<number, string>>) => seg("ORC", f);
const obr = (f: Readonly<Record<number, string>>) => seg("OBR", f);
const rxo = (f: Readonly<Record<number, string>>) => seg("RXO", f);
const rxr = (f: Readonly<Record<number, string>>) => seg("RXR", f);

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

const ORM_O01 = [
  "MSH|^~\\&|CPOE|HOSP|LAB|HOSP|20260721150000-0500||ORM^O01^ORM_O01|MSGORD1|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  seg("PV1", { 2: "O" }),
  // A service order: ORC (New) + OBR. Identifiers come from ORC-2/3 (OBR-2/3 empty).
  orc({ 1: "NW", 2: "PLACER1", 3: "FILLER1", 9: "20260721140000-0500" }),
  obr({ 1: "1", 4: "24331-1^Lipid Panel^LN", 6: "20260722080000-0500", 31: "R51^Headache^I10" }),
  // A pharmacy order: ORC (New) + RXO + RXR route.
  orc({ 1: "NW", 2: "PLACER2", 3: "FILLER2", 9: "20260721141000-0500" }),
  rxo({
    1: "197361^Amoxicillin 250 MG Oral Tablet^RXNORM",
    2: "250", // give amount min
    4: "mg^milligram^UCUM", // give units
    11: "30", // dispense amount
    13: "2", // refills
  }),
  rxr({ 1: "PO^Oral^HL70162" }),
];

describe("toFhir — ORM_O01 → ServiceRequest + MedicationRequest graph", () => {
  const result = toFhir(msg(ORM_O01), { namingSystem: registry, generateId: seq() });

  it("assembles MessageHeader, Patient, Encounter, then the ServiceRequest and MedicationRequest", () => {
    expect(entryTypes(result)).toEqual([
      "MessageHeader",
      "Patient",
      "Encounter",
      "ServiceRequest",
      "MedicationRequest",
    ]);
  });

  it("does not flag TRANSFORM_SEGMENT_ASSEMBLED for the IG-mapped ORM^O01 trigger", () => {
    expect(has(result, ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(false);
  });

  it("ORC-1 NW → ServiceRequest.status active (HL70119) and intent order", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"resourceType":"ServiceRequest"');
    expect(json).toContain('"status":"active"');
    expect(json).toContain('"intent":"order"');
  });

  it("routes ORC-2/ORC-3 → placer/filler identifiers (v2-0203 PLAC/FILL) and OBR-4 → code", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"value":"PLACER1"');
    expect(json).toContain('"value":"FILLER1"');
    expect(json).toContain('"code":"PLAC"');
    expect(json).toContain('"code":"FILL"');
    expect(json).toContain('"code":"24331-1"');
  });

  it("carries ORC-9 → authoredOn (NW), OBR-6 → occurrenceDateTime, OBR-31 → reasonCode", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"authoredOn":"2026-07-21T14:00:00-05:00"');
    expect(json).toContain('"occurrenceDateTime":"2026-07-22T08:00:00-05:00"');
    expect(json).toContain('"reasonCode"');
    expect(json).toContain('"code":"R51"');
  });

  it("RXO-1 → medicationCodeableConcept (RxNorm), intent order, status unknown + flagged", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"resourceType":"MedicationRequest"');
    expect(json).toContain('"medicationCodeableConcept"');
    expect(json).toContain('"code":"197361"');
    expect(json).toContain("http://www.nlm.nih.gov/research/umls/rxnorm");
    expect(json).toContain('"status":"unknown"');
    expect(
      has(result, ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "MedicationRequest.status"),
    ).toBe(true);
  });

  it("RXO-2/RXO-4 → dosageInstruction.doseAndRate.doseRange.low (precision-exact + UCUM)", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"doseRange"');
    expect(json).toContain('"value":250');
    expect(json).toContain('"code":"mg"');
    expect(json).toContain('"system":"http://unitsofmeasure.org"');
  });

  it("RXR-1 → dosageInstruction.route and RXO-11/RXO-13 → dispenseRequest", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"route"');
    expect(json).toContain('"code":"PO"');
    expect(json).toContain('"dispenseRequest"');
    expect(json).toContain('"numberOfRepeatsAllowed":2');
    expect(json).toContain('"quantity":{"value":30}');
  });

  it("wires both requests' subject → Patient (every reference resolves within the bundle)", () => {
    const urls = new Set(fullUrls(result));
    const refs = references(result);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
  });

  it("every issue is registered, value-free, and carries a v2 location", () => {
    for (const i of result.issues) {
      expect(Object.values(ISSUE_CODES)).toContain(i.code);
      expect(i.v2Location.length).toBeGreaterThan(0);
      expect(i.message.length).toBeGreaterThan(0);
    }
  });
});

describe("toFhir — ServiceRequest status safety (never a guessed request status)", () => {
  const base = (orcFields: Record<number, string>) => [
    "MSH|^~\\&|CPOE|H|LAB|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
    "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
    orc({ 2: "P1", 3: "F1", ...orcFields }),
    obr({ 1: "1", 4: "GLU^Glucose^LN" }),
  ];

  it("an ORC-1 with no HL70119 target (PA parent) leaves status absent → request withheld + flagged", () => {
    // v2-0119 `PA` (Parent order) is in the IG's (unmapped) group.
    const result = toFhir(msg(base({ 1: "PA" })), { namingSystem: registry, generateId: seq() });
    expect(entryTypes(result)).not.toContain("ServiceRequest");
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "ServiceRequest.status")).toBe(true);
    expect(has(result, ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, "ServiceRequest")).toBe(true);
  });

  it("a valued ORC-5 (unspecified IG mapping) leaves status absent → withheld, never mis-applying HL70119", () => {
    const result = toFhir(msg(base({ 1: "NW", 5: "CM" })), {
      namingSystem: registry,
      generateId: seq(),
    });
    expect(entryTypes(result)).not.toContain("ServiceRequest");
    expect(has(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "ServiceRequest.status")).toBe(true);
  });

  it("a cancel/discontinue control code maps to `revoked` (never `cancelled`, absent in request-status)", () => {
    const result = toFhir(msg(base({ 1: "DC" })), { namingSystem: registry, generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"status":"revoked"');
    expect(json).not.toContain('"status":"cancelled"');
  });
});

describe("toFhir — medication path fail-safes", () => {
  const wrap = (rxoLine: string, extra: readonly string[] = []) =>
    msg([
      "MSH|^~\\&|CPOE|H|PH|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "NW", 2: "P1" }),
      rxoLine,
      ...extra,
    ]);

  it("an RXO with no give code (RXO-1) is not emitted (medication[x] is required 1..1)", () => {
    const result = toFhir(wrap(rxo({ 2: "250", 4: "mg^^UCUM" })), { generateId: seq() });
    expect(entryTypes(result)).not.toContain("MedicationRequest");
  });

  it("a non-UCUM dose unit is preserved verbatim with no code/system, flagged at RXO.4", () => {
    const result = toFhir(wrap(rxo({ 1: "D^Drug^RXNORM", 2: "2", 4: "puffs^puffs^LOCAL" })), {
      namingSystem: registry,
      generateId: seq(),
    });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"unit":"puffs"');
    expect(json).not.toContain('"system":"http://unitsofmeasure.org"');
    expect(has(result, ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM, "Quantity.code")).toBe(true);
    expect(
      result.issues.some(
        (i) => i.code === ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM && i.v2Location === "RXO.4",
      ),
    ).toBe(true);
  });

  it("an RXE segment (no IG map) is flagged dropped, never assembled from a guessed layout", () => {
    const result = toFhir(
      wrap(rxo({ 1: "D^Drug^RXNORM" }), [seg("RXE", { 2: "D^Drug^RXNORM", 3: "1" })]),
      { namingSystem: registry, generateId: seq() },
    );
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.fhirPath === "MedicationRequest",
      ),
    ).toBe(true);
  });
});

describe("toFhir — order-message dispatch", () => {
  it("an OMP^O09 order (no IG message map) is segment-assembled + flagged, resources still emit", () => {
    const omp = [
      "MSH|^~\\&|CPOE|H|PH|H|20260101120000-0500||OMP^O09|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "NW", 2: "P1" }),
      rxo({ 1: "D^Drug^RXNORM", 2: "1", 4: "mg^^UCUM" }),
    ];
    const result = toFhir(msg(omp), { namingSystem: registry, generateId: seq() });
    expect(has(result, ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(true);
    expect(entryTypes(result)).toContain("MedicationRequest");
  });

  it("an ORU^R01 is NOT treated as an order (its OBR anchors a DiagnosticReport, not a ServiceRequest)", () => {
    const oru = [
      "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      obr({ 1: "1", 4: "GLU^Glucose^LN", 25: "F" }),
      seg("OBX", { 1: "1", 2: "NM", 3: "GLU^Glucose^LN", 5: "99", 11: "F" }),
    ];
    const result = toFhir(msg(oru), { namingSystem: registry, generateId: seq() });
    expect(entryTypes(result)).toContain("DiagnosticReport");
    expect(entryTypes(result)).not.toContain("ServiceRequest");
  });
});

describe("toFhir — order-group assembly & optional fields", () => {
  it("an ORC-only order (no OBR) → a ServiceRequest from ORC alone (status/identifiers, no code)", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|LAB|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "OK", 2: "P9", 3: "F9" }),
    ];
    const result = toFhir(msg(lines), { namingSystem: registry, generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(entryTypes(result)).toContain("ServiceRequest");
    expect(json).toContain('"status":"active"'); // OK → active
    expect(json).toContain('"value":"P9"');
    expect(json).not.toContain('"occurrenceDateTime"');
    expect(json).not.toContain('"reasonCode"');
  });

  it("prefers OBR-2/OBR-3 for placer/filler when the OBR carries its own order numbers", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|LAB|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "NW" }),
      obr({ 1: "1", 2: "OBRPLAC", 3: "OBRFILL", 4: "GLU^Glucose^LN" }),
    ];
    const json = serializeResource(
      toFhir(msg(lines), { namingSystem: registry, generateId: seq() }).bundle,
    );
    expect(json).toContain('"value":"OBRPLAC"');
    expect(json).toContain('"value":"OBRFILL"');
  });

  it("withholds both requests when there is no Patient to anchor the required subject", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|LAB|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      orc({ 1: "NW", 2: "P1" }),
      obr({ 1: "1", 4: "GLU^Glucose^LN" }),
    ];
    const result = toFhir(msg(lines), { namingSystem: registry, generateId: seq() });
    expect(entryTypes(result)).not.toContain("ServiceRequest");
    expect(has(result, ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, "ServiceRequest")).toBe(true);
  });

  it("a bare OBR (no ORC) has no status source → the ServiceRequest is withheld", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|LAB|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      obr({ 1: "1", 4: "GLU^Glucose^LN" }), // no ORC → no ORC-1 → no status
      orc({ 1: "NW", 2: "P2" }),
      rxo({ 1: "D^Drug^RXNORM" }),
      rxo({ 1: "D2^Drug2^RXNORM" }), // a second RXO under the same ORC opens its own group
    ];
    const result = toFhir(msg(lines), { namingSystem: registry, generateId: seq() });
    // The bare OBR's ServiceRequest is withheld; both RXO medication requests emit.
    expect(entryTypes(result).filter((t) => t === "MedicationRequest")).toHaveLength(2);
    expect(entryTypes(result)).not.toContain("ServiceRequest");
  });

  it("a minimal RXO (give code only, no dose/dispense/route) emits a MedicationRequest with none of them", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|PH|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "NW", 2: "P1" }),
      rxo({ 1: "D^Drug^RXNORM" }),
    ];
    const json = serializeResource(
      toFhir(msg(lines), { namingSystem: registry, generateId: seq() }).bundle,
    );
    expect(json).toContain('"resourceType":"MedicationRequest"');
    expect(json).not.toContain('"dosageInstruction"');
    expect(json).not.toContain('"dispenseRequest"');
  });

  it("a non-unsignedInt refill count (RXO-13) is dropped + flagged, never emitted as an invalid primitive", () => {
    const lines = [
      "MSH|^~\\&|CPOE|H|PH|H|20260101120000-0500||ORM^O01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
      orc({ 1: "NW", 2: "P1" }),
      rxo({ 1: "D^Drug^RXNORM", 11: "30", 13: "2.5" }),
    ];
    const result = toFhir(msg(lines), { namingSystem: registry, generateId: seq() });
    expect(serializeResource(result.bundle)).not.toContain('"numberOfRepeatsAllowed"');
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED &&
          i.fhirPath === "dispenseRequest.numberOfRepeatsAllowed",
      ),
    ).toBe(true);
  });
});

describe("REQUEST_STATUS_MAP mirrors the IG HL70119 → request-status ConceptMap", () => {
  it("carries only the 19 mapped codes, to valid request-status values", () => {
    expect(REQUEST_STATUS_MAP).toMatchObject({
      NW: "active",
      OK: "active",
      HR: "on-hold",
      OH: "on-hold",
      DC: "revoked",
      CR: "revoked",
      FU: "completed",
    });
    expect(Object.keys(REQUEST_STATUS_MAP)).toHaveLength(19);
    // request-status has no `cancelled`/`draft`; every target is a real request-status code.
    const valid = new Set([
      "active",
      "on-hold",
      "revoked",
      "completed",
      "entered-in-error",
      "unknown",
    ]);
    for (const v of Object.values(REQUEST_STATUS_MAP)) expect(valid.has(v)).toBe(true);
  });

  it("excludes the codes the IG leaves in its (unmapped) group", () => {
    for (const c of ["CH", "CP", "PA", "RE", "RF", "RP", "SC", "UA", "UC", "XO", "MC"]) {
      expect(Object.hasOwn(REQUEST_STATUS_MAP, c)).toBe(false);
    }
  });
});

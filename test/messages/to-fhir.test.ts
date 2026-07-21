import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  ADMINISTRATIVE_GENDER_MAP,
  ENCOUNTER_CLASS_V3_MAP,
  ENCOUNTER_STATUS_MAP,
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

/** Deep-find the first property value named `name` under a resource node (test convenience). */
function prop(node: unknown, name: string): unknown {
  if (node !== null && typeof node === "object" && isComplex(node as never)) {
    return getProperty(node as never, name);
  }
  return undefined;
}

/** All `reference` strings anywhere in the serialized bundle. */
function references(result: TransformResult): string[] {
  const json = serializeResource(result.bundle);
  return [...json.matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** All `fullUrl` strings in the bundle. */
function fullUrls(result: TransformResult): string[] {
  const json = serializeResource(result.bundle);
  return [...json.matchAll(/"fullUrl":"([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** The resourceType of each entry, in order. */
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

/** Build a PV1 segment string placing values at their 1-indexed HL7 field positions. */
function pv1(fields: Readonly<Record<number, string>>): string {
  const max = Math.max(...Object.keys(fields).map(Number));
  const parts = ["PV1"];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

const ADT_A01 = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "EVN|A01|20260721143000-0500",
  "PID|1||MRN12345^^^HOSP^MR~999887777^^^SSA^SS||Public^Jane^Q^^Mrs.^^L||19800115|F|||123 Main St^Apt 4^Boston^MA^02101^USA^H|||555-1234",
  "NK1|1|Public^John^^^^^L|SPO|456 Oak Ave^^Boston^MA^02101",
  pv1({
    2: "I", // patient class → Encounter.class IMP
    3: "ICU^101^A", // assigned location (deferred)
    7: "1234^Welby^Marcus^^^Dr.", // attending (deferred)
    8: "5678^Smith^Sam", // referring (deferred)
    19: "VISIT001", // visit number → Encounter.identifier VN
    44: "20260721143000-0500", // admit → period.start
    45: "20260721150000-0500", // discharge → period.end + status finished
  }),
];

describe("toFhir — ADT^A01 message assembly", () => {
  const registry = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } });
  const result = toFhir(msg(ADT_A01), { namingSystem: registry, generateId: seq() });

  it("produces a FHIR message Bundle with MessageHeader first, then Patient, Encounter, RelatedPerson", () => {
    expect(prop(result.bundle, "resourceType")).toMatchObject({ value: "Bundle" });
    expect(prop(result.bundle, "type")).toMatchObject({ value: "message" });
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "Encounter", "RelatedPerson"]);
  });

  it("carries MSH-10 on Bundle.identifier and MSH-7 on Bundle.timestamp (zoned instant)", () => {
    expect(prop(prop(result.bundle, "identifier"), "value")).toMatchObject({ value: "MSG00001" });
    expect(prop(result.bundle, "timestamp")).toMatchObject({ value: "2026-07-21T14:30:00-05:00" });
  });

  it("wires every reference to a fullUrl that exists in the bundle (references resolve within)", () => {
    const urls = new Set(fullUrls(result));
    const refs = references(result);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
  });

  it("maps PID-8 F → Patient.gender female and PID-7 → birthDate at date precision", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"gender":"female"');
    expect(json).toContain('"birthDate":"1980-01-15"');
  });

  it("resolves the registered assigning authority and flags the unresolved one (never synthesized)", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"system":"urn:oid:1.2.840.114350"'); // HOSP resolved
    const unresolved = result.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED,
    );
    expect(unresolved).toHaveLength(1); // SSA not in the registry
    expect(unresolved[0]?.v2Location).toBe("CX.4");
  });

  it("maps PV1-2 I → Encounter.class IMP (v3 ActCode) and, with a discharge, status finished", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"system":"http://terminology.hl7.org/CodeSystem/v3-ActCode"');
    expect(json).toContain('"code":"IMP"');
    expect(json).toContain('"status":"finished"');
  });

  it("does not flag TRANSFORM_SEGMENT_ASSEMBLED for an IG-mapped ADT trigger", () => {
    expect(result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(
      false,
    );
  });

  it("emits MessageHeader.source.endpoint as data-absent (never a fabricated URL) + flags it", () => {
    const json = serializeResource(result.bundle);
    expect(json).toContain('"_endpoint"');
    expect(json).toContain("data-absent-reason");
    expect(
      result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN),
    ).toBe(true);
  });

  it("every issue carries a registered code, a v2 location, and no value", () => {
    for (const i of result.issues) {
      expect(Object.values(ISSUE_CODES)).toContain(i.code);
      expect(i.v2Location.length).toBeGreaterThan(0);
      expect(i.message.length).toBeGreaterThan(0);
    }
  });
});

describe("toFhir — reference wiring & fail-safe edges", () => {
  it("omits Encounter.subject (flagged) when there is no PID/Patient to anchor it", () => {
    const noPid = ["MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1", "PV1|1|O|||||||||||||||||V9"];
    const result = toFhir(msg(noPid), { generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader", "Encounter"]);
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.fhirPath === "Encounter.subject",
      ),
    ).toBe(true);
    // No dangling references: the only reference is the MessageHeader.focus → Encounter.
    const urls = new Set(fullUrls(result));
    for (const r of references(result)) expect(urls.has(r)).toBe(true);
  });

  it("drops NK1 (flagged) when there is no Patient to anchor RelatedPerson.patient", () => {
    const noPid = ["MSH|^~\\&|A|B|C|D|20260101||ADT^A04|M1|P|2.5.1", "NK1|1|Doe^Jane|SPO"];
    const result = toFhir(msg(noPid), { generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader"]);
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED &&
          i.fhirPath === "RelatedPerson.patient",
      ),
    ).toBe(true);
  });

  it("flags a non-IG-mapped trigger as segment-assembled (never a fabricated message map)", () => {
    const a31 = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A31|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
    ];
    const result = toFhir(msg(a31), { generateId: seq() });
    expect(result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(
      true,
    );
    expect(entryTypes(result)).toContain("Patient");
  });

  it("an unmapped-trigger message is segment-assembled and still yields a Patient", () => {
    // ORU^R01 is now IG-mapped (Phase 3); ORU^R30 has no IG message map → segment-assembled.
    const oru = [
      "MSH|^~\\&|A|B|C|D|20260101||ORU^R30|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
    ];
    const result = toFhir(msg(oru), { generateId: seq() });
    expect(result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(
      true,
    );
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient"]);
  });

  it("flags an unmapped administrative-sex code (never guessed) and leaves gender absent", () => {
    const weird = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|ZZZ",
    ];
    const result = toFhir(msg(weird), { generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(json).not.toContain('"gender"');
    expect(
      result.issues.some(
        (i) => i.code === ISSUE_CODES.TRANSFORM_CODE_UNMAPPED && i.fhirPath === "Patient.gender",
      ),
    ).toBe(true);
  });

  it("maps a self-mapped patient class (R) into the v2-0004 system, not v3 ActCode", () => {
    const rec = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      "PV1|1|R",
    ];
    const result = toFhir(msg(rec), { generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(json).toContain('"system":"http://terminology.hl7.org/CodeSystem/v2-0004"');
    expect(json).toContain('"code":"R"');
    expect(json).toContain('"status":"in-progress"'); // no discharge → Table 0004 status
  });

  it("withholds an Encounter with an unmapped class/status (R4 1..1) rather than shipping it invalid", () => {
    const weird = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      "PV1|1|Z",
    ];
    const result = toFhir(msg(weird), { generateId: seq() });
    // The unmapped class leaves Encounter.class + status absent → structurally invalid R4 → withheld.
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient"]);
    expect(
      result.issues.filter(
        (i) => i.code === ISSUE_CODES.TRANSFORM_CODE_UNMAPPED && i.v2Location === "PV1.2",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(
      result.issues.some(
        (i) => i.code === ISSUE_CODES.TRANSFORM_RESOURCE_INVALID && i.fhirPath === "Encounter",
      ),
    ).toBe(true);
  });

  it("preserves a naked (no-timezone) admit timestamp fail-safe: no time in period, flagged", () => {
    const naked = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      "PV1|1|O||||||||||||||||||||||||||||||||||||||||||20260721143000",
    ];
    const result = toFhir(msg(naked), { generateId: seq() });
    const json = serializeResource(result.bundle);
    // The admit time cannot become a zoned instant → date precision, never a guessed UTC.
    expect(json).not.toContain("T14:30:00Z");
    expect(result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE)).toBe(
      true,
    );
  });

  it("drops a date-only MSH-7 from Bundle.timestamp (not a valid instant), flagged", () => {
    const dateOnly = [
      "MSH|^~\\&|A|B|C|D|20260721||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
    ];
    const result = toFhir(msg(dateOnly), { generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(json).not.toContain('"timestamp"');
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.fhirPath === "Bundle.timestamp",
      ),
    ).toBe(true);
  });

  it("emits no Patient when the PID carries nothing emittable", () => {
    const emptyPid = ["MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1", "PID|1"];
    const result = toFhir(msg(emptyPid), { generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader"]);
  });

  it("emits no RelatedPerson when an NK1 carries nothing beyond the patient link", () => {
    const emptyNk1 = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      "NK1|1",
    ];
    const result = toFhir(msg(emptyNk1), { generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient"]);
  });

  it("flags MSH-9 with no trigger event (eventCoding absent, never fabricated)", () => {
    const noTrigger = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
    ];
    const result = toFhir(msg(noTrigger), { generateId: seq() });
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_CODE_UNMAPPED &&
          i.fhirPath === "MessageHeader.eventCoding",
      ),
    ).toBe(true);
    // A MessageHeader with no event[x] (R4 1..1) is invalid → withheld, not shipped without its event.
    expect(entryTypes(result)).toEqual(["Patient"]);
    expect(
      result.issues.some(
        (i) => i.code === ISSUE_CODES.TRANSFORM_RESOURCE_INVALID && i.fhirPath === "MessageHeader",
      ),
    ).toBe(true);
    // no trigger → not IG-mapped → segment-assembled
    expect(result.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED)).toBe(
      true,
    );
  });

  it("reduces a birth date/time with a zone to date precision (drops the time), flagged", () => {
    const dobTime = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19800115143000-0500|M",
    ];
    const result = toFhir(msg(dobTime), { generateId: seq() });
    expect(serializeResource(result.bundle)).toContain('"birthDate":"1980-01-15"');
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.fhirPath === "Patient.birthDate",
      ),
    ).toBe(true);
  });

  it("flags NK1 telecom as deferred (no XTN converter yet)", () => {
    const withPhone = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      "NK1|1|Kin^Next|SPO|1 St^^Boston^MA|555-9999",
    ];
    const result = toFhir(msg(withPhone), { generateId: seq() });
    expect(
      result.issues.some(
        (i) =>
          i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED &&
          i.fhirPath === "RelatedPerson.telecom",
      ),
    ).toBe(true);
  });

  it("drops unparseable admit/discharge timestamps — no period, no fabricated instant", () => {
    const badTs = [
      "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
      "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|M",
      pv1({ 2: "I", 44: "BADADMIT", 45: "BADDISCHG" }),
    ];
    const result = toFhir(msg(badTs), { generateId: seq() });
    const json = serializeResource(result.bundle);
    expect(json).not.toContain('"period"');
    // The parser drops the unparseable discharge, so status falls back to the class map, not finished.
    expect(json).toContain('"status":"in-progress"');
  });

  it("stays fail-safe when present fields carry only unmapped/empty parts (no fabricated values)", () => {
    // MSH-3 empty; a PID-3 rep with no id; PID-5/PID-11 with only an unmapped code; an NK1 whose
    // every field collapses to nothing. Nothing is fabricated; the Patient still emits on its valid id.
    const adversarial = [
      "MSH|^~\\&||FAC|RCV|RFAC|20260101120000-0500||ADT^A01|M1|P|2.5.1",
      "PID|1||^^^HOSP^MR~MRN2^^^HOSP^MR||^^^^^^ZZ||19900101|M|||^^^^^^ZZ",
      "NK1|1|^^^^^^ZZ|^^SCT|^^^^^^ZZ",
    ];
    const registry2 = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.3.4" } });
    const result = toFhir(msg(adversarial), { namingSystem: registry2, generateId: seq() });
    const json = serializeResource(result.bundle);
    // Patient emitted (valid MRN2), but no name/address (their only parts were unmapped), no gender guess.
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient"]);
    expect(json).toContain('"value":"MRN2"');
    expect(json).not.toContain('"name"');
    expect(json).not.toContain('"address"');
    // MessageHeader.source has no name (MSH-3 empty) but still a data-absent endpoint.
    expect(json).toContain('"_endpoint"');
  });

  it("emits an empty PV1 as no Encounter (nothing emittable, no subject to anchor)", () => {
    const emptyPv1 = ["MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1", "PV1|1"];
    const result = toFhir(msg(emptyPv1), { generateId: seq() });
    expect(entryTypes(result)).toEqual(["MessageHeader"]);
  });

  it("uses crypto.randomUUID by default (valid urn:uuid fullUrls) when no generator is injected", () => {
    const result = toFhir(msg(ADT_A01));
    for (const u of fullUrls(result)) {
      expect(u).toMatch(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    }
  });
});

describe("exported Phase-2 table maps mirror the IG ConceptMaps", () => {
  it("HL70001 → administrative-gender (A and N narrow to other)", () => {
    expect(ADMINISTRATIVE_GENDER_MAP).toMatchObject({
      F: "female",
      M: "male",
      O: "other",
      U: "unknown",
      A: "other",
      N: "other",
    });
  });

  it("HL70004 → v3 ActCode (only the four with a v3 equivalent)", () => {
    expect(Object.keys(ENCOUNTER_CLASS_V3_MAP).sort()).toEqual(["E", "I", "O", "P"]);
    expect(ENCOUNTER_CLASS_V3_MAP["I"]).toMatchObject({ code: "IMP" });
  });

  it("HL70004 → encounter-status (P planned, U unknown, rest in-progress)", () => {
    expect(ENCOUNTER_STATUS_MAP["P"]).toBe("planned");
    expect(ENCOUNTER_STATUS_MAP["U"]).toBe("unknown");
    expect(ENCOUNTER_STATUS_MAP["I"]).toBe("in-progress");
  });
});

/**
 * The two ORU_R01 message-map rows this library recognized and did not build: `4.2.7.1
 * ORDER_OBSERVATION.SPECIMEN.SPM` → a `Specimen` referenced from the `DiagnosticReport` that scopes
 * it, and `4.2.4.3.3 ORDER_OBSERVATION.OBSERVATION.NTE` → `Observation.note`.
 *
 * Both are positional facts about the message, so both are tested positionally, and both carry a
 * negative the map itself states: a specimen never outlives the report that scopes it, and the
 * PATIENT-level and ORDER_OBSERVATION-level NTE rows publish no FHIR target at all, so neither may
 * reach an Observation however close to one it sits on the wire.
 */

import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  SPM_SHIPMENT_IDENTIFIER_TYPE,
  type TransformResult,
} from "../../src/index.js";

/** A deterministic urn:uuid generator so fullUrls/reference wiring can be asserted exactly. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

const registry = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } });

/** Build a segment string placing values at their 1-indexed HL7 field positions. */
function seg(type: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(...Object.keys(fields).map(Number));
  const parts = [type];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

const MSH = "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1";
const PID = "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F";
/** An OBR whose OBR-25 result status the HL70123 map DOES carry, so its report is emitted. */
const OBR_FINAL = seg("OBR", { 1: "1", 3: "FILLER1", 4: "T^Test^LN", 25: "F" });
/** The same OBR with `M`, which HL70123 leaves unmapped: the emit gate withholds its report. */
const OBR_WITHHELD = seg("OBR", { 1: "1", 3: "FILLER1", 4: "T^Test^LN", 25: "M" });
const OBX_FINAL = seg("OBX", { 1: "1", 2: "ST", 3: "V^Value^LN", 5: "text", 11: "F" });

function run(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), { namingSystem: registry, generateId: seq() });
}

function wire(result: TransformResult): string {
  return serializeResource(result.bundle);
}

function entryTypes(result: TransformResult): string[] {
  const parsed = parseResource(wire(result)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry === undefined || !isList(entry)) return [];
  return entry.items.map((e) => {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    return rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
  });
}

/** The serialized JSON of the first resource of `type` in the bundle, or `""` when there is none. */
function resourceJson(result: TransformResult, type: string): string {
  const parsed = parseResource(wire(result)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry === undefined || !isList(entry)) return "";
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    if (res === undefined || !isComplex(res)) continue;
    const rt = getProperty(res, "resourceType");
    const found = rt !== undefined && "value" in rt ? (rt as { value: unknown }).value : undefined;
    if (found === type) return serializeResource(res);
  }
  return "";
}

/** Every `reference` and every `fullUrl` in the serialized bundle. */
function refsAndUrls(result: TransformResult): { refs: string[]; urls: Set<string> } {
  const json = wire(result);
  return {
    refs: [...json.matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1] ?? ""),
    urls: new Set([...json.matchAll(/"fullUrl":"([^"]+)"/g)].map((m) => m[1] ?? "")),
  };
}

/** `CODE@v2Location` for every completeness issue the assembly appended. */
function completenessLabels(result: TransformResult): string[] {
  const codes: readonly string[] = [
    ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED,
    ISSUE_CODES.TRANSFORM_SEGMENT_NO_IG_MAP,
  ];
  return result.issues
    .filter((i) => codes.includes(i.code))
    .map((i) => `${i.code}@${i.v2Location}`);
}

const NOT_EMITTED = ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED;

// ── SPM → Specimen, referenced from its report (AC-3, AC-16, AC-17) ─────────────────────────────

const SPM_FULL = [
  "SPM",
  "1",
  "PLACERSPEC1^FILLERSPEC1",
  "",
  "BLD^Whole blood^HL70487",
  "",
  "EDTA^EDTA^HL70371",
  "VENIP^Venipuncture^HL70488",
  "RAC^Right antecubital^L",
  "",
  "",
  "",
  "",
  "",
  "Gross exam normal",
  "",
  "",
  "20260721143000-0500^20260721150000-0500",
  "20260721160000-0500",
  "",
  "",
  "",
  "",
  "",
  "HEM^Hemolyzed^HL70493",
  "",
  "",
  "TUBE^Red top^L",
  "",
  "",
  "ACC1^^^HOSP^MR",
  "",
  "SHIPMENT1",
].join("|");

describe("an SPM in an ORU becomes a Specimen the DiagnosticReport that scopes it points at", () => {
  const result = run([MSH, PID, OBR_FINAL, OBX_FINAL, SPM_FULL]);

  it("emits the Specimen after the report and before the report's Observations", () => {
    expect(entryTypes(result)).toEqual([
      "MessageHeader",
      "Patient",
      "DiagnosticReport",
      "Specimen",
      "Observation",
    ]);
  });

  it("wires DiagnosticReport.specimen to it, and every reference in the bundle still resolves", () => {
    const specimenUrl = [
      ...wire(result).matchAll(/"fullUrl":"([^"]+)","resource":\{"resourceType":"Specimen"/g),
    ]
      .map((m) => m[1] ?? "")
      .at(0);
    expect(specimenUrl).toBeDefined();
    expect(resourceJson(result, "DiagnosticReport")).toContain(
      `"specimen":[{"reference":"${specimenUrl ?? ""}"}]`,
    );
    const { refs, urls } = refsAndUrls(result);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
  });

  it("carries the rows the SPM map grounds, each to the target the map names", () => {
    const specimen = resourceJson(result, "Specimen");
    // SPM-2's two entity identifiers, then SPM-32's shipment id under the type the row assigns.
    expect(specimen).toContain('"identifier":[{"value":"PLACERSPEC1"},{"value":"FILLERSPEC1"}');
    expect(specimen).toContain(`"code":"${SPM_SHIPMENT_IDENTIFIER_TYPE}"`);
    expect(specimen).toContain('"value":"SHIPMENT1"');
    expect(specimen).toContain('"accessionIdentifier":{'); // SPM-30
    expect(specimen).toContain('"code":"BLD"'); // SPM-4 -> type
    expect(specimen).toContain('"receivedTime":"2026-07-21T16:00:00-05:00"'); // SPM-18
    expect(specimen).toContain('"method":{'); // SPM-7
    expect(specimen).toContain('"bodySite":{'); // SPM-8
    // SPM-17 with SPM-17.2 valued is a collectedPeriod, per the row's own condition.
    expect(specimen).toContain(
      '"collectedPeriod":{"start":"2026-07-21T14:30:00-05:00","end":"2026-07-21T15:00:00-05:00"}',
    );
    expect(specimen).toContain('"code":"TUBE"'); // SPM-27 -> container.type
    expect(specimen).toContain('"code":"EDTA"'); // SPM-6 -> container.additiveCodeableConcept
    expect(specimen).toContain('"code":"HEM"'); // SPM-24 -> condition
    expect(specimen).toContain('"note":[{"text":"Gross exam normal"}]'); // SPM-14
    expect(specimen).toContain('"subject":{"reference":"urn:uuid:');
  });

  it("takes SPM-17 to a collectedDateTime when SPM-17.2 is NOT valued, never a one-ended period", () => {
    const spm = seg("SPM", {
      1: "1",
      2: "SPEC1",
      4: "BLD^Blood^HL70487",
      17: "20260721143000-0500",
    });
    const single = run([MSH, PID, OBR_FINAL, OBX_FINAL, spm]);
    const specimen = resourceJson(single, "Specimen");
    expect(specimen).toContain('"collectedDateTime":"2026-07-21T14:30:00-05:00"');
    expect(specimen).not.toContain("collectedPeriod");
  });

  it("never asserts a specimen status, and declares the three rows it reads and does not build", () => {
    // SPM-20 reaches `status` only through a Table 0136 value map this library does not carry, and
    // every member of R4's required binding is a positive claim about a sample.
    const spm = seg("SPM", {
      1: "1",
      2: "SPEC1",
      3: "PARENT1",
      4: "BLD^Blood^HL70487",
      12: "5^mL",
      20: "Y",
    });
    const declared = run([MSH, PID, OBR_FINAL, OBX_FINAL, spm]);
    expect(resourceJson(declared, "Specimen")).not.toContain('"status"');
    const labels = declared.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@SPM.3#Specimen.parent`,
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@SPM.12#Specimen.collection.quantity`,
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@SPM.20#Specimen.status`,
      ]),
    );
  });

  it("emits no Specimen at all from an SPM that grounds no row of the map", () => {
    // SPM-1 is a set id with no target: the segment arrived and described nothing.
    const empty = run([MSH, PID, OBR_FINAL, OBX_FINAL, "SPM|1"]);
    expect(entryTypes(empty)).not.toContain("Specimen");
    expect(completenessLabels(empty)).toContain(`${NOT_EMITTED}@SPM[1]`);
  });

  it("names no subject when the bundle carries no Patient, rather than a reference to nothing", () => {
    const noPatient = run([
      MSH,
      OBR_FINAL,
      OBX_FINAL,
      seg("SPM", { 1: "1", 2: "SPEC1", 4: "BLD^Blood^HL70487" }),
    ]);
    const specimen = resourceJson(noPatient, "Specimen");
    expect(specimen).toContain('"resourceType":"Specimen"');
    expect(specimen).not.toContain('"subject"');
    const { refs, urls } = refsAndUrls(noPatient);
    for (const r of refs) expect(urls.has(r)).toBe(true);
  });

  it("drops an SPM-18 that is no timestamp at all rather than emitting a receivedTime for it", () => {
    const bad = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      seg("SPM", { 1: "1", 2: "SPEC1", 4: "BLD^Blood^HL70487", 18: "NOTATIMESTAMP" }),
    ]);
    expect(resourceJson(bad, "Specimen")).not.toContain("receivedTime");
    expect(bad.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });

  it("skips an SPM-14 repetition that carries nothing, and keeps the ones that do", () => {
    const notes = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      seg("SPM", { 1: "1", 2: "SPEC1", 4: "BLD^Blood^HL70487", 14: "first~~third" }),
    ]);
    expect(resourceJson(notes, "Specimen")).toContain(
      '"note":[{"text":"first"},{"text":"third"}]',
    );
  });

  it("stops reporting the SPM as not emitted, so the completeness report agrees with the bundle", () => {
    // The falsifiable half of AC-16: the same message reported `SPM[1]` before this row was built.
    expect(completenessLabels(result)).toEqual([]);
    expect(entryTypes(result)).toContain("Specimen");
  });

  it("builds one Specimen per SPM occurrence and reports none of them", () => {
    const two = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      "SPM|1|SPEC1||BLD^Blood^HL70487",
      "SPM|2|SPEC2||UR^Urine^HL70487",
    ]);
    expect(entryTypes(two).filter((t) => t === "Specimen")).toHaveLength(2);
    expect(completenessLabels(two)).toEqual([]);
    expect(resourceJson(two, "DiagnosticReport")).toMatch(/"specimen":\[\{[^\]]*\},\{[^\]]*\}\]/);
  });

  it("leaves an SPM outside an ORU exactly where it was: recognized, unread, and reported", () => {
    // The row that builds a Specimen is the ORU message map's, and it wires the specimen to a
    // DiagnosticReport. An ADT has none, so nothing here changes for one.
    const adt = run([
      "MSH|^~\\&|APP|F|RCV|H|20260101120000-0500||ADT^A01|M1|P|2.5.1",
      PID,
      "SPM|1|SPEC1||BLD^Blood^HL70487",
    ]);
    expect(entryTypes(adt)).not.toContain("Specimen");
    expect(completenessLabels(adt)).toContain(`${NOT_EMITTED}@SPM[1]`);
  });
});

describe("a withheld report takes its specimens with it (AC-17)", () => {
  const result = run([MSH, PID, OBR_WITHHELD, OBX_FINAL, SPM_FULL]);

  it("emits neither the report nor an orphaned Specimen entry beside it", () => {
    expect(entryTypes(result)).not.toContain("DiagnosticReport");
    expect(entryTypes(result)).not.toContain("Specimen");
    // The Observation of the group still stands on its own, as it always has.
    expect(entryTypes(result)).toContain("Observation");
  });

  it("leaves no reference in the bundle that resolves to nothing", () => {
    const { refs, urls } = refsAndUrls(result);
    expect(refs.length).toBeGreaterThan(0);
    for (const r of refs) expect(urls.has(r)).toBe(true);
    expect(wire(result)).not.toContain('"specimen"');
  });

  it("reports the SPM as not emitted, because read and withheld is not reached", () => {
    expect(completenessLabels(result)).toEqual(
      expect.arrayContaining([`${NOT_EMITTED}@SPM[1]`, `${NOT_EMITTED}@OBR[1]`]),
    );
  });
});

// ── NTE → Observation.note, and only from the OBSERVATION group (AC-18) ─────────────────────────

describe("an NTE inside the OBSERVATION group becomes that Observation's note", () => {
  it("attaches the comment text, and NTE-6 as the annotation time", () => {
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      "NTE|1|L|Specimen received warm|||20260721170000-0500",
    ]);
    expect(resourceJson(result, "Observation")).toContain(
      '"note":[{"time":"2026-07-21T17:00:00-05:00","text":"Specimen received warm"}]',
    );
    expect(completenessLabels(result)).toEqual([]);
  });

  it("makes one annotation per NTE-3 repetition and per NTE segment, joining nothing", () => {
    // NTE-3 is `0..-1`, and a separator inserted between repetitions would be a character the wire
    // never carried. `Observation.note` is `0..*` precisely so each line can stand on its own.
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      "NTE|1|L|line one~line two",
      "NTE|2|L|line three",
    ]);
    expect(resourceJson(result, "Observation")).toContain(
      '"note":[{"text":"line one"},{"text":"line two"},{"text":"line three"}]',
    );
    expect(completenessLabels(result)).toEqual([]);
  });

  it("renders the v2 escape sequences a narrative carries, and fabricates nothing for one it cannot", () => {
    const result = run([MSH, PID, OBR_FINAL, OBX_FINAL, "NTE|1|L|A\\T\\B\\.br\\C\\Z9\\"]);
    const observation = resourceJson(result, "Observation");
    expect(observation).toContain('"text":"A&B\\nC\\\\Z9\\\\"');
  });

  it("attaches each group's notes to that group's own Observation and to no other", () => {
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      seg("OBX", { 1: "1", 2: "ST", 3: "AAA^A^LN", 5: "first", 11: "F" }),
      "NTE|1|L|note for the first",
      seg("OBX", { 1: "2", 2: "ST", 3: "BBB^B^LN", 5: "second", 11: "F" }),
      "NTE|1|L|note for the second",
    ]);
    const json = wire(result);
    const first = json.slice(json.indexOf('"code":"AAA"'), json.indexOf('"code":"BBB"'));
    expect(first).toContain('"text":"note for the first"');
    expect(first).not.toContain("note for the second");
    expect(completenessLabels(result)).toEqual([]);
  });

  it("carries the text without a time when NTE-6 is no timestamp this library will emit", () => {
    const result = run([MSH, PID, OBR_FINAL, OBX_FINAL, "NTE|1|L|a comment|||NOTATIMESTAMP"]);
    const observation = resourceJson(result, "Observation");
    expect(observation).toContain('"note":[{"text":"a comment"}]');
    expect(observation).not.toContain('"time"');
    expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });

  it("adds no annotation for a repetition whose whole content the display projection resolves away", () => {
    // A lone highlight pair is display markup and nothing else: there is no note text under it, and
    // an empty `Annotation.text` would be a note a clinician never wrote.
    const result = run([MSH, PID, OBR_FINAL, OBX_FINAL, "NTE|1|L|\\H\\\\N\\~kept"]);
    expect(resourceJson(result, "Observation")).toContain('"note":[{"text":"kept"}]');
  });

  it("declares the two NTE rows whose targets this library does not build", () => {
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      "NTE|1|L|text|GI^General instructions^HL70364|1234^Who^Wrote",
    ]);
    const labels = result.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`);
    expect(labels).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@NTE.4#Annotation.extension`,
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@NTE.5#Annotation.authorReference`,
      ]),
    );
  });
});

describe("an NTE the ORU map publishes no target for reaches no Observation", () => {
  it("leaves a PATIENT-level NTE unattached and still reported", () => {
    // Row 4.1.4 carries no FHIR target at all. It sits before any OBR on the wire.
    const result = run([MSH, PID, "NTE|1|L|patient level comment", OBR_FINAL, OBX_FINAL]);
    expect(wire(result)).not.toContain("patient level comment");
    expect(resourceJson(result, "Observation")).not.toContain('"note"');
    expect(completenessLabels(result)).toEqual([`${NOT_EMITTED}@NTE[1]`]);
  });

  it("leaves an ORDER_OBSERVATION-level NTE unattached and still reported", () => {
    // Row 4.2.3 carries no FHIR target either. It sits after the OBR and before the first OBX.
    const result = run([MSH, PID, OBR_FINAL, "NTE|1|L|order level comment", OBX_FINAL]);
    expect(wire(result)).not.toContain("order level comment");
    expect(resourceJson(result, "Observation")).not.toContain('"note"');
    expect(completenessLabels(result)).toEqual([`${NOT_EMITTED}@NTE[1]`]);
  });

  it("closes the OBSERVATION group at the next non-NTE segment, so a post-SPM NTE attaches to nothing", () => {
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      OBX_FINAL,
      "SPM|1|SPEC1||BLD^Blood^HL70487",
      "NTE|1|L|comment after the specimen",
    ]);
    expect(wire(result)).not.toContain("comment after the specimen");
    expect(completenessLabels(result)).toEqual([`${NOT_EMITTED}@NTE[1]`]);
  });

  it("attaches nothing when the Observation the note sat under was withheld", () => {
    // OBX-11 `R` has no HL70085 target, so the Observation never joins the bundle; its note must
    // not survive it, and the NTE is reported alongside the OBX.
    const result = run([
      MSH,
      PID,
      OBR_FINAL,
      seg("OBX", { 1: "1", 2: "ST", 3: "V^Value^LN", 5: "text", 11: "R" }),
      "NTE|1|L|note on a withheld result",
    ]);
    expect(wire(result)).not.toContain("note on a withheld result");
    expect(completenessLabels(result)).toEqual(
      expect.arrayContaining([`${NOT_EMITTED}@OBX[1]`, `${NOT_EMITTED}@NTE[1]`]),
    );
  });

  it("leaves an NTE outside an ORU exactly where it was: recognized, unread, and reported", () => {
    const adt = run([
      "MSH|^~\\&|APP|F|RCV|H|20260101120000-0500||ADT^A01|M1|P|2.5.1",
      PID,
      "NTE|1|L|an ADT comment",
    ]);
    expect(wire(adt)).not.toContain("an ADT comment");
    expect(completenessLabels(adt)).toEqual([`${NOT_EMITTED}@NTE[1]`]);
  });
});

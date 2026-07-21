import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { getProperty, isList, isComplex } from "@cosyte/fhir";

import { toFhir, ISSUE_CODES, type TransformResult } from "../../src/index.js";

function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}
function toFhirSeq(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), { generateId: seq() });
}
function seg(name: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(0, ...Object.keys(fields).map(Number));
  const parts = [name];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}
function codes(result: TransformResult): string[] {
  return result.issues.map((i) => i.code);
}
function docRef(result: TransformResult): unknown {
  const entry = getProperty(result.bundle, "entry");
  if (entry === undefined || !isList(entry)) return undefined;
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    const type = rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
    if (type === "DocumentReference") return res;
  }
  return undefined;
}
/** The first content[0].attachment of a DocumentReference. */
function firstAttachment(doc: unknown): unknown {
  const content = getProperty(doc as never, "content");
  if (content === undefined || !isList(content)) return undefined;
  const first = content.items[0];
  return first !== undefined && isComplex(first) ? getProperty(first, "attachment") : undefined;
}

const MSH = "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||MDM^T02^MDM_T02|MSG1|P|2.5.1";
const PID = "PID|1||MRN1^^^HOSP^MR||Doc^Dana^^^^^L||19850101|F";

describe("MDM_T02 → DocumentReference (Phase 5)", () => {
  it("assembles a DocumentReference from TXA + OBX, grounded on the IG segment maps", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", {
        2: "CN^Consultation^HL70270",
        6: "20260720101500-0500",
        12: "DOC-123",
        16: "consult-note.txt",
        19: "AV",
        25: "Cardiology Consultation Note",
      }),
      seg("OBX", { 2: "TX", 5: "Hello world" }),
    ]);
    const doc = docRef(result);
    expect(doc).toBeDefined();
    const status = getProperty(doc as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("current"); // TXA-19 = AV → current (the only faithful target)
    const desc = getProperty(doc as never, "description") as { value: unknown } | undefined;
    expect(desc?.value).toBe("Cardiology Consultation Note");
    expect(getProperty(doc as never, "type")).toBeDefined();
    expect(getProperty(doc as never, "masterIdentifier")).toBeDefined();
    expect(getProperty(doc as never, "identifier")).toBeDefined();
    expect(getProperty(doc as never, "subject")).toBeDefined(); // wired to Patient
    const date = getProperty(doc as never, "date") as { value: unknown } | undefined;
    expect(date?.value).toBe("2026-07-20T10:15:00-05:00"); // fully-zoned instant
    // content.attachment carries the body base64-encoded, never interpreted
    const att = firstAttachment(doc);
    const ct = getProperty(att as never, "contentType") as { value: unknown } | undefined;
    const data = getProperty(att as never, "data") as { value: unknown } | undefined;
    expect(ct?.value).toBe("application/text"); // IG-assigned contentType for OBX-2 = TX
    expect(data?.value).toBe(Buffer.from("Hello world", "utf8").toString("base64"));
  });

  it("carries an RP-type OBX body as content.attachment.url", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", { 19: "AV" }),
      seg("OBX", { 2: "RP", 5: "https://docs.example/report.pdf" }),
    ]);
    const att = firstAttachment(docRef(result));
    const url = getProperty(att as never, "url") as { value: unknown } | undefined;
    expect(url?.value).toBe("https://docs.example/report.pdf");
  });

  it("withholds the DocumentReference when TXA-19 is not AV (status unmapped, never guessed)", () => {
    const result = toFhirSeq([MSH, PID, seg("TXA", { 19: "OB" }), seg("OBX", { 2: "TX", 5: "x" })]);
    expect(docRef(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID);
  });

  it("withholds the DocumentReference when no OBX yields groundable content", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", { 19: "AV" }),
      seg("OBX", { 2: "NM", 5: "42" }),
    ]);
    expect(docRef(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED); // the NM body dropped
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID); // then withheld (no content)
  });

  it("flags TXA-17 (docStatus) as unmapped and leaves docStatus absent — no IG value map exists", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", { 17: "AU", 19: "AV" }),
      seg("OBX", { 2: "TX", 5: "note" }),
    ]);
    const doc = docRef(result);
    expect(doc).toBeDefined();
    expect(getProperty(doc as never, "docStatus")).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("flags a valued TXA-3 as dropped rather than emitting a non-MIME contentType", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", { 3: "TEXT", 19: "AV" }),
      seg("OBX", { 2: "TX", 5: "note" }),
    ]);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("carries an FT body and drops a date-only TXA-6 (DocumentReference.date is an instant)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("TXA", { 6: "20260720", 19: "AV" }), // date-only → not a valid instant → dropped
      seg("OBX", { 2: "FT", 5: "\\H\\bold\\N\\ text" }),
    ]);
    const doc = docRef(result);
    expect(doc).toBeDefined();
    expect(getProperty(doc as never, "date")).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    const att = firstAttachment(doc);
    const ct = getProperty(att as never, "contentType") as { value: unknown } | undefined;
    expect(ct?.value).toBe("text/hl7v2"); // IG-assigned contentType for OBX-2 = FT
  });

  it("produces nothing (no crash) for an MDM with no TXA segment", () => {
    const result = toFhirSeq([MSH, PID, seg("OBX", { 2: "TX", 5: "orphan body" })]);
    expect(docRef(result)).toBeUndefined();
  });

  it("flags a non-T02 MDM trigger as segment-assembled", () => {
    const result = toFhirSeq([
      "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||MDM^T04^MDM_T02|MSG1|P|2.5.1",
      PID,
      seg("TXA", { 19: "AV" }),
      seg("OBX", { 2: "TX", 5: "note" }),
    ]);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED);
    expect(docRef(result)).toBeDefined();
  });
});

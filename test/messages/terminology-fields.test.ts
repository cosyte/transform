import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { getProperty, isList, isComplex, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import {
  toFhir,
  ISSUE_CODES,
  V2_0161_SYSTEM,
  V2_0277_SYSTEM,
  type TransformResult,
} from "../../src/index.js";

function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}
function seg(type: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(...Object.keys(fields).map(Number));
  const parts = [type];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}
function run(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), { generateId: seq() });
}
/** The first bundle resource of `type`, or `undefined`. */
function resource(result: TransformResult, type: string): FhirComplex | undefined {
  const entry = getProperty(result.bundle, "entry");
  if (entry === undefined || !isList(entry)) return undefined;
  for (const e of entry.items) {
    if (!isComplex(e)) continue;
    const res = getProperty(e, "resource");
    if (res === undefined || !isComplex(res)) continue;
    const rt = getProperty(res, "resourceType");
    if (rt !== undefined && "value" in rt && (rt as { value: unknown }).value === type) return res;
  }
  return undefined;
}
function prim(node: FhirNode | undefined): string | undefined {
  return node !== undefined && "value" in node
    ? String((node as { value: unknown }).value)
    : undefined;
}
function firstCoding(cc: FhirComplex | undefined): {
  system: string | undefined;
  code: string | undefined;
} {
  const none = { system: undefined, code: undefined };
  if (cc === undefined) return none;
  const coding = getProperty(cc, "coding");
  if (coding === undefined || !isList(coding)) return none;
  const c = coding.items.find(isComplex);
  return c === undefined
    ? none
    : { system: prim(getProperty(c, "system")), code: prim(getProperty(c, "code")) };
}
function hasIssue(r: TransformResult, code: string, path?: string): boolean {
  return r.issues.some((i) => i.code === code && (path === undefined || i.fhirPath === path));
}

const MSH_ORM = "MSH|^~\\&|CPOE|H|LAB|H|20260721120000-0500||ORM^O01|M1|P|2.5.1";
const PID = "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F";

describe("OBR-5 → ServiceRequest.priority (HL70485, value-translated)", () => {
  it("translates S → stat", () => {
    const r = run([
      MSH_ORM,
      PID,
      seg("ORC", { 1: "NW" }),
      seg("OBR", { 4: "CBC^Complete Blood Count^LN", 5: "S" }),
    ]);
    expect(prim(getProperty(resource(r, "ServiceRequest") as FhirComplex, "priority"))).toBe(
      "stat",
    );
  });

  it("leaves priority absent + flags a code in the IG (unmapped) group (PRN), never guessed", () => {
    const r = run([MSH_ORM, PID, seg("ORC", { 1: "NW" }), seg("OBR", { 4: "CBC^^LN", 5: "PRN" })]);
    const sr = resource(r, "ServiceRequest") as FhirComplex;
    expect(getProperty(sr, "priority")).toBeUndefined();
    expect(hasIssue(r, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "ServiceRequest.priority")).toBe(true);
  });
});

describe("RXO-9 → MedicationRequest.substitution (HL70161, value-translated)", () => {
  it("translates G → substitution.allowedCodeableConcept in v2-0161", () => {
    const r = run([
      MSH_ORM,
      PID,
      seg("ORC", { 1: "NW" }),
      seg("RXO", { 1: "1049630^Acetaminophen^RXNORM", 9: "G" }),
    ]);
    const mr = resource(r, "MedicationRequest") as FhirComplex;
    const sub = getProperty(mr, "substitution");
    expect(sub !== undefined && isComplex(sub)).toBe(true);
    const allowed = getProperty(sub as FhirComplex, "allowedCodeableConcept");
    expect(firstCoding(allowed as FhirComplex)).toEqual({ system: V2_0161_SYSTEM, code: "G" });
  });

  it("withholds substitution + flags an unrecognized RXO-9 (never a fabricated permission)", () => {
    const r = run([
      MSH_ORM,
      PID,
      seg("ORC", { 1: "NW" }),
      seg("RXO", { 1: "1049630^Acetaminophen^RXNORM", 9: "X" }),
    ]);
    const mr = resource(r, "MedicationRequest") as FhirComplex;
    expect(getProperty(mr, "substitution")).toBeUndefined();
    expect(
      hasIssue(
        r,
        ISSUE_CODES.TRANSFORM_CODE_UNMAPPED,
        "MedicationRequest.substitution.allowedCodeableConcept",
      ),
    ).toBe(true);
  });

  it("withholds substitution when RXO-9 declares a FOREIGN coding system (never asserted as v2-0161)", () => {
    const r = run([
      MSH_ORM,
      PID,
      seg("ORC", { 1: "NW" }),
      seg("RXO", { 1: "1049630^Acetaminophen^RXNORM", 9: "G^^99LOCAL" }),
    ]);
    const mr = resource(r, "MedicationRequest") as FhirComplex;
    expect(getProperty(mr, "substitution")).toBeUndefined();
    expect(
      hasIssue(
        r,
        ISSUE_CODES.TRANSFORM_CODE_UNMAPPED,
        "MedicationRequest.substitution.allowedCodeableConcept",
      ),
    ).toBe(true);
  });

  it("RXR-4 method stays structurally carried (SNOMED target not bundled), never SNOMED-translated", () => {
    const r = run([
      MSH_ORM,
      PID,
      seg("ORC", { 1: "NW" }),
      seg("RXO", { 1: "1049630^Acetaminophen^RXNORM" }),
      seg("RXR", { 1: "PO^Oral^HL70162", 4: "CH^Chew^HL70165" }),
    ]);
    const mr = resource(r, "MedicationRequest") as FhirComplex;
    const dosage = getProperty(mr, "dosageInstruction");
    const di = dosage !== undefined && isList(dosage) ? dosage.items.find(isComplex) : undefined;
    // method present (structural), but NOT emitted with a SNOMED system/code — its code stays "CH".
    expect(firstCoding(getProperty(di as FhirComplex, "method") as FhirComplex).code).toBe("CH");
    expect(firstCoding(getProperty(di as FhirComplex, "method") as FhirComplex).system).not.toBe(
      "http://snomed.info/sct",
    );
  });
});

describe("SCH-8 → Appointment.appointmentType (HL70277, value-translated)", () => {
  it("translates Normal → v2-0277 Normal", () => {
    const r = run([
      "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||SIU^S12|MSG1|P|2.5.1",
      PID,
      seg("SCH", { 8: "Normal", 25: "Booked" }),
    ]);
    const appt = resource(r, "Appointment") as FhirComplex;
    expect(firstCoding(getProperty(appt, "appointmentType") as FhirComplex)).toEqual({
      system: V2_0277_SYSTEM,
      code: "Normal",
    });
  });
});

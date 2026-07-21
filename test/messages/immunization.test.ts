import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { getProperty, isList, isComplex, validateResource } from "@cosyte/fhir";

import {
  toFhir,
  ISSUE_CODES,
  IMMUNIZATION_STATUS_MAP,
  type TransformResult,
} from "../../src/index.js";

/** A deterministic urn:uuid generator so fullUrls/reference wiring can be asserted exactly. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function toFhirSeq(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), { generateId: seq() });
}

/** Build a segment string placing values at their 1-indexed HL7 field positions. */
function seg(name: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(0, ...Object.keys(fields).map(Number));
  const parts = [name];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

const MSH = "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||VXU^V04^VXU_V04|MSG1|P|2.5.1";
const PID = "PID|1||MRN1^^^HOSP^MR||Imm^Ian^^^^^L||20180101|M";

/** The focal Immunization resource in a bundle, or undefined. */
function immunization(result: TransformResult): unknown {
  const entry = getProperty(result.bundle, "entry");
  if (entry === undefined || !isList(entry)) return undefined;
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    const type = rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
    if (type === "Immunization") return res;
  }
  return undefined;
}

function codes(result: TransformResult): string[] {
  return result.issues.map((i) => i.code);
}

describe("VXU_V04 → Immunization (Phase 5)", () => {
  it("assembles an Immunization from ORC/RXA/RXR, grounded on the IG segment maps", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      "PV1|1|O",
      seg("ORC", { 1: "RE", 2: "PLACER1", 3: "FILLER1" }),
      seg("RXA", {
        3: "20260715",
        5: "08^Hepatitis B^CVX",
        6: "0.5",
        7: "mL^milliliter^UCUM",
        15: "LOT42",
        16: "20271231",
        20: "CP",
        21: "A",
      }),
      seg("RXR", { 1: "IM^Intramuscular^HL70162", 2: "LA^Left Arm^HL70163" }),
    ]);
    const imm = immunization(result);
    expect(imm).toBeDefined();
    expect(getProperty(imm as never, "encounter")).toBeDefined(); // PV1 → Encounter, wired
    const status = getProperty(imm as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("completed"); // RXA-20 CP → HL70322 → completed (valid immunization-status)
    const occ = getProperty(imm as never, "occurrenceDateTime") as { value: unknown } | undefined;
    expect(occ?.value).toBe("2026-07-15");
    // vaccineCode + route + site + dose + lotNumber all present
    expect(getProperty(imm as never, "vaccineCode")).toBeDefined();
    expect(getProperty(imm as never, "route")).toBeDefined();
    expect(getProperty(imm as never, "site")).toBeDefined();
    expect(getProperty(imm as never, "doseQuantity")).toBeDefined();
    const lot = getProperty(imm as never, "lotNumber") as { value: unknown } | undefined;
    expect(lot?.value).toBe("LOT42");
    // patient wired to the bundle Patient
    const patient = getProperty(imm as never, "patient");
    expect(patient).toBeDefined();
    // the emitted Immunization is structurally valid under the emit schema
    expect(validateResource(imm as never, { mode: "lenient" }).valid).toBe(true);
  });

  it("maps the four HL70322 completion codes to valid immunization-status members", () => {
    expect(IMMUNIZATION_STATUS_MAP).toEqual({
      CP: "completed",
      PA: "completed",
      RE: "not-done",
      NA: "not-done",
    });
  });

  it("maps a delete action (RXA-21 = D) to the IG-assigned status entered-in-error", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP", 21: "D" }),
    ]);
    const imm = immunization(result);
    expect(imm).toBeDefined();
    const status = getProperty(imm as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("entered-in-error"); // RXA-21=D → IG assignment, not the RXA-20 map
  });

  it("withholds the Immunization when the completion status is not in HL70322", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "ZZ" }),
    ]);
    expect(immunization(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("does not build an Immunization with no vaccine code (RXA-5 absent)", () => {
    const result = toFhirSeq([MSH, PID, seg("RXA", { 3: "20260715", 20: "CP" })]);
    expect(immunization(result)).toBeUndefined();
  });

  it("withholds the Immunization when there is no Patient to anchor Immunization.patient", () => {
    const result = toFhirSeq([MSH, seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" })]);
    expect(immunization(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID);
  });

  it("carries statusReason/reasonCode/recorded and a bare RXA with no ORC", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", {
        3: "20260715",
        5: "08^Hep B^CVX",
        18: "00^Patient refused^NIP002",
        19: "430^prophylaxis^SCT",
        20: "CP",
        22: "20260715120000-0500",
      }),
    ]);
    const imm = immunization(result);
    expect(imm).toBeDefined();
    expect(getProperty(imm as never, "statusReason")).toBeDefined();
    expect(getProperty(imm as never, "reasonCode")).toBeDefined();
    const recorded = getProperty(imm as never, "recorded") as { value: unknown } | undefined;
    expect(recorded?.value).toBe("2026-07-15T12:00:00-05:00");
    // no ORC → no identifier
    expect(getProperty(imm as never, "identifier")).toBeUndefined();
  });

  it("carries an RXR route with no administration site (site omitted)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" }),
      seg("RXR", { 1: "IM^Intramuscular^HL70162" }), // route only, no RXR-2
    ]);
    const imm = immunization(result);
    expect(getProperty(imm as never, "route")).toBeDefined();
    expect(getProperty(imm as never, "site")).toBeUndefined();
  });

  it("carries an RXR administration site with no route (route omitted)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" }),
      seg("RXR", { 2: "LA^Left Arm^HL70163" }), // site only, no RXR-1 route
    ]);
    const imm = immunization(result);
    expect(getProperty(imm as never, "route")).toBeUndefined();
    expect(getProperty(imm as never, "site")).toBeDefined();
  });

  it("groups a second RXA into its own Immunization (multiple administrations)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" }),
      seg("RXA", { 3: "20260716", 5: "20^DTaP^CVX", 20: "CP" }),
    ]);
    const entry = getProperty(result.bundle, "entry");
    const count =
      entry !== undefined && isList(entry)
        ? entry.items.filter((e) => {
            const res = isComplex(e) ? getProperty(e, "resource") : undefined;
            const rt =
              res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
            return (
              rt !== undefined &&
              "value" in rt &&
              (rt as { value: unknown }).value === "Immunization"
            );
          }).length
        : 0;
    expect(count).toBe(2);
  });

  it("falls back to ORC-9 for recorded when RXA-22 is unvalued", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("ORC", { 1: "RE", 9: "20260716" }),
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" }),
    ]);
    const recorded = getProperty(immunization(result) as never, "recorded") as
      | { value: unknown }
      | undefined;
    expect(recorded?.value).toBe("2026-07-16");
  });

  it("drops an RXA-16 expiration that carries a time-of-day (not a valid FHIR date)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 16: "20271231120000-0500", 20: "CP" }),
    ]);
    const imm = immunization(result);
    expect(getProperty(imm as never, "expirationDate")).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("emits no expirationDate when RXA-16 cannot be parsed as a date (never fabricated)", () => {
    const result = toFhirSeq([
      MSH,
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 16: "NOTADATE", 20: "CP" }),
    ]);
    const imm = immunization(result);
    expect(imm).toBeDefined();
    expect(getProperty(imm as never, "expirationDate")).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });

  it("assigns status=completed when RXA-20 is unvalued and RXA-21 ≠ D (the IG default)", () => {
    // RXA-20 absent and not a delete → the IG assigns `completed`; the Immunization is emitted, not withheld.
    const result = toFhirSeq([MSH, PID, seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX" })]);
    const imm = immunization(result);
    expect(imm).toBeDefined();
    const status = getProperty(imm as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("completed");
    expect(codes(result)).not.toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("flags a non-V04 VXU trigger as segment-assembled (no IG message map)", () => {
    const result = toFhirSeq([
      "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||VXU^V03^VXU_V04|MSG1|P|2.5.1",
      PID,
      seg("RXA", { 3: "20260715", 5: "08^Hep B^CVX", 20: "CP" }),
    ]);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED);
    // it still assembles from the segment maps
    expect(immunization(result)).toBeDefined();
  });
});

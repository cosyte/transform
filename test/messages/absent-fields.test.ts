/**
 * What an absent field or segment does: its element stays absent, a required element that has no
 * source withholds its resource, and nothing is filled in from a neighbour or a default. An absent
 * field is not a coding error, so it raises no "unmapped" flag of its own.
 *
 * Every fixture is synthetic; every person-identifying literal comes from the PHI allow-list.
 */

import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { getProperty, isComplex, isList } from "@cosyte/fhir";

import { buildAnnotations, ISSUE_CODES, type TransformIssue } from "../../src/index.js";
import {
  MSH_ADT_A01,
  PID_JANE,
  bundleJson,
  issuesAt,
  labels,
  resourcesOfType,
  run,
  segment,
} from "../_support/clinical-fixtures.js";

const { TRANSFORM_RESOURCE_INVALID, TRANSFORM_SEGMENT_ASSEMBLED, TRANSFORM_SEGMENT_NOT_EMITTED } =
  ISSUE_CODES;

/** An MSH for the given `code^trigger^structure`, otherwise the shared ADT header. */
function msh(type: string): string {
  return MSH_ADT_A01.replace("ADT^A01^ADT_A01", type);
}

/** The single resource of a type the message produced. */
function only(result: ReturnType<typeof run>, type: string): Record<string, unknown> {
  const found = resourcesOfType(result, type);
  expect(found, `exactly one ${type}`).toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

/** Whether the completeness ledger reports an occurrence (`NAME[k]`, 1-based) as not emitted. */
function notEmitted(result: ReturnType<typeof run>, location: string): boolean {
  return result.issues.some(
    (i) => i.code === TRANSFORM_SEGMENT_NOT_EMITTED && i.v2Location === location,
  );
}

describe("the message header", () => {
  it("an empty MSH-10 gives the Bundle no identifier", () => {
    const result = run([MSH_ADT_A01.replace("|MSG00001|", "||"), PID_JANE]);
    const bundle = bundleJson(result);
    expect(bundle["identifier"]).toBeUndefined();
    expect(bundle["type"]).toBe("message");
  });

  it("an empty MSH-7 gives the Bundle no timestamp and raises nothing for it", () => {
    const result = run([MSH_ADT_A01.replace("|20260721143000-0500|", "||"), PID_JANE]);
    expect(bundleJson(result)["timestamp"]).toBeUndefined();
    expect(issuesAt(result, "MSH.7")).toEqual([]);
  });

  it("an unparseable MSH-7 gives the Bundle no timestamp, says so, and raises no precision flag", () => {
    const result = run([MSH_ADT_A01.replace("|20260721143000-0500|", "|20261399|"), PID_JANE]);
    expect(bundleJson(result)["timestamp"]).toBeUndefined();
    expect(issuesAt(result, "MSH.7").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER,
    ]);
  });

  it("an MSH-9 with a trigger but no message code is segment-assembled, never order-mapped", () => {
    const result = run([MSH_ADT_A01.replace("ADT^A01^ADT_A01", "^O01"), PID_JANE]);
    expect(labels(result)).toContain(`${TRANSFORM_SEGMENT_ASSEMBLED}@MSH.9#`);
  });
});

describe("a scheduling message", () => {
  it("an SIU with no SCH builds no Appointment and still builds its Patient", () => {
    const result = run([
      msh("SIU^S12^SIU_S12"),
      PID_JANE,
      segment("AIS", { 1: "1", 3: "OV^Visit^L" }),
    ]);
    expect(resourcesOfType(result, "Appointment")).toEqual([]);
    expect(resourcesOfType(result, "Patient")).toHaveLength(1);
  });

  it("an empty SCH-25 leaves status absent without an unmapped flag, so the Appointment is withheld", () => {
    const result = run([msh("SIU^S12^SIU_S12"), segment("SCH", { 1: "PLAC-1" }), PID_JANE]);
    expect(resourcesOfType(result, "Appointment")).toEqual([]);
    expect(issuesAt(result, "SCH.25")).toEqual([]);
    expect(labels(result)).toContain(`${TRANSFORM_RESOURCE_INVALID}@SCH#Appointment`);
  });
});

describe("a document message", () => {
  const MDM = msh("MDM^T02^MDM_T02");
  const BODY = segment("OBX", { 1: "1", 2: "TX", 5: "Synthetic note body" });

  it("an empty TXA-19 leaves status absent without an unmapped flag, so the document is withheld", () => {
    const result = run([MDM, PID_JANE, segment("TXA", { 1: "1", 2: "CN" }), BODY]);
    expect(resourcesOfType(result, "DocumentReference")).toEqual([]);
    expect(issuesAt(result, "TXA.19")).toEqual([]);
    expect(labels(result)).toContain(`${TRANSFORM_RESOURCE_INVALID}@TXA#DocumentReference`);
  });

  it("a body OBX with an empty OBX-5 adds no content, so a document with no other body is withheld", () => {
    const result = run([
      MDM,
      PID_JANE,
      segment("TXA", { 1: "1", 2: "CN", 19: "AV" }),
      segment("OBX", { 1: "1", 2: "TX" }),
    ]);
    expect(resourcesOfType(result, "DocumentReference")).toEqual([]);
    expect(issuesAt(result, "OBX[0].5")).toEqual([]);
  });

  it("an empty body OBX beside a valued one contributes nothing and drops nothing", () => {
    const result = run([
      MDM,
      PID_JANE,
      segment("TXA", { 1: "1", 2: "CN", 19: "AV" }),
      segment("OBX", { 1: "1", 2: "TX" }),
      BODY,
    ]);
    const content = only(result, "DocumentReference")["content"] as unknown[];
    expect(content).toHaveLength(1);
  });

  it("an MDM with no PID builds a DocumentReference with no subject", () => {
    const result = run([MDM, segment("TXA", { 1: "1", 2: "CN", 19: "AV" }), BODY]);
    const document = only(result, "DocumentReference");
    expect(document["subject"]).toBeUndefined();
    expect(document["status"]).toBe("current");
  });
});

describe("an order message", () => {
  const OMP = msh("OMP^O09^OMP_O09");

  it("a pharmacy order with no PID is withheld, since MedicationRequest.subject is required", () => {
    const result = run([
      OMP,
      segment("ORC", { 1: "NW" }),
      segment("RXO", { 1: "RX1^Synthetic drug^L" }),
    ]);
    expect(resourcesOfType(result, "MedicationRequest")).toEqual([]);
    expect(labels(result)).toContain(`${TRANSFORM_RESOURCE_INVALID}@RXO#MedicationRequest`);
  });

  it("an RXR with a site and no route sets site alone", () => {
    const result = run([
      OMP,
      PID_JANE,
      segment("ORC", { 1: "NW" }),
      segment("RXO", { 1: "RX1^Synthetic drug^L" }),
      segment("RXR", { 2: "LA^Left arm^HL70550" }),
    ]);
    const dosage = (
      only(result, "MedicationRequest")["dosageInstruction"] as Record<string, unknown>[]
    )[0];
    expect(dosage?.["route"]).toBeUndefined();
    expect(dosage?.["site"]).toBeDefined();
  });

  it("an RXR before any order has no request to join and is reported as not emitted", () => {
    const result = run([
      OMP,
      PID_JANE,
      segment("RXR", { 1: "PO^Oral^HL70162" }),
      segment("ORC", { 1: "NW" }),
      segment("RXO", { 1: "RX1^Synthetic drug^L" }),
    ]);
    const dosage = only(result, "MedicationRequest")["dosageInstruction"];
    expect(dosage).toBeUndefined();
    expect(notEmitted(result, "RXR[1]")).toBe(true);
  });

  it.each(["HL70485", "0485"])(
    "an OBR-5 priority that names the bound table as %s is translated",
    (mnemonic) => {
      const result = run([
        msh("ORM^O01^ORM_O01"),
        PID_JANE,
        segment("ORC", { 1: "NW" }),
        segment("OBR", { 1: "1", 4: "24331-1^Lipid panel^LN", 5: `S^Stat^${mnemonic}` }),
      ]);
      expect(only(result, "ServiceRequest")["priority"]).toBe("stat");
    },
  );
});

describe("a vaccination message", () => {
  const VXU = msh("VXU^V04^VXU_V04");
  const RXA = segment("RXA", { 1: "0", 2: "1", 3: "20260101", 5: "08^HepB^CVX", 20: "CP" });

  it("only the first RXR after an RXA sets the route", () => {
    const result = run([
      VXU,
      PID_JANE,
      "ORC|RE",
      RXA,
      segment("RXR", { 1: "IM^Intramuscular^HL70162" }),
      segment("RXR", { 1: "PO^Oral^HL70162" }),
    ]);
    const route = only(result, "Immunization")["route"] as { coding: { code: string }[] };
    expect(route.coding.map((c) => c.code)).toContain("IM");
    expect(route.coding.map((c) => c.code)).not.toContain("PO");
    expect(notEmitted(result, "RXR[2]")).toBe(true);
  });

  it("an RXR before any RXA, in or out of an order group, sets no route", () => {
    for (const lines of [
      [VXU, PID_JANE, segment("RXR", { 1: "PO^Oral^HL70162" }), "ORC|RE", RXA],
      [VXU, PID_JANE, "ORC|RE", segment("RXR", { 1: "PO^Oral^HL70162" }), RXA],
    ]) {
      const result = run(lines);
      expect(only(result, "Immunization")["route"]).toBeUndefined();
      expect(notEmitted(result, "RXR[1]")).toBe(true);
    }
  });

  it("an RXA with no RXA-3 has no occurrence, so the Immunization is withheld", () => {
    const result = run([
      VXU,
      PID_JANE,
      "ORC|RE",
      segment("RXA", { 1: "0", 2: "1", 5: "08^HepB^CVX", 20: "CP" }),
    ]);
    expect(resourcesOfType(result, "Immunization")).toEqual([]);
    expect(issuesAt(result, "RXA.3")).toEqual([]);
    expect(labels(result)).toContain(`${TRANSFORM_RESOURCE_INVALID}@RXA#Immunization`);
  });

  it("an OBX with no OBX-3 adds no Observation and leaves the Immunization in place", () => {
    const result = run([
      VXU,
      PID_JANE,
      "ORC|RE",
      RXA,
      segment("OBX", { 1: "1", 2: "ST", 5: "x", 11: "F" }),
    ]);
    expect(resourcesOfType(result, "Observation")).toEqual([]);
    expect(resourcesOfType(result, "Immunization")).toHaveLength(1);
  });
});

describe("the insurance subscriber id", () => {
  it("an IN1-10 typed SN with no id number adds no subscriber-id extension", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("IN1", { 1: "1", 2: "PLAN1", 4: "Acme Health Plan", 10: "^^^^SN" }),
    ]);
    expect(only(result, "Coverage")["extension"]).toBeUndefined();
  });
});

describe("a note segment", () => {
  /** The NTE segments of a message made of the given NTE lines. */
  function notes(...lines: readonly string[]) {
    return parseHL7([MSH_ADT_A01, ...lines].join("\r")).segments("NTE");
  }

  it("an NTE with no NTE-3 adds no annotation, and its NTE-6 is not read", () => {
    const issues: TransformIssue[] = [];
    expect(buildAnnotations(notes("NTE|1|||||20261399"), {}, issues)).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("an NTE with no NTE-3 beside a valued one leaves only the valued one's annotation", () => {
    const issues: TransformIssue[] = [];
    const built = buildAnnotations(notes("NTE|1", "NTE|2||Synthetic comment"), {}, issues);
    const items = built !== undefined && isList(built) ? built.items : [];
    expect(items).toHaveLength(1);
    const first = items[0];
    const text = first !== undefined && isComplex(first) ? getProperty(first, "text") : undefined;
    expect((text as { value?: unknown } | undefined)?.value).toBe("Synthetic comment");
    expect(issues).toEqual([]);
  });
});

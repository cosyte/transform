/**
 * A field that is valued but cannot be converted (an unparseable timestamp, a magnitude FHIR's
 * `decimal` cannot carry, a bound with no partner) leaves its element absent and is flagged, while
 * the rest of the resource still comes through. Neither half is ever guessed: no element is filled
 * from a neighbouring field, and no resource is withheld for a loss that only touched one element.
 *
 * Every fixture is synthetic; every person-identifying literal comes from the PHI allow-list.
 */

import { describe, expect, it } from "vitest";

import { ISSUE_CODES } from "../../src/index.js";
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

const {
  TRANSFORM_TIMESTAMP_INVALID,
  TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER,
  TRANSFORM_ELEMENT_DROPPED,
  TRANSFORM_QUANTITY_VALUE_INVALID,
} = ISSUE_CODES;

/** An MSH for the given `code^trigger^structure`, otherwise the shared ADT header. */
function msh(type: string): string {
  return MSH_ADT_A01.replace("ADT^A01^ADT_A01", type);
}

/** The single resource of a type the message produced, or a failure naming what was there. */
function only(result: ReturnType<typeof run>, type: string): Record<string, unknown> {
  const found = resourcesOfType(result, type);
  expect(found, `exactly one ${type}`).toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

const NOT_A_DATE = "20261399";

describe("an unparseable timestamp drops only its own element", () => {
  it("IN1-12 leaves Coverage.period absent while a valid IN1-13 still sets its end", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("IN1", { 1: "1", 2: "PLAN1", 4: "Acme Health Plan", 12: NOT_A_DATE, 13: "20271231" }),
    ]);
    expect(only(result, "Coverage")["period"]).toEqual({ end: "2027-12-31" });
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("OBX-14 leaves Observation.effectiveDateTime absent and keeps the result", () => {
    const result = run([
      msh("ORU^R01^ORU_R01"),
      PID_JANE,
      segment("OBR", { 1: "1", 4: "24331-1^Lipid panel^LN", 25: "F" }),
      segment("OBX", { 1: "1", 2: "ST", 3: "8310-5^Note^LN", 5: "ok", 11: "F", 14: NOT_A_DATE }),
    ]);
    const observation = only(result, "Observation");
    expect(observation["effectiveDateTime"]).toBeUndefined();
    expect(observation["valueString"]).toBe("ok");
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("SCH-11 TQ.4 leaves Appointment.start absent and withholds nothing else", () => {
    const result = run([
      msh("SIU^S12^SIU_S12"),
      segment("SCH", { 1: "PLAC-1", 11: `^^^${NOT_A_DATE}^20260801100000-0500`, 25: "Booked" }),
      PID_JANE,
    ]);
    const appointment = only(result, "Appointment");
    expect(appointment["start"]).toBeUndefined();
    expect(appointment["end"]).toBe("2026-08-01T10:00:00-05:00");
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("TXA-6 leaves DocumentReference.date absent without the instant-precision flag", () => {
    const result = run([
      msh("MDM^T02^MDM_T02"),
      PID_JANE,
      segment("TXA", { 1: "1", 2: "CN", 6: NOT_A_DATE, 19: "AV" }),
      segment("OBX", { 1: "1", 2: "TX", 5: "Synthetic note body" }),
    ]);
    expect(only(result, "DocumentReference")["date"]).toBeUndefined();
    expect(issuesAt(result, "TXA.6")).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("RXA-22 leaves Immunization.recorded absent and keeps the administration", () => {
    const result = run([
      msh("VXU^V04^VXU_V04"),
      PID_JANE,
      "ORC|RE",
      segment("RXA", { 1: "0", 2: "1", 3: "20260101", 5: "08^HepB^CVX", 20: "CP", 22: NOT_A_DATE }),
    ]);
    const immunization = only(result, "Immunization");
    expect(immunization["recorded"]).toBeUndefined();
    expect(immunization["occurrenceDateTime"]).toBe("2026-01-01");
  });

  it("an unparseable RXA-3 leaves occurrenceDateTime absent, so the Immunization is withheld", () => {
    const result = run([
      msh("VXU^V04^VXU_V04"),
      PID_JANE,
      "ORC|RE",
      segment("RXA", { 1: "0", 2: "1", 3: NOT_A_DATE, 5: "08^HepB^CVX", 20: "CP" }),
    ]);
    expect(resourcesOfType(result, "Immunization")).toEqual([]);
    expect(labels(result)).toContain(`${ISSUE_CODES.TRANSFORM_RESOURCE_INVALID}@RXA#Immunization`);
  });

  it("ORC-9 leaves authoredOn absent on both a ServiceRequest and a MedicationRequest", () => {
    const service = run([
      msh("ORM^O01^ORM_O01"),
      PID_JANE,
      segment("ORC", { 1: "NW", 2: "PLAC1", 9: NOT_A_DATE }),
      segment("OBR", { 1: "1", 4: "24331-1^Lipid panel^LN" }),
    ]);
    expect(only(service, "ServiceRequest")["authoredOn"]).toBeUndefined();
    expect(service.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);

    const medication = run([
      msh("OMP^O09^OMP_O09"),
      PID_JANE,
      segment("ORC", { 1: "NW", 2: "PLAC1", 9: NOT_A_DATE }),
      segment("RXO", { 1: "RX1^Synthetic drug^L" }),
    ]);
    expect(only(medication, "MedicationRequest")["authoredOn"]).toBeUndefined();
    expect(medication.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });
});

describe("a magnitude FHIR's decimal cannot carry drops only its own element", () => {
  it("RXA-6 leaves Immunization.doseQuantity absent and flags the value", () => {
    const result = run([
      msh("VXU^V04^VXU_V04"),
      PID_JANE,
      "ORC|RE",
      segment("RXA", { 1: "0", 2: "1", 3: "20260101", 5: "08^HepB^CVX", 6: "+0.5", 20: "CP" }),
    ]);
    expect(only(result, "Immunization")["doseQuantity"]).toBeUndefined();
    expect(labels(result)).toContain(`${TRANSFORM_QUANTITY_VALUE_INVALID}@RXA.6#Quantity.value`);
  });

  it("RXO-11 leaves dispenseRequest.quantity absent while RXO-13 still sets the refills", () => {
    const result = run([
      msh("OMP^O09^OMP_O09"),
      PID_JANE,
      segment("ORC", { 1: "NW" }),
      segment("RXO", { 1: "RX1^Synthetic drug^L", 11: "+30", 13: "2" }),
    ]);
    expect(only(result, "MedicationRequest")["dispenseRequest"]).toEqual({
      numberOfRepeatsAllowed: 2,
    });
    expect(labels(result)).toContain(`${TRANSFORM_QUANTITY_VALUE_INVALID}@RXO.11#Quantity.value`);
  });
});

describe("the diagnostic report's time and code rows", () => {
  const ORU = msh("ORU^R01^ORU_R01");

  function report(fields: Readonly<Record<number, string>>) {
    return run([
      ORU,
      PID_JANE,
      segment("OBR", { 1: "1", 4: "24331-1^Lipid panel^LN", 25: "F", ...fields }),
    ]);
  }

  it("OBR-7 with OBR-8 is an effectivePeriod from start to end", () => {
    const dr = only(
      report({ 7: "20260721080000-0500", 8: "20260721093000-0500" }),
      "DiagnosticReport",
    );
    expect(dr["effectivePeriod"]).toEqual({
      start: "2026-07-21T08:00:00-05:00",
      end: "2026-07-21T09:30:00-05:00",
    });
    expect(dr["effectiveDateTime"]).toBeUndefined();
  });

  it("an unparseable OBR-8 keeps the period's start and never moves it to effectiveDateTime", () => {
    const result = report({ 7: "20260721080000-0500", 8: NOT_A_DATE });
    const dr = only(result, "DiagnosticReport");
    expect(dr["effectivePeriod"]).toEqual({ start: "2026-07-21T08:00:00-05:00" });
    expect(dr["effectiveDateTime"]).toBeUndefined();
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("an unparseable OBR-7 sets neither effective element, even with OBR-8 valued", () => {
    const result = report({ 7: NOT_A_DATE, 8: "20260721093000-0500" });
    const dr = only(result, "DiagnosticReport");
    expect(dr["effectivePeriod"]).toBeUndefined();
    expect(dr["effectiveDateTime"]).toBeUndefined();
  });

  it("a date-only OBR-22 is not an instant: issued is dropped and flagged", () => {
    const result = report({ 22: "20260721" });
    expect(only(result, "DiagnosticReport")["issued"]).toBeUndefined();
    expect(labels(result)).toContain(`${TRANSFORM_ELEMENT_DROPPED}@OBR.22#DiagnosticReport.issued`);
  });

  it("an unparseable OBR-22 is flagged as invalid, not as a precision drop", () => {
    const result = report({ 22: NOT_A_DATE });
    expect(only(result, "DiagnosticReport")["issued"]).toBeUndefined();
    expect(issuesAt(result, "OBR.22")).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain(TRANSFORM_TIMESTAMP_INVALID);
  });

  it("an OBR with no OBR-4 builds no DiagnosticReport, since code is required", () => {
    const result = run([
      ORU,
      PID_JANE,
      segment("OBR", { 1: "1", 25: "F" }),
      segment("OBX", { 1: "1", 2: "ST", 3: "8310-5^Note^LN", 5: "ok", 11: "F" }),
    ]);
    expect(resourcesOfType(result, "DiagnosticReport")).toEqual([]);
    expect(resourcesOfType(result, "Observation")).toHaveLength(1);
  });
});

describe("a date the parser's typed view could not read is reported, not lost in silence", () => {
  // PID-7, PV1-44, PV1-45 and MSH-7 reach this library through `@cosyte/hl7`'s typed views, which
  // hand back nothing for a value they cannot read. Nothing else changes: the bundle is exactly the
  // one the same message gives with the field empty, and the issues are that message's plus one.
  const MSH_TS = "20260721143000-0500";
  const PV1 = (admit: string, discharge: string): string =>
    segment("PV1", { 1: "1", 2: "I", 44: admit, 45: discharge });

  /** The message with the date field valued as given, and with it empty. */
  const cases = [
    {
      field: "PID-7",
      location: "PID.7",
      fhirPath: "Patient.birthDate",
      lines: (v: string) => [MSH_ADT_A01, PID_JANE.replace("19800115", v), PV1("", "")],
    },
    {
      field: "PV1-44",
      location: "PV1.44",
      fhirPath: "Encounter.period.start",
      lines: (v: string) => [MSH_ADT_A01, PID_JANE, PV1(v, "20260722100000-0500")],
    },
    {
      field: "PV1-45",
      location: "PV1.45",
      fhirPath: "Encounter.period.end",
      lines: (v: string) => [MSH_ADT_A01, PID_JANE, PV1("20260721100000-0500", v)],
    },
    {
      field: "MSH-7",
      location: "MSH.7",
      fhirPath: "Bundle.timestamp",
      lines: (v: string) => [MSH_ADT_A01.replace(MSH_TS, v), PID_JANE, PV1("", "")],
    },
  ] as const;

  it.each(cases)("an unparseable $field raises one issue and changes nothing else", (c) => {
    const bad = run(c.lines(NOT_A_DATE));
    const empty = run(c.lines(""));
    expect(bundleJson(bad)).toEqual(bundleJson(empty));
    const reported = `${TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER}@${c.location}#${c.fhirPath}`;
    expect(labels(bad).filter((l) => l === reported)).toHaveLength(1);
    expect(labels(bad).filter((l) => l !== reported)).toEqual(labels(empty));
    expect(issuesAt(bad, c.location).map((i) => i.code)).toEqual([
      TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER,
    ]);
  });

  it.each(cases)("an empty or null $field raises nothing for it", (c) => {
    for (const v of ["", '""']) {
      expect(issuesAt(run(c.lines(v)), c.location)).toEqual([]);
    }
  });

  it.each(cases)("a readable $field raises nothing for it", (c) => {
    const result = run(c.lines("20260721143000-0500"));
    expect(result.issues.filter((i) => i.code === TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER)).toEqual(
      [],
    );
  });

  it("an order-ambiguous PID-7 the typed view refuses is reported the same way", () => {
    const result = run([MSH_ADT_A01, PID_JANE.replace("19800115", "05/07/1980")]);
    expect(only(result, "Patient")["birthDate"]).toBeUndefined();
    expect(labels(result)).toContain(
      `${TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER}@PID.7#Patient.birthDate`,
    );
  });

  it("an order-ambiguous MSH-7 the view hands over as invalid keeps its own flag only", () => {
    const result = run([MSH_ADT_A01.replace(MSH_TS, "05/07/2026"), PID_JANE]);
    expect(bundleJson(result)["timestamp"]).toBeUndefined();
    const codes = result.issues.map((i) => i.code);
    expect(codes).toContain(TRANSFORM_TIMESTAMP_INVALID);
    expect(codes).not.toContain(TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER);
  });

  it("an unparseable PV1-45 still leaves the status to the patient class", () => {
    const result = run([MSH_ADT_A01, PID_JANE, PV1("", NOT_A_DATE)]);
    expect(only(result, "Encounter")["status"]).toBe("in-progress");
  });
});

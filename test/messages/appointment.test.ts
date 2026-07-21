import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  ISSUE_CODES,
  APPOINTMENT_STATUS_MAP,
  type TransformResult,
} from "../../src/index.js";

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
function appointment(result: TransformResult): unknown {
  const entry = getProperty(result.bundle, "entry");
  if (entry === undefined || !isList(entry)) return undefined;
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    const type = rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
    if (type === "Appointment") return res;
  }
  return undefined;
}

const MSH = "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||SIU^S12^SIU_S12|MSG1|P|2.5.1";
const PID = "PID|1||MRN1^^^HOSP^MR||Appt^Amy^^^^^L||19900101|F";

describe("SIU_S12 → Appointment (Phase 5)", () => {
  it("assembles an Appointment from SCH/AIS/PID, grounded on the IG segment maps", () => {
    const result = toFhirSeq([
      MSH,
      seg("SCH", {
        1: "PLAC-APPT-1",
        2: "FILL-APPT-1",
        7: "CHECKUP^Annual checkup^HL70276",
        8: "ROUTINE^Routine^HL70277",
        9: "30",
        10: "min^minutes^UCUM",
        11: "^^^20260801093000-0500^20260801100000-0500",
        25: "Booked",
      }),
      PID,
      seg("AIS", { 3: "OFFICEVISIT^Office visit^L", 10: "Booked" }),
    ]);
    const appt = appointment(result);
    expect(appt).toBeDefined();
    const status = getProperty(appt as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("booked"); // SCH-25 Booked → HL70278 → booked
    const start = getProperty(appt as never, "start") as { value: unknown } | undefined;
    const end = getProperty(appt as never, "end") as { value: unknown } | undefined;
    expect(start?.value).toBe("2026-08-01T09:30:00-05:00"); // TQ.4 → start (fully zoned instant)
    expect(end?.value).toBe("2026-08-01T10:00:00-05:00"); // TQ.5 → end
    const minutes = getProperty(appt as never, "minutesDuration") as { value: unknown } | undefined;
    expect(String(minutes?.value)).toBe("30");
    expect(getProperty(appt as never, "appointmentType")).toBeDefined();
    expect(getProperty(appt as never, "serviceType")).toBeDefined();
    // the patient is the required participant
    const participant = getProperty(appt as never, "participant");
    expect(participant !== undefined && isList(participant)).toBe(true);
    // participant.status is data-absent (unknown) + flagged, never fabricated
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN);
  });

  it("maps every HL70278 filler-status code to a valid appointmentstatus", () => {
    expect(APPOINTMENT_STATUS_MAP).toEqual({
      Pending: "pending",
      Waitlist: "waitlist",
      Booked: "booked",
      Started: "checked-in",
      Complete: "fulfilled",
      Cancelled: "cancelled",
      Deleted: "entered-in-error",
      Noshow: "noshow",
    });
  });

  it("withholds the Appointment when SCH-25 is an IG-unmatched status (never guessed)", () => {
    const result = toFhirSeq([MSH, seg("SCH", { 25: "Overbook" }), PID]);
    expect(appointment(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID);
  });

  it("withholds the Appointment when there is no Patient to be the required participant", () => {
    const result = toFhirSeq([MSH, seg("SCH", { 25: "Booked" })]);
    expect(appointment(result)).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID);
  });

  it("drops a naked (unzoned) SCH-11 timing rather than assign a fabricated UTC offset", () => {
    const result = toFhirSeq([
      MSH,
      seg("SCH", { 11: "^^^20260801093000^20260801100000", 25: "Booked" }),
      PID,
    ]);
    const appt = appointment(result);
    expect(appt).toBeDefined();
    expect(getProperty(appt as never, "start")).toBeUndefined();
    expect(getProperty(appt as never, "end")).toBeUndefined();
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("omits minutesDuration when SCH-10 does not declare minutes, and start-only timing", () => {
    const result = toFhirSeq([
      MSH,
      seg("SCH", {
        9: "2",
        10: "d^days^UCUM", // not minutes → minutesDuration omitted
        11: "^^^20260801093000-0500", // TQ.4 start only, no TQ.5 end
        25: "Pending",
      }),
      PID,
    ]);
    const appt = appointment(result);
    expect(appt).toBeDefined();
    expect(getProperty(appt as never, "minutesDuration")).toBeUndefined();
    expect(getProperty(appt as never, "start")).toBeDefined();
    expect(getProperty(appt as never, "end")).toBeUndefined();
    const status = getProperty(appt as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("pending");
  });

  it("omits minutesDuration when SCH-9 is present but SCH-10 (units) is entirely absent", () => {
    const result = toFhirSeq([MSH, seg("SCH", { 9: "45", 25: "Booked" }), PID]);
    const appt = appointment(result);
    expect(appt).toBeDefined();
    expect(getProperty(appt as never, "minutesDuration")).toBeUndefined();
  });

  it("builds a minimal Appointment (status + patient participant) with no SCH-7/8, no AIS", () => {
    const result = toFhirSeq([MSH, seg("SCH", { 25: "Cancelled" }), PID]);
    const appt = appointment(result);
    expect(appt).toBeDefined();
    expect(getProperty(appt as never, "appointmentType")).toBeUndefined();
    expect(getProperty(appt as never, "serviceType")).toBeUndefined();
    const status = getProperty(appt as never, "status") as { value: unknown } | undefined;
    expect(status?.value).toBe("cancelled");
  });

  it("flags a non-S12 SIU trigger as segment-assembled", () => {
    const result = toFhirSeq([
      "MSH|^~\\&|S|SF|R|RF|20260721143000-0500||SIU^S13^SIU_S12|MSG1|P|2.5.1",
      seg("SCH", { 25: "Booked" }),
      PID,
    ]);
    expect(codes(result)).toContain(ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED);
    expect(appointment(result)).toBeDefined();
  });
});

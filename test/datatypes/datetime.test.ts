import { describe, expect, it } from "vitest";
import { parseDtm } from "@cosyte/hl7";
import { primitive } from "@cosyte/fhir";

import { toFhirDateTime, ISSUE_CODES } from "../../src/index.js";
import { embedAndValidate } from "../_support/fhir.js";

describe("toFhirDateTime — precision preserved, no padding", () => {
  it.each([
    ["2026", "2026"],
    ["202607", "2026-07"],
    ["20260721", "2026-07-21"],
  ])("keeps %s at its stated precision → %s", (raw, expected) => {
    const { value, issues } = toFhirDateTime(parseDtm(raw));
    expect(value).toBe(expected);
    expect(issues).toEqual([]);
  });

  it("emits a full zoned dateTime when the wire carried an offset", () => {
    const { value, issues } = toFhirDateTime(parseDtm("20260721143000-0500"));
    expect(value).toBe("2026-07-21T14:30:00-05:00");
    expect(issues).toEqual([]);
  });

  it("preserves sub-second fraction with an offset", () => {
    const { value } = toFhirDateTime(parseDtm("20260721143000.5-0500"));
    expect(value).toBe("2026-07-21T14:30:00.5-05:00");
  });

  it("formats a +00:00 offset explicitly (never a bare Z guess)", () => {
    const { value } = toFhirDateTime(parseDtm("20260721143000+0000"));
    expect(value).toBe("2026-07-21T14:30:00+00:00");
  });
});

describe("toFhirDateTime — the naked-timestamp fail-safe (MANDATORY)", () => {
  it("never turns a timezone-less timestamp into a zoned/UTC instant", () => {
    const { value, issues } = toFhirDateTime(parseDtm("20260721143000"));
    // Reduced to date precision — never fabricated a zone.
    expect(value).toBe("2026-07-21");
    expect(value).not.toMatch(/T/);
    expect(value).not.toMatch(/[Zz]/);
    expect(value).not.toMatch(/[+]/);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE);
    expect(issues[0]?.v2Location).toBe("TS.1");
  });

  it("applies a caller-asserted offset when supplied, flagging it as asserted", () => {
    const { value, issues } = toFhirDateTime(parseDtm("20260721143000"), {
      assumeTimezoneOffsetMinutes: -300,
    });
    expect(value).toBe("2026-07-21T14:30:00-05:00");
    expect(issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE);
  });

  it("reduces a partial-precision (hour) naked time to date, never padding seconds", () => {
    const { value, issues } = toFhirDateTime(parseDtm("2026072114"));
    expect(value).toBe("2026-07-21");
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE);
  });

  it("reduces a partial-precision time WITH an offset to date (FHIR needs full seconds)", () => {
    const { value, issues } = toFhirDateTime(parseDtm("2026072114-0500"));
    expect(value).toBe("2026-07-21");
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });
});

describe("toFhirDateTime — invalid input fails safe", () => {
  it("emits no value and a typed issue for an unparseable timestamp", () => {
    const { value, issues } = toFhirDateTime(parseDtm("not-a-date"));
    expect(value).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });
});

describe("toFhirDateTime — output validates under @cosyte/fhir (emit gate)", () => {
  it.each(["2026", "20260721", "20260721143000-0500", "20260721143000", "20260721143000.5-0500"])(
    "produces a FHIR-valid dateTime for %s",
    (raw) => {
      const { value } = toFhirDateTime(parseDtm(raw));
      if (value === undefined) return;
      expect(embedAndValidate([["effectiveDateTime", primitive(value)]])).toEqual([]);
    },
  );
});

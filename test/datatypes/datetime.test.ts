import { describe, expect, it } from "vitest";
import { parseDtm, type TS } from "@cosyte/hl7";
import { primitive } from "@cosyte/fhir";

import { toFhirDateTime, ISSUE_CODES } from "../../src/index.js";
import { embedAndValidate } from "../_support/fhir.js";

describe("toFhirDateTime: precision preserved, no padding", () => {
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

describe("toFhirDateTime: the naked-timestamp fail-safe (MANDATORY)", () => {
  it("never turns a timezone-less timestamp into a zoned/UTC instant", () => {
    const { value, issues } = toFhirDateTime(parseDtm("20260721143000"));
    // Reduced to date precision, never fabricated a zone.
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

describe("toFhirDateTime: invalid input fails safe", () => {
  it("emits no value and a typed issue for an unparseable timestamp", () => {
    const { value, issues } = toFhirDateTime(parseDtm("not-a-date"));
    expect(value).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });
});

describe("toFhirDateTime: output validates under @cosyte/fhir (emit gate)", () => {
  it.each(["2026", "20260721", "20260721143000-0500", "20260721143000", "20260721143000.5-0500"])(
    "produces a FHIR-valid dateTime for %s",
    (raw) => {
      const { value } = toFhirDateTime(parseDtm(raw));
      if (value === undefined) return;
      expect(embedAndValidate([["effectiveDateTime", primitive(value)]])).toEqual([]);
    },
  );
});

describe("toFhirDateTime: an offset FHIR cannot carry is never emitted", () => {
  // The R4 dateTime grammar admits offsets from -14:00 to +14:00 in whole minutes. A v2 DTM admits
  // any -2359 to +2359, so a wire offset outside FHIR's range has no faithful FHIR form: the time is
  // dropped to date precision and flagged, exactly as for a time FHIR cannot carry at all.
  it.each(["+1401", "+1500", "+2359", "-1401", "-2359"])(
    "reduces a wire offset of %s to the date and flags the drop",
    (zone) => {
      const { value, issues } = toFhirDateTime(parseDtm(`20260721143000${zone}`));
      expect(value).toBe("2026-07-21");
      expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
    },
  );

  it.each([
    ["+1400", "2026-07-21T14:30:00+14:00"],
    ["-1400", "2026-07-21T14:30:00-14:00"],
    ["+1359", "2026-07-21T14:30:00+13:59"],
  ])("keeps a wire offset of %s at the edge of FHIR's range", (zone, expected) => {
    const { value, issues } = toFhirDateTime(parseDtm(`20260721143000${zone}`));
    expect(value).toBe(expected);
    expect(issues).toEqual([]);
    expect(embedAndValidate([["effectiveDateTime", primitive(expected)]])).toEqual([]);
  });

  it.each([841, -841, 900, 90.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "ignores a caller-asserted offset of %s minutes, reducing a naked time to the date",
    (assumeTimezoneOffsetMinutes) => {
      const { value, issues } = toFhirDateTime(parseDtm("20260721143000"), {
        assumeTimezoneOffsetMinutes,
      });
      expect(value).toBe("2026-07-21");
      expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE]);
    },
  );

  it.each([840, -840, -720])("applies a caller-asserted offset of %s minutes", (minutes) => {
    const { value } = toFhirDateTime(parseDtm("20260721143000"), {
      assumeTimezoneOffsetMinutes: minutes,
    });
    expect(value).toMatch(/^2026-07-21T14:30:00[+-]1[24]:00$/);
    expect(embedAndValidate([["effectiveDateTime", primitive(value ?? "")]])).toEqual([]);
  });
});

describe("toFhirDateTime: a hand-built timestamp never has its missing time parts filled in", () => {
  // `TS` is a plain object type, so a JavaScript caller can hand one over that claims a precision its
  // parts do not carry. A minute or second it does not have is never padded to `00`.
  it.each([
    ["no minute", { precision: "second", second: 0 }],
    ["no second", { precision: "second", minute: 30 }],
    ["no second, at fraction precision", { precision: "fraction", minute: 30 }],
  ] as const)("reduces a timestamp with %s to the date", (_label, parts) => {
    const { value, issues } = toFhirDateTime({
      raw: "",
      valid: true,
      year: 2026,
      month: 7,
      day: 21,
      hour: 14,
      hasTimezone: true,
      offsetMinutes: -300,
      fractionalSeconds: "5",
      ...parts,
    });
    expect(value).toBe("2026-07-21");
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
  });

  it("emits the full time when the hand-built timestamp carries every part", () => {
    const { value } = toFhirDateTime({
      raw: "",
      valid: true,
      precision: "second",
      year: 2026,
      month: 7,
      day: 21,
      hour: 14,
      minute: 30,
      second: 5,
      hasTimezone: true,
      offsetMinutes: -300,
    });
    expect(value).toBe("2026-07-21T14:30:05-05:00");
  });
});

describe("toFhirDateTime: a hand-built timestamp never writes a date part out of place", () => {
  // Every part a `TS` carries is either written where FHIR expects it or dropped with a flag. A day
  // has no place without a month, and a time has no place without the full date it falls on: FHIR
  // writes a time only after `YYYY-MM-DD`, so `2026-07T14:30:00` or `2026-21` is never written.
  const base = {
    raw: "",
    valid: true,
    precision: "second",
    year: 2026,
    month: 7,
    day: 21,
    hour: 14,
    minute: 30,
    second: 0,
    hasTimezone: true,
    offsetMinutes: 0,
  } as const;

  /** The base timestamp with the named parts left out (absent, not `undefined`). */
  const without = (...keys: readonly ("month" | "day" | "offsetMinutes")[]): TS =>
    Object.fromEntries(
      Object.entries(base).filter(([key]) => !(keys as readonly string[]).includes(key)),
    ) as unknown as TS;

  it.each([
    ["no day", without("day"), "2026-07"],
    ["no month", without("month"), "2026"],
    ["no month and no day", without("month", "day"), "2026"],
    ["no day, at fraction precision", { ...without("day"), precision: "fraction" }, "2026-07"],
  ] as const)("reduces a time with %s to the date it can place", (_label, ts, expected) => {
    const { value, issues } = toFhirDateTime(ts);
    expect(value).toBe(expected);
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
    expect(embedAndValidate([["effectiveDateTime", primitive(expected)]])).toEqual([]);
  });

  it("flags the incomplete date, not the zone, when a naked time also has no day", () => {
    const { value, issues } = toFhirDateTime(
      { ...without("day", "offsetMinutes"), hasTimezone: false },
      { assumeTimezoneOffsetMinutes: -300 },
    );
    expect(value).toBe("2026-07");
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
  });

  it.each([
    ["day precision", "day"],
    ["month precision", "month"],
  ] as const)("drops a day that has no month at %s and keeps the year", (_label, precision) => {
    const { value, issues } = toFhirDateTime({
      raw: "",
      valid: true,
      precision,
      year: 2026,
      day: 21,
      hasTimezone: false,
    });
    expect(value).toBe("2026");
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
  });

  it.each([
    ["a minute", { minute: 30 }],
    ["a second", { second: 5 }],
    ["a minute and a second", { minute: 30, second: 5 }],
  ] as const)("flags %s that has no hour to sit on, keeping the date", (_label, parts) => {
    const { value, issues } = toFhirDateTime({
      raw: "",
      valid: true,
      precision: "second",
      year: 2026,
      month: 7,
      day: 21,
      hasTimezone: true,
      offsetMinutes: 0,
      ...parts,
    });
    expect(value).toBe("2026-07-21");
    expect(issues.map((i) => i.code)).toEqual([ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]);
  });

  it.each([
    ["a year", { precision: "year" }, "2026"],
    ["a year and month", { precision: "month", month: 7 }, "2026-07"],
    ["a full date", { precision: "day", month: 7, day: 21 }, "2026-07-21"],
  ] as const)("keeps %s with no time exactly, with no issue", (_label, parts, expected) => {
    const { value, issues } = toFhirDateTime({
      raw: "",
      valid: true,
      year: 2026,
      hasTimezone: false,
      ...parts,
    });
    expect(value).toBe(expected);
    expect(issues).toEqual([]);
  });
});

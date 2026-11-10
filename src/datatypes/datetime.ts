/**
 * DTM / TS → FHIR `dateTime`: the single most dangerous conversion.
 *
 * Grounded on the IG datatype ConceptMap **DTM → dateTime** (`DTM.1` *is equivalent to* the FHIR
 * `dateTime.$value`, with the instruction to "convert v2 date time format to FHIR date time format")
 * and the **FHIR core datatype rule** it defers to: *"if hours and minutes are specified, a timezone
 * offset SHALL be populated"*, and the R4 `dateTime` grammar requires **full `hh:mm:ss` with an
 * offset** whenever a time is present. Two fail-safe consequences follow:
 *
 * - **Naked timestamp (no offset).** A `20260721143000` cannot become a valid zoned FHIR `dateTime`
 *   without inventing an offset: assuming UTC would silently shift the clinical instant by hours. So
 *   the value is **reduced to date precision** (`2026-07-21`) and {@link ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE}
 *   is raised, unless the caller asserts the sender's offset via `options.assumeTimezoneOffsetMinutes`.
 * - **Partial-precision time (hour/minute only).** FHIR cannot represent `hh` or `hh:mm` without
 *   seconds, and padding `:00` would fabricate precision, so such a value is likewise reduced to date
 *   precision and flagged, never padded.
 *
 * - **Offset FHIR cannot write.** The R4 grammar admits offsets from `-14:00` to `+14:00` in whole
 *   minutes, where a v2 DTM admits any `-2359` to `+2359`. An offset outside FHIR's range, on the wire
 *   or asserted by the caller, cannot be written without changing the instant, so it is treated as
 *   no usable offset at all and the value is reduced to date precision and flagged.
 *
 * - **Part with no place.** A `TS` built by hand can carry parts its precision does not name, or
 *   leave out parts it does: a day with no month, a minute with no hour, a time with no day. Each part
 *   is written where FHIR expects it or dropped and flagged; none is padded or written out of place.
 *
 * Date-only precisions (`2026`, `2026-07`, `2026-07-21`) are preserved exactly, never zero-filled,
 * and need no offset (FHIR permits a bare date).
 *
 * @packageDocumentation
 */

import type { TS } from "@cosyte/hl7";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformOptions } from "../terminology/context.js";

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}

/** The signed FHIR offset suffix for a number of minutes east of UTC (e.g. `-300` → `-05:00`). */
function formatOffset(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(abs / 60), 2)}:${pad(abs % 60, 2)}`;
}

/** The widest offset the R4 `dateTime` grammar admits, in minutes either side of UTC (`14:00`). */
const FHIR_MAX_OFFSET_MINUTES = 14 * 60;

/** The offset itself when FHIR can write it (whole minutes, `-14:00` to `+14:00`), else `undefined`. */
function writableOffset(offsetMinutes: number | undefined): number | undefined {
  return offsetMinutes !== undefined &&
    Number.isInteger(offsetMinutes) &&
    Math.abs(offsetMinutes) <= FHIR_MAX_OFFSET_MINUTES
    ? offsetMinutes
    : undefined;
}

/** The `YYYY[-MM[-DD]]` date portion of a parsed TS, at its stated precision. */
function datePart(year: number, month: number | undefined, day: number | undefined): string {
  let out = pad(year, 4);
  if (month !== undefined) {
    out += `-${pad(month, 2)}`;
    if (day !== undefined) out += `-${pad(day, 2)}`;
  }
  return out;
}

/** The flag for a part the TS carries that has no place in the FHIR value and is left out. */
function dropped(value: string): ConvertResult<string> {
  return { value, issues: [issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TS.1", "dateTime")] };
}

/**
 * Convert a parsed HL7 v2 timestamp to a FHIR `dateTime` lexical string, fail-safe on timezone and
 * precision. Returns `{ value: undefined }` only when the timestamp is unparseable.
 *
 * @param ts - A parsed `@cosyte/hl7` `TS` (`DtmParts`).
 * @param options - Conversion policy; `assumeTimezoneOffsetMinutes` supplies a sender-asserted offset.
 * @example
 * ```ts
 * import { parseDtm } from "@cosyte/hl7";
 * import { toFhirDateTime } from "@cosyte/transform";
 * const { value } = toFhirDateTime(parseDtm("20260721"));
 * // value === "2026-07-21"
 * void value;
 * ```
 */
export function toFhirDateTime(ts: TS, options: TransformOptions = {}): ConvertResult<string> {
  if (!ts.valid || ts.precision === undefined || ts.year === undefined) {
    return {
      value: undefined,
      issues: [issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID, "TS.1", "dateTime")],
    };
  }

  const date = datePart(ts.year, ts.month, ts.day);

  // Every part a TS carries is written where FHIR expects it or dropped with a flag, never written
  // out of place. A hand-built TS can carry a day without a month, a minute without an hour, or a
  // time without the full date it falls on; FHIR has a place for none of these.
  if (ts.month === undefined && ts.day !== undefined) return dropped(date);

  // No time-of-day → a bare date is a valid FHIR dateTime; preserve precision exactly.
  if (ts.hour === undefined) {
    return ts.minute === undefined && ts.second === undefined
      ? { value: date, issues: [] }
      : dropped(date);
  }

  // FHIR writes a time only after a full `YYYY-MM-DD`; supplying an offset would not change that.
  if (ts.day === undefined) return dropped(date);

  // Time-of-day present. FHIR requires full hh:mm:ss + an offset; anything less cannot be emitted.
  // Full means the parts are there, not only that the precision says so: a hand-built TS can claim
  // second precision without a minute, and a part it does not carry is never padded to `00`.
  const { minute, second } = ts;
  const hasFullTime =
    (ts.precision === "second" || ts.precision === "fraction") &&
    minute !== undefined &&
    second !== undefined;
  // An offset FHIR cannot write is no offset at all: the value is reduced, never written out of range.
  const offset = writableOffset(
    ts.hasTimezone ? ts.offsetMinutes : options.assumeTimezoneOffsetMinutes,
  );

  if (hasFullTime && offset !== undefined) {
    const frac =
      ts.precision === "fraction" && ts.fractionalSeconds !== undefined
        ? `.${ts.fractionalSeconds}`
        : "";
    const value = `${date}T${pad(ts.hour, 2)}:${pad(minute, 2)}:${pad(second, 2)}${frac}${formatOffset(offset)}`;
    // If the offset was asserted by the caller rather than present on the wire, say so (value-free).
    const issues = ts.hasTimezone
      ? []
      : [issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime")];
    return { value, issues };
  }

  // Cannot emit a valid zoned/full-precision time → reduce to date precision, never pad, never assume UTC.
  if (!ts.hasTimezone && offset === undefined) {
    return {
      value: date,
      issues: [issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime")],
    };
  }
  return dropped(date);
}

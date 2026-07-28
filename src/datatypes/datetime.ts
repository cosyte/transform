/**
 * DTM / TS → FHIR `dateTime` — the single most dangerous conversion.
 *
 * Grounded on the IG datatype ConceptMap **DTM → dateTime** (`DTM.1` *is equivalent to* the FHIR
 * `dateTime.$value`, with the instruction to "convert v2 date time format to FHIR date time format")
 * and the **FHIR core datatype rule** it defers to: *"if hours and minutes are specified, a timezone
 * offset SHALL be populated"*, and the R4 `dateTime` grammar requires **full `hh:mm:ss` with an
 * offset** whenever a time is present. Two fail-safe consequences follow:
 *
 * - **Naked timestamp (no offset).** A `20260721143000` cannot become a valid zoned FHIR `dateTime`
 *   without inventing an offset — assuming UTC would silently shift the clinical instant by hours. So
 *   the value is **reduced to date precision** (`2026-07-21`) and {@link ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE}
 *   is raised — unless the caller asserts the sender's offset via `options.assumeTimezoneOffsetMinutes`.
 * - **Partial-precision time (hour/minute only).** FHIR cannot represent `hh` or `hh:mm` without
 *   seconds, and padding `:00` would fabricate precision, so such a value is likewise reduced to date
 *   precision and flagged — never padded.
 *
 * Date-only precisions (`2026`, `2026-07`, `2026-07-21`) are preserved exactly — never zero-filled —
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

/** The `YYYY[-MM[-DD]]` date portion of a parsed TS, at its stated precision. */
function datePart(ts: TS): string {
  let out = pad(ts.year ?? 0, 4);
  if (ts.month !== undefined) out += `-${pad(ts.month, 2)}`;
  if (ts.day !== undefined) out += `-${pad(ts.day, 2)}`;
  return out;
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

  const date = datePart(ts);

  // No time-of-day → a bare date is a valid FHIR dateTime; preserve precision exactly.
  if (ts.hour === undefined) {
    return { value: date, issues: [] };
  }

  // Time-of-day present. FHIR requires full hh:mm:ss + an offset; anything less cannot be emitted.
  const hasFullTime = ts.precision === "second" || ts.precision === "fraction";
  const offset = ts.hasTimezone ? ts.offsetMinutes : options.assumeTimezoneOffsetMinutes;

  if (hasFullTime && offset !== undefined) {
    const frac =
      ts.precision === "fraction" && ts.fractionalSeconds !== undefined
        ? `.${ts.fractionalSeconds}`
        : "";
    const value = `${date}T${pad(ts.hour, 2)}:${pad(ts.minute ?? 0, 2)}:${pad(ts.second ?? 0, 2)}${frac}${formatOffset(offset)}`;
    // If the offset was asserted by the caller rather than present on the wire, say so (value-free).
    const issues = ts.hasTimezone
      ? []
      : [issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime")];
    return { value, issues };
  }

  // Cannot emit a valid zoned/full-precision time → reduce to date precision, never pad, never assume UTC.
  const code =
    !ts.hasTimezone && offset === undefined
      ? ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE
      : ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED;
  return { value: date, issues: [issue(code, "TS.1", "dateTime")] };
}

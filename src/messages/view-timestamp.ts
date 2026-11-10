/**
 * The report for a date that a `@cosyte/hl7` typed view could not read.
 *
 * PID-7 (`msg.patient.dateOfBirth`), PV1-44 and PV1-45 (`msg.visit.admitDateTime` and
 * `.dischargeDateTime`) and MSH-7 (`msg.meta.timestamp`) reach this library through the parser's
 * typed views, which hand back no timestamp at all for a value they cannot read. Read alone, that is
 * the same as an empty field, so an unreadable date of birth or admit time would be lost with no
 * word. This check looks at the field itself: valued, and not readable as a timestamp, is reported
 * {@link ISSUE_CODES.TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER}. Nothing is written in its place.
 *
 * @packageDocumentation
 */

import type { Segment, TS } from "@cosyte/hl7";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";

/**
 * The issue for a typed-view date that came back absent although its field is valued and does not
 * read as a timestamp, or nothing.
 *
 * An empty or HL7-null (`""`) field raises nothing: there was no date to lose. A field whose own
 * text reads as a timestamp raises nothing either: the view was absent for another reason, such as a
 * caller replacing it, and the field was not lost to the parser.
 *
 * @param view - What the typed view handed back for the field.
 * @param segment - The segment the view reads, or `undefined` when there is none.
 * @param field - The 1-based field number within that segment.
 * @param v2Location - The v2 location to report, e.g. `PID.7`.
 * @param fhirPath - The FHIR element the field would have filled.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * const msg = parseHL7(raw);
 * const issues = viewTimestampIssues(
 *   msg.patient?.dateOfBirth,
 *   msg.segments("PID")[0],
 *   7,
 *   "PID.7",
 *   "Patient.birthDate",
 * );
 * void issues;
 * ```
 */
export function viewTimestampIssues(
  view: TS | undefined,
  segment: Segment | undefined,
  field: number,
  v2Location: string,
  fhirPath: string,
): TransformIssue[] {
  if (view !== undefined || segment === undefined) return [];
  const source = segment.field(field);
  if (source.value === "" || source.asTs().valid) return [];
  return [issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER, v2Location, fhirPath)];
}

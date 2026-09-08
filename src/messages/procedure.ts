/**
 * PR1 to FHIR `Procedure`: the procedures an admit states, carried into the bundle instead of lost
 * between the v2 feed and the FHIR record. Grounded firsthand on the IG **PR1 to Procedure** segment
 * map and the **ADT_A01 to Bundle** message map (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-pr1-to-procedure.html`, `ConceptMap-message-adt-a01-to-bundle.html`), which
 * wires `Procedure.subject.reference` to the bundle's Patient and creates one Procedure per PR1.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | PR1 (narrative row) | `status` (required 1..1) | the row's own `unknown`, the value it directs when the message context does not determine one |
 * | PR1-3 Procedure Code (CNE) | `code` | {@link toFhirCodeableConcept} (structural, no IG value map) |
 * | PR1-4 Procedure Description (ST) | `code.text` | verbatim, only `IF PR1-3.9 NOT VALUED` |
 * | PR1-5 Procedure Date/Time (DTM) | `performedDateTime` / `performedPeriod.start` | {@link toFhirDateTime}, branched on PR1-7 |
 * | PR1-6 Procedure Functional Type (CWE) | `category` | {@link toFhirCodeableConcept} |
 * | PR1-7 Procedure Minutes (NM) | `performedPeriod.end` | the period start plus that many minutes |
 * | PR1-15 Associated Diagnosis Code (CWE) | `reasonCode` | {@link toFhirCodeableConcept} |
 * | PR1-19 Procedure Identifier (EI) | `identifier` | {@link toFhirEntityIdentifier} |
 * | (message-map wiring) | `subject` (required 1..1) | the bundle's Patient |
 *
 * **Fail-safes (never a confident wrong procedure).**
 * - **The status is the one the map directs, never one the message did not state.** The map's own
 *   sort-order 0 row reads "The value mapping depends on the message context where the PR1 is used
 *   and to be determined by the implementer. If not clear, use `unknown`". No PR1 component states a
 *   procedure status, so `unknown` is the answer, and `completed` or `in-progress` is never selected
 *   from a message that did not say so.
 * - **A period needs a start precise enough to add minutes to.** PR1-7 is minutes, and the map's own
 *   comment requires PR1-5 to reach at least minute granularity before a `performedPeriod` is built
 *   from the pair. This library goes by what the conversion could actually carry: a PR1-5 that
 *   reduces to date precision (a naked or partial-precision timestamp, per {@link toFhirDateTime})
 *   is not a start a duration can be added to, so the value stays `performedDateTime` and the end is
 *   declared {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} rather than computed from a date.
 * - **The description defers to the coded field's own text.** The PR1-4 row is conditioned
 *   `IF PR1-3.9 NOT VALUED`, so an original text the sender put in the coded field wins and PR1-4 is
 *   dropped and declared rather than overwriting it.
 *
 * Deferred and flagged, never silently mapped: `PR1-8`, `PR1-11` and `PR1-12` (`performer.actor`, a
 * Practitioner resource this library does not build), `PR1-23` (`location`, likewise a Location),
 * `PR1-25` (`partOf`, a reference resolved by identifier rather than by bundle position) and
 * `PR1-16`, whose target `Procedure.code.value` is not an element of R4's `Procedure.code`.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference, toFhirEntityIdentifier, withCodeableText } from "./reference.js";

/**
 * The `Procedure.status` the PR1 map's own narrative row directs when the message context does not
 * determine one. No PR1 component carries a procedure status, so this is the value every Procedure
 * built from a PR1 carries.
 *
 * @example
 * ```ts
 * import { PROCEDURE_STATUS_UNKNOWN } from "@cosyte/transform";
 * PROCEDURE_STATUS_UNKNOWN; // "unknown"
 * ```
 */
export const PROCEDURE_STATUS_UNKNOWN = "unknown";

/** A v2 procedure-minutes value this library will add to a start: a plain non-negative integer. */
const WHOLE_MINUTES = /^\d+$/;

/** A FHIR `dateTime` carrying a time of day, captured so minutes can be added to it faithfully. */
const ZONED_DATE_TIME =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/**
 * Every `PR1` occurrence a message carries, in message order. One Procedure is created per
 * occurrence, per the IG message map's `0..-1` cardinality on the PROCEDURE group.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // collectProcedures(parseHL7(raw)).length; // one entry per PR1 in the message
 * ```
 */
export function collectProcedures(msg: Hl7Message): readonly Segment[] {
  return msg.allSegments().filter((seg) => seg.type === "PR1");
}

/**
 * Add whole minutes to a FHIR `dateTime` that carries a time of day, preserving its stated offset and
 * its fractional seconds exactly. Returns `undefined` when the value is not a full zoned timestamp,
 * because a date is not a start a duration can be added to.
 *
 * @param start - The FHIR `dateTime` lexical value the conversion produced.
 * @param minutes - The number of minutes to add.
 * @example
 * ```ts
 * import { addMinutes } from "@cosyte/transform";
 * addMinutes("2026-01-15T10:30:00-05:00", 45); // "2026-01-15T11:15:00-05:00"
 * addMinutes("2026-01-15", 45); // undefined
 * ```
 */
export function addMinutes(start: string, minutes: number): string | undefined {
  const parts = ZONED_DATE_TIME.exec(start);
  if (parts === null) return undefined;
  const [, year, month, day, hour, minute, second, fraction, zone] = parts;
  // Wall-clock arithmetic in a fixed offset: the parts are placed as if they were UTC and read back
  // the same way, so the stated offset is carried through untouched rather than re-derived.
  const wall = new Date(0);
  // Never NaN: the pattern above admits only four-digit years and two-digit parts, and every
  // out-of-range part rolls over. The one way out of range is the SHIFT, which is guarded below.
  wall.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  wall.setUTCHours(Number(hour), Number(minute), Number(second), 0);
  const shifted = new Date(wall.getTime() + minutes * 60_000);
  if (Number.isNaN(shifted.getTime())) return undefined;
  const pad = (value: number, width: number): string => String(value).padStart(width, "0");
  const rendered =
    `${pad(shifted.getUTCFullYear(), 4)}-${pad(shifted.getUTCMonth() + 1, 2)}` +
    `-${pad(shifted.getUTCDate(), 2)}T${pad(shifted.getUTCHours(), 2)}` +
    `:${pad(shifted.getUTCMinutes(), 2)}:${pad(shifted.getUTCSeconds(), 2)}`;
  return `${rendered}${fraction ?? ""}${zone ?? ""}`;
}

/**
 * The value-free diagnostics for the PR1 rows this library reads and deliberately does not build:
 * the three practitioner roles, the treating organizational unit, the parent procedure, and the code
 * modifier whose target is not an R4 element.
 *
 * Raised for the occurrence whether or not the Procedure itself is emitted, so a deferred row a
 * message actually valued is in the issues list rather than silently absent.
 *
 * @param pr1 - The `PR1` `@cosyte/hl7` `Segment`.
 * @example
 * ```ts
 * // deferredProcedureIssues(pr1).length; // one per valued deferred row
 * ```
 */
export function deferredProcedureIssues(pr1: Segment): readonly TransformIssue[] {
  const deferred: readonly (readonly [number, string])[] = [
    [8, "Procedure.performer.actor"],
    [11, "Procedure.performer.actor"],
    [12, "Procedure.performer.actor"],
    [16, "Procedure.code.value"],
    [23, "Procedure.location"],
    [25, "Procedure.partOf"],
  ];
  const issues: TransformIssue[] = [];
  for (const [field, path] of deferred) {
    if (pr1.field(field).value !== "") {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `PR1.${String(field)}`, path));
    }
  }
  return issues;
}

/** Build `Procedure.code` from PR1-3, with PR1-4 supplying text only where PR1-3.9 is not valued. */
function buildCode(
  pr1: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const cne = pr1.field(3).asCwe();
  const description = pr1.field(4).value;
  const originalTextValued = cne.originalText !== undefined && cne.originalText !== "";
  const coded = toFhirCodeableConcept(cne, ctx);
  issues.push(...coded.issues);

  if (description !== "" && originalTextValued) {
    // The row's own condition: an original text in the coded field wins, so PR1-4 is not carried.
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PR1.4", "Procedure.code.text"));
    return coded.value;
  }
  if (coded.value === undefined) {
    return description === ""
      ? undefined
      : complex([{ name: "text", value: primitive(description) }]);
  }
  return description === "" ? coded.value : withCodeableText(coded.value, description);
}

/** Build `Procedure.performed[x]` from PR1-5 and PR1-7, per the map's three conditioned rows. */
function buildPerformed(
  pr1: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): { name: string; value: FhirNode } | undefined {
  if (pr1.field(5).value === "") return undefined;
  const converted = toFhirDateTime(pr1.field(5).asTs(), ctx.options);
  issues.push(...converted.issues);
  if (converted.value === undefined) return undefined;

  const minutesRaw = pr1.field(7).value;
  if (minutesRaw === "") {
    return { name: "performedDateTime", value: primitive(converted.value) };
  }

  const end = WHOLE_MINUTES.test(minutesRaw)
    ? addMinutes(converted.value, Number(minutesRaw))
    : undefined;
  if (end === undefined) {
    // Either PR1-5 did not reach a time this conversion could carry, or PR1-7 is not a number of
    // minutes: no end is computed from a start that is not one, and the loss is declared.
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PR1.7", "Procedure.performedPeriod.end"),
    );
    return { name: "performedDateTime", value: primitive(converted.value) };
  }
  return {
    name: "performedPeriod",
    value: complex([
      { name: "start", value: primitive(converted.value) },
      { name: "end", value: primitive(end) },
    ]),
  };
}

/**
 * Build a FHIR `Procedure` resource node from one `PR1` occurrence, wired to the bundle's Patient.
 * Always produces a Procedure: a PR1 states that a procedure happened, and `status` is grounded on
 * the map's own row rather than on the message, so nothing here can fail to be groundable.
 *
 * @param pr1 - The `PR1` `@cosyte/hl7` `Segment`.
 * @param patientFullUrl - The bundle's Patient fullUrl, for `subject` (required 1..1).
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const pr1 = parseHL7(raw).segments("PR1")[0];
 * // const { value } = buildProcedure(pr1!, "urn:uuid:pat", {});
 * ```
 */
export function buildProcedure(
  pr1: Segment,
  patientFullUrl: string,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Procedure") },
  ];

  // PR1-19 EI -> identifier. The assigning authority is never turned into a system URI.
  const entity = toFhirEntityIdentifier(pr1.field(19));
  if (entity.identifier !== undefined) {
    props.push({ name: "identifier", value: list([entity.identifier]) });
  }
  if (entity.authorityValued) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PR1.19", "Procedure.identifier.system"),
    );
  }

  // The map's own narrative row: the status a PR1 grounds when the message context states none.
  props.push({ name: "status", value: primitive(PROCEDURE_STATUS_UNKNOWN) });

  // PR1-6 -> category.
  const category = toFhirCodeableConcept(pr1.field(6).asCwe(), ctx);
  issues.push(...category.issues);
  if (category.value !== undefined) props.push({ name: "category", value: category.value });

  // PR1-3 -> code, PR1-4 -> code.text (only where the coded field carries no original text).
  const code = buildCode(pr1, ctx, issues);
  if (code !== undefined) props.push({ name: "code", value: code });

  // The message map's wiring: Procedure.subject.reference = Patient[1].id.
  props.push({ name: "subject", value: reference(patientFullUrl) });

  // PR1-5 (+ PR1-7) -> performedDateTime or performedPeriod.
  const performed = buildPerformed(pr1, ctx, issues);
  if (performed !== undefined) props.push(performed);

  // PR1-15 -> reasonCode.
  const reason = toFhirCodeableConcept(pr1.field(15).asCwe(), ctx);
  issues.push(...reason.issues);
  if (reason.value !== undefined) props.push({ name: "reasonCode", value: list([reason.value]) });

  return { value: complex(props), issues };
}

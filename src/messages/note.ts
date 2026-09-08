/**
 * NTE → a FHIR `Annotation`, grounded firsthand on the IG **Segment NTE to ServiceRequest**
 * ConceptMap (`hl7.fhir.uv.v2mappings`, STU1; `ConceptMap-segment-nte-to-servicerequest.html`),
 * which is the map the ORU_R01 message map files its `Observation.note` row against.
 *
 * | NTE field | FHIR target | via |
 * |---|---|---|
 * | NTE-3 Comment (FT, `0..-1`) | `Annotation.text` (`markdown`) | one annotation per repetition |
 * | NTE-6 Entered Date/Time (DTM) | `Annotation.time` | {@link toFhirDateTime} |
 *
 * `NTE-1`, `NTE-2`, `NTE-7`, `NTE-8` and `NTE-9` carry no target in the map at all. Two rows do
 * carry one and are deliberately **declared rather than built**: `NTE-5 Entered By` targets
 * `note.authorReference(Practitioner)`, and this library builds no Practitioner, so an author would
 * be a reference resolving to nothing; and `NTE-4 Comment Type` targets a **proposed** extension
 * the guide has not named yet (its own cell reads `extension??-noteType`), so there is no canonical
 * URL to write and one is never invented.
 *
 * **A note is text the sender wrote, so it is read as text.** `NTE-3` is `FT`: a v2 primitive with
 * no component structure, where a raw `^` or `&` is content. Each repetition is rendered through
 * the parser's own display projection, which resolves the v2 escape sequences (`\T\` to `&`,
 * `\.br\` to a line break) and preserves verbatim any sequence it cannot render. The repetitions
 * are **not** joined: a separator between them would be a character the wire never carried, and
 * `Observation.note` is `0..*` precisely so each can stand on its own.
 *
 * @packageDocumentation
 */

import { renderText, type Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { TransformContext } from "../terminology/context.js";

/**
 * The NTE rows the map gives a target this library does not build, paired with that target. Each is
 * declared for an occurrence that valued it, so a deferred row is in the issues list rather than
 * silently absent.
 */
const DEFERRED_NOTE_ROWS: readonly (readonly [field: number, path: string])[] = Object.freeze([
  [4, "Annotation.extension"],
  [5, "Annotation.authorReference"],
]);

/** `Annotation.time` from NTE-6, or `undefined` when the segment values no entry timestamp. */
function annotationTime(
  nte: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  if (nte.field(6).value === "") return undefined;
  const entered = toFhirDateTime(nte.field(6).asTs(), ctx.options);
  issues.push(...entered.issues);
  return entered.value === undefined ? undefined : primitive(entered.value);
}

/**
 * Every FHIR `Annotation` a run of `NTE` segments contributes, in message order: one per valued
 * `NTE-3` repetition, each carrying that repetition's rendered text and the segment's `NTE-6` time.
 *
 * Returns `undefined` when the segments carry no comment text at all, so a caller adds no empty
 * `note` element. The diagnostics raised are value-free: no byte of a note ever reaches one.
 *
 * @param notes - The `NTE` segments to read, in message order.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @param issues - The issue sink for the deferred-row and timestamp diagnostics.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const nte = parseHL7(raw).segments("NTE");
 * // buildAnnotations(nte, {}, []); // a FHIR list of Annotation nodes, or undefined
 * ```
 */
export function buildAnnotations(
  notes: readonly Segment[],
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  const annotations: FhirComplex[] = [];

  for (const nte of notes) {
    for (const [field, path] of DEFERRED_NOTE_ROWS) {
      if (nte.field(field).value !== "") {
        issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `NTE.${String(field)}`, path));
      }
    }

    const comment = nte.field(3);
    if (comment.repetitions.length === 0) continue;
    const time = annotationTime(nte, ctx, issues);
    // The field's own delimiters, off the segment: a sender declares them in MSH-2, and splitting
    // on an assumed `~` would cut a note at a character the message never used as a separator.
    for (const repetition of comment.text.split(nte.enc.repetition)) {
      const rendered = renderText(repetition, nte.enc).text;
      if (rendered === "") continue;
      const props: { name: string; value: FhirNode }[] = [];
      if (time !== undefined) props.push({ name: "time", value: time });
      props.push({ name: "text", value: primitive(rendered) });
      annotations.push(complex(props));
    }
  }

  return annotations.length === 0 ? undefined : list(annotations);
}

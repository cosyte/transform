/**
 * TQ1 (Timing/Quantity) → the FHIR `Timing` an order's request carries, grounded firsthand on the IG
 * **Segment TQ1 to MedicationRequest** and **Segment TQ1 to ServiceRequest** ConceptMaps and the
 * **Datatype RPT to Timing** ConceptMap it delegates to (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-tq1-to-medicationrequest.html`, `ConceptMap-segment-tq1-to-servicerequest.html`,
 * `ConceptMap-datatype-rpt-to-timing.html`).
 *
 * A pharmacy order that reaches this library as `RXO` + `TQ1` used to produce a `MedicationRequest`
 * with a drug, a dose and a route and **no schedule at all**, so "give 5 mg every 4 hours for 3 days"
 * and "give 5 mg once" were the same resource. This module is the schedule: what the TQ1 grounds, and
 * an explicit refusal for everything it does not.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | TQ1-3 Repeat Pattern (RPT) | `dosageInstruction.timing` / `occurrenceTiming` | the RPT rows below |
 * | TQ1-7 Start date/time (DTM) | that Timing's `repeat.boundsPeriod.start` | {@link toFhirDateTime} |
 * | TQ1-8 End date/time (DTM) | that Timing's `repeat.boundsPeriod.end` | {@link toFhirDateTime} |
 * | TQ1-10 Condition text (TX) | `dosageInstruction.additionalInstruction.text` | whole field, verbatim |
 * | TQ1-11 Text instruction (TX) | `MedicationRequest.text` (a `Narrative`) | whole field, XML-escaped |
 *
 * and inside TQ1-3, the **expressible RPT components and only those**:
 *
 * | RPT component | FHIR target | via |
 * |---|---|---|
 * | RPT.1 Repeat Pattern Code | `Timing.code` (system `v2-0335`, code verbatim) | {@link isRepeatPatternCode} |
 * | RPT.5 Period Quantity | `Timing.repeat.period` (decimal) | precision-exact, never rescaled |
 * | RPT.6 Period Units | `Timing.repeat.periodUnit` (code) | {@link UNITS_OF_TIME} membership |
 * | RPT.8 Event | `Timing.repeat.when` (code) | {@link TIMING_EVENT_VALUE_MAP} |
 *
 * **RPT.5 and RPT.6 are a pair, not two independent rows**, because R4 constrains `Timing.repeat`
 * beyond its element types: `tim-2` requires period units wherever a period exists, and `tim-5`
 * requires the period to be non-negative. So a period with no units, a unit with no period, and a
 * negative period are each refused whole rather than emitted, for the reason below.
 *
 * **A schedule is fully grounded or absent and flagged.** Everything here is all-or-nothing, because
 * a half-built timing reads to the receiving system as a complete instruction: an order whose TQ1
 * says "every 4 hours, but only between meals" must not arrive as "every 4 hours". So **any** of the
 * conditions below withholds the whole `Timing` (no partial repeat, no lone `boundsPeriod`) and
 * raises a value-free issue naming the offending component:
 *
 * - An RPT component **outside** the four expressible rows is valued. `RPT.2` Calendar Alignment,
 *   `RPT.7` Institution Specified Time and `RPT.11` General Timing Specification have **no FHIR
 *   target row at all** in the published map; `RPT.3`/`RPT.4` (the two ends of the day-of-week
 *   range) carry the narrative `/translate number to day/` with no published table behind it;
 *   `RPT.9`/`RPT.10` Event Offset carry `/convert to minutes based on RPT.10/`, a rescale this
 *   library never performs.
 * - An `RPT.1` with no HL70335 row, an `RPT.8` with no HL70528 row targeting `v3-TimingEvent`, an
 *   `RPT.5` that is not a faithful FHIR `decimal`, or an `RPT.6` outside FHIR's required-bound
 *   `UnitsOfTime`. Each would need a value invented to be carried.
 * - An `RPT.5` **without** an `RPT.6`, an `RPT.6` **without** an `RPT.5`, or a **negative** `RPT.5`.
 *   The two are `0..1` each on the wire, so all three shapes arrive in real traffic, and every one of
 *   them produces a `Timing.repeat` that **fails a published R4 invariant**: `tim-2`
 *   (`period.empty() or periodUnit.exists()`) and `tim-5` ("period SHALL be a non-negative value").
 *   `@cosyte/fhir` models no `Timing` constraint, so the conservative-emit gate cannot catch any of
 *   them and a receiving system would be handed `{"period": 6}` or `{"period": -6}` as a grounded
 *   repeat to compute against. "Every minus six hours" is not a schedule.
 * - A **schedule-narrowing** field is valued: TQ1-4 Explicit Time, TQ1-5 Relative Time and Units,
 *   TQ1-6 Service Duration, TQ1-12 Conjunction, TQ1-13 Occurrence duration, TQ1-14 Total
 *   occurrences. Each one *narrows* the schedule, so a Timing built without it is not a subset of
 *   what the sender said, it is a different and larger instruction.
 * - A valued TQ1-7/TQ1-8 that yields no FHIR dateTime, or a TQ1-8 that precedes TQ1-7.
 * - More than one TQ1 on the order, or more than one repetition of TQ1-3: mapping one and discarding
 *   the rest would silently drop half a regimen.
 *
 * **TQ1-2 Quantity and TQ1-9 Priority are different**, and do *not* withhold the timing: the IG maps
 * them to the dose and the priority, both of which the RXO/OBR path already grounds. They are flagged
 * dropped and neither field is touched, so a TQ1 that carries them still contributes its schedule.
 *
 * @packageDocumentation
 */

import type { Segment } from "@cosyte/hl7";
import { complex, decimal, list, primitive, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import {
  isRepeatPatternCode,
  translateBound,
  TIMING_EVENT_VALUE_MAP,
  V2_0335_SYSTEM,
} from "../terminology/concept-map.js";
import type { TransformContext } from "../terminology/context.js";

/**
 * FHIR R4's `UnitsOfTime` value set: the **required** binding on `Timing.repeat.periodUnit`. RPT.6
 * carries a v2 period unit and the IG publishes no ConceptMap for that row, so the only faithful
 * carry is a code that is already a member; anything else would be an invented translation and is
 * refused instead.
 *
 * @example
 * ```ts
 * // UNITS_OF_TIME.has("h");   // true  -> RPT.6 "h" reaches Timing.repeat.periodUnit
 * // UNITS_OF_TIME.has("hr");  // false -> refused, never translated to "h"
 * ```
 */
export const UNITS_OF_TIME: ReadonlySet<string> = Object.freeze(
  new Set(["s", "min", "h", "d", "wk", "mo", "a"]),
);

/** The UCUM coding-system mnemonics RPT.6 may declare and still be read as a `UnitsOfTime` code. */
const UCUM_MNEMONICS: ReadonlySet<string> = Object.freeze(new Set(["UCUM", "ISO+"]));

/** The HL70335 coding-system mnemonics RPT.1 may declare and still be read as a table code. */
const HL70335_MNEMONICS: ReadonlySet<string> = Object.freeze(new Set(["HL70335", "0335"]));

/**
 * Which request the TQ1 is read for. It selects the FHIR paths the diagnostics name and whether the
 * TQ1-10 / TQ1-11 free-text rows have a target at all (the IG's ServiceRequest map sends them
 * elsewhere, and the service path carries only the timing here).
 *
 * @example
 * ```ts
 * // const reading = readTq1(group.tq1s, "MedicationRequest", ctx);
 * ```
 */
export type Tq1Target = "MedicationRequest" | "ServiceRequest";

/**
 * What one order group's TQ1 occurrences ground, ready for a request builder to place: the `Timing`
 * (or `undefined` when it was absent or refused), the two free-text rows, the value-free diagnostics
 * raised reading them, and whether anything at all reached the request.
 *
 * @example
 * ```ts
 * // const { timing, issues, contributes } = readTq1(tq1s, "ServiceRequest", ctx);
 * ```
 */
export interface Tq1Reading {
  /** The FHIR `Timing` node, or `undefined` when the TQ1 grounded none or the schedule was refused. */
  readonly timing: FhirComplex | undefined;
  /** TQ1-10 Condition text, verbatim, for `dosageInstruction.additionalInstruction.text`. */
  readonly conditionText: string | undefined;
  /** TQ1-11 Text instruction, verbatim, for the `MedicationRequest.text` narrative. */
  readonly instructionText: string | undefined;
  /** The value-free diagnostics this reading raised, in emission order. */
  readonly issues: readonly TransformIssue[];
  /** Whether the TQ1 contributed anything to the request (what the completeness ledger marks on). */
  readonly contributes: boolean;
}

/** The FHIR path of the timing element on each target: the `occurrence[x]`/`timing` choice differs. */
function timingPath(target: Tq1Target): string {
  return target === "MedicationRequest"
    ? "MedicationRequest.dosageInstruction.timing"
    : "ServiceRequest.occurrenceTiming";
}

/** Whether a field carries any content at all: one non-empty subcomponent anywhere in it. */
function isValued(seg: Segment, index: number): boolean {
  return seg
    .field(index)
    .repetitions.some((r) => r.components.some((c) => c.subcomponents.some((s) => s !== "")));
}

/** The subcomponents of a 1-based component of a composite field's first repetition. */
function subcomponents(seg: Segment, field: number, component: number): readonly string[] {
  return seg.field(field).repetitions[0]?.components[component - 1]?.subcomponents ?? [];
}

/** Whether a 1-based component of a composite field's first repetition carries any content. */
function componentValued(seg: Segment, field: number, component: number): boolean {
  return subcomponents(seg, field, component).some((s) => s !== "");
}

/** A 1-based subcomponent of a 1-based component, or `""` when absent (a composite-encoded CWE part). */
function subcomponent(seg: Segment, field: number, component: number, sub: number): string {
  return subcomponents(seg, field, component)[sub - 1] ?? "";
}

/**
 * The **whole** content of a `TX` free-text field, as display text.
 *
 * TQ1-10 and TQ1-11 are `TX`: a v2 **primitive**, with no component or subcomponent structure at
 * all, so a raw `^`, `&` or `~` inside one is *content* by definition. `Field.value` is documented
 * as the "first-repetition, first-component, first-subcomponent value" and would therefore truncate
 * `2 tabs^then 1 tab` to `2 tabs`, delivering a dosing instruction that lost its taper with nothing
 * to say so. `Field.render()` is the parser's documented reader for a clinical narrative: a read
 * projection over the field's byte-verbatim wire text that resolves the v2 escape sequences (`\T\`
 * to a literal `&`, `\.br\` to a line break) and **never fabricates**, preserving any sequence it
 * cannot render rather than guessing at it.
 */
function freeText(seg: Segment, field: number): string {
  return seg.field(field).render().text;
}

/**
 * The six TQ1 fields that each **narrow** a schedule, paired with the IG target they would have
 * reached. A valued one withholds the whole timing (see the module note), because a Timing built
 * without it would read as a complete instruction that is strictly wider than the one sent.
 */
const SCHEDULE_NARROWING: readonly (readonly [field: number, path: string])[] = Object.freeze([
  [4, ".event"],
  [5, ".repeat.offset"],
  // R4 places every `bounds[x]` on `Timing.repeat`, not on `Timing`, so the element the IG's
  // TQ1-6 rows would have reached is `...timing.repeat.boundsDuration`: a consumer routing on
  // `fhirPath` must not be handed a path that resolves to nothing.
  [6, ".repeat.boundsDuration"],
  [12, ""],
  [13, ".repeat.duration"],
  [14, ".repeat.countMax"],
]);

/** The RPT components with no expressible FHIR target, paired with the reason recorded on the map. */
const INEXPRESSIBLE_RPT_COMPONENTS: readonly number[] = Object.freeze([2, 3, 4, 7, 9, 10, 11]);

/**
 * Whether the instant `end` denotes precedes the instant `start` denotes, decided only where the
 * two FHIR dateTime values are unambiguously comparable, so an inverted period is caught without a
 * date-precision value ever being read as an instant it does not carry:
 *
 * - Two fully-zoned datetimes are compared as the absolute instants they are.
 * - Otherwise both are reduced to the calendar date each states and compared at day granularity,
 *   with a partial date (`2026`, `2026-07`) widened to the whole span it covers, so a comparison
 *   only fires when *every* day the end could mean is before *every* day the start could mean.
 *
 * @param start - The FHIR dateTime the boundsPeriod would start at.
 * @param end - The FHIR dateTime the boundsPeriod would end at.
 * @example
 * ```ts
 * // endPrecedesStart("2026-07-22", "2026-07-21");                                 // true
 * // endPrecedesStart("2026-07-21T10:00:00-05:00", "2026-07-21T09:00:00-05:00");   // true
 * // endPrecedesStart("2026-07-21T10:00:00-05:00", "2026-07-21");                  // false (same day)
 * ```
 */
export function endPrecedesStart(start: string, end: string): boolean {
  const zoned = (v: string): number | undefined => {
    if (!v.includes("T")) return undefined;
    const ms = Date.parse(v);
    return Number.isNaN(ms) ? undefined : ms;
  };
  const startMs = zoned(start);
  const endMs = zoned(end);
  if (startMs !== undefined && endMs !== undefined) return endMs < startMs;
  // Day granularity: the earliest day the start could mean vs the latest day the end could mean.
  const datePart = (v: string): string => v.split("T")[0] ?? v;
  const widen = (v: string, high: boolean): string => {
    const d = datePart(v);
    if (d.length === 4) return high ? `${d}-12-31` : `${d}-01-01`;
    if (d.length === 7) return high ? `${d}-31` : `${d}-01`;
    return d;
  };
  return widen(end, true) < widen(start, false);
}

/**
 * Build the `Timing.code` CodeableConcept from RPT.1: the message's own code, **verbatim**, under the
 * `v2-0335` CodeSystem. The IG map's rows are identity in the source code, so nothing is translated
 * and no second, derived coding is asserted; a code the map has no row for never reaches here.
 */
function timingCode(code: string): FhirComplex {
  return complex([
    {
      name: "coding",
      value: list([
        complex([
          { name: "system", value: primitive(V2_0335_SYSTEM) },
          { name: "code", value: primitive(code) },
        ]),
      ]),
    },
  ]);
}

/** The accumulating state of one TQ1 read: the timing parts so far, plus whether it has been refused. */
interface Draft {
  refused: boolean;
  code: FhirComplex | undefined;
  period: FhirNode | undefined;
  periodUnit: string | undefined;
  when: string | undefined;
  boundsStart: string | undefined;
  boundsEnd: string | undefined;
}

/** Read TQ1-3's RPT components into `draft`, refusing on anything outside the expressible set. */
function readRepeatPattern(
  tq1: Segment,
  base: string,
  draft: Draft,
  issues: TransformIssue[],
): void {
  const repetitions = tq1.field(3).repetitions;
  if (repetitions.length === 0) return;
  if (repetitions.length > 1) {
    // Timing.code is 0..1 and Timing carries one repeat: a second pattern cannot be placed, and
    // taking the first would emit a schedule the message did not send.
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.3", base));
    draft.refused = true;
    return;
  }

  for (const component of INEXPRESSIBLE_RPT_COMPONENTS) {
    if (!componentValued(tq1, 3, component)) continue;
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `TQ1.3.${String(component)}`, base));
    draft.refused = true;
  }

  // RPT.1 → Timing.code. A foreign coding system is never asserted to be the v2-0335 concept, and a
  // code the published map has no row for is never asserted at all.
  if (componentValued(tq1, 3, 1)) {
    const code = subcomponent(tq1, 3, 1, 1);
    const mnemonic = subcomponent(tq1, 3, 1, 3);
    const fromTable = mnemonic === "" || HL70335_MNEMONICS.has(mnemonic);
    if (fromTable && isRepeatPatternCode(code)) {
      draft.code = timingCode(code);
    } else {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "TQ1.3.1", `${base}.code`));
      draft.refused = true;
    }
  }

  // RPT.5 → Timing.repeat.period, precision-exact. A magnitude FHIR's decimal cannot hold in the
  // sender's own lexical form is refused, never canonicalized (which would alter it); and so is a
  // negative one, which R4's tim-5 ("period SHALL be a non-negative value") forbids on the target
  // element whatever its lexical form. Zero is not refused: tim-5 admits it and carrying the
  // sender's own magnitude unaltered is this library's standing rule.
  if (componentValued(tq1, 3, 5)) {
    const raw = subcomponent(tq1, 3, 5, 1);
    let period: FhirNode | undefined;
    try {
      period = primitive(decimal(raw));
    } catch {
      period = undefined;
    }
    if (period === undefined || Number(raw) < 0) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID, "TQ1.3.5", `${base}.repeat.period`),
      );
      draft.refused = true;
    } else {
      draft.period = period;
    }
  }

  // RPT.6 → Timing.repeat.periodUnit, a required-bound code: carried only when it already is one.
  if (componentValued(tq1, 3, 6)) {
    const unit = subcomponent(tq1, 3, 6, 1);
    const mnemonic = subcomponent(tq1, 3, 6, 3);
    const fromUcum = mnemonic === "" || UCUM_MNEMONICS.has(mnemonic);
    if (fromUcum && UNITS_OF_TIME.has(unit)) {
      draft.periodUnit = unit;
    } else {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "TQ1.3.6", `${base}.repeat.periodUnit`),
      );
      draft.refused = true;
    }
  }

  // RPT.5 and RPT.6 are one carry, not two. R4's tim-2 ("if there's a period, there needs to be
  // period units") makes a lone period an INVALID repeat rather than a narrower one, and a lone unit
  // grounds no interval at all; either way the half that did arrive cannot be placed. The one the
  // message valued is named, so the diagnostic points at content the sender actually sent. Skipped
  // when that half was already refused above: its own issue already names the component.
  const periodValued = componentValued(tq1, 3, 5);
  const unitValued = componentValued(tq1, 3, 6);
  if (periodValued && !unitValued && draft.period !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.3.5", `${base}.repeat.period`));
    draft.refused = true;
  }
  if (unitValued && !periodValued && draft.periodUnit !== undefined) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.3.6", `${base}.repeat.periodUnit`),
    );
    draft.refused = true;
  }

  // RPT.8 → Timing.repeat.when, a required-bound code: only the IG rows that target v3-TimingEvent.
  if (componentValued(tq1, 3, 8)) {
    const event = subcomponent(tq1, 3, 8, 1);
    const target = translateBound({ identifier: event }, TIMING_EVENT_VALUE_MAP);
    if (target === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "TQ1.3.8", `${base}.repeat.when`));
      draft.refused = true;
    } else {
      draft.when = target.code;
    }
  }
}

/** Read TQ1-7 / TQ1-8 into `draft`'s bounds, refusing an endpoint that is lost or inverted. */
function readBounds(
  tq1: Segment,
  base: string,
  ctx: TransformContext,
  draft: Draft,
  issues: TransformIssue[],
): void {
  const endpoint = (field: number, name: "start" | "end"): string | undefined => {
    if (!isValued(tq1, field)) return undefined;
    const converted = toFhirDateTime(tq1.field(field).asTs(), ctx.options);
    issues.push(...converted.issues);
    if (converted.value === undefined) {
      // A valued endpoint that yields no dateTime cannot be silently omitted: the remaining bound
      // would read as an open-ended regimen the message never authorized.
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
          `TQ1.${String(field)}`,
          `${base}.repeat.boundsPeriod.${name}`,
        ),
      );
      draft.refused = true;
    }
    return converted.value;
  };

  draft.boundsStart = endpoint(7, "start");
  draft.boundsEnd = endpoint(8, "end");

  if (
    draft.boundsStart !== undefined &&
    draft.boundsEnd !== undefined &&
    endPrecedesStart(draft.boundsStart, draft.boundsEnd)
  ) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.8", `${base}.repeat.boundsPeriod.end`),
    );
    draft.refused = true;
  }
}

/** Assemble the `Timing` node from a draft that was not refused, or `undefined` when it grounds none. */
function assembleTiming(draft: Draft): FhirComplex | undefined {
  if (draft.refused) return undefined;

  const bounds: { name: string; value: FhirNode }[] = [];
  if (draft.boundsStart !== undefined)
    bounds.push({ name: "start", value: primitive(draft.boundsStart) });
  if (draft.boundsEnd !== undefined)
    bounds.push({ name: "end", value: primitive(draft.boundsEnd) });

  const repeat: { name: string; value: FhirNode }[] = [];
  if (bounds.length > 0) repeat.push({ name: "boundsPeriod", value: complex(bounds) });
  if (draft.period !== undefined) repeat.push({ name: "period", value: draft.period });
  if (draft.periodUnit !== undefined)
    repeat.push({ name: "periodUnit", value: primitive(draft.periodUnit) });
  if (draft.when !== undefined) repeat.push({ name: "when", value: list([primitive(draft.when)]) });

  const timing: { name: string; value: FhirNode }[] = [];
  if (repeat.length > 0) timing.push({ name: "repeat", value: complex(repeat) });
  if (draft.code !== undefined) timing.push({ name: "code", value: draft.code });

  return timing.length === 0 ? undefined : complex(timing);
}

/** The reading an order group with no usable TQ1 yields: nothing placed, nothing claimed reached. */
function nothing(issues: readonly TransformIssue[]): Tq1Reading {
  return {
    timing: undefined,
    conditionText: undefined,
    instructionText: undefined,
    issues,
    contributes: false,
  };
}

/**
 * Read an order group's TQ1 occurrences into the parts its request builder places. Never throws;
 * every refusal is a value-free {@link TransformIssue} naming the TQ1 field or component that caused
 * it, and a refused schedule leaves `timing` `undefined` rather than partially built.
 *
 * @param tq1s - The group's `TQ1` segments, in document order (usually zero or one).
 * @param target - Which request is being built; selects the FHIR paths and the free-text rows.
 * @param ctx - The transform context (its options carry the naked-timestamp policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const tq1s = parseHL7(raw).allSegments().filter((s) => s.type === "TQ1");
 * // const { timing, issues } = readTq1(tq1s, "MedicationRequest", {});
 * ```
 */
export function readTq1(
  tq1s: readonly Segment[],
  target: Tq1Target,
  ctx: TransformContext,
): Tq1Reading {
  const issues: TransformIssue[] = [];
  const base = timingPath(target);

  if (tq1s.length === 0) return nothing(issues);
  if (tq1s.length > 1) {
    // Two timings on one order is a regimen this library cannot express as one request. Mapping the
    // first and discarding the rest would emit half a schedule as if it were the whole one, so
    // nothing from any occurrence is carried and every one of them stays unreached.
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1", base));
    return nothing(issues);
  }
  const tq1 = tq1s[0];
  if (tq1 === undefined) return nothing(issues);

  // TQ1-2 / TQ1-9: the IG maps these to the dose and the priority, which the RXO/OBR path already
  // grounds. Flagged dropped, neither field touched, and the schedule is unaffected.
  if (isValued(tq1, 2)) {
    issues.push(
      issue(
        ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
        "TQ1.2",
        target === "MedicationRequest"
          ? "MedicationRequest.dosageInstruction.doseAndRate.doseQuantity"
          : "ServiceRequest.quantityQuantity",
      ),
    );
  }
  if (isValued(tq1, 9)) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.9", `${target}.priority`));
  }

  const draft: Draft = {
    refused: false,
    code: undefined,
    period: undefined,
    periodUnit: undefined,
    when: undefined,
    boundsStart: undefined,
    boundsEnd: undefined,
  };

  for (const [field, suffix] of SCHEDULE_NARROWING) {
    if (!isValued(tq1, field)) continue;
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `TQ1.${String(field)}`, `${base}${suffix}`),
    );
    draft.refused = true;
  }

  readRepeatPattern(tq1, base, draft, issues);
  readBounds(tq1, base, ctx, draft, issues);

  const timing = assembleTiming(draft);

  // TQ1-10 / TQ1-11 reach two DIFFERENT MedicationRequest targets, and the IG names no target on the
  // service path for either (TQ1-10 is a proposed extension there, TQ1-11 an Annotation this library
  // does not build), so on that path they are flagged dropped rather than silently discarded.
  let conditionText: string | undefined;
  let instructionText: string | undefined;
  if (target === "MedicationRequest") {
    // Read whole, never truncated at the first raw delimiter: see freeText. "Verbatim" is the
    // claim these two rows make, and a TX field's delimiters are content, not structure.
    const condition = freeText(tq1, 10);
    const instruction = freeText(tq1, 11);
    if (condition !== "") conditionText = condition;
    if (instruction !== "") instructionText = instruction;
  } else {
    if (isValued(tq1, 10))
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.10", "ServiceRequest"));
    if (isValued(tq1, 11))
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TQ1.11", "ServiceRequest.note"));
  }

  return {
    timing,
    conditionText,
    instructionText,
    issues,
    contributes:
      timing !== undefined || conditionText !== undefined || instructionText !== undefined,
  };
}

/**
 * Escape the five XML predefined entities in a v2 free-text instruction so it can sit inside an
 * XHTML `div` without altering anything else about it. Nothing is trimmed, collapsed, wrapped or
 * re-cased: unescaping the result returns the sender's text character for character.
 *
 * @param value - The decoded v2 text.
 * @example
 * ```ts
 * // escapeXml('take <2 & "rest"'); // 'take &lt;2 &amp; &quot;rest&quot;'
 * ```
 */
export function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Build the `MedicationRequest.text` `Narrative` for a TQ1-11 free-text instruction: `status`
 * `additional` (the resource's structured elements do not contain this text, so it is genuinely
 * additional, never `generated`), and a `div` carrying the sender's text XML-escaped and otherwise
 * untouched.
 *
 * @param value - The TQ1-11 text, decoded.
 * @example
 * ```ts
 * // narrative("with food"); // Narrative { status: "additional", div: "<div ...>with food</div>" }
 * ```
 */
export function narrative(value: string): FhirComplex {
  return complex([
    { name: "status", value: primitive("additional") },
    {
      name: "div",
      value: primitive(`<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(value)}</div>`),
    },
  ]);
}

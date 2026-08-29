/**
 * The message-level completeness diagnostic: which segment occurrences a message carried, which of
 * them contributed to a resource the returned bundle actually contains, and one value-free issue for
 * each one that did not.
 *
 * The library already refuses to produce a confident wrong FHIR value at the datatype and resource
 * levels. This is the same rule one level up. A message can carry an `IAM`, a `DG1` or an `IN1` that
 * nothing here reads, and until now the consumer got a bundle with nothing in it about the allergy
 * and an issues list with nothing in it about the omission: silence read as completeness, which is a
 * claim this library cannot make. After this, a consumer reads the issues list and learns which
 * segments did not reach the bundle, and whether each one is a **library gap**
 * ({@link ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED}, the IG publishes a map and this library has
 * not built it) or a **standard gap** ({@link ISSUE_CODES.TRANSFORM_SEGMENT_NO_IG_MAP}, the IG
 * publishes no map, or the name could not be classified at all).
 *
 * Four rules carry the safety of this, and each one is enforced here rather than assumed upstream:
 *
 * - **Contribution, never inspection.** An occurrence "reached" a resource only if the assembly took
 *   at least one of its values, or its identity, into a resource that is present in the returned
 *   bundle. An occurrence that was counted, walked past, or already named by another issue did not
 *   reach anything: the `RXE` and the orphan `OBX` this library counts and refuses are exactly the
 *   omissions a consumer most needs told, so a "the walker touched it" reading would silence the
 *   two cases the diagnostic exists for.
 * - **A name is rendered only if it passes the segment-identifier shape**
 *   ({@link SEGMENT_IDENTIFIER_SHAPE}), applied by this library to the value the parser published,
 *   as a positive test the value must pass. Not by excluding known markers, not by importing a
 *   constant from the parser package, not by anything that depends on which parser version a
 *   consumer resolved: this library declares a peer range that admits any of them, so a rule keyed
 *   on a marker literal fails OPEN the moment that literal changes, promoting an unvouched value
 *   into a rendering. A shape test fails CLOSED: whatever it does not recognize is located
 *   positionally, and no byte of it is reproduced.
 * - **A position that carries no segment is not an occurrence.** The parser materializes an empty
 *   position for a blank line so that ordinals stay stable. It carries no name AND no field content,
 *   nothing was sent there, and reporting it would be a false claim of clinical omission at a
 *   position the sender left empty. It is excluded wherever it sits, and it still counts toward the
 *   `[#n]` ordinal of later occurrences so those keep matching the wire. A line that kept its field
 *   separator still carries content and IS reported: the exclusion is for the absence of a segment,
 *   never for the absence of a name.
 * - **One issue per occurrence, numbered among all occurrences of its name.** Never collapsed,
 *   capped or deduplicated, and `[k]` is the occurrence's position among all occurrences of that
 *   name, never among the reported ones: a message with two `NK1` of which only the second is
 *   reported yields `NK1[2]`.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import { isIgMappedSegmentName } from "./ig-segment-maps.js";

/**
 * The HL7 v2 Chapter 2 segment-identifier shape: three characters, a leading letter, applied to the
 * name value ITSELF as a positive membership test that must pass before any name is rendered.
 *
 * Everything else is a malformed name without exception: the empty string, a withheld marker, a raw
 * pre-delimiter token, a bare numeric like `202`, a four-character `AL11`. A malformed occurrence has
 * no name in this library's vocabulary and is identified by position instead.
 *
 * @example
 * ```ts
 * import { SEGMENT_IDENTIFIER_SHAPE } from "@cosyte/transform";
 * SEGMENT_IDENTIFIER_SHAPE.test("ZAL"); // true
 * SEGMENT_IDENTIFIER_SHAPE.test("202"); // false
 * ```
 */
export const SEGMENT_IDENTIFIER_SHAPE = /^[A-Z][A-Za-z0-9]{2}$/;

/**
 * Whether a segment name may be rendered: the shape test of {@link SEGMENT_IDENTIFIER_SHAPE} applied
 * to the value itself.
 *
 * Deliberately NOT an exclusion of known-bad literals. An exclusion test admits any value it has not
 * heard of, which is the wrong direction for a rule whose whole job is to keep message bytes out of
 * a diagnostic, and it would silently couple this library to one release of the parser package.
 *
 * @param name - The value the parser published as the occurrence's segment type.
 * @example
 * ```ts
 * import { isWellFormedSegmentName } from "@cosyte/transform";
 * isWellFormedSegmentName("ZAL");  // true
 * isWellFormedSegmentName("AL11"); // false
 * ```
 */
export function isWellFormedSegmentName(name: string): boolean {
  return SEGMENT_IDENTIFIER_SHAPE.test(name);
}

/**
 * One segment occurrence of a parsed message: a segment as it appears in the message, in message
 * order, with everything needed to locate it in a value-free way and nothing else.
 */
export interface SegmentOccurrence {
  /** The parsed segment this occurrence wraps. */
  readonly segment: Segment;
  /** 1-based position among **all** parsed positions, empty ones included, so it matches the wire. */
  readonly ordinal: number;
  /** The renderable segment name, present only when it passed the shape test. */
  readonly name: string | undefined;
  /** 1-based position among the occurrences of {@link SegmentOccurrence.name}, when there is one. */
  readonly nameIndex: number | undefined;
}

/**
 * Every segment occurrence of a parsed message, in message order.
 *
 * A position that carries neither a name nor any field content is the parser's ordinal placeholder
 * for a blank line: it is not a segment occurrence, it is left out, and it still advances the
 * ordinal of everything after it. A position that carries field content is an occurrence even when
 * its name is empty.
 *
 * @param msg - The parsed message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { enumerateSegmentOccurrences } from "@cosyte/transform";
 * // enumerateSegmentOccurrences(parseHL7(raw))[0]?.name; // "MSH"
 * ```
 */
export function enumerateSegmentOccurrences(msg: Hl7Message): readonly SegmentOccurrence[] {
  const occurrences: SegmentOccurrence[] = [];
  const seenPerName = new Map<string, number>();

  for (const [i, segment] of msg.allSegments().entries()) {
    // The ordinal placeholder: no name AND no field content. Skipped, but `i` still advances, so a
    // later occurrence's `[#n]` keeps naming the line the sender actually wrote.
    if (segment.type === "" && segment.fields.length === 0) continue;

    if (isWellFormedSegmentName(segment.type)) {
      const nameIndex = (seenPerName.get(segment.type) ?? 0) + 1;
      seenPerName.set(segment.type, nameIndex);
      occurrences.push({ segment, ordinal: i + 1, name: segment.type, nameIndex });
    } else {
      occurrences.push({ segment, ordinal: i + 1, name: undefined, nameIndex: undefined });
    }
  }

  return occurrences;
}

/**
 * The v2 location of an occurrence: `NAME[k]` for a name that passed the shape test, `[#n]` for one
 * that did not. Those are the only two shapes, and neither carries a field or component index.
 *
 * @param occurrence - The occurrence to locate.
 * @example
 * ```ts
 * import { segmentOccurrenceLocation } from "@cosyte/transform";
 * // segmentOccurrenceLocation(occ); // "DG1[2]" or "[#4]"
 * ```
 */
export function segmentOccurrenceLocation(occurrence: SegmentOccurrence): string {
  return occurrence.name !== undefined && occurrence.nameIndex !== undefined
    ? `${occurrence.name}[${String(occurrence.nameIndex)}]`
    : `[#${String(occurrence.ordinal)}]`;
}

/**
 * Tracks, across one message-level assembly, which segment occurrences CONTRIBUTED to a resource the
 * returned bundle contains, and turns the rest into one value-free issue each.
 *
 * The assembly marks an occurrence only where a resource has just cleared the emit gate and joined
 * the bundle, so "reached" means contributed-and-present by construction: an occurrence that was
 * read and refused, or that built a resource the gate withheld, is never marked and is therefore
 * reported.
 *
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { SegmentReachLedger } from "@cosyte/transform";
 * // const ledger = new SegmentReachLedger(parseHL7(raw));
 * // ledger.markFirstOfType("MSH");
 * // ledger.issues(); // one issue per occurrence that reached nothing
 * ```
 */
export class SegmentReachLedger {
  private readonly occurrences: readonly SegmentOccurrence[];
  private readonly reached = new Set<Segment>();

  /**
   * @param msg - The parsed message whose occurrences are being tracked.
   */
  constructor(msg: Hl7Message) {
    this.occurrences = enumerateSegmentOccurrences(msg);
  }

  /**
   * Record that each given segment contributed to a resource now present in the bundle. `undefined`
   * entries are ignored, so a call site can pass an optional part of a group without branching.
   */
  mark(...segments: readonly (Segment | undefined)[]): void {
    for (const segment of segments) {
      if (segment !== undefined) this.reached.add(segment);
    }
  }

  /**
   * Record that the FIRST occurrence of `type` contributed. The parser's derived views (`patient`,
   * `visit`, `meta`) are built from the first segment of their type, so this is how a resource built
   * from a view marks the occurrence it came from.
   */
  markFirstOfType(type: string): void {
    const found = this.occurrences.find((o) => o.name === type);
    if (found !== undefined) this.reached.add(found.segment);
  }

  /**
   * Record that the `index`-th (0-based) occurrence of `type` contributed: the counterpart of
   * {@link SegmentReachLedger.markFirstOfType} for the repeating views (`nextOfKin()`), whose
   * entries are in document order.
   */
  markNthOfType(type: string, index: number): void {
    const matching = this.occurrences.filter((o) => o.name === type);
    const found = matching[index];
    if (found !== undefined) this.reached.add(found.segment);
  }

  /** The occurrences that contributed to no resource present in the bundle, in message order. */
  reportable(): readonly SegmentOccurrence[] {
    return this.occurrences.filter((o) => !this.reached.has(o.segment));
  }

  /**
   * One value-free issue per reportable occurrence, in message order: the library-gap code when the
   * IG publishes a segment map for the name, the standard-gap code otherwise, and the standard-gap
   * code for every name that could not be classified at all.
   */
  issues(): readonly TransformIssue[] {
    return this.reportable().map((occurrence) =>
      issue(
        occurrence.name !== undefined && isIgMappedSegmentName(occurrence.name)
          ? ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED
          : ISSUE_CODES.TRANSFORM_SEGMENT_NO_IG_MAP,
        segmentOccurrenceLocation(occurrence),
      ),
    );
  }
}

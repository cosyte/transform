/**
 * ORU^R01 order/result grouping — the message-map structure the DiagnosticReport/Observation graph is
 * assembled over (roadmap §Phase 3), grounded on the IG **ORU_R01 message map**
 * (`ConceptMap-message-oru-r01-to-bundle.html`).
 *
 * An ORU message is a sequence of order groups, each an **OBR** followed by its **OBX** results. This
 * walks the segments in document order and buckets each OBX under the most recent OBR — the same
 * positional grouping `@cosyte/hl7`'s `orders()` performs, done here so the raw OBR/OBX `Segment`s are
 * available (the report/result fields the lean `Order` view omits — OBR-7/22/24/25 — and the exact
 * lexical OBX-5 magnitude the `Observation` view rounds to a JS `number`). An OBX that precedes any OBR
 * has no report to anchor it and is surfaced by {@link ReportGrouping.orphanObxCount} rather than
 * silently dropped.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";

/** One ORU report group: an OBR anchor and the OBX result segments beneath it, in document order. */
export interface ReportGroup {
  /** The OBR segment anchoring this report. */
  readonly obr: Segment;
  /** The OBX result segments grouped under this OBR (positional grouping). */
  readonly observations: readonly Segment[];
}

/** The result of grouping an ORU message: the report groups plus any OBX with no preceding OBR. */
export interface ReportGrouping {
  /** The OBR-anchored report groups, in document order. */
  readonly groups: readonly ReportGroup[];
  /** The count of OBX segments that appeared before any OBR (no report to anchor them). */
  readonly orphanObxCount: number;
}

/**
 * Group an ORU message's OBR/OBX segments into report groups (each OBR with its trailing OBX children).
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { groups } = collectReportGroups(parseHL7(raw));
 * // groups[0]?.obr; groups[0]?.observations.length;
 * ```
 */
export function collectReportGroups(msg: Hl7Message): ReportGrouping {
  const groups: { obr: Segment; observations: Segment[] }[] = [];
  let current: { obr: Segment; observations: Segment[] } | undefined;
  let orphanObxCount = 0;

  for (const seg of msg.allSegments()) {
    if (seg.type === "OBR") {
      current = { obr: seg, observations: [] };
      groups.push(current);
    } else if (seg.type === "OBX") {
      if (current === undefined) orphanObxCount += 1;
      else current.observations.push(seg);
    }
  }

  return { groups, orphanObxCount };
}

/**
 * ORU^R01 order/result grouping: the message-map structure the DiagnosticReport/Observation graph is
 * assembled over, grounded on the IG **ORU_R01 message map**
 * (`ConceptMap-message-oru-r01-to-bundle.html`).
 *
 * An ORU message is a sequence of order groups, each an **OBR** followed by its **OBX** results,
 * with the group's specimens (`4.2.7 SPECIMEN`) and per-result notes (`4.2.4.3.3 OBSERVATION.NTE`)
 * beneath it. This walks the segments in document order and buckets each one under the most recent
 * anchor: the same positional grouping `@cosyte/hl7`'s `orders()` performs, done here so the raw
 * OBR/OBX `Segment`s are available (the report/result fields the lean `Order` view omits, namely
 * OBR-7/22/24/25, and the exact lexical OBX-5 magnitude the `Observation` view rounds to a JS
 * `number`). An OBX that precedes any OBR has no report to anchor it and is surfaced by
 * {@link ReportGrouping.orphanObxCount} rather than silently dropped.
 *
 * **Which NTE is which is decided positionally, because the map's three NTE rows differ.** The
 * message map publishes a FHIR target for the OBSERVATION group's NTE (`4.2.4.3.3` →
 * `Observation.note`) and **none at all** for the PATIENT-level (`4.1.4`) or ORDER_OBSERVATION-level
 * (`4.2.3`) rows. In the wire's segment order those are exactly the NTEs that follow an OBX, so an
 * NTE is attached to an observation only while one is open: any other segment closes it, and an NTE
 * before the first OBX of a group, or before any OBR, attaches to nothing. It is then reported by
 * the completeness diagnostic as a segment that reached no resource, which is what the guide's
 * silence about it means.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";

/** One OBX result and the OBSERVATION-group NTE segments beneath it, in document order. */
export interface ObservationEntry {
  /** The OBX segment carrying the result. */
  readonly obx: Segment;
  /** The NTE segments that followed it with no other segment in between → `Observation.note`. */
  readonly notes: readonly Segment[];
}

/** One ORU report group: an OBR anchor, the OBX results beneath it, and the group's specimens. */
export interface ReportGroup {
  /** The OBR segment anchoring this report. */
  readonly obr: Segment;
  /** The OBX result segments grouped under this OBR (positional grouping), each with its notes. */
  readonly observations: readonly ObservationEntry[];
  /** The SPM segments of this group's SPECIMEN occurrences (message map row 4.2.7.1). */
  readonly specimens: readonly Segment[];
}

/** The result of grouping an ORU message: the report groups plus any OBX with no preceding OBR. */
export interface ReportGrouping {
  /** The OBR-anchored report groups, in document order. */
  readonly groups: readonly ReportGroup[];
  /** The count of OBX segments that appeared before any OBR (no report to anchor them). */
  readonly orphanObxCount: number;
}

interface MutableGroup {
  readonly obr: Segment;
  readonly observations: { obx: Segment; notes: Segment[] }[];
  readonly specimens: Segment[];
}

/**
 * Group an ORU message's OBR/OBX/SPM/NTE segments into report groups (each OBR with its trailing
 * OBX results and their notes, plus the SPM occurrences of its SPECIMEN group).
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { groups } = collectReportGroups(parseHL7(raw));
 * // groups[0]?.obr; groups[0]?.observations.length; groups[0]?.specimens.length;
 * ```
 */
export function collectReportGroups(msg: Hl7Message): ReportGrouping {
  const groups: MutableGroup[] = [];
  let current: MutableGroup | undefined;
  let openObservation: { obx: Segment; notes: Segment[] } | undefined;
  let orphanObxCount = 0;

  for (const seg of msg.allSegments()) {
    if (seg.type === "NTE") {
      // Only an NTE inside an open OBSERVATION group has a published target; every other one is
      // left unattached, and therefore reported by the completeness diagnostic.
      if (openObservation !== undefined) openObservation.notes.push(seg);
      continue;
    }
    if (seg.type === "OBX") {
      if (current === undefined) {
        orphanObxCount += 1;
        openObservation = undefined;
        continue;
      }
      openObservation = { obx: seg, notes: [] };
      current.observations.push(openObservation);
      continue;
    }

    // Any other segment closes the OBSERVATION group: a note after it belongs to no observation.
    openObservation = undefined;
    if (seg.type === "OBR") {
      current = { obr: seg, observations: [], specimens: [] };
      groups.push(current);
    } else if (seg.type === "SPM" && current !== undefined) {
      current.specimens.push(seg);
    }
  }

  return { groups, orphanObxCount };
}

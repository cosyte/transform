/**
 * Order-message grouping: the message-map structure the ServiceRequest / MedicationRequest graph is
 * assembled over, grounded firsthand on the IG **ORM_O01** and **OML_O21** message
 * maps (`ConceptMap-message-orm-o01-to-bundle.html`, `ConceptMap-message-oml-o21-to-bundle.html`).
 *
 * Both message maps model the ORDER group the same way: **`ORC` creates the request** and the
 * following **ORDER_DETAIL** segment is *incorporated into that same request*, so `OBR` →
 * `ServiceRequest` and `RXO` (+ `RXR` route) → `MedicationRequest`. One order group is an `ORC`
 * anchor plus at most one order-detail segment (an `OBR` for a service order, an `RXO` for a
 * pharmacy order), the `RXR` route segments beneath a pharmacy order, and the `TQ1` timing segments
 * the order's TIMING group carries. This walks the segments in
 * document order and buckets each detail segment under the most recent `ORC`: the same positional
 * grouping `@cosyte/hl7`'s `orders()` performs, done here so the raw `ORC`/`OBR`/`RXO`/`RXR`/`TQ1`
 * `Segment`s (the request/dose/schedule fields the lean `Order` view omits) are available.
 *
 * **`TQ1` is bucketed positionally, like `RXR`, and that is the wiring the schedule arrives on.** No
 * published STU1 *message* map wires a `TQ1` into a `MedicationRequest`: the ORM_O01 map carries no
 * `TQ1` row at all and the OML_O21 map's only `TQ1` row targets a `ServiceRequest`. The `RXO`-plus-
 * `TQ1` pairing therefore reaches this library on the segment-assembled path (`OMP_O09` and its
 * relatives, already flagged), so this positional grouping is what pairs a timing with the order it
 * times. Every occurrence is kept, in document order and never collapsed, because a second `TQ1` on
 * one order is a fact the request builder has to refuse rather than a duplicate to discard here.
 *
 * A detail segment that precedes any `ORC` still anchors its own group (a bare `OBR`/`RXO` order),
 * and any `RXE` (for which the IG ships **no** segment map at all, verified against the STU1
 * artifacts index) is counted by {@link OrderGrouping.rxeCount} so the assembler can flag it as
 * un-grounded rather than fabricate an RXE→MedicationRequest layout.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";

/** One order group: an optional `ORC` request anchor and its incorporated order-detail segments. */
export interface OrderGroup {
  /** The `ORC` segment anchoring this order (absent for a bare `OBR`/`RXO` with no preceding `ORC`). */
  readonly orc: Segment | undefined;
  /** The `OBR` order-detail segment → `ServiceRequest`, when this is a service order. */
  readonly obr: Segment | undefined;
  /** The `RXO` order-detail segment → `MedicationRequest`, when this is a pharmacy order. */
  readonly rxo: Segment | undefined;
  /** The `RXR` route segments beneath a pharmacy order (in document order). */
  readonly rxrs: readonly Segment[];
  /** The `TQ1` timing segments this order carries (in document order); every occurrence, uncollapsed. */
  readonly tq1s: readonly Segment[];
}

/** The result of grouping an order message: the order groups plus the count of un-mappable `RXE`s. */
export interface OrderGrouping {
  /** The order groups, in document order. */
  readonly groups: readonly OrderGroup[];
  /** The count of `RXE` segments: the IG ships no RXE map, so they are flagged, never assembled. */
  readonly rxeCount: number;
}

interface MutableGroup {
  orc: Segment | undefined;
  obr: Segment | undefined;
  rxo: Segment | undefined;
  rxrs: Segment[];
  tq1s: Segment[];
}

/**
 * Group an order message's `ORC`/`OBR`/`RXO`/`RXR` segments into order groups (each `ORC` with the
 * order-detail segment incorporated into it, or a bare detail segment as its own group).
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { groups } = collectOrderGroups(parseHL7(raw));
 * // groups[0]?.orc; groups[0]?.obr; groups[0]?.rxo;
 * ```
 */
export function collectOrderGroups(msg: Hl7Message): OrderGrouping {
  const groups: MutableGroup[] = [];
  let current: MutableGroup | undefined;
  let rxeCount = 0;

  const open = (): MutableGroup => {
    const g: MutableGroup = {
      orc: undefined,
      obr: undefined,
      rxo: undefined,
      rxrs: [],
      tq1s: [],
    };
    groups.push(g);
    current = g;
    return g;
  };

  for (const seg of msg.allSegments()) {
    switch (seg.type) {
      case "ORC":
        // A new ORC always opens a new order group (ORM/OML: one request per ORC).
        open().orc = seg;
        break;
      case "OBR":
        // Incorporate into the current group when it has no detail yet; else open a bare group.
        if (current === undefined || current.obr !== undefined || current.rxo !== undefined) open();
        (current as MutableGroup).obr = seg;
        break;
      case "RXO":
        if (current === undefined || current.obr !== undefined || current.rxo !== undefined) open();
        (current as MutableGroup).rxo = seg;
        break;
      case "RXR":
        // Route belongs to the current pharmacy order; harmless (unused) if the group has no RXO.
        if (current !== undefined) current.rxrs.push(seg);
        break;
      case "TQ1":
        // The TIMING group's schedule belongs to the order that is open. A TQ1 that precedes every
        // ORC/OBR/RXO has no order to time, reaches no resource, and is reported as such.
        if (current !== undefined) current.tq1s.push(seg);
        break;
      case "RXE":
        // No IG segment map exists for RXE: surfaced for a flag, never assembled.
        rxeCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    groups: groups.map((g) => ({
      orc: g.orc,
      obr: g.obr,
      rxo: g.rxo,
      rxrs: g.rxrs,
      tq1s: g.tq1s,
    })),
    rxeCount,
  };
}

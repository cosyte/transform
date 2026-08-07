/**
 * Order-message grouping: the message-map structure the ServiceRequest / MedicationRequest graph is
 * assembled over, grounded firsthand on the IG **ORM_O01** and **OML_O21** message
 * maps (`ConceptMap-message-orm-o01-to-bundle.html`, `ConceptMap-message-oml-o21-to-bundle.html`).
 *
 * Both message maps model the ORDER group the same way: **`ORC` creates the request** and the
 * following **ORDER_DETAIL** segment is *incorporated into that same request*, so `OBR` →
 * `ServiceRequest` and `RXO` (+ `RXR` route) → `MedicationRequest`. One order group is an `ORC`
 * anchor plus at most one order-detail segment (an `OBR` for a service order, an `RXO` for a
 * pharmacy order) and the `RXR` route segments beneath a pharmacy order. This walks the segments in
 * document order and buckets each detail segment under the most recent `ORC`: the same positional
 * grouping `@cosyte/hl7`'s `orders()` performs, done here so the raw `ORC`/`OBR`/`RXO`/`RXR`
 * `Segment`s (the request/dose fields the lean `Order` view omits) are available.
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
    const g: MutableGroup = { orc: undefined, obr: undefined, rxo: undefined, rxrs: [] };
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
      case "RXE":
        // No IG segment map exists for RXE: surfaced for a flag, never assembled.
        rxeCount += 1;
        break;
      default:
        break;
    }
  }

  return {
    groups: groups.map((g) => ({ orc: g.orc, obr: g.obr, rxo: g.rxo, rxrs: g.rxrs })),
    rxeCount,
  };
}

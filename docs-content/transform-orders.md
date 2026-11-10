---
id: transform-orders
title: Transform an order and its schedule
sidebar_label: Transform an order
description: "Turn an order message into ServiceRequest and MedicationRequest resources, and carry a TQ1 schedule into a FHIR Timing, or learn why it was withheld."
---

# Transform an order and its schedule

In an order message each `ORC` starts an order, and the segment after it says what is ordered: an
`OBR` for a service (a test, a procedure), an `RXO` for a medication. `toFhir` turns the first into a
`ServiceRequest` and the second into a `MedicationRequest`. A `TQ1` in the order carries its
schedule.

## Transform a service order

`ORM^O01` and `OML^O21` are the two order messages the guide publishes a message map for.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|CPOE|HOSP|LAB|HOSP|20260721150000-0500||OML^O21^OML_O21|MSG0003|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "ORC|NW|PLACER1|FILLER1||||||20260721140000-0500",
  "OBR|1|PLACER1|FILLER1|24331-1^Lipid Panel^LN|R",
].join("\r");

const { bundle } = toFhir(parseHL7(raw));
const json = JSON.parse(serializeResource(bundle)) as {
  entry: { resource: Record<string, unknown> & { resourceType: string } }[];
};
const request = json.entry.find((e) => e.resource.resourceType === "ServiceRequest")?.resource;

request?.["status"]; // => "active"
request?.["intent"]; // => "order"
request?.["priority"]; // => "routine"
```

`status` comes from ORC-1 through the guide's order-control map (`NW`, a new order, is `active`),
and `priority` from OBR-5 through the priority map. A control code the map has no target for leaves
`status` absent, and the request is withheld with `TRANSFORM_RESOURCE_INVALID`, because FHIR
requires it.

```ts runnable
import { REQUEST_STATUS_MAP, SERVICE_REQUEST_PRIORITY_MAP } from "@cosyte/transform";

REQUEST_STATUS_MAP["NW"]; // => "active"
REQUEST_STATUS_MAP["DC"]; // => "revoked"
SERVICE_REQUEST_PRIORITY_MAP["S"]; // => "stat"
```

## Transform a medication order with a schedule

A pharmacy order carries an `RXO`, its route in `RXR`, and its schedule in `TQ1`. Pharmacy messages
such as `OMP^O09` have no message map in the guide, so the graph is built from the segment maps and
flagged `TRANSFORM_SEGMENT_ASSEMBLED`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|CPOE|HOSP|PHARM|HOSP|20260721150000-0500||OMP^O09|MSG0004|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "ORC|NW|PLACER2|FILLER2||||||20260721141000-0500",
  "TQ1|1||Q6H^^^^6^h||||20260721|20260728",
  "RXO|197361^Amoxicillin 250 MG Oral Tablet^RXNORM|250||mg^milligram^UCUM",
  "RXR|PO^Oral^HL70162",
].join("\r");

const { bundle, issues } = toFhir(parseHL7(raw));
const json = JSON.parse(serializeResource(bundle)) as {
  entry: { resource: Record<string, unknown> & { resourceType: string } }[];
};
const order = json.entry.find((e) => e.resource.resourceType === "MedicationRequest")?.resource;
const dosage = (order?.["dosageInstruction"] as Record<string, unknown>[])[0];

order?.["status"]; // => "unknown"
dosage?.["timing"]; // => { repeat: { boundsPeriod: { start: "2026-07-21", end: "2026-07-28" }, period: 6, periodUnit: "h" }, code: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0335", code: "Q6H" }] } }
issues.map((i) => i.code).includes("TRANSFORM_SEGMENT_ASSEMBLED"); // => true
```

Two things to read there:

- **`status` is `unknown`.** The guide grounds no `MedicationRequest.status`, so the library writes
  the code FHIR provides for exactly that and raises `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`.
- **The schedule is whole.** TQ1-3 gave the repeat code and the period, TQ1-7 and TQ1-8 the bounds.
  On a `ServiceRequest` the same schedule goes to `occurrenceTiming`.

## Know when the schedule is withheld

A schedule that is only partly understood reads to the receiver as a complete instruction. "Every 6
hours, but only between meals" must not arrive as "every 6 hours". So if any part of a `TQ1`
cannot be mapped, the whole `Timing` is left out and an issue names the field that caused it. Here
TQ1-3 carries two repeat patterns:

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|CPOE|HOSP|PHARM|HOSP|20260721150000-0500||OMP^O09|MSG0005|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "ORC|NW|PLACER2|FILLER2||||||20260721141000-0500",
  "TQ1|1||Q6H^^^^6^h~Q8H^^^^8^h||||20260721|20260728",
  "RXO|197361^Amoxicillin 250 MG Oral Tablet^RXNORM|250||mg^milligram^UCUM",
  "RXR|PO^Oral^HL70162",
].join("\r");

const { issues } = toFhir(parseHL7(raw));
const dropped = issues.find((i) => i.fhirPath === "MedicationRequest.dosageInstruction.timing");

dropped?.code; // => "TRANSFORM_ELEMENT_DROPPED"
dropped?.v2Location; // => "TQ1.3"
```

No `boundsPeriod` survives a withheld schedule either, even when TQ1-7 and TQ1-8 were usable on their
own: a pair of dates with no schedule would read as an open regimen the message never ordered.
[Mapping scope](./mapping-scope.md#orders-and-schedules) lists the causes.

## Reference

- [`toFhir`](./api/README.md#tofhir)
- [`REQUEST_STATUS_MAP`](./api/README.md#request_status_map) and
  [`SERVICE_REQUEST_PRIORITY_MAP`](./api/README.md#service_request_priority_map)
- [`IG_MAPPED_ORDER_TRIGGERS`](./api/README.md#ig_mapped_order_triggers)
- [`ROUTE_VALUE_MAP`](./api/README.md#route_value_map): how RXR-1 is translated
- [Issue codes](./issue-codes.md)

---
id: transform-an-admission
title: "Tutorial: transform an admission message"
sidebar_label: Transform an admission
description: "Turn a synthetic ADT^A01 into a FHIR message Bundle step by step: read the resources, resolve the identifier system, act on the issues."
---

# Tutorial: transform an admission message

In this tutorial we turn one admission message into FHIR R4 and learn to read everything the call
hands back. Each step is a complete program you can paste into a file and run with Node.js 22 or
later after `npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir`. The message is synthetic.

## Step 1: transform the message

An `ADT^A01` says a patient was admitted. Ours carries the header (`MSH`), the patient (`PID`), the
visit (`PV1`), one allergy (`AL1`), and a site-specific `ZPD` segment. Parse it with `@cosyte/hl7`,
then pass the parsed message to `toFhir`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I||||||||||||||||||||||||||||||||||||||||||20260721140000",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
  "ZPD|1|SYNTHETIC",
].join("\r");

const { bundle } = toFhir(parseHL7(raw));

const json = JSON.parse(serializeResource(bundle)) as {
  type: string;
  entry: { resource: { resourceType: string } }[];
};
json.type; // => "message"
json.entry.map((e) => e.resource.resourceType); // => ["MessageHeader", "Patient", "Encounter", "AllergyIntolerance"]
```

The bundle is a FHIR message: the `MessageHeader` comes first, then the resources the message is
about. The `ZPD` segment produced nothing, because the guide maps no segment by that name.

## Step 2: read the patient

The `Patient` carries the name, birth date and sex from PID-5, PID-7 and PID-8, and the medical
record number from PID-3. Look at the identifier: it has a value and a type, and no `system`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I||||||||||||||||||||||||||||||||||||||||||20260721140000",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
  "ZPD|1|SYNTHETIC",
].join("\r");

const json = JSON.parse(serializeResource(toFhir(parseHL7(raw)).bundle)) as {
  entry: { resource: Record<string, unknown> }[];
};
const patient = json.entry[1]?.resource;

// The values below are synthetic: what the Patient holds, asserted and not printed.
patient?.["name"]; // => [{ family: "Public", given: ["Jane", "Q"] }]
patient?.["birthDate"]; // => "1980-01-15"
patient?.["gender"]; // => "female"
patient?.["identifier"]; // => [{ type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, value: "MRN12345" }]
```

The message names the assigning authority only as `HOSP`, a short code the sender chose. Two
hospitals can both call themselves `HOSP`, so turning that code into a system URI on our own could
merge two different patients. The library leaves `system` out and reports it instead.

## Step 3: resolve the identifier system

You know which system URI `HOSP` stands for; the library cannot. Say so with a naming system and
pass it to `toFhir`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I||||||||||||||||||||||||||||||||||||||||||20260721140000",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
  "ZPD|1|SYNTHETIC",
].join("\r");

const namingSystem = createNamingSystem({
  authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" },
});
const json = JSON.parse(serializeResource(toFhir(parseHL7(raw), { namingSystem }).bundle)) as {
  entry: { resource: { identifier?: { system?: string; value: string }[] } }[];
};

json.entry[1]?.resource.identifier?.[0]?.system; // => "urn:oid:2.16.840.1.113883.19"
```

## Step 4: read the issues

`toFhir` also returns `issues`: everything it could not map faithfully, as a code, a severity, a
v2 location and a FHIR path. An issue never carries a value from the message, so it is safe to log.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I||||||||||||||||||||||||||||||||||||||||||20260721140000",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
  "ZPD|1|SYNTHETIC",
].join("\r");

const { issues } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
});

issues.map((i) => `${i.severity} ${i.code} ${i.v2Location}`); // => ["warning TRANSFORM_TIMESTAMP_NO_TIMEZONE TS.1", "information TRANSFORM_REQUIRED_ELEMENT_UNKNOWN MSH.3", "information TRANSFORM_SEGMENT_NO_IG_MAP ZPD[1]"]
```

Read them in order:

- **`TRANSFORM_TIMESTAMP_NO_TIMEZONE`**: the admit time in PV1-44 has a time of day but no offset,
  and FHIR does not allow a time without a zone. Rather than assume UTC and move the admission by
  hours, the library kept the date only: `Encounter.period.start` is `2026-07-21`. The location
  `TS.1` is the timestamp component of the field, not a value.
- **`TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`**: FHIR requires `MessageHeader.source.endpoint`, and
  MSH-3 is an application name, not an address, so the element carries a `data-absent-reason` of
  `unknown` instead of an invented URL.
- **`TRANSFORM_SEGMENT_NO_IG_MAP`**: the `ZPD` segment reached no resource, and the guide publishes
  no map for it. `ZPD[1]` is its first occurrence.

The fix for the first one is in your hands: if you know the sender's offset, pass
`assumeTimezoneOffsetMinutes`. [Supply a sender timezone for a timestamp with no offset](./supply-a-sender-timezone.md)
shows how.

## Step 5: make the ids repeatable and return the issues as FHIR

Each run mints fresh `urn:uuid:` ids for the bundle entries. Pass `generateId` to make them
repeatable, for golden files or tests; it must return a new, unique value each call. Then turn the
issues into a FHIR `OperationOutcome` you can store or return beside the bundle.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir, toOperationOutcome } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I||||||||||||||||||||||||||||||||||||||||||20260721140000",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
  "ZPD|1|SYNTHETIC",
].join("\r");

let next = 0;
const { bundle, issues } = toFhir(parseHL7(raw), {
  assumeTimezoneOffsetMinutes: -300,
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
  generateId: () => `00000000-0000-4000-8000-${String((next += 1)).padStart(12, "0")}`,
});

const json = JSON.parse(serializeResource(bundle)) as {
  entry: { fullUrl: string; resource: { resourceType: string; period?: { start: string } } }[];
};
json.entry[1]?.fullUrl; // => "urn:uuid:00000000-0000-4000-8000-000000000001"
json.entry[2]?.resource.period?.start; // => "2026-07-21T14:00:00-05:00"

const outcome = JSON.parse(serializeResource(toOperationOutcome(issues))) as {
  resourceType: string;
  issue: { severity: string; details: { coding: { code: string }[] } }[];
};
outcome.resourceType; // => "OperationOutcome"
outcome.issue.map((i) => i.details.coding[0]?.code); // => ["TRANSFORM_TIMESTAMP_NO_TIMEZONE", "TRANSFORM_REQUIRED_ELEMENT_UNKNOWN", "TRANSFORM_SEGMENT_NO_IG_MAP"]
```

With the offset asserted, the admit time keeps its time of day. The timezone issue is still raised,
because the offset came from you and not from the message; it marks the value as sender-asserted.

## What you built

You transformed an admission into a FHIR message `Bundle`, resolved the record number's system, read
each issue, and returned the issues as an `OperationOutcome`.

## Next

- [Resolve assigning authorities](./resolve-assigning-authorities.md): every way a system URI is found.
- [Read, log and return the issues](./handle-issues.md): branch on codes and severities.
- [Transform a lab result](./transform-lab-results.md): the same steps for an `ORU^R01`.
- [How the transform works](./concepts-archetype.md): why the library refuses to guess.
- [Mapping scope](./mapping-scope.md): what each segment reaches.

---
id: handle-issues
title: Read, log and return the issues
sidebar_label: Handle the issues
description: "Branch on the issues a transform returns by code and severity, find the segments that reached nothing, log the issues, and return an OperationOutcome."
---

# Read, log and return the issues

Every call returns its issues beside its value: `{ value, issues }` from a converter or the reverse
path, `{ bundle, issues }` from `toFhir`. Each issue has a `code`, a `severity`, a `v2Location`, an
optional `fhirPath`, and a fixed `message`. None of them carries a value from the message. This
guide shows what to do with them.

## Branch on the code

Compare against `ISSUE_CODES`, never against the message text. Codes are stable; renaming one is a
breaking change.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { ISSUE_CODES, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I",
].join("\r");

const { issues } = toFhir(parseHL7(raw));
const unresolved = issues.filter(
  (i) => i.code === ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED,
);

unresolved.map((i) => `${i.v2Location} ${i.fhirPath ?? ""}`); // => ["CX.4 Identifier.system"]
```

The `v2Location` of an issue raised inside a datatype converter is relative to that datatype:
`CX.4` is the assigning authority of an identifier, `TS.1` the time of a timestamp. An issue raised
by the assembly names the segment and field, such as `MSH.3` or `TQ1.3`, or an occurrence, such as
`AL1[0]`.

## Branch on the severity

The severity is fixed per code. Most issues are `warning` or `information` and come with a usable
result. `error` marks a result that is missing something: a resource withheld from the bundle
(`TRANSFORM_RESOURCE_INVALID`), or, on the reverse path, no message at all, or a message missing a
field v2 requires. Decide per code what your pipeline does; a common start is to hold a message for
review on any `error`.

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient","identifier":[{"value":"MRN1"}]}');
const { value, issues } = toV2Patient(resource, "A28");

const errors = issues.filter((i) => i.severity === "error");
errors.map((i) => `${i.code} ${i.v2Location}`); // => ["TRANSFORM_V2_REQUIRED_FIELD_ABSENT PID.5"]
value === undefined; // => false
```

Here a message was built, but it lacks the patient name v2 requires, so it should not be sent as
it is. [Issue codes](./issue-codes.md) lists every code with its severity.

## Find what the bundle did not carry

Each segment occurrence that reached no resource in the bundle raises one issue naming it.
`TRANSFORM_SEGMENT_NOT_EMITTED` means the guide maps that segment and this library did not carry it;
`TRANSFORM_SEGMENT_NO_IG_MAP` means the guide maps no segment by that name, or the name could not be
read. Both are `information`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { ISSUE_CODES, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "EVN|A01|20260721143000-0500",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "ZPD|1|SYNTHETIC",
].join("\r");

const { issues } = toFhir(parseHL7(raw));
const unreached = issues.filter(
  (i) =>
    i.code === ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED ||
    i.code === ISSUE_CODES.TRANSFORM_SEGMENT_NO_IG_MAP,
);

unreached.map((i) => `${i.code} ${i.v2Location}`); // => ["TRANSFORM_SEGMENT_NOT_EMITTED EVN[1]", "TRANSFORM_SEGMENT_NO_IG_MAP ZPD[1]"]
```

These locations count from 1 among the occurrences of that name. Other per-occurrence locations,
such as `AL1[0]` on a withheld allergy, count from 0. [How the transform
works](./concepts-archetype.md#reading-the-location) explains both conventions and the `[#n]` form
for a name that cannot be read.

## Log them

An issue is safe to log as it is: the code, the severity, the location, the path and the message are
all fixed text or positions. Log the issues, not the message and not the resources, which carry
patient data.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
].join("\r");

const { issues } = toFhir(parseHL7(raw));
const lines = issues.map((i) => JSON.stringify(i));

lines.length > 0; // => true
lines.some((line) => line.includes("MRN12345") || line.includes("Public")); // => false
```

## Return them as an OperationOutcome

`toOperationOutcome` turns a list of issues into a FHIR `OperationOutcome` resource. Each issue keeps
its severity, its FHIR issue type in `code`, its code in `details.coding` under
`TRANSFORM_ISSUE_SYSTEM`, its message in `details.text`, its v2 location in `diagnostics` and its
FHIR path in `expression`. An empty list gives one `information` issue, because FHIR requires at
least one.

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { ISSUE_CODES, issue, toOperationOutcome } from "@cosyte/transform";

const outcome = toOperationOutcome([
  issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime"),
]);
const json = JSON.parse(serializeResource(outcome)) as {
  issue: { severity: string; code: string; diagnostics: string; expression: string[] }[];
};

json.issue[0]?.severity; // => "warning"
json.issue[0]?.code; // => "value"
json.issue[0]?.diagnostics; // => "TS.1"
json.issue[0]?.expression; // => ["dateTime"]

const empty = JSON.parse(serializeResource(toOperationOutcome([]))) as {
  issue: { severity: string }[];
};
empty.issue.map((i) => i.severity); // => ["information"]
```

## Reference

- [`TransformIssue`](./api/README.md#transformissue),
  [`ISSUE_CODES`](./api/README.md#issue_codes) and
  [`ISSUE_REGISTRY`](./api/README.md#issue_registry)
- [`toOperationOutcome`](./api/README.md#tooperationoutcome) and
  [`TRANSFORM_ISSUE_SYSTEM`](./api/README.md#transform_issue_system)
- [`issue`](./api/README.md#issue) and [`fhirIssueTypeFor`](./api/README.md#fhirissuetypefor)
- [`SegmentReachLedger`](./api/README.md#segmentreachledger): what decides the two completeness codes
- [Issue codes](./issue-codes.md)

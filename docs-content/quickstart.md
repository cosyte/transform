---
id: quickstart
title: Quickstart
sidebar_label: Quickstart
description: "Convert one v2 datatype, then assemble a FHIR message Bundle from a parsed v2 message, and read the issues each call returns."
---

# Quickstart

This page takes you from an installed package to a FHIR `Bundle` in three steps. Install first
([Installation](./installation.md)); every message below is synthetic.

## Convert a name

Each datatype converter takes a composite parsed by `@cosyte/hl7` and returns `{ value, issues }`:
the FHIR datatype it could faithfully produce, and the value-free issues it raised.

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { toFhirHumanName } from "@cosyte/transform";

const { value, issues } = toFhirHumanName({
  familyName: "Public",
  givenName: "Jane",
  nameTypeCode: "L", // HL7 Table 0200 "Legal name", FHIR name use "official"
});

// The name below is synthetic: it is asserted here, and a real one is never logged.
value === undefined ? undefined : serializeResource(value); // => '{"use":"official","family":"Public","given":["Jane"]}'
issues; // => []
```

`value` is a FHIR `HumanName` node you can place in a resource. `issues` is empty because every
part mapped.

## See the fail-safe rule

When a mapping is ambiguous, the converter refuses to guess and says why. A patient identifier whose
assigning authority has no known system URI keeps its value and gets **no** system, never a
made-up one that could merge two patients:

```ts runnable
import { createNamingSystem, toFhirIdentifier } from "@cosyte/transform";

const { issues } = toFhirIdentifier(
  { idNumber: "12345", assigningAuthority: { namespaceId: "HOSPMRN" } },
  { namingSystem: createNamingSystem() }, // no entry for a bare "HOSPMRN"
);

issues[0]?.code; // => "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"
issues[0]?.fhirPath; // => "Identifier.system"
```

Register the authority, `createNamingSystem({ authorities: { HOSPMRN: "urn:oid:..." } })`, and the
same call sets `Identifier.system` and raises nothing. [Resolve assigning
authorities](./resolve-assigning-authorities.md) shows how.

## Assemble a message

Parse a message with `@cosyte/hl7` and hand it to `toFhir`. You get a FHIR R4 message `Bundle`
(a `MessageHeader`, then the resources the message describes) and the issues raised building it.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I",
].join("\r");

const { bundle, issues } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
});

const json = JSON.parse(serializeResource(bundle)) as {
  type: string;
  entry: { resource: { resourceType: string } }[];
};
json.type; // => "message"
json.entry.map((e) => e.resource.resourceType); // => ["MessageHeader", "Patient", "Encounter"]
issues.map((i) => i.code); // => ["TRANSFORM_REQUIRED_ELEMENT_UNKNOWN"]
```

The one issue says that `MessageHeader.source.endpoint`, which FHIR requires, could not be derived
from MSH-3 (an application name, not a URL), so it carries a `data-absent-reason` instead of an
invented address. Every reference in the bundle points at a `urn:uuid:` `fullUrl` inside it.

## Next

- [Transform an admission message](./transform-an-admission.md): the tutorial, step by step, with
  issues, an `OperationOutcome` and reproducible ids.
- How-to guides: [resolve assigning authorities](./resolve-assigning-authorities.md),
  [transform a lab result](./transform-lab-results.md), [transform an order and its
  schedule](./transform-orders.md), [read, log and return the issues](./handle-issues.md), and
  [emit a v2 message from a FHIR resource](./emit-v2-from-fhir.md).
- [The reference](./api/README.md): every export, generated from the source.

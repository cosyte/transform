---
id: guides-overview
title: Guides
sidebar_position: 1
---

# Guides

Task-oriented recipes for `@cosyte/transform`. Each is a short, copy-pasteable answer to one real
transformation question. A guide is written only once the behavior it documents is shipped and its
runnable example passes the doc/code-agreement check.

## Resolve an assigning authority

A patient identifier's assigning authority (HD) is resolved through a **NamingSystem registry**. The
registry auto-derives a system URI only for the two unambiguous cases — a valid OID with
`universalIdType: "ISO"` (`urn:oid:…`) and a valid UUID (`urn:uuid:…`) — and otherwise consults the
entries you seed. A bare namespace mnemonic (HD.1) is **never** turned into a URI on its own.

```ts runnable
import { createNamingSystem } from "@cosyte/transform";

const registry = createNamingSystem({
  authorities: { HOSPMRN: "urn:oid:1.2.840.114350.1.13.1" },
});

registry.resolveAssigningAuthority({ namespaceId: "HOSPMRN" }); // => "urn:oid:1.2.840.114350.1.13.1"
```

## Supply a sender's timezone for naked timestamps

By default a v2 timestamp with a time-of-day but no offset is reduced to date precision (FHIR forbids
time without a zone). If you *know* the sending system's offset, assert it — the value is emitted with
that offset and flagged as sender-asserted, never inferred:

```ts
import { toFhirDateTime } from "@cosyte/transform";
import { parseDtm } from "@cosyte/hl7";

toFhirDateTime(parseDtm("20260721143000"), { assumeTimezoneOffsetMinutes: -300 });
// => { value: "2026-07-21T14:30:00-05:00", issues: [ TRANSFORM_TIMESTAMP_NO_TIMEZONE ] }
```

## Planned guides

As later phases ship: assembling a full `Patient`/`Encounter`/`Observation` graph from a message,
applying a BYO `ConceptMap` for local codes, and targeting US Core profiles.

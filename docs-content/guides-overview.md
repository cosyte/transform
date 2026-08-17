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
registry auto-derives a system URI only for the two unambiguous cases: a valid OID with
`universalIdType: "ISO"` (`urn:oid:…`) and a valid UUID (`urn:uuid:…`), and otherwise consults the
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
time without a zone). If you *know* the sending system's offset, assert it, and the value is emitted with
that offset and flagged as sender-asserted, never inferred:

```ts
import { toFhirDateTime } from "@cosyte/transform";
import { parseDtm } from "@cosyte/hl7";

toFhirDateTime(parseDtm("20260721143000"), { assumeTimezoneOffsetMinutes: -300 });
// => { value: "2026-07-21T14:30:00-05:00", issues: [ TRANSFORM_TIMESTAMP_NO_TIMEZONE ] }
```

## Emit a v2 message from a FHIR resource

The reverse path is narrow on purpose: a `Patient` becomes an `ADT`-shaped message carrying a `PID`,
an `Observation` becomes an `ORU`-shaped message carrying an `OBX`. **You supply the trigger.** No
FHIR resource carries an HL7 v2 message trigger, so there is nothing to infer one from, and an
absent one returns no message plus a `TRANSFORM_MISSING_TRIGGER` diagnostic.

```ts runnable
import { toV2Patient, ISSUE_CODES } from "@cosyte/transform";
import { parseResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","gender":"female"}');

const emitted = toV2Patient(resource, "A28");
emitted.value?.toString().includes("ADT^A28"); // => true

const refused = toV2Patient(resource, "");
refused.value; // => undefined
refused.issues[0]?.code === ISSUE_CODES.TRANSFORM_MISSING_TRIGGER; // => true
```

The direction is **lossy by design and not a round-trip**. The mapping guide runs v2 to FHIR, and
several of its rows are many-to-one, so their inverse is ambiguous: `gender` `other` could have come
from three different v2 codes, so it is refused rather than resolved to one of them.

```ts runnable
import { toV2Patient, ISSUE_CODES } from "@cosyte/transform";
import { parseResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","gender":"other"}');
const { issues } = toV2Patient(resource, "A28");

issues[0]?.code === ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE; // => true
issues[0]?.v2Location; // => "PID.8"
```

The same rule covers what v2 requires and your resource does not carry. A `PID` needs PID-3 (Patient
Identifier List) and PID-5 (Patient Name); an `OBX` needs OBX-11 (Observation Result Status). None of
them has a safe default, so the field is left absent rather than padded with an invented value, and
its absence is reported: check the issues before you send the message.

```ts runnable
import { toV2Patient, ISSUE_CODES } from "@cosyte/transform";
import { parseResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient","identifier":[{"value":"MRN1"}]}');
const { value, issues } = toV2Patient(resource, "A28");

// The message is emitted, with the required name field absent rather than fabricated.
value?.toString().includes("PID|||MRN1"); // => true
issues[0]?.code === ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT; // => true
issues[0]?.v2Location; // => "PID.5"
```

If nothing in the resource grounds a single field of the target segment, there is no message at all,
and that is reported too rather than returned as an empty success.

```ts runnable
import { toV2Patient, ISSUE_CODES } from "@cosyte/transform";
import { parseResource } from "@cosyte/fhir";

const { resource } = parseResource('{"resourceType":"Patient"}');
const { value, issues } = toV2Patient(resource, "A28");

value; // => undefined
issues[0]?.code === ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED; // => true
```

## Planned guides

Not yet written: assembling a full `Patient`/`Encounter`/`Observation` graph from a message,
applying a BYO `ConceptMap` for local codes, and targeting US Core profiles.

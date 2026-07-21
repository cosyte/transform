---
id: quickstart
title: Quickstart
sidebar_position: 1
---

# Quickstart

The **datatype converters** each take a parsed `@cosyte/hl7` composite and return a `{ value, issues }`
pair — the FHIR datatype node it could faithfully produce, plus the value-free diagnostics it raised.
Phase 2 adds the **message-level** entry `toFhir(msg)`, which assembles a whole HL7 v2 **ADT** message
into a FHIR **Patient + Encounter** bundle over those same converters.

## Convert a name

```ts runnable
import { toFhirHumanName } from "@cosyte/transform";

const { value, issues } = toFhirHumanName({
  familyName: "Public",
  givenName: "Jane",
  nameTypeCode: "L", // HL7 Table 0200 "Legal name" → FHIR name-use "official"
});

// A clean, fully-mapped name raises no diagnostics.
issues; // => []
```

`value` is a FHIR `HumanName` node you can drop straight into a resource; `issues` is empty here
because every part mapped cleanly.

## The fail-safe rule in action

When a mapping is ambiguous, the converter **refuses to guess** and tells you why. A patient
identifier whose assigning authority can't be resolved is emitted with its value and **no system** —
never a synthesized one that could merge two patients:

```ts runnable
import { toFhirIdentifier, createNamingSystem, ISSUE_CODES } from "@cosyte/transform";

const { issues } = toFhirIdentifier(
  { idNumber: "12345", assigningAuthority: { namespaceId: "HOSPMRN" } },
  { namingSystem: createNamingSystem() }, // no registry entry for a bare "HOSPMRN"
);

issues[0].code; // => "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"
```

Register the authority explicitly (`createNamingSystem({ authorities: { HOSPMRN: "urn:oid:…" } })`)
and the same call resolves `Identifier.system` with no diagnostic.

## Assemble a message

Parse an `ADT^A01` with `@cosyte/hl7`, then hand it to `toFhir` — you get back a FHIR R4 **message
`Bundle`** (a `MessageHeader`, then the `Patient` and `Encounter` it describes) plus the value-free
issues. Every segment→resource map is grounded on the published HL7 v2-to-FHIR IG.

```ts
import { parseHL7 } from "@cosyte/hl7";
import { toFhir, createNamingSystem } from "@cosyte/transform";

const msg = parseHL7(raw); // an ADT^A01
const { bundle, issues } = toFhir(msg, {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
});

// bundle.type === "message"; entry[0] is a MessageHeader, then Patient + Encounter.
// Encounter.subject and every reference resolve to a urn:uuid: fullUrl inside the bundle.
```

The same fail-safe rule holds at the message level: an unmapped patient class, a naked timestamp, or
an unresolvable identifier authority becomes a typed issue — never a fabricated FHIR value. A message
whose trigger the IG has **no message map** for is still assembled from the reusable segment maps and
flagged `TRANSFORM_SEGMENT_ASSEMBLED`, never invented. The Table-0001/0004 maps the assembly applies
are exported for inspection:

```ts runnable
import { ADMINISTRATIVE_GENDER_MAP, ENCOUNTER_CLASS_V3_MAP } from "@cosyte/transform";

ADMINISTRATIVE_GENDER_MAP["F"]; // => "female"
ENCOUNTER_CLASS_V3_MAP["I"].code; // => "IMP"
```

## Next

- [Core concepts](./concepts-archetype) — the fail-safe rule, the diagnostic channel, the six converters.
- **API reference** — every export, generated from source.

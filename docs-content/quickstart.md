---
id: quickstart
title: Quickstart
sidebar_position: 1
---

# Quickstart

Phase 1 ships the **datatype converters**: each takes a parsed `@cosyte/hl7` composite and returns a
`{ value, issues }` pair — the FHIR datatype node it could faithfully produce, plus the value-free
diagnostics it raised.

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

## Next

- [Core concepts](./concepts-archetype) — the fail-safe rule, the diagnostic channel, the six converters.
- **API reference** — every export, generated from source.

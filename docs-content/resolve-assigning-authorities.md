---
id: resolve-assigning-authorities
title: Resolve assigning authorities
sidebar_label: Resolve assigning authorities
description: "Give each identifier a FHIR Identifier.system: seed the naming system with your authorities, and know which ones resolve on their own."
---

# Resolve assigning authorities

A v2 identifier names who assigned it in its assigning authority (CX-4, an `HD`). FHIR needs a
system URI in `Identifier.system`. There is no rule that turns one into the other, so the library
asks a **naming system** you create, and leaves `system` out, with an issue, when the naming system
has no answer. This guide shows how to give it the answers.

## Seed the naming system with your authorities

Map each authority code your senders use to the system URI it stands for. A key can be the
namespace id (HD-1) or the universal id (HD-2).

```ts runnable
import { createNamingSystem } from "@cosyte/transform";

const registry = createNamingSystem({
  authorities: {
    HOSPMRN: "urn:oid:2.16.840.1.113883.19.5",
    "2.16.840.1.113883.19.7": "urn:oid:2.16.840.1.113883.19.7",
  },
});

registry.resolveAssigningAuthority({ namespaceId: "HOSPMRN" }); // => "urn:oid:2.16.840.1.113883.19.5"
registry.resolveAssigningAuthority({ universalId: "2.16.840.1.113883.19.7" }); // => "urn:oid:2.16.840.1.113883.19.7"
registry.resolveAssigningAuthority({ namespaceId: "OTHER" }); // => undefined
```

When an `HD` carries both, an entry for the universal id wins over an entry for the namespace id.

## Know what resolves without a seed

Two kinds of authority resolve with no entry, because each names its system unambiguously: an OID
in HD-2 with HD-3 `ISO`, and a UUID in HD-2 with HD-3 `UUID`. A namespace id alone never does, and
neither does an OID without `ISO`.

```ts runnable
import { createNamingSystem } from "@cosyte/transform";

const registry = createNamingSystem();

registry.resolveAssigningAuthority({ universalId: "2.16.840.1.113883.19.5", universalIdType: "ISO" }); // => "urn:oid:2.16.840.1.113883.19.5"
registry.resolveAssigningAuthority({ universalId: "6A2F41A3-C54C-4E1B-9C11-6B1A7F5F2E10", universalIdType: "UUID" }); // => "urn:uuid:6a2f41a3-c54c-4e1b-9c11-6b1a7f5f2e10"
registry.resolveAssigningAuthority({ namespaceId: "HOSPMRN" }); // => undefined
registry.resolveAssigningAuthority({ universalId: "2.16.840.1.113883.19.5" }); // => undefined
```

## Pass the naming system to the transform

`toFhir` takes the naming system in its options and passes it to the datatype conversions it runs.
Without one it uses `createNamingSystem()`, so only the two cases above resolve.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A28^ADT_A05|MSG00002|P|2.5.1",
  "PID|1||MRN12345^^^HOSPMRN^MR||Public^Jane||19800115|F",
].join("\r");
const namingSystem = createNamingSystem({
  authorities: { HOSPMRN: "urn:oid:2.16.840.1.113883.19.5" },
});

const { bundle, issues } = toFhir(parseHL7(raw), { namingSystem });
const json = JSON.parse(serializeResource(bundle)) as {
  entry: { resource: { identifier?: { system?: string }[] } }[];
};

json.entry[1]?.resource.identifier?.[0]?.system; // => "urn:oid:2.16.840.1.113883.19.5"
issues.some((i) => i.code === "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"); // => false
```

The datatype converter takes it the same way, in its second argument:
`toFhirIdentifier(cx, { namingSystem })`. Called without one, a converter resolves nothing.

## When an authority is not resolved

The identifier keeps its value and type, `Identifier.system` is left out, and the result carries a
`TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED` at `CX.4` with the FHIR path `Identifier.system`. Add the
authority to your seed. Do not fill the system in with a guess: two senders can use the same short
code for different registries, and a shared system would make their patients look like one.

## Seed coding systems too

The same naming system resolves the coding-system mnemonic in a coded field (CWE-3) to a system
URI. It knows `LN`, `SCT`, `RXNORM`, `CVX` and `UCUM` out of the box (`DEFAULT_V2_CODE_SYSTEMS`).
Add your own with `codeSystems`:

```ts runnable
import { createNamingSystem } from "@cosyte/transform";

const registry = createNamingSystem({
  codeSystems: { "99LAB": "https://lab.example.com/fhir/CodeSystem/tests" },
});

registry.resolveCodeSystem("LN"); // => "http://loinc.org"
registry.resolveCodeSystem("99LAB"); // => "https://lab.example.com/fhir/CodeSystem/tests"
registry.resolveCodeSystem("L"); // => undefined
```

An unknown mnemonic leaves `Coding.system` out and raises `TRANSFORM_CODE_SYSTEM_UNRESOLVED`; the
code itself is kept.

## Reference

- [`createNamingSystem`](./api/README.md#createnamingsystem),
  [`NamingSystemSeed`](./api/README.md#namingsystemseed) and
  [`NamingSystemRegistry`](./api/README.md#namingsystemregistry)
- [`DEFAULT_V2_CODE_SYSTEMS`](./api/README.md#default_v2_code_systems)
- [`toFhir`](./api/README.md#tofhir) and [`TransformOptions`](./api/README.md#transformoptions)
- [`toFhirIdentifier`](./api/README.md#tofhiridentifier)
- [Issue codes](./issue-codes.md)

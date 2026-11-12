---
id: limitations
title: Limitations
sidebar_label: Limitations
description: "What @cosyte/transform leaves out by design: terminology content, unit conversion, other FHIR versions, and a FHIR to v2 path that is narrow."
---

# Limitations

What the library does not do, by design. Each entry links where it is explained.

- **No terminology content.** No SNOMED CT, LOINC or RxNorm content is bundled, and membership in
  a value set is not checked. See [Conformance](./conformance.md).
- **No unit conversion.** A unit is carried as the message states it.
- **R4 only.** Output is FHIR R4, checked with `@cosyte/fhir`.
- **A narrow FHIR to v2 path.** A v2-required field with no source stays absent and is reported.
  See [Why FHIR to v2 is narrow](./reverse-direction.md).
- **No guessed values.** An element the IG gives no source for is left out and reported. See
  [How the transform works](./concepts-archetype.md).

[Mapping scope](./mapping-scope.md) lists, family by family, what reaches a resource and what is
left out, and [Issue codes](./issue-codes.md) lists the diagnostics that report it.

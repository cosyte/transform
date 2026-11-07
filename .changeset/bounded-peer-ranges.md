---
"@cosyte/transform": patch
---

The `@cosyte/hl7` and `@cosyte/fhir` peer dependencies are now bounded to the 0.1 line (`^0.1.0`), the releases this package is tested against, instead of accepting any version.

A package manager now warns, or refuses under strict peer dependencies, when either sibling is outside the 0.1 line, rather than installing a combination nobody has tested. Nothing this package emits changes.

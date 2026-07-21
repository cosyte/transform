---
"@cosyte/transform": patch
---

Phase 1 — the datatype foundation + the value-free diagnostic channel. `@cosyte/transform` becomes the
HL7 v2 → FHIR R4 transformation tier (a consumer of `@cosyte/hl7` + `@cosyte/fhir`, not a parser),
grounded firsthand on the published HL7 v2-to-FHIR IG. Ships the six safety-critical, fail-safe
datatype converters (`toFhirDateTime`, `toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`,
`toFhirAddress`, `toFhirQuantity`), the `OperationOutcome`-shaped value-free diagnostic channel
(`ISSUE_CODES`/`FATAL_CODES`/`TransformIssue`/`toOperationOutcome`), and the minimal NamingSystem
resolver (`createNamingSystem`). `@cosyte/hl7` + `@cosyte/fhir` are peer deps (vendored for dev/test);
third-party runtime deps stay at zero. Two architecture ADRs recorded.

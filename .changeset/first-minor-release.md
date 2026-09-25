---
"@cosyte/transform": minor
---

**This is 0.1.0, the first release of `@cosyte/transform` whose public API we treat as settled.**

What is covered, and what you can build against:

- HL7 v2 to FHIR R4, grounded on the HL7 Version 2 to FHIR Implementation Guide: the six datatype
  converters (`toFhirDateTime`, `toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`,
  `toFhirAddress`, `toFhirQuantity`), and `toFhir(msg)`, which turns a parsed `@cosyte/hl7` message
  into a FHIR message Bundle for ADT (with `AL1`, `DG1`, `PR1` and `IN1`), ORU^R01, ORM_O01 and
  OML_O21 (with `RXO` and `TQ1`), VXU_V04, SIU_S12 and MDM_T02.
- The fail-safe rule: a naked timestamp, an assigning authority with no registered system, an
  unmapped code or a unit that is not UCUM becomes a typed issue carrying a code and a location,
  never a value, and never a guessed FHIR value. `toOperationOutcome` renders the issues as FHIR.
- A narrow FHIR to v2 path: `toV2Patient` and `toV2Observation` emit a complete v2 message from the
  fields whose mapping inverts one to one, with the trigger always supplied by you.

What the version promises. The exported names, options, result shapes and issue codes are the
surface we keep stable: a new issue code is an addition, and renaming or removing one is a breaking
change. While the package is below 1.0, a breaking change bumps the minor version (0.1 to 0.2) and
is called out in this changelog; a fix that changes no emitted value ships as a patch.
`@cosyte/hl7` and `@cosyte/fhir` are peer dependencies you install beside this package.

What is not covered yet. None of the guide's seven published test messages yet produces a Bundle
that is clean against FHIR R4 plus the US Core 9.0.0 profiles; six of the seven are clean against
base R4, and the conformance report in the repository lists every finding. No profiles and no
terminology content ship, so a field whose guide target is SNOMED CT stays structural unless you
supply a ConceptMap. `RXE` has no map in the guide and is flagged, never assembled. The FHIR to v2
path does not build a visit-carrying ADT from a `Patient` and an `Encounter`, and it is not a round
trip: a many-to-one mapping is refused rather than inverted.

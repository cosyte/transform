---
"@cosyte/transform": patch
---

`toFhir` now carries a veterinary PID's species and breed into `Patient`. PID-35 Species Code and PID-36 Breed Code go to the `species` and `breed` parts of the FHIR R4 core extension `http://hl7.org/fhir/StructureDefinition/patient-animal`, each a `valueCodeableConcept` converted from the CWE the way every other coded field is. The extension is written as the `Patient`'s first `extension`. Its `genderStatus` part is never written, and is never inferred from PID-8. PID-37 strain and PID-38 production class are still not carried and still raise `TRANSFORM_ELEMENT_DROPPED`.

This is new output: a `Patient` from a PID that values PID-35 now has an `extension` it did not have, and a PID that values only PID-35 now yields a `Patient`. PID-35 and PID-36 raise `TRANSFORM_ELEMENT_DROPPED` (now with a `fhirPath` naming the extension part) only when a value cannot be written: a CWE with no code and no text, a breed with no species (the extension requires species), or a repetition after the first. The public API is unchanged; a caller that read species and breed from the parsed message can read them from `Patient.extension` instead.

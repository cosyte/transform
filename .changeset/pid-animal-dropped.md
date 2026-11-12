---
"@cosyte/transform": patch
---

`toFhir` now reports the animal fields of a PID that it does not carry into `Patient`. PID-37 strain and PID-38 production class were dropped with no issue at all, so a veterinary ADT or ORU converted to FHIR lost them and nothing said so.

Each of these fields that is valued now raises one `TRANSFORM_ELEMENT_DROPPED` at `information` severity at its own location (`PID.37` or `PID.38`), with no `fhirPath`, because FHIR R4 `Patient` has no element for them. An empty field or the HL7 null `""` raises nothing. The issues carry no field values, and the public API is unchanged: a caller that counts or filters issues sees up to two more on a veterinary message. PID-35 species and PID-36 breed are carried into the `patient-animal` extension, as described in the separate changeset for that output.

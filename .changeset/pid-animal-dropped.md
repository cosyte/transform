---
"@cosyte/transform": patch
---

`toFhir` now reports the animal fields of a PID that it does not carry into `Patient`. PID-35 species, PID-36 breed, PID-37 strain and PID-38 production class were dropped with no issue at all, so a veterinary ADT or ORU converted to FHIR lost them and nothing said so.

Each of these fields that is valued now raises one `TRANSFORM_ELEMENT_DROPPED` at `information` severity at its own location (`PID.35`, `PID.36`, `PID.37` or `PID.38`), with no `fhirPath`, because FHIR R4 `Patient` has no element for them. An empty field or the HL7 null `""` raises nothing. The `Patient` itself is unchanged, the issues carry no field values, and the public API is unchanged: a caller that counts or filters issues sees up to four more on a veterinary message.

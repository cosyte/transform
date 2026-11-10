---
"@cosyte/transform": patch
---

`toFhir` now reports the PID fields it does not carry into `Patient`. PID-10 race, PID-15 primary language, PID-19 SSN, PID-22 ethnic group, PID-29 death date and time and PID-30 death indicator were dropped with no issue at all, so a `Patient` from a PID that records a death came out with no `deceased[x]` and nothing said so, and looked like a living patient.

Each of these fields that is valued now raises `TRANSFORM_ELEMENT_DROPPED` at its own location (`PID.10`, `PID.15`, `PID.19`, `PID.22`, `PID.29` or `PID.30`), with the FHIR element the HL7 v2 to FHIR guide maps it to: `Patient.communication.language`, `Patient.identifier`, `Patient.deceasedDateTime` or `Patient.deceasedBoolean`. Race and ethnic group name no element, because the guide's PID to Patient map has no row for them. An empty field or the HL7 null `""` raises nothing. The `Patient` itself is unchanged: none of these fields is mapped yet, and the issues carry no field values.

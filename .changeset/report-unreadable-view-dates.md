---
"@cosyte/transform": minor
---

`toFhir` now reports a PID-7, PV1-44, PV1-45 or MSH-7 that is valued but could not be read as a date. These four fields reach the transform through `@cosyte/hl7`'s typed views, which hand back no timestamp at all for a value they cannot read, so a date of birth such as `20261399` was dropped from `Patient.birthDate` with no issue, and the same for `Encounter.period.start`, `Encounter.period.end` and `Bundle.timestamp`.

The new issue code `TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER` (severity `warning`) names the field and the FHIR element it would have filled. Nothing else changes: no value is written in its place, and an unreadable PV1-45 still does not make the encounter `finished`. An empty or `""` field raises nothing.

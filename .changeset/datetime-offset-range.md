---
"@cosyte/transform": patch
---

`toFhirDateTime` no longer writes a timezone offset that FHIR cannot carry. FHIR R4 allows offsets from -14:00 to +14:00 in whole minutes, but a v2 timestamp can carry up to +2359. Before this fix, `20260721143000+1500` became `2026-07-21T14:30:00+15:00`, which is not a valid FHIR `dateTime`. It went out in `Condition`, `Procedure`, `Observation`, `DiagnosticReport` and `Specimen`, and the emit gate did not stop it.

Now an offset outside that range is treated as no usable offset. The value is reduced to its date and flagged with `TRANSFORM_ELEMENT_DROPPED`. The same applies to `assumeTimezoneOffsetMinutes`: a value that is not a whole number of minutes from -840 to 840 (for example `900`, `90.5` or `NaN`) is ignored, so a naked timestamp is still reduced to its date and flagged with `TRANSFORM_TIMESTAMP_NO_TIMEZONE`.

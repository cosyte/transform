---
"@cosyte/transform": patch
---

Give an ORU consumer the typed value the guide already publishes, instead of a string to re-parse. Five OBX-2 value types that used to degrade to `valueString` plus a dropped-element flag now reach their mapped FHIR target, and an ORU's specimens and per-result comments reach the bundle.

`DR` becomes `Observation.valuePeriod`, `NR` becomes `valueRange`, `TM` becomes `valueTime`, and `NA` becomes `valueSampledData`. An `ED` whose OBX-5.4 says `Base64` becomes the guide's named `valueAttachment` extension, and its payload is copied from OBX-5.5 **byte-for-byte**: not decoded, not re-encoded, not normalized, not validated, not truncated. A bundle that previously carried a raw string in these five cases now carries a period, a range, a time, a waveform or an attachment, so a consumer reading `value[x]` sees a different shape for the same message.

The fail-safe floor is unchanged and still reached wherever the map cannot carry the value faithfully: a `DR` neither of whose bounds is a dateTime this library will emit, an `NR` neither of whose bounds is a `decimal` FHIR carries unaltered, a `TM` carrying a UTC offset (an R4 `time` admits none, and discarding one would move the clinical instant), an `NA` carrying a magnitude that would have to be rewritten, and an `ED` under any encoding other than `Base64`, all fall back to the raw OBX-5 text as `valueString` with `TRANSFORM_ELEMENT_DROPPED`. Where the fallback fires for one of these five, it now carries the **whole** OBX-5 rather than its first component, so a two-ended `DR` no longer loses its second bound on the way out. `RP` is deliberately untouched: its extension target carries the guide's own comment that it is unresolved.

A `SampledData` **never asserts an origin or a period**. R4 makes both required and the guide sources neither, so each ships value-absent with a `data-absent-reason` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`, and the observation still emits. `.dimensions` and `.data` follow the guide's own worked examples, with `E` for a position a repetition did not carry.

An `SPM` in an ORU now becomes a `Specimen` that the `DiagnosticReport` scoping it references, so it is no longer reported as a segment that reached nothing. A report the emit gate withholds takes its specimens with it: the bundle never carries a `DiagnosticReport.specimen` pointing at an absent resource, nor a `Specimen` entry orphaned by a report that was never emitted. `Specimen.status` is never asserted, because the only row that reaches it does so through a Table 0136 value map this library does not carry, and the parent, collection-quantity and status rows are declared rather than guessed.

An `NTE` inside an ORU's OBSERVATION group now becomes `Observation.note`, one annotation per comment repetition, with NTE-6 as its time. The PATIENT-level and ORDER_OBSERVATION-level `NTE` rows publish no FHIR target, so neither reaches an observation however close to one it sits, and both are still reported as unread.

No issue code is added, renamed or removed, and no diagnostic carries a value: not an attachment payload, not a specimen identifier, not a note's text, not an observation magnitude.

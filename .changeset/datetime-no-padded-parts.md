---
"@cosyte/transform": patch
---

`toFhirDateTime` no longer fills in a minute or second that a timestamp does not have. A `TS` built by hand that claimed `second` or `fraction` precision but had no `minute` or no `second` came out with `00` in that place, which states a precision the sender never sent. Such a value is now reduced to its date and flagged with `TRANSFORM_ELEMENT_DROPPED`, the same as any time that lacks seconds. Timestamps from `@cosyte/hl7`'s parser always carry the parts their precision names, so parsed messages are unaffected.

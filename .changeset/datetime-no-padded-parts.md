---
"@cosyte/transform": patch
---

`toFhirDateTime` no longer fills in a time part a timestamp does not have, or writes a part where FHIR does not expect it. A `TS` built by hand can claim a precision its parts do not carry. One that claimed `second` or `fraction` precision but had no `minute` or no `second` came out with `00` in that place, and one with no `day` or no `month` came out as `2026-07T14:30:00+00:00` or `2026-21T14:30:00+00:00`, which is not a FHIR `dateTime` or puts the day where the month goes. A day with no month did the same at date precision (`2026-21`).

Now every part a timestamp carries is either written in its FHIR place or dropped and flagged with `TRANSFORM_ELEMENT_DROPPED`. A time needs the full date and the minute and second; without them the value is reduced to the date it can place. A day with no month is dropped and the year kept. A minute or second with no hour is dropped and flagged rather than lost without a word. Timestamps from `@cosyte/hl7`'s parser always carry the parts their precision names, so parsed messages are unaffected.

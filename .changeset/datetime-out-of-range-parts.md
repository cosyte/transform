---
"@cosyte/transform": patch
---

`toFhirDateTime` no longer writes a timestamp part that is out of range. A `TS` built by hand with hour 25 came out as `2026-07-21T25:30:00+00:00`, and minute 60 or month 13 were written the same way, none of them a FHIR `dateTime`. A day the month does not have, such as 31 February, was written too, and that one reaches `toFhir` from parsed messages, because `@cosyte/hl7` reads `20260231` as a valid date. Fractional seconds that were not digits, such as `5x`, were written after the dot as given, and an empty fraction left a bare dot.

Now a part out of range is dropped with every part after it and flagged with `TRANSFORM_ELEMENT_DROPPED`, and the value keeps the parts before it: hour 25 gives the date, 31 February gives `2026-02`, month 13 gives the year. Fractional seconds that are not digits are dropped on their own and flagged, and the whole second is still written. A fraction carried at a precision with no place for it is flagged rather than left out without a word. A year outside 0001 to 9999 gives no value and `TRANSFORM_TIMESTAMP_INVALID`.

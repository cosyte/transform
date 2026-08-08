---
"@cosyte/transform": patch
---

Corroborate every HL7 v2 field number the PHI scanner reads against a published HL7 v2.5.1, and read seven PHI-bearing fields it previously disclosed as unread (PHI-SCAN-RESIDUALS).

The segment field list is the detector in this package: the cross-cutting SSN/email floor finds nothing in a corpus whose messages are inline v2 string literals, so a wrong field number is either a missed leak or a false positive on a clinical field. Fifteen numbers had never been checked against any published source (the whole GT1 row, plus PID-6, PID-9, PID-19, PID-20, NK1-30, NK1-33, IN1-18 and IN1-19). All fifteen are now checked against the v2.5.1 segment attribute tables in Chapter 3 (PID 3.4.2, NK1 3.4.5) and Chapter 6 (GT1 6.5.5, IN1 6.5.6), cross-checked against a second version-pinned publication, and none of them was wrong. The GT1 clause citation was: it said 6.5.4.

Every row in the scanner's coverage table and in the suite's coverage case now carries the v2.5.1 item number the field number was corroborated by, which is the standard's own stable identifier for an element.

Seven fields that a review had measured as reported-clean are read now, because the same published tables ground them: NK1-26, NK1-31, NK1-32, NK1-37, GT1-2, GT1-4 and IN1-49. This is a union with the previous list rather than a replacement, and the superset is pinned cell by cell: every field that reported before still reports, every deliberate non-field (IN1-17, IN1-7, PID-10, PID-18, NK1-3, GT1-11, PV1-19) still reports nothing, and the tracked corpus stays clean. `PHI_SEGMENTS` is derived from the union of all five field tables instead of one of them, so a segment added to a single table can no longer go silently unlocated.

---
"@cosyte/transform": patch
---

The `TRANSFORM_ELEMENT_DROPPED` for unmapped patient telecom now points at the field the phone came from. It was always located at `PID.13`, even when the only phone was a PID-14 business number. Now a valued PID-13 raises one at `PID.13` and a valued PID-14 raises one at `PID.14`, so a PID valuing both raises two. The `Patient` is unchanged; telecom is still not mapped.

---
"@cosyte/transform": patch
---

Corrected the docs on which PID fields reach a FHIR `Patient`: PID-10, PID-15, PID-19, PID-22, PID-29 and PID-30 are dropped with no issue, not flagged as the type declarations said.

So a `Patient` from a PID that records a death has no `deceased[x]`, and no issue says so. The README and the type declarations now say this. Their examples also now use HL7's example OID root, `2.16.840.1.113883.19`, in place of a real organization's OID. The code, API and behavior are unchanged.

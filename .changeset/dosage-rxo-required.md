---
"@cosyte/transform": patch
---

An internal tidy in the HL7 v2 to FHIR medication order mapping, with no change to any output: the dosage builder takes the RXO segment its caller always passes, instead of checking for a missing one.

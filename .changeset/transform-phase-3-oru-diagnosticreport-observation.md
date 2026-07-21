---
"@cosyte/transform": patch
---

Phase 3 — ORU^R01 → DiagnosticReport + Observation, the results graph. `toFhir(msg, opts?)` now
assembles a parsed HL7 v2 ORU^R01 message into a FHIR R4 message `Bundle` carrying a `DiagnosticReport`
per OBR with its `Observation` results (alongside the Phase-2 `Patient`/`Encounter`), grounded firsthand
on the published HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1) segment/table ConceptMaps: OBR →
`DiagnosticReport` (OBR-4 code, OBR-7/8 effective, OBR-22 issued, OBR-24 category, OBR-25 status via
HL70123, OBX children → result), and OBX → `Observation` with **OBX-2 value-type discrimination** of
OBX-5 → `value[x]` (NM → `valueQuantity`, CWE/CE → `valueCodeableConcept`, SN → structured
`valueQuantity`/`valueRange`/`valueRatio`, ST/TX/FT → `valueString`), OBX-8 → `interpretation` (HL70078),
OBX-11 → `status` (HL70085), OBX-14 → effective, OBX-6 units UCUM-gated, OBX-7 → `referenceRange.text`.
The "never a confident wrong result" fail-safes hold: a corrected/cancelled result is never emitted as
`final`; an unmapped result status leaves `status` absent and the required-`status` emit gate withholds
the resource (never guessed); an unrecognized abnormal flag is surfaced, never coerced to normal; and a
numeric magnitude is carried through precision-exact from the raw OBX-5 (never a lossy JS `number`). New
public surface: `IG_MAPPED_ORU_TRIGGERS`, `DIAGNOSTIC_REPORT_STATUS_MAP`, `OBSERVATION_STATUS_MAP`,
`HL70078_INTERPRETATION_CODES`. No new issue codes (the existing `TRANSFORM_CODE_UNMAPPED` now also
covers a table code with no IG-ConceptMap target; `TRANSFORM_ELEMENT_DROPPED` covers a deferred richer
`value[x]` type).

---
"@cosyte/transform": patch
---

Phase 4 — the order-entry graph. `toFhir(msg, opts?)` now assembles HL7 v2 **ORM_O01 / OML_O21** order
messages into a FHIR R4 message `Bundle`: each ORC-anchored order becomes a **`ServiceRequest`** (from
its `OBR` detail) or a **`MedicationRequest`** (from its `RXO` pharmacy detail, plus the `RXR` route),
alongside the Phase-2 `Patient`/`Encounter`. Every segment/field/table map is grounded firsthand on the
published HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source — the
**Segment ORC/OBR to ServiceRequest**, **Segment RXO/RXR to MedicationRequest**, and **Table HL70119 to
Request Status** maps.

Fail-safe throughout (never a confident wrong request): a `ServiceRequest.status` that cannot be
grounded via HL70119 (an ORC-1 in the IG's `(unmapped)` group, or a valued ORC-5 the IG leaves
unspecified) is withheld rather than guessed; the IG grounds no `MedicationRequest` status, so it is set
to the value set's honest `unknown` + flagged (the `request-status` codes HL70119 yields are not valid
`medicationrequest-status` codes and are never borrowed); doses/dispense amounts stay precision-exact
with UCUM-gated units (no fabricated code, no rescaled magnitude); and `RXE` — for which STU1 ships no
segment or `RDE` message map — is flagged, never assembled from a guessed layout. New public exports:
`REQUEST_STATUS_MAP`, `IG_MAPPED_ORDER_TRIGGERS`.

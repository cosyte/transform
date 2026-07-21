---
"@cosyte/transform": patch
---

Phase 5 — the thin IG singles. `toFhir(msg, opts?)` now assembles the three single-trigger IG message
families into a FHIR R4 message `Bundle`, alongside the Phase-2 `Patient`/`Encounter`: **VXU_V04 →
`Immunization`** (RXA + RXR route, ORC identifiers), **SIU_S12 → `Appointment`** (SCH + AIS + the
Patient participant), and **MDM_T02 → `DocumentReference`** (TXA metadata + the OBX document body).
Every segment/field/table/datatype map is grounded firsthand on the published HL7 v2-to-FHIR IG
(`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source — the **Segment RXA/RXR/ORC to
Immunization**, **Table HL70322 to Event Status**, **Segment SCH/AIS/PID to Appointment**, **Table
HL70278 to AppointmentStatus**, **Datatype TQ to Appointment**, and **Segment TXA/OBX to
DocumentReference** maps. With Phase 5 the v2→FHIR direction is feature-complete for the IG-covered
message set.

Fail-safe throughout (never a confident wrong resource): `Immunization.status` follows the IG's three
conditioned rows (RXA-21 = `D` delete → the IG-assigned `entered-in-error`; unvalued RXA-20 → the
IG-assigned `completed`; valued RXA-20 → the HL70322 → event-status map), and a valued RXA-20 the map has
no target for is withheld rather than guessed; an `Appointment.status` from an IG-unmatched HL70278 filler status
(`Discontinued`/`Blocked`/`Overbook`) is withheld, and the patient participant's IG-unsourced required
`status` is emitted as a `data-absent-reason` primitive, never fabricated; a `DocumentReference.status`
is grounded only for TXA-19 = `AV` → `current` (the IG ships no value ConceptMap and `AV` has exactly
one faithful `document-reference-status` target), with every other availability code withheld and
TXA-17 → `docStatus` left absent (no IG value map exists). Timezone-naked instants (Appointment
`start`/`end`, DocumentReference `date`) are dropped + flagged rather than assigned a fabricated UTC
offset; the document body is base64-encoded verbatim, carried and never interpreted; and a non-mapped
VXU/SIU/MDM trigger is segment-assembled + flagged, never invented. New public exports:
`IMMUNIZATION_STATUS_MAP`, `APPOINTMENT_STATUS_MAP`, `IG_MAPPED_IMMUNIZATION_TRIGGERS`,
`IG_MAPPED_APPOINTMENT_TRIGGERS`, `IG_MAPPED_DOCUMENT_TRIGGERS`.

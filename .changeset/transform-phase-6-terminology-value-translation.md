---
"@cosyte/transform": patch
---

Phase 6 — terminology value translation of coded fields. Several coded fields that earlier phases
carried **structurally** (via `toFhirCodeableConcept`, code preserved + system recognized) are now
**value-translated** through their IG segment-map `mappedVia` ConceptMaps. Adds a `$translate`-shaped,
additive, fail-safe engine — `toFhirCodeableConceptVia(cwe, map, ctx?)` — plus the license-clean value
maps it applies, each transcribed and verified **firsthand against the raw published IG ConceptMap
JSON** (`hl7.fhir.uv.v2mappings`, STU1), down to the nested `TypeInfo → mappedVia` extension rows:

- **RXR-1 route → `route` / `dosageInstruction.route`** via `table-hl70162-to-v2-0162` (`ROUTE_VALUE_MAP`):
  a 41-code identity group into `v2-0162` plus a 6-code remap into `v3-RouteOfAdministration`
  (`ID→IDINJ`, `IM→IM`, `IV→IVINJ`, `PO→PO`, `SC→SQ`, `TD→TRNSDERM`).
- **RXR-2 site → `site` / `dosageInstruction.site`** via `table-hl70550-to-v2-0550` (`SITE_VALUE_MAP`):
  the 443-code body-part identity map into `v2-0550`, transcribed verbatim (including the IG's
  as-published `Â` encoding artifacts, preserved for source-fidelity and inert).
- **SCH-8 appointment type → `appointmentType`** via `table-hl70277-to-v2-0277` (`APPOINTMENT_TYPE_VALUE_MAP`).
- **RXO-9 allow-substitution → `substitution.allowedCodeableConcept`** via `table-hl70161-to-v2-0161`
  (`SUBSTITUTION_VALUE_MAP`, `N`/`G`/`T`) — translate-or-withhold: a substitution permission is never
  emitted from an unrecognized code.
- **OBR-5 priority → `ServiceRequest.priority`** via `table-hl70485-to-request-priority`
  (`SERVICE_REQUEST_PRIORITY_MAP`: `S→stat`, `A→asap`, `R→routine`; every other v2-0485 code, including
  the whole `T{S,M,H,D,W,L}<integer>` timing-critical family and `PRN`, is in the IG's `(unmapped)`
  group → flagged, `priority` left absent).

**Grounding discipline — no invented targets.** A source code in the IG map's `(unmapped)` group is
flagged `TRANSFORM_CODE_UNMAPPED` and the raw coding preserved (or the value withheld), never coerced.
Translation is **additive** (the derived target coding is added alongside the preserved raw coding —
including any CWE.4/5/6 alternate triplet and CWE.7 version — so recognition augments rather than
overwrites what the message said) and **bound-table-guarded**: it applies only when the field's primary
coding is genuinely from the source table (CWE.3 absent, or naming that table). A field that declares a
*foreign* coding system (a local `99…`, SNOMED, …) is carried structurally and flagged, never asserted
to be the standard concept just because its code string collides with a table code. Two fields the IG maps into **SNOMED
CT** — **RXR-4 method** (`table-hl70165-to-sct`) and **SCH-7 reason** (`table-hl70276-to-sct`) — stay
structurally carried (BYO ConceptMap): SNOMED is license-encumbered and **not bundled** (§5). Two fields
the task named but the IG ships **no** value ConceptMap for — **TXA-2 document type** and **RXA-5
vaccineCode** — are documented as such and left structural, never given an invented translation
(ADR 0018 applied to mappings). Zero encumbered terminology content is bundled.

New public surface (additions only): `toFhirCodeableConceptVia`, `codeableConceptFromTarget`,
`CodedTarget`, `CodedValueMap`, `ROUTE_VALUE_MAP`, `SITE_VALUE_MAP`, `APPOINTMENT_TYPE_VALUE_MAP`,
`SUBSTITUTION_VALUE_MAP`, `SERVICE_REQUEST_PRIORITY_MAP`, and the target-system URI constants
(`V2_0162_SYSTEM`, `V3_ROUTE_OF_ADMINISTRATION_SYSTEM`, `V2_0550_SYSTEM`, `V2_0277_SYSTEM`,
`V2_0161_SYSTEM`). No new issue codes (the existing `TRANSFORM_CODE_UNMAPPED` covers the unmapped case).

---
"@cosyte/transform": patch
---

Phase 2 — ADT → Patient + Encounter, the first message-level assembly. Adds the top-level entry
`toFhir(msg, opts?)` that assembles a parsed HL7 v2 ADT message into a FHIR R4 message `Bundle`
(`MessageHeader` first, then the focal resources), grounded firsthand on the published HL7 v2-to-FHIR
IG (`hl7.fhir.uv.v2mappings`, STU1) segment/table ConceptMaps: PID → `Patient` (identifiers, name,
birthDate, gender via HL70001, address), PV1 → `Encounter` (class/status via HL70004, visit-number
identifier, period), NK1 → `RelatedPerson`, and MSH → `MessageHeader` with the `Bundle` envelope and
`urn:uuid:` reference wiring that always resolves within the bundle. The fail-safe rule holds at the
message level: a non-IG-mapped trigger is segment-assembled + flagged (`TRANSFORM_SEGMENT_ASSEMBLED`,
never a fabricated message map), and every resource passes a conservative-emit gate against
`@cosyte/fhir.validateResource` (a structurally-invalid resource is withheld + flagged
`TRANSFORM_RESOURCE_INVALID`, never shipped invalid). New public surface: `toFhir`, `TransformResult`,
`IG_MAPPED_ADT_TRIGGERS`, the exported table maps, and three additions-only issue codes; `TransformOptions`
gains `namingSystem` and `generateId`.

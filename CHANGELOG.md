# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions and publishing are managed with [Changesets](https://github.com/changesets/changesets);
this file is maintained by hand (Changesets handles the version bump and publish only).

## [Unreleased]

The first pre-alpha release (`0.0.1`) will ship the initial public API surface. The package begins
its public history at `0.0.x`, per the cosyte version ladder (`0.0.x` until first alpha).

### Added

- **Phase 2 — ADT → Patient + Encounter, the first message-level assembly** (roadmap §Phase 2). The
  top-level entry `toFhir(msg, opts?)` assembles a parsed HL7 v2 **ADT** message into a FHIR R4
  **message `Bundle`** (a `MessageHeader` first, then the focal resources), establishing the
  message-map → resource-graph pattern later phases reuse. Every segment→resource and field→element
  map is grounded firsthand on the published HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1)
  ConceptMaps and cited in-source.
  - **PID → `Patient`** (IG _Segment PID to Patient_): PID-3 → `identifier` (via `toFhirIdentifier`),
    PID-5 → `name`, PID-7 → `birthDate` (reduced to `date` precision; a birth time is dropped +
    flagged), PID-8 → `gender` via the `HL70001` → administrative-gender ConceptMap
    (`ADMINISTRATIVE_GENDER_MAP`; an unmapped sex code leaves `gender` absent, never guessed),
    PID-11 → `address`.
  - **PV1 → `Encounter`** (IG _Segment PV1 to Encounter_ + both `HL70004` tables): PV1-2 → `class` via
    `HL70004` → V3 ActCode (`ENCOUNTER_CLASS_V3_MAP`; the self-mapped classes stay in v2-0004), PV1-2/
    PV1-45 → `status` via `HL70004` → Encounter Status (`ENCOUNTER_STATUS_MAP`; a valued discharge is
    `finished`), PV1-19 → `identifier` (type `VN`), PV1-44/45 → `period`. `Encounter.subject` is wired
    to the bundle Patient.
  - **NK1 → `RelatedPerson`** (IG _Segment NK1 to RelatedPerson_): NK1-2 → `name`, NK1-3 →
    `relationship`, NK1-4 → `address`, `patient` wired to the bundle Patient.
  - **MSH → `MessageHeader`** + the `Bundle` envelope: MSH-9 → `eventCoding` (v2-0003), MSH-3 →
    `source` (the required-but-underivable `source.endpoint` URL is emitted with a `data-absent-reason`
    extension, never fabricated), MSH-7 → `Bundle.timestamp` (only a fully-zoned instant qualifies),
    MSH-10 → `Bundle.identifier`; `MessageHeader.focus` and every intra-bundle reference wire to
    `urn:uuid:` fullUrls that always resolve within the bundle.
  - **Two message-level fail-safes.** A non-IG-mapped trigger is assembled from the reusable segment
    maps and flagged `TRANSFORM_SEGMENT_ASSEMBLED` (never a fabricated message map); every produced
    resource passes a **conservative-emit gate** against `@cosyte/fhir.validateResource` (`Patient`
    strict against the built-in schema; the other types against minimal required-cardinality schemas
    in lenient mode) and a structurally-invalid one — e.g. an Encounter with no `class`/`status` from
    an unmapped patient class — is withheld + flagged `TRANSFORM_RESOURCE_INVALID`, never shipped invalid.
  - New public surface: `toFhir`, `TransformResult`, `IG_MAPPED_ADT_TRIGGERS`, and the exported table
    maps. New **additions-only** issue codes: `TRANSFORM_SEGMENT_ASSEMBLED`, `TRANSFORM_RESOURCE_INVALID`,
    `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`. `TransformOptions` gains `namingSystem` and a `generateId`
    allocator (for reproducible fullUrls). Property + fuzz coverage over the message boundary
    (never-throw, value-free registered issues, references resolve, every Patient validates strict).
- **Phase 1 — the datatype foundation + the value-free diagnostic channel** (roadmap §Phase 1).
  `@cosyte/transform` is the HL7 v2 → FHIR R4 **transformation** tier (a consumer of `@cosyte/hl7` +
  `@cosyte/fhir`), not a parser. Every mapping is grounded firsthand on the published HL7 v2-to-FHIR
  Implementation Guide (`hl7.fhir.uv.v2mappings`, STU Edition 1) datatype/table ConceptMaps.
  - The six safety-critical datatype converters, each fail-safe and IG-grounded:
    `toFhirDateTime` (DTM/TS → `dateTime`; a timezone-less time is reduced to date precision, never a
    guessed UTC), `toFhirIdentifier` (CX → `Identifier`; the assigning authority resolves via a
    NamingSystem registry, **never** synthesized from HD.1 alone), `toFhirCodeableConcept` (CWE/CE →
    `CodeableConcept`; an unmapped code is preserved + flagged, never coerced),
    `toFhirHumanName` (XPN → `HumanName`; HL70200 → name-use), `toFhirAddress` (XAD → `Address`; the
    value-conditional XAD.7 split over HL70190 → address-use/type), `toFhirQuantity` (NM + units →
    `Quantity`; magnitude carried precision-exact, non-UCUM unit preserved verbatim, never converted).
  - The `OperationOutcome`-shaped, **value-free** diagnostic channel: `TransformIssue`, the stable
    `ISSUE_CODES` + `FATAL_CODES` registries (`key === value`; renaming/removing one is breaking),
    the `issue` factory, and `toOperationOutcome(issues)`.
  - The minimal NamingSystem resolver: `createNamingSystem`, `DEFAULT_V2_CODE_SYSTEMS`,
    `V2_0203_SYSTEM` — HD → `Identifier.system` (safe OID/UUID auto-derivation only) and v2 Table 0396
    mnemonic → canonical URI (FHIR-core-fixed systems only; full THO crosswalk deferred to Phase 6).
  - Property + fuzz coverage over the datatype boundary (never-throw, registered value-free issues,
    and an emit gate against `@cosyte/fhir.validateResource`).
- **`@cosyte/hl7` + `@cosyte/fhir` as peer dependencies**, consumed as vendored `pnpm pack` tarballs
  in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008), with `scripts/vendor-refresh.sh`. Pinned
  sibling commits: `@cosyte/hl7` `46d50eb`, `@cosyte/fhir` `7a099b2`. **Third-party runtime deps: 0.**
- Two architecture ADRs (`documentation/decisions/`): `0001` — the transformation tier may depend on
  the parser tier; third-party runtime deps stay zero. `0002` — terminology is a separate
  `@cosyte/terminology` sibling; value translation is BYO-ConceptMap.

### Changed

- **Replaced the parser-template scaffold** with the transformation shape: removed the placeholder
  `parseTransform` / `WARNING_CODES` / `FATAL_CODES` parser stubs and the round-trip property test;
  rewrote `docs-content/`, `README`, and this repo's `CLAUDE.md` for the transformation library.

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/cosyte/transform/commits/main

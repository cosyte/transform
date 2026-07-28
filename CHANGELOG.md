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

- **Phase 6 — terminology value translation of coded fields** (roadmap §Phase 6). Coded fields that
  earlier phases carried **structurally** (code preserved, system recognized) are now
  **value-translated** through their IG segment-map `mappedVia` ConceptMaps. Adds a `$translate`-shaped,
  additive, fail-safe engine — `toFhirCodeableConceptVia(cwe, map, ctx?)` — and the license-clean value
  maps it applies, each transcribed and verified **firsthand against the raw published IG ConceptMap
  JSON** (`hl7.fhir.uv.v2mappings`, STU1), down to the nested `TypeInfo → mappedVia` extension rows.
  - **RXR-1 route → `route`/`dosageInstruction.route`** via `table-hl70162-to-v2-0162`
    (`ROUTE_VALUE_MAP`): a 41-code identity group into `v2-0162` plus a 6-code remap into
    `v3-RouteOfAdministration` (`ID→IDINJ`, `IM→IM`, `IV→IVINJ`, `PO→PO`, `SC→SQ`, `TD→TRNSDERM`).
  - **RXR-2 site → `site`/`dosageInstruction.site`** via `table-hl70550-to-v2-0550` (`SITE_VALUE_MAP`):
    the 443-code body-part identity map into `v2-0550`, transcribed verbatim (including the IG's
    as-published `Â` encoding artifacts, preserved for source-fidelity and inert).
  - **SCH-8 appointment type → `appointmentType`** via `table-hl70277-to-v2-0277`
    (`APPOINTMENT_TYPE_VALUE_MAP`).
  - **RXO-9 allow-substitution → `substitution.allowedCodeableConcept`** via `table-hl70161-to-v2-0161`
    (`SUBSTITUTION_VALUE_MAP`, `N`/`G`/`T`), translate-or-withhold — a substitution permission is never
    emitted from an unrecognized code.
  - **OBR-5 priority → `ServiceRequest.priority`** via `table-hl70485-to-request-priority`
    (`SERVICE_REQUEST_PRIORITY_MAP`: `S→stat`, `A→asap`, `R→routine`; every other v2-0485 code — the
    whole `T{S,M,H,D,W,L}<integer>` timing-critical family and `PRN` included — is in the IG's
    `(unmapped)` group → flagged, `priority` left absent).

  **Grounding discipline — no invented targets.** A source code in the IG map's `(unmapped)` group is
  flagged `TRANSFORM_CODE_UNMAPPED` and the raw coding preserved (or the value withheld), never coerced.
  Translation is **additive** (the derived coding is added alongside the preserved raw coding, including
  any CWE.4/5/6 alternate triplet and CWE.7 version) and **bound-table-guarded** — it fires only when the
  field's primary coding is from the source table (CWE.3 absent or naming it); a field declaring a
  _foreign_ coding system is carried structurally + flagged, never asserted as the standard concept. Two
  fields the IG maps into **SNOMED CT** — **RXR-4 method** (`table-hl70165-to-sct`) and **SCH-7 reason**
  (`table-hl70276-to-sct`) — stay structurally carried (BYO ConceptMap): SNOMED is license-encumbered
  and **not bundled** (§5). Two fields the IG ships **no** value ConceptMap for — **TXA-2 document type**
  and **RXA-5 vaccineCode** — are documented as such and left structural, never given an invented
  translation (ADR 0018). Zero encumbered terminology content is bundled. New public surface (additions
  only): `toFhirCodeableConceptVia`, `codeableConceptFromTarget`, `CodedTarget`, `CodedValueMap`,
  `ROUTE_VALUE_MAP`, `SITE_VALUE_MAP`, `APPOINTMENT_TYPE_VALUE_MAP`, `SUBSTITUTION_VALUE_MAP`,
  `SERVICE_REQUEST_PRIORITY_MAP`, and the target-system URI constants. No new issue codes.

- **Phase 5 — the thin IG singles: VXU_V04 → Immunization; SIU_S12 → Appointment; MDM_T02 →
  DocumentReference** (roadmap §Phase 5). `toFhir(msg, opts?)` now assembles the three single-trigger IG
  message families into a FHIR R4 message `Bundle`, alongside the Phase-2 `Patient`/`Encounter`. Every
  segment/field/table/datatype map is grounded firsthand on the published HL7 v2-to-FHIR IG
  (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source. **With Phase 5 the v2→FHIR direction
  is feature-complete for the IG-covered message set.**
  - **VXU_V04: RXA (+ RXR, ORC) → `Immunization`** (IG _Segment RXA/RXR/ORC to Immunization_; per the
    VXU message map each `ORC` creates the Immunization and the `RXA`/`RXR` are incorporated): RXA-5 →
    `vaccineCode`, RXA-3 → `occurrenceDateTime`, RXA-6/7 → `doseQuantity`, RXA-15 → `lotNumber`, RXA-16 →
    `expirationDate`, RXA-18 → `statusReason`, RXA-19 → `reasonCode`, RXA-22/ORC-9 → `recorded`, RXR-1/2
    → `route`/`site`, ORC-2/3 → `identifier` (PLAC/FILL), and `patient`/`encounter` wired to the bundle.
    `status` follows the IG's three conditioned status rows: a delete action (RXA-21 = `D`) → the
    IG-assigned `entered-in-error`, an unvalued RXA-20 → the IG-assigned `completed`, and a valued RXA-20
    → the **`HL70322` → Event Status** ConceptMap (`IMMUNIZATION_STATUS_MAP`); a valued RXA-20 the map has
    no target for is flagged and the Immunization withheld, never guessed. The order-group `OBX`s become
    standalone patient `Observation`s.
  - **SIU_S12: SCH (+ AIS, PID) → `Appointment`** (IG _Segment SCH/AIS/PID to Appointment_ + _Datatype TQ
    to Appointment_): SCH-25 → `status` via the **`HL70278` → AppointmentStatus** ConceptMap
    (`APPOINTMENT_STATUS_MAP`), SCH-1/2 → `identifier`, SCH-8 → `appointmentType`, SCH-7 → `reasonCode`,
    SCH-9/10 → `minutesDuration`, SCH-11 TQ.4/TQ.5 → `start`/`end`, AIS-3 → `serviceType`, and the bundle
    Patient wired as the required `participant`. An IG-unmatched filler status withholds the Appointment;
    the participant's IG-unsourced required `status` is a `data-absent-reason` primitive, never fabricated.
  - **MDM_T02: TXA (+ OBX) → `DocumentReference`** (IG _Segment TXA/OBX to DocumentReference_): TXA-2 →
    `type`, TXA-6 → `date`, TXA-12 → `masterIdentifier`, TXA-16 → `identifier`, TXA-25 → `description`,
    the `OBX` body → `content.attachment` (TX/FT base64-encoded verbatim, RP as a URL), and `subject`
    wired to the Patient. `status` is grounded only for TXA-19 = `AV` → `current` (the IG ships no value
    ConceptMap; `AV` has exactly one faithful `document-reference-status` target); every other
    availability code withholds the resource and TXA-17 → `docStatus` is left absent (no IG value map).
  - Fail-safe throughout: timezone-naked instants (Appointment `start`/`end`, DocumentReference `date`,
    Immunization date fields) are dropped + flagged rather than assigned a fabricated UTC offset; a
    non-mapped VXU/SIU/MDM trigger is segment-assembled + flagged, never invented; every emitted resource
    passes the conservative-emit gate against `@cosyte/fhir` before it ships. New public exports:
    `IMMUNIZATION_STATUS_MAP`, `APPOINTMENT_STATUS_MAP`, `IG_MAPPED_IMMUNIZATION_TRIGGERS`,
    `IG_MAPPED_APPOINTMENT_TRIGGERS`, `IG_MAPPED_DOCUMENT_TRIGGERS`.

- **Phase 4 — ORM_O01 / OML_O21 → ServiceRequest; RXO → MedicationRequest, the order-entry graph**
  (roadmap §Phase 4). `toFhir(msg, opts?)` now assembles order messages into a FHIR R4 message
  `Bundle`: each ORC-anchored order becomes a **`ServiceRequest`** (an `OBR` order detail) or a
  **`MedicationRequest`** (an `RXO` pharmacy detail), alongside the Phase-2 `Patient`/`Encounter`.
  Every segment/field/table map is grounded firsthand on the published HL7 v2-to-FHIR IG
  (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source.
  - **ORC + OBR → `ServiceRequest`** (IG _Segment ORC/OBR to ServiceRequest_; per the ORM_O01/OML_O21
    message maps the `ORC` creates the request and the `OBR` is incorporated into it): ORC-2/3 or
    OBR-2/3 → `identifier` (PLAC/FILL, v2-0203), ORC-1 → `status` via the **`HL70119` → request-status**
    ConceptMap (`REQUEST_STATUS_MAP`, only when ORC-5 is not valued), OBR-4 → `code`, OBR-6 →
    `occurrenceDateTime`, ORC-9 → `authoredOn` (for a `NW` order), OBR-31 → `reasonCode`, and
    `subject`/`encounter` wired to the bundle's Patient/Encounter. `intent` is fixed to the
    `request-intent` code `order` from the order-message context (the IG maps `→ intent` with no value
    table) — a resource-level constant, not a fabricated per-code row.
  - **RXO (+ RXR) → `MedicationRequest`** (IG _Segment RXO/RXR to MedicationRequest_): RXO-1 →
    `medicationCodeableConcept`, RXO-2/3 (+ RXO-4 units) → `dosageInstruction.doseAndRate.doseRange`,
    RXR-1/2/4 → `dosageInstruction.route`/`.site`/`.method`, RXO-11/12 → `dispenseRequest.quantity`,
    RXO-13 → `dispenseRequest.numberOfRepeatsAllowed`, ORC-9 → `authoredOn`. Doses/dispense amounts
    carry the magnitude **precision-exact** and gate units against UCUM (a non-UCUM unit is preserved
    verbatim, `code`/`system` absent + flagged) — never a rescaled magnitude or a fabricated UCUM code.
  - **The fail-safes (never a confident wrong request).** A `ServiceRequest.status` that cannot be
    grounded — an ORC-1 in the IG's HL70119 `(unmapped)` group, or a valued ORC-5 the IG routes through
    an unspecified mapping — is left absent + flagged (`TRANSFORM_CODE_UNMAPPED`) and the required-`status`
    emit gate **withholds** the request rather than guessing. The IG grounds **no** `MedicationRequest`
    status, so it is set to the value-set's own `unknown` (an honest "not known", asserting nothing) +
    flagged (`TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`) — the `request-status` codes the HL70119 table yields
    (`revoked`, …) are **not** valid `medicationrequest-status` codes and are never borrowed. **`RXE` has
    no IG segment map (nor RDE message map) in STU1**, so any `RXE` is flagged (`TRANSFORM_ELEMENT_DROPPED`)
    rather than assembled from a guessed layout, and non-`ORM^O01`/`OML^O21` order families (`OMP`, `OMG`,
    `RDE`, …) are flagged `TRANSFORM_SEGMENT_ASSEMBLED`.
  - New public export: **`REQUEST_STATUS_MAP`** (HL70119 → request-status) and
    **`IG_MAPPED_ORDER_TRIGGERS`**.
- **Phase 3 — ORU^R01 → DiagnosticReport + Observation, the results graph** (roadmap §Phase 3).
  `toFhir(msg, opts?)` now assembles a parsed HL7 v2 **ORU^R01** message into a FHIR R4 message
  `Bundle` carrying a **`DiagnosticReport`** per OBR with its **`Observation`** results, alongside the
  Phase-2 `Patient`/`Encounter`. Every segment/field/table map is grounded firsthand on the published
  HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source.
  - **OBR → `DiagnosticReport`** (IG _Segment OBR to DiagnosticReport_): OBR-2/3 → `identifier`
    (PLAC/FILL, v2-0203), OBR-4 → `code`, OBR-7/8 → `effectiveDateTime`/`effectivePeriod`, OBR-22 →
    `issued` (a zoned `instant` only; a naked/date-only value is dropped + flagged), OBR-24 →
    `category` (v2-0074), OBR-25 → `status` via the `HL70123` → diagnostic-report-status ConceptMap
    (`DIAGNOSTIC_REPORT_STATUS_MAP`), and the OBX children → `result` references.
  - **OBX → `Observation`** (IG _Segment OBX to Observation_): **OBX-2 discriminates OBX-5 →
    `value[x]`** (NM → `valueQuantity`, CWE/CE/CF/CNE/IS → `valueCodeableConcept`, SN → structured
    `valueQuantity`/`valueRange`/`valueRatio`, ST/TX/FT → `valueString`; a type with no first-class
    target preserves the raw value as `valueString` + flags it — never a fabricated `Quantity`), OBX-3
    → `code`, OBX-6 → `valueQuantity` units (UCUM-gated), OBX-7 → `referenceRange.text`, OBX-8 →
    `interpretation` via the `HL70078` ConceptMap (`HL70078_INTERPRETATION_CODES`), OBX-11 → `status`
    via the `HL70085` → observation-status ConceptMap (`OBSERVATION_STATUS_MAP`), OBX-14 →
    `effectiveDateTime`.
  - **The "never a confident wrong result" fail-safes.** A **corrected (`C`) / cancelled (`X`)** result
    is modelled exactly and **never emitted as `final`**; an OBX-11/OBR-25 status the IG map has **no
    target** for leaves `status` absent + flagged (`TRANSFORM_CODE_UNMAPPED`) and the required-`status`
    emit gate **withholds** the resource (`TRANSFORM_RESOURCE_INVALID`) rather than guessing; an
    **unrecognized abnormal flag** is surfaced and dropped, never coerced to normal; a numeric
    magnitude is carried through **precision-exact** (read from the raw OBX-5, not a lossy JS `number`).
  - New public surface: `IG_MAPPED_ORU_TRIGGERS`, `DIAGNOSTIC_REPORT_STATUS_MAP`,
    `OBSERVATION_STATUS_MAP`, `HL70078_INTERPRETATION_CODES`. No new issue codes — the existing
    `TRANSFORM_CODE_UNMAPPED` now also covers a table code with no IG-ConceptMap target (its message was
    generalized accordingly), and `TRANSFORM_ELEMENT_DROPPED` covers a deferred richer `value[x]` type.
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

- **CI-REQUIRED-CHECKS: the build checks now BIND on `main`, and DEPENDABOT-PR-QUEUE: dependencies
  are watched.** Until `PUBLIC-SURFACE-HYGIENE` (#11) this repo had **no ruleset at all**; that
  change created `19914044` requiring exactly one context, `no-internal-refs`. The result is the
  shape worth naming: **a repo can have a ruleset and still not bind its build.** `ci / verify` on
  both matrix legs, `ci / actionlint` and `codeql / analyze` all stayed advisory, so any of them
  could be red and the merge would still land on the branch that publishes. The four contexts are
  now **folded into `19914044`** (renamed `ci-required-checks`) rather than added as a second
  ruleset, deliberately: `ncpdp` is the cautionary case, where a correctly pinned base ruleset sat
  beside two later rulesets that pinned nothing and the repo read as "pinned" because one of its
  rulesets was. One ruleset per repo is one place to audit. Final state, read back live: five
  contexts, each pinned to `integration_id: 15368`; `bypass_actors: []`; `~DEFAULT_BRANCH`; plus
  `deletion` and `non_fast_forward`.
  - **The context names were read off real check runs, on two independent `pull_request` heads**
    (`66715e5b`, head of #11; `460bfcf8`, head of #7), never off a workflow `name:` field. The
    workflow named `Public-surface gate` emits the context `no-internal-refs`, and requiring a name
    nothing emits leaves every PR **pending**, not failing, forever. `scorecard / analysis` and
    `release / release` are excluded because neither has a `pull_request` trigger; the Advanced
    Security `CodeQL` check (app `57789`) is excluded because it reports **alert state**, not
    whether the analysis ran. No workflow here carries a `paths:` filter.
  - **What the ruleset still does not protect, measured rather than asserted.** A required _job_
    gates its _steps_, but the suites that job runs are chosen by the `include` glob in
    `vitest.config.ts`, and the shared `@cosyte/vitest-config` sets no `test.include` of its own, so
    that single line decides. Narrow it and `test/messages/property.test.ts` stops running with the
    job green. Coverage is a thin, incidental backstop: excluding that one file takes
    `src/messages/**` branch coverage from **90.11% to 88.82%**, breaching the `>= 90` gate, so the
    deletion is caught today, by 1.29 points, over the incidental fact that the property run is the
    only thing reaching some branches, and never for the loss of the properties themselves. Banners
    on `ci.yml` and `vitest.config.ts` say so.
  - **The cost, expected and measured.** Requiring a context blocks any open PR that cannot emit it.
    **PR #10 ("Version Packages", head `2996df7`) has zero check runs and reports `BLOCKED`**, and it is
    the structural case, since Changesets opens it as `github-actions[bot]` on the default
    `GITHUB_TOKEN` and GitHub starts no workflow runs for that token's events. The escape (one empty
    commit onto `changeset-release/main`) is written on `release.yml`; a bypass actor is refused.
  - **`.github/dependabot.yml` added** (weekly `npm` + `github-actions`, limit 5, dev-dependency
    group). Zero open Dependabot PRs here meant nothing was looking. Two limits are stated in the
    file rather than left to be discovered: `dependabot_security_updates` reads `disabled` on this
    repo, so an advisory opens no fix PR; and Dependabot resolves neither the `file:vendor/*.tgz`
    specifiers nor a peer dependency's registry move, so **both routes to `@cosyte/hl7` and
    `@cosyte/fhir` are unwatched** and stay a `pnpm vendor:refresh` job by hand. Whether the pnpm
    updater tolerates that `file:` shape at all is recorded as unobserved.
  - **Nothing inside this repo can observe its own ruleset.** Delete it and the suite stays green,
    `verify.sh` stays green, and the docs keep asserting protection. `CLAUDE.md` gained a "Branch
    protection (and the limits of this claim)" section that says so and gives the `gh api` calls,
    including `?includes_parents=true`, because checking one ruleset is how `ncpdp` was missed.
- **PUBLIC-SURFACE-HYGIENE: internal project bookkeeping removed from every surface a consumer
  reads, and a gate added under it.** Founder directive, 2026-07-27: a README, a docs page, an npm
  description, a JSDoc block a consumer's editor renders, and a message their log prints say what
  the software does and what changed, never which internal item, phase or roadmap section produced
  it. Measured on `e6c4531` with the rule set that ships in this change, because a count taken
  against different rules is a different count: **32** violating lines across the public markdown
  surface (`README.md`, `docs-content/intro.md`, `concepts-archetype.md`, `quickstart.md`,
  `guides-overview.md`, `troubleshooting.md`, all of them "Phase N" framing; **zero** item
  identifiers, and zero on the npm metadata) and **54** `src/` doc-comment lines plus **29** blocks
  that matched only once reflowed across their line wraps. The built `dist/index.d.ts` went from
  **45** violating lines to **0**, and `dist/index.d.cts` and the ESM/CJS bundles with it.
  Separately, and **not** found by any rule: one runtime message string, where
  `TRANSFORM_ELEMENT_DROPPED` told a reader an element's conversion was "deferred to a later phase".
  It ends its clause at `phase`, which is the shape the rules deliberately do not cover, so it was a
  reviewer catch. **51** `src/` doc-comment lines carried a roadmap-section citation
  (`(roadmap §4.5)`, `(roadmap §Phase 5)`, or the bare `(§4.7)`) and were cleared by hand; 23 of
  those overlap the 54 counted above, so the union of the two sweeps is 82 lines, not 105. Of the
  51 citations, 20 name the roadmap explicitly and a rule now catches them, 4 read `§Phase N` and
  are caught by the ordinary phase rule, and the remaining **28** are bare section numbers that
  nothing guards; that non-catch is deliberate and its reasoning is recorded in the script. Two `§`
  citations remain in `//` comments, which this convention keeps out of scope.
- **`pnpm check:no-internal-refs` + its own CI workflow now gate that rule.** Four passes over the
  README, `LICENSE`, `docs-content/`, the npm `description`/`keywords`, `src/` doc comments and
  `src/` string literals, each scanned line by line and again paragraph-joined so a violation that
  straddles a line wrap cannot hide. It is `hl7`'s gate ported shape-first, with `ncpdp`'s
  string-literal fourth pass; the prefix list is `hl7`'s character for character, and the three rule
  widenings on top of it (`phases?`, `/` in the ADR separator, `roadmap §N`) are each named in the
  script and pinned by their own self-test. **The gate raises the floor; it does not seal the
  category,** and the script writes down thirteen numbered residuals plus the boundaries stated at
  each pass, rather than implying otherwise. The four worth knowing here: `phase` ending a clause
  ("deferred to a later phase);") is not covered; a bare `(§4.7)` is a deliberate non-catch; a doc
  comment that does not open its own line is invisible to the doc-comment extractor (residual (xi),
  inherited from `hl7`) and a violation split across a template literal's line breaks is invisible
  to the string-literal extractor (stated at that pass, which comes from `ncpdp` rather than `hl7`),
  neither of them reachable on this tree today; and prose about our process stays a reviewer's
  catch. `CHANGELOG.md` is excluded on purpose even though it ships inside the npm
  tarball: this convention names it as one of the places identifiers belong. That contradiction is
  ecosystem-wide and is recorded rather than settled here.
- **Replaced the parser-template scaffold** with the transformation shape: removed the placeholder
  `parseTransform` / `WARNING_CODES` / `FATAL_CODES` parser stubs and the round-trip property test;
  rewrote `docs-content/`, `README`, and this repo's `CLAUDE.md` for the transformation library.

### Deprecated

### Removed

### Fixed

### Security

[Unreleased]: https://github.com/cosyte/transform/commits/main

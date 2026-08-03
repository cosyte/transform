# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).
Versions and publishing are managed with [Changesets](https://github.com/changesets/changesets);
this file is maintained by hand (Changesets handles the version bump and publish only).

## [Unreleased]

The first pre-alpha release (`0.0.1`) will ship the initial public API surface. The package begins
its public history at `0.0.x`, per the cosyte version ladder (`0.0.x` until first alpha).

### Fixed

- **The exported `VERSION` constant said `"0.0.0"` on a package published as `0.0.4`, and the
  documented install smoke test told an installer to print exactly that constant**
  (`VERSION-CONSTANT-DRIFT`). Measured on the released tarball, not inferred from source:
  `npm pack @cosyte/transform@0.0.4` yields a `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`
  and `dist/index.d.cts` that all carry `"0.0.0"`. It is not one bad release: **every** version ever
  published (`0.0.2`, `0.0.3`, `0.0.4`) ships `"0.0.0"`, so the wrong constant is live on the registry today
  and stays wrong there until the next publish. The constant's own doc comment already claimed it
  was "synced with `package.json#version` by the release tooling" while no such step existed: the
  `version` script ran `changeset version` alone, which rewrites `package.json` and nothing else.
  The fix is structural rather than a hand-bump, because a hand-bumped constant goes stale at the
  very next release. `scripts/sync-version.mjs` (ported from `terminology#12`, `67f73db`, the commit
  that added it there) rewrites the declaration from `package.json` and is wired into the `version` script
  immediately after `changeset version`, so the bump and the constant land in the same
  "Version Packages" commit. The drift guard is `test/sanity.test.ts`, which now compares the export
  against `package.json` instead of asserting shape only; it fails on the unfixed tree
  (`expected '0.0.0' to be '0.0.4'`), which is how it was checked for bite. The declaration also
  gains the `: string` annotation the sync script keys on, which stops the published declaration
  files leaking the literal type `"0.0.0"` into consumers' types (they did — both `dist/index.d.ts`,
  which `exports["."].import.types` points at, and `dist/index.d.cts`).
  This is a known repeat class in the suite: `@cosyte/astm@0.0.1` and `@cosyte/terminology@0.0.1`
  shipped the same defect, the latter with the same install-smoke-test amplifier.
- **`docs-content/installation.md` claimed the package was "not yet published to npm"** and that
  both peers were unpublished. The package is on the registry; `@cosyte/hl7` is too. The page now
  says what is actually true and keeps the two halves together, because either half alone misleads:
  the package **is** published **and** it **cannot be installed from npm**, because the
  `@cosyte/fhir` peer is not on the registry. Measured today:
  `npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir` fails with `ERESOLVE`, `Could not resolve
dependency: peer @cosyte/fhir@">=0.0.0" from @cosyte/transform@0.0.4`.
- **The PHI scanner read a symbolic link as clean on BOTH of its enumerating routes, so a link
  under a scan root pointing at a file full of PHI passed the commit gate**
  (`PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES`; port of the graded fix in `terminology#37`, `5f81640`).
  Measured on this repo's own scanner before the fix, over a link under `src/` pointing at a
  name-bearing synthetic payload: all-mode printed `OK — no hits` and exited **0**, and `--staged`
  did too. The walk enumerates `Dirent.isFile()`, which is an lstat answer, so a link is neither a
  file nor a directory and fell out of the loop whatever it pointed at — and a linked _directory_
  took its whole subtree with it. `--staged` reads content with `git show :<path>`, and git stores a
  link as its **target path** under mode `120000` (`git ls-files --stage` read `120000` on it), so
  that route was handed the path text and never the target's bytes.

  **The remedy is to narrow the enumeration and follow nothing it enumerates.** Every entry the scan
  enumerates, and every path named directly, is now **refused** if it is not a regular file (exit 2,
  the existing "could not complete" code) rather than being silently skipped. Following such an entry was rejected on purpose: it would read bytes the
  enumeration does not control (outside the repo, a loop, a device, a FIFO that blocks the gate
  forever), and git does not carry those bytes anyway, so a hit on them would be a claim about
  something no commit contains.

  **The third mode — a named `<path>` — was not blind, and it is fixed in the same pass because the
  invariant has to hold for the whole scanner.** It classified with `statSync`, which
  **dereferences**, so `pnpm phi-scan src/link.ts` read the target's bytes and reported the hits it
  found there, including for a target **outside the repository**. That is never a false clean, which
  is why reading the code does not catch it; it made the scanner's stated rule weaker than one of its
  own routes. It lstats now and refuses through the same closed set. A dangling link is reported as
  the link it is rather than as a missing file, because `existsSync` follows.

  **Stated precisely, because a looser wording of it was measured false twice: `lstat` answers for
  the final path component only.** A named path whose **ancestor** component is a symlink is still
  followed and still read, and so is a plain absolute or `../` argument. Both predate this change and
  neither is narrowed by it; they are listed with the other residuals below rather than closed,
  because closing them means realpath or containment logic, which is a guard growing past the defect
  it fixes. Neither of the two routes that gate a commit — the pre-commit hook and the walk CI runs —
  reaches either.

  **`--diff-filter` now admits `T`, and leaving it out is what made the mode check unreachable on a
  tracked file.** Replacing a tracked regular file with a link is neither an add nor a modify:
  measured here, `git diff --cached --raw --diff-filter=AM` printed **nothing** for that change
  while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T`. Under an `AM` filter the
  record died before any mode could be read and the hook passed a mode-`120000` blob green.
  Admitting `T` also covers the reverse typechange — a tracked link replaced by a real file bearing
  PHI, which is a scan that must happen rather than a refusal. The route reads
  `git diff --cached --raw -z` so the destination mode is visible at all, and a record it cannot
  parse refuses rather than shortening the list silently.

  **A refusal names every offender by its own repo-relative path plus an engine-owned kind token,
  and never the link target.** A target path is working-tree text that can itself carry PHI — a
  target of the shape `<surname>-<given>-<dob>.txt` is the whole reason, written out as a shape
  rather than an example because a diagnostic about a PHI leak is itself a PHI surface. The scope of
  each route is unchanged: the walk still excludes a gitignored entry (so links get no second,
  stricter boundary of their own) and `--staged` still only looks at `test/fixtures/**` and
  `src/**.ts`. This narrows what those scopes admit; it does not widen them. The walk itself has no
  extension scope — it skips regular `*.md` as documentation and takes everything else — so a link at
  `src/leak.json`, and a linked directory, are refused there too.

  **Three residuals are disclosed rather than closed** — the ancestor-component and absolute/`../`
  reads above, plus two inherited from the graded reference and
  re-measured here. `R`/`C` rename and copy records are still not enumerated by `--staged` at all —
  admitting them needs the two-path record shape handled, which is a scope decision of its own; the
  stride desync a stray one would cause refuses rather than mis-parses. That residual is reachable by
  an ordinary action rather than only in principle: `git mv` into a scanned prefix raises `R100`,
  which the filter drops, so the pre-commit hook reports clean over a staged PHI-bearing file — on
  the old scanner and on this one alike. The all-mode walk that CI runs does catch it, so the
  exposure is a local commit or a pushed branch, not a merge. And this scanner has no
  refuse-a-scan-that-observed-nothing rule, so an empty enumeration still reports clean.

- **The `attw` publish gate passed an untyped pack, so a tarball with no type declarations in it
  would have merged and published as green** (`ATTW-FALSE-GREEN-PORT`; port of the graded fix in
  `terminology#28`, `bf153cb`). `@arethetypeswrong/cli@0.18.4` opens `getExitCode()` with
  `if (!analysis.types) return 0`, returning **before the problem list is read at all** — an untyped
  package is a legitimate npm package, so the CLI treats "no types" as a description rather than a
  problem. No `--profile`, `--ignore-rules` or config setting reaches that early return, which is
  why the remedy is a wrapper (`scripts/attw.mjs`, now what the `attw` script runs) and not a
  stricter invocation. The old invocation here was the bare `attw --pack .`, on the default strict
  profile; it was never lenient.

  **Reproduced on this package, on a quiet box, with zero concurrency** — both `rm -rf dist && attw
--pack .` and `pnpm build && rm -f dist/index.d.ts dist/index.d.cts && attw --pack .` print
  "This package does not contain types." and exit **0**. The second is the realistic trigger: `tsup`
  emits the ESM/CJS bundles in one pass and the declarations in a later pass, so **every** build of
  this package has a window where `dist/` holds JS and no `.d.ts`. Polling `dist/` every 5 ms from
  the start of `pnpm build`, that window measured **1,600 ms, 1,646 ms and 2,018 ms** across three
  consecutive builds. Concurrency only widens the window; it is not the defect, and the remedy is
  therefore **not** a lock, a lease or a build queue (umbrella ADR 0015) — the gate is made able to
  report that its own inputs were missing, whatever removed them.

  Two nets, catching different things. A **preflight** that every relative path `package.json`
  promises (`main`, `module`, `types`, `typings`, every string leaf of `exports` — here
  `./dist/index.{cjs,mjs,d.ts,d.cts}`) exists and is non-empty, which is what catches the build
  window and names the missing file. A **post-check** that promotes `attw`'s untyped sentence to a
  failure, which catches what the preflight structurally cannot: declarations present on disk but
  excluded from the tarball by `files`/`.npmignore`. **No instance of that second case is on record
  in this repo.** Because the post-check reads a printed string it is blindable, so `--quiet`,
  `-f/--format` and `--config-path` are refused **by option name, wholesale, not by value**, along
  with a `.attw.json` setting `quiet` or `format` (`readConfig()` applies those after argv). Three
  of those four routes were measured here to restore the exact exit-0; `--config-path` is refused by
  inference, and says so.

  `test/scripts/attw-gate.test.ts` pins both nets against the real binary — including the upstream
  exit-0 itself, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the
  suite instead of letting the net go quietly slack — plus a **negative control** on a well-formed
  package and a check that a real `attw` failure still exits with `attw`'s own status. Reducing the
  wrapper back to the bare CLI reds 10 of its 13 tests.

  **Two limits, stated rather than left to be discovered.** A **complete but stale `dist/`** passes
  both nets; that is not live today only because the verify ladder runs `build` before `attw`. And
  this package's unpublished `@cosyte/fhir` peer (`FHIR-NPM-NAME`, a separate human gate) does not
  change what `--pack .` can see: a good pack reports "No problems found" and exits 0, and does so
  identically with `node_modules/@cosyte/fhir` moved out of the way, so `attw` is not resolving that
  peer either way. Nothing in this entry says a green `attw` speaks to whether a consumer can
  install the peer; it does not.

  No library code, public API, issue code, mapping or transformed value changes.

### Added

- **A brand image at the top of `README.md`.** The page opens with the Cosyte lockup, served as a
  `<picture>` with a light and a dark source so it follows the reader's theme, and carrying alt text
  that describes the mark for anyone reading with images off or a screen reader on. The block is
  copied byte for byte from the `hl7` README, which is the reference the suite mirrors, so the eight
  repos that carry it stay identical rather than drifting into eight hand-typed variants. Nothing
  else on the page moved: the title, the summary blockquote and every code sample are unchanged, and
  no API, issue code, mapping or transformed value differs.
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
  - **The context names were read off real check runs**, never off a workflow `name:` field.
    Provenance stated exactly, because "two heads" is not true of all five: the four build contexts
    were read off **two** independent `pull_request` heads (`66715e5b`, head of #11; `460bfcf8`,
    head of #7); `no-internal-refs` could only be read off `66715e5b`, since `460bfcf8` predates the
    workflow that emits it. All five were then confirmed together on this change's own PR (#12,
    first head `57a62b2`), which read `BLOCKED` until they landed and `CLEAN` after, on that head
    and on every later one. The
    workflow named `Public-surface gate` emits the context `no-internal-refs`, and requiring a name
    nothing emits leaves every PR **pending**, not failing, forever. `scorecard / analysis` and
    `release / release` are excluded because neither has a `pull_request` trigger; the Advanced
    Security `CodeQL` check (app `57789`) is excluded because it reports **alert state**, not
    whether the analysis ran. No workflow here carries a `paths:` filter.
  - **What the ruleset still does not protect, measured rather than asserted.** A required _job_
    gates its _steps_, but the suites that job runs are chosen by the `include` glob in
    `vitest.config.ts`, and the shared `@cosyte/vitest-config` sets no `test.include` of its own, so
    that line decides today. It is not the only lever: the `test`/`test:coverage` script bodies in
    `package.json` are plain `vitest run` invocations, and a path argument or `--exclude` added
    there drops suites without touching the glob. Narrow either and
    `test/messages/property.test.ts` stops running with the job green. Coverage is a thin,
    incidental backstop: excluding that one file takes
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
  - **The changeset for this entry is deliberately not consumer-facing.** None of the above is
    observable by someone installing the package, so its headline names `CodeQL`, `actionlint` and
    `Dependabot`, which the shared `cosyte/.github` release-note renderer classifies as internal-only
    and **drops from the published release body** rather than rewording into it. Verified by running
    that renderer's `collectHeadlines` over this repo's eight pending changesets: seven kept, this
    one dropped. Recorded because the earlier wording said the same thing in words the classifier
    does not know, and would have published it.
  - **Also noted, not fixed here:** three of the five required names
    (`ci / verify (22|24, ubuntu-latest)`, `ci / actionlint`) are produced by the DEFAULT inputs of
    `cosyte/.github/.github/workflows/ci.yml@main`, a different repo on a floating ref. Changing a
    default there strands every PR in every repo pinning this set. Fails closed, ecosystem-wide,
    and written into `CLAUDE.md`.
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

- **The README no longer says this package is unpublished.** It is on npm, and the sentence sat a
  few lines above the page's own `npm install` instructions, so the page contradicted itself and a
  reader had no way to tell which half was current. On the npm page it was worse: the same sentence
  rendered directly beneath npm's own header, which shows the version being served. The replacement
  names no version deliberately. A version written into prose is the part that goes stale, and the
  registry is the only thing that knows which one is current.

### Security

[Unreleased]: https://github.com/cosyte/transform/commits/main

# @cosyte/transform — Project Guide for Claude

## Project

**`@cosyte/transform`** — a developer-focused **HL7 v2 → FHIR R4 transformation** library for
Node.js/TypeScript, published under the Cosyte brand. Open-source (MIT). **Not a parser** — it is the
cosyte **transformation tier**, one layer _above_ the parser suite: a **consumer** that takes an
already-parsed `@cosyte/hl7` message and produces a validated `@cosyte/fhir` model. Grounded on the
official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`, STU Edition 1).

**North star:** a developer parses an `ORU^R01` or `ADT^A01` with `@cosyte/hl7` and gets back valid
FHIR R4 — without reading the v2 spec, without hand-writing a ConceptMap, and **without ever being
handed a confident wrong FHIR value**. The borrowed disciplines (not the parser shape): the
**fail-safe rule** (ambiguity → a typed, value-free diagnostic, never a guessed value), a stable
`OperationOutcome`-shaped diagnostic channel, immutable output, conservative emit validated against
`@cosyte/fhir`. Two architecture ADRs govern the tier: `documentation/decisions/0001` (may depend on
the parser tier; third-party runtime deps stay zero) and `0002` (terminology is a separate
`@cosyte/terminology` sibling; BYO ConceptMap).

## Status

- **Phases 1–6 shipped** (roadmap `operations/roadmaps/transform.md` §Phase 1–6). Pre-alpha `0.0.x`,
  not yet published to npm. Phase 1: the **six safety-critical datatype converters** (`toFhirDateTime`,
  `toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`, `toFhirAddress`, `toFhirQuantity`),
  the **value-free diagnostic channel** (`ISSUE_CODES`/`FATAL_CODES`, `TransformIssue`,
  `toOperationOutcome`), and the minimal **NamingSystem resolver** (`createNamingSystem`). Phase 2: the
  first **message-level assembly** — `toFhir(msg)` turns an HL7 v2 **ADT** message into a FHIR R4
  **message `Bundle`** (MSH→`MessageHeader`, PID→`Patient`, PV1→`Encounter`, NK1→`RelatedPerson`, with
  `urn:uuid:` reference wiring, the HL70001/HL70004 table maps, a segment-assembled fallback for
  non-IG-mapped triggers, and a conservative-emit gate against `@cosyte/fhir.validateResource`). Phase
  3: the **ORU^R01 → DiagnosticReport + Observation** results graph — OBR→`DiagnosticReport` (status via
  HL70123, `DIAGNOSTIC_REPORT_STATUS_MAP`), OBX→`Observation` with **OBX-2 value-type discrimination**
  of OBX-5→`value[x]` (NM→`valueQuantity`, CWE→`valueCodeableConcept`, SN→structured, ST/TX→`valueString`),
  OBX-8→`interpretation` (HL70078, `HL70078_INTERPRETATION_CODES`), OBX-11→`status` (HL70085,
  `OBSERVATION_STATUS_MAP`), with the "never a confident wrong result" fail-safes (a corrected/cancelled
  result never emits as `final`; an unmapped status withholds the resource; a precision-exact magnitude
  read from the raw OBX-5). Every segment→resource and field→element map is grounded firsthand on the
  IG's ConceptMaps and cited. Phases 4–5 added the message-level graphs for **ORM_O01/OML_O21 →
  ServiceRequest** and **RXO → MedicationRequest** (Phase 4) and the thin IG singles **VXU_V04 →
  Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference** (Phase 5). Phase 6: the
  **terminology value-translation** layer — a `$translate`-shaped, additive, fail-safe engine
  (`toFhirCodeableConceptVia`) applying the license-clean IG value ConceptMaps (each transcribed +
  verified **firsthand against the raw IG JSON**) to the previously structural-only coded fields: RXR
  route/site (HL70162 / HL70550), SCH-8 appointment type (HL70277), RXO-9 substitution (HL70161), and
  OBR-5 priority (HL70485, `SERVICE_REQUEST_PRIORITY_MAP`). A code in the IG's `(unmapped)` group is
  flagged, never coerced; SNOMED-target maps (RXR-4 method, SCH-7 reason) stay structural/BYO — no
  SNOMED bundled; and fields with no IG value map (TXA-2, RXA-5) are documented as structural, never
  invented.
- **Consumes two unpublished cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer
  dependencies**, vendored as `pnpm pack` tarballs in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008) — refresh with `pnpm vendor:refresh`. Pinned shas: hl7 `46d50eb`, fhir `7a099b2`. **Third-party
  runtime deps: zero.**
- **Deferred to later phases:** deeper terminology (the full HL7 THO NamingSystem crosswalk beyond the
  shipped value maps, consumer-supplied ConceptMap application), the reverse FHIR→v2 direction (Phase 7),
  and profiles (Phase 8).

## Tech Stack (the shared `@cosyte/*` standard)

This repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files. The source of truth is the meta-repo's `documentation/conventions.md` — this is
a summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`. TypeScript 5.9.x, exact-pinned.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`).
- **Node:** **>= 22** (CI matrix 22 + 24).
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** + unified `typescript-eslint` (type-checked) via
  `@cosyte/eslint-config`; Prettier via `@cosyte/prettier-config`. Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-directory >= 90 gates on
  `src/datatypes`, `src/diagnostics`, `src/terminology` and `src/messages`. Property + fuzz
  (`fast-check`) over **two** boundaries: the datatype boundary
  (`test/datatypes/boundary.property.test.ts`) and the message boundary
  (`test/messages/property.test.ts`): never-throw, only registered value-free issues, no dangling
  `urn:uuid:` reference, and an emit gate (what is produced validates under
  `@cosyte/fhir.validateResource`). **Which suites run is decided by the `include` glob in
  `vitest.config.ts`, and by the `test`/`test:coverage` script bodies in `package.json` that could
  add a path filter of their own.** Both levers are invisible to a branch ruleset. See "Branch
  protection" below for why that matters.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows, plus one repo-local job
  (`no-internal-refs`). **The checks BIND**; see "Branch protection" below.
- **Runtime deps:** **Zero third-party.** `@cosyte/hl7` + `@cosyte/fhir` are peer deps (ADR 0001).
- **License:** MIT.

## Branch protection (and the limits of this claim)

`main` is protected by the repository ruleset **`ci-required-checks`** (id `19914044`,
`source_type: Repository`, `enforcement: active`, conditions `~DEFAULT_BRANCH`, `bypass_actors: []`).
Rules: `deletion`, `non_fast_forward`, `required_status_checks`.

**It did not always bind, and the half-done state is the thing to recognise.** This repo had no
ruleset at all until `PUBLIC-SURFACE-HYGIENE` (#11) created `19914044` requiring exactly one context,
`no-internal-refs`. From that point the repo _had a ruleset_ and still did not gate its build:
`ci / verify`, `ci / actionlint` and `codeql` were all advisory, so any of them could be red and the
merge still landed on `main`, and `main` is the branch that publishes. **Having a ruleset is not the
same as being protected.** `CI-REQUIRED-CHECKS` folded the four build contexts into that same ruleset
rather than adding a second one, deliberately: `ncpdp` is the cautionary case, where a correctly
pinned base ruleset sat beside two later rulesets that pinned nothing, and the repo read as "pinned"
because one of its rulesets was. **One ruleset per repo means one place to audit.**

Required contexts, each pinned to **`integration_id: 15368`** (the `github-actions` app) so that a
commit status of the same name posted by any other actor with write access cannot satisfy it:

| context                                    | emitted by             |
| ------------------------------------------ | ---------------------- |
| `ci / verify (22, ubuntu-latest)`          | `ci.yml`               |
| `ci / verify (24, ubuntu-latest)`          | `ci.yml`               |
| `ci / actionlint`                          | `ci.yml`               |
| `codeql / analyze (javascript-typescript)` | `codeql.yml`           |
| `no-internal-refs`                         | `no-internal-refs.yml` |

These are the names GitHub actually reports, **read off real check runs**, never off a workflow's
`name:` field. Provenance stated exactly, because "two independent heads" is not true of all five:
the four build contexts were read off **two** independent `pull_request` heads, `66715e5b` (head of
#11) and `460bfcf8` (head of #7). `no-internal-refs` could only be read off **one**, `66715e5b`,
because `460bfcf8` predates the workflow that emits it and carries no such check run. All five were
then confirmed together on a third head, `57a62b2` (head of #12, the change that required them).
That distinction is the whole trap: the workflow named `Public-surface gate`
emits the context `no-internal-refs`, and requiring a context nothing emits does not fail a PR, it
leaves it **pending and unmergeable forever**. None of the three workflows that emit these five
contexts (`ci.yml`, `codeql.yml`, `no-internal-refs.yml`) carries a `paths:` filter, so no PR can
skip one.

**What is deliberately NOT required, and why each would be a defect:**

- **`scorecard / analysis`** runs on `push` to `main` and on a schedule, never on `pull_request`.
  Requiring it would strand every PR pending forever.
- **`release / release`** runs on `push` to `main`. It is not a PR gate.
- The **`CodeQL`** check posted by the Advanced Security app (id `57789`) reports **alert state**, not
  whether the analysis ran. `codeql / analyze (javascript-typescript)` already gates that.

**A required job gates all of its steps.** Splitting a step out of `ci / verify` into its own job
silently un-requires it, with no error and no warning. There is a banner on `ci.yml` where someone
would trip it.

**Three of the five names are set upstream, in another repo, on a floating ref.**
`ci / verify (22, ubuntu-latest)`, `ci / verify (24, ubuntu-latest)` and `ci / actionlint` come from
the DEFAULT inputs of `cosyte/.github/.github/workflows/ci.yml@main` (`node-versions`, `os`,
`run-actionlint`). This repo's caller passes none of them. Change a default there and every PR here
strands pending, with nothing in this repo to warn you. It fails closed rather than open, and every
repo pinning this reference set shares it, so it is an ecosystem concern rather than a local one --
but it is the reason the context list is not stable just because this repo is.

**And the gate can leave the job entirely, which is the sharper edge in this repo.** Requiring
`ci / verify` pins that `pnpm test` runs; it does not pin _what_ it runs. The suites are chosen by the
`include` glob in `vitest.config.ts`, and the shared `@cosyte/vitest-config` sets no `test.include` of
its own, so that line decides today. **It is not the only lever:** the `test` and `test:coverage`
script bodies in `package.json` are plain `vitest run` invocations, and adding a path argument or
`--exclude` there drops suites without touching the glob, equally unobserved by the ruleset. The glob
is what currently selects `test/messages/property.test.ts` and
`test/datatypes/boundary.property.test.ts` -- the property and fuzz suites carrying the never-throw,
value-free-diagnostic, reference-resolution and emit-validity claims that are the point of the
fail-safe rule. **Narrow that glob and they stop running with the job still green and the ruleset
still satisfied.** The ruleset does not protect them; it protects the job that happens to run them.
There is a banner on `vitest.config.ts` saying so.

The per-directory coverage gate is a **thin, incidental** backstop and should not be mistaken for a
real one. Measured on `dfc7739`: excluding `test/messages/property.test.ts` alone takes
`src/messages/**` branch coverage from **90.11% to 88.82%**, which breaches the `>= 90` gate, so that
particular deletion is caught today. It is caught by a 1.29-point margin, because the property run
happens to be the only thing reaching some branches -- any example test covering them restores the
margin and the backstop goes quiet. And coverage can never see the loss of the **properties**
themselves, since a trivial test touching the same lines satisfies it identically.

**▶ The cost of requiring a new context, which is real and was measured here.** A PR whose branch
predates a required workflow cannot emit that workflow's context, so it goes `BLOCKED` until it is
rebased or re-run. **PR #10 ("Version Packages", head `2996df7`) has zero check runs and reports
`BLOCKED`** -- and it is the structural case, not a stale branch: Changesets opens that PR as
`github-actions[bot]` with the default `GITHUB_TOKEN`, and GitHub does not start workflow runs for
that token's events. With `bypass_actors: []` nobody can merge past it. The escape is one empty
commit onto `changeset-release/main`; it is written out on `release.yml`.

**▶ Scope of the claim, stated plainly: a ruleset makes a red check BLOCK a merge. It does not make
the check correct, and nothing inside this repository can observe its own ruleset.** Delete the
ruleset and this test suite stays green, `verify.sh` stays green, and this section keeps asserting
protection. It is not verifiable from inside the repo, by `verify.sh`, or by any gate here. Verify it
the only way that works, and check **every** ruleset the call returns:

```bash
gh api 'repos/cosyte/transform/rulesets?includes_parents=true'
gh api repos/cosyte/transform/rulesets/19914044
```

Recorded as **unproven** rather than fine: no fork PR has ever run here, so neither the
first-time-contributor approval gate nor whether `codeql / analyze` can report on a fork token (which
cannot hold `security-events: write`) has been observed.

## Dependency watching

`.github/dependabot.yml` configures weekly `npm` and `github-actions` updates. Before it existed this
repo showed **zero** open Dependabot PRs, which meant nothing was looking, not that nothing was stale.
Two limits are written into that file rather than left to be discovered: automatic **security** update
PRs are a repo setting that currently reads `disabled`, and **Dependabot never resolves a
`file:vendor/*.tgz` specifier**, so the vendored `@cosyte/hl7` and `@cosyte/fhir` tarballs -- the
versions the tests actually exercise -- are unwatched by both the `file:` route and the peer-dep route
and stay a `pnpm vendor:refresh` job by hand.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export — the JSDoc lint rule is an **error** on public
  exports, so this is enforced, not optional.
- Immutable output — produced nodes are `@cosyte/fhir` immutables; input v2 composites are never mutated.
- No `console.*` in library code. Return `{ value, issues }`; never throw on ambiguity.
- Short, testable functions over big mapping blobs.
- **The fail-safe rule (the whole point):** on any ambiguity — a naked timestamp, an unresolvable
  assigning authority, an unmapped code, a non-UCUM unit, a value that would fail R4 validation —
  emit a typed, value-free diagnostic and **refuse to produce a confident wrong FHIR value**. Never
  silently default, pad a truncation, guess a timezone, synthesize an identifier system, or coerce an
  unmapped code to a neighbor.
- **Grounded on the IG, never invented** (umbrella ADR 0018 applied to mappings). Every segment/
  field/datatype/table mapping is verified firsthand against the published HL7 v2-to-FHIR IG's
  ConceptMaps and cited in the source; a mapping the IG has no target for is flagged, not guessed.
- **Value-free diagnostics.** A `TransformIssue` carries a stable code, severity, the v2 location
  (segment/field/component index), and the FHIR path — **never a value**. Messages are static/per-code.
- Stable codes are a public API: `ISSUE_CODES` + `FATAL_CODES` are `key === value`; renaming/removing
  one is a **breaking change**; new codes are additions only.
- Coverage: per-directory >= 90% (lines/branches/functions/statements), enforced by
  `pnpm test:coverage`.

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md` — they bind here too:

1. **Documentation follows code** — a change to the public surface/stack/status isn't done until the
   docs are: this repo's docs content (`README.md`, `docs-content/`), the meta-repo
   `documentation/repos/transform.md` (bump its "last verified" date), and the `ecosystem-map.md`
   status table.
2. **Version + changelog** — a Changeset (`patch` on the `0.0.x` ladder) + a `CHANGELOG.md`
   `[Unreleased]` entry per meaningful change. Renaming a stable warning code is a **breaking change**.
3. **Crew + knowledgebase loop** — if this library's public API or issue codes change, flag/update
   the matching `crew` healthcare skills (`terminology-mapping`, `fhir-resource-design`) + the KB
   product doc.
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
   consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, the JSDoc
   their editor renders, the message text their log prints) says what the software does and what
   changed. Item identifiers (`TRANSFORM-6`), phase and wave language, roadmap section numbers
   (`roadmap §4.5`, `§Phase 6`), ADR numbers, meta-repo paths and "how this got built" commentary
   belong in the changeset, `CHANGELOG.md`, the commit, the PR and the roadmap. It is a
   **translation** at the boundary, not a deletion, and when you strip a label off the front of a
   line, **repair the head**: a fragment reads worse than the text it replaced. Gated by
   `pnpm check:no-internal-refs`. The gate keys on known project prefixes, so **a new programme
   prefix has to be added to it by hand**; and it catches identifiers, not English sentences about
   our process, so the reviewer still owns half the rule.

   **This repo is dense with the colliding shape**, because a v2-to-FHIR mapper's whole vocabulary is
   written `WORD-N`: `MSH-9`, `PID-3`, `PV1-44`, `OBX-5`, `OBR-25`, `RXA-20`, `SCH-8`, `TXA-19`.
   None of those is caught, and the only reason is that their leading token is not on the prefix
   list. **Never re-key the rule on the `WORD-N` shape**, and never "resync" the prefix list with a
   sibling repo's copy without re-reading why this one keeps `SYNTH` and the `HL7-\d{3,4}`
   exclusion. Case sensitivity is load-bearing too: `FHIR-core`, `FHIR-required` and
   `FHIR-core-fixed` are live here and a case-insensitive rule calls every one of them a violation.

   **Three source surfaces, three different answers.** `/** */` doc comments compile into
   `dist/*.d.ts` and render in a consumer's editor, so they are **gated**. String literals reach a
   consumer as diagnostic message text, so they are **gated too**. `//` and plain `/* */` comments
   are **not gated** and identifiers are **welcome** in them, because **the convention says source
   comments are a place identifiers belong**. That is the whole reason. **Do not justify this
   boundary from what reaches `dist/`**: two attempts to do so in a sibling repo were both false.
   Measured here: this repo's tsup config strips `//` comments from the bundles, but `dist` is
   `files[0]`, there is no `.npmignore`, and `dist/*.map` carries every tracked source byte in
   `sourcesContent`, so **everything in `src/` is in the tarball anyway**. The line is not what
   reaches a consumer's disk (all of it does) but what a consumer is **shown**. Two consequences: a
   doc comment is not the place for "which stage added this" framing, and **removing a doc comment
   to satisfy the gate is a regression**, not a fix (JSDoc with `@example` on every public export is
   a hard guardrail above, and neither lint nor coverage will catch its loss). What the gate cannot
   do is read `dist/` itself: `dist/` is untracked build output, so this is a gate on the source of
   the published text, not on the published text.

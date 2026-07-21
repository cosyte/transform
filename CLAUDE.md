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

- **Phases 1–2 shipped** (roadmap `operations/roadmaps/transform.md` §Phase 1–2). Pre-alpha `0.0.x`,
  not yet published to npm. Phase 1: the **six safety-critical datatype converters** (`toFhirDateTime`,
  `toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`, `toFhirAddress`, `toFhirQuantity`),
  the **value-free diagnostic channel** (`ISSUE_CODES`/`FATAL_CODES`, `TransformIssue`,
  `toOperationOutcome`), and the minimal **NamingSystem resolver** (`createNamingSystem`). Phase 2: the
  first **message-level assembly** — `toFhir(msg)` turns an HL7 v2 **ADT** message into a FHIR R4
  **message `Bundle`** (MSH→`MessageHeader`, PID→`Patient`, PV1→`Encounter`, NK1→`RelatedPerson`, with
  `urn:uuid:` reference wiring, the HL70001/HL70004 table maps, a segment-assembled fallback for
  non-IG-mapped triggers, and a conservative-emit gate against `@cosyte/fhir.validateResource`). Every
  segment→resource and field→element map is grounded firsthand on the IG's ConceptMaps and cited.
- **Consumes two unpublished cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer
  dependencies**, vendored as `pnpm pack` tarballs in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008) — refresh with `pnpm vendor:refresh`. Pinned shas: hl7 `46d50eb`, fhir `7a099b2`. **Third-party
  runtime deps: zero.**
- **Deferred to later phases:** ORU→DiagnosticReport/Observation and abnormal-flag/status semantics
  (Phase 3), orders/medications (Phase 4), VXU/SIU/MDM (Phase 5), full terminology + ConceptMap
  application (Phase 6), the reverse FHIR→v2 direction (Phase 7), and profiles (Phase 8).

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
  `src/datatypes`, `src/diagnostics`, `src/terminology`. Property + fuzz over the datatype boundary
  (`fast-check`): never-throw, registered value-free issues, and an emit gate (produced datatypes
  validate under `@cosyte/fhir.validateResource` when embedded in a host resource).
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows.
- **Runtime deps:** **Zero third-party.** `@cosyte/hl7` + `@cosyte/fhir` are peer deps (ADR 0001).
- **License:** MIT.

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

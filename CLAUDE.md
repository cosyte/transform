# @cosyte/transform: Project Guide for Claude

**▶ The long form lives in [`documentation/agent-notes.md`](documentation/agent-notes.md).** Every
trap below is a one-line imperative with a pointer into that file, where the incident, the
measurement and the rationale are written out **verbatim**. Relocated 2026-08-04, not deleted
(umbrella ADR 0023, amendment 2026-08-04). **When a one-liner here and a paragraph there disagree,
the notes are the measurement.** Re-measure before you soften either.

## Project

**`@cosyte/transform`**: a developer-focused **HL7 v2 → FHIR R4 transformation** library for
Node.js/TypeScript, published under the Cosyte brand. Open-source (MIT). **Not a parser.** It is the
cosyte **transformation tier**, one layer _above_ the parser suite: a **consumer** that takes an
already-parsed `@cosyte/hl7` message and produces a validated `@cosyte/fhir` model. Grounded on the
official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`, STU Edition 1).

**North star:** a developer parses an `ORU^R01` or `ADT^A01` with `@cosyte/hl7` and gets back valid
FHIR R4, without reading the v2 spec, without hand-writing a ConceptMap, and **without ever being
handed a confident wrong FHIR value**. The borrowed disciplines (not the parser shape): the
**fail-safe rule** (ambiguity → a typed, value-free diagnostic, never a guessed value), a stable
`OperationOutcome`-shaped diagnostic channel, immutable output, conservative emit validated against
`@cosyte/fhir`. Two architecture ADRs govern the tier: `documentation/decisions/0001` (may depend on
the parser tier; third-party runtime deps stay zero) and `0002` (terminology is a separate
`@cosyte/terminology` sibling; BYO ConceptMap).

**A silently mis-transformed message is the same harm as a mis-parsed one.** Everything below marked
as a trap is clinical-safety content.

## Status

**▶ Moved, unchanged, to [`documentation/status.md`](documentation/status.md). READ IT BEFORE
YOU MAP ANYTHING**: it is the cursor, and it names the resources that are built, the values that
are deliberately never populated, and the claims already flagged stale. The narrative:
`documentation/agent-notes.md#shipped-phase-history-phases-16`,
`documentation/agent-notes.md#the-reverse-direction-and-what-it-does-not-claim` and
`documentation/agent-notes.md#publish-state-and-the-stale-claim-inside-it`.

## Tech Stack (the shared `@cosyte/*` standard)

**▶ Moved, unchanged, to [`documentation/tech-stack.md`](documentation/tech-stack.md).** This
repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files, and the source of truth is the meta-repo's `documentation/conventions.md`.

## Branch protection

**▶ EVERY TRAP HERE, WITH ITS MEASUREMENT AND PROVENANCE:
`documentation/agent-notes.md#branch-protection-and-the-limits-of-this-claim`. Read it before you
touch the ruleset, a required context, or a workflow that emits one**: the one ruleset (`19914044`)
and never a second, contexts pinned to `integration_id: 15368`, names read off real check runs and
not off a workflow's `name:`, what must never be required, the required job that gates only the
steps it still runs, the gate that can leave the job, the thin coverage backstop, the structurally
`BLOCKED` release PR and its escape, and that **nothing here can observe its own ruleset**.

## Dependency watching

Weekly `npm` + `github-actions` via `.github/dependabot.yml`. **Two limits leave a vendored tarball,
the version the tests actually exercise, unwatched on both routes**, so it stays a by-hand
`pnpm vendor:refresh` job, and WHICH sibling: `documentation/agent-notes.md#dependency-watching`.

## Engineering Guardrails

- No `any`. No unjustified `as` casts. Use `unknown` and narrow.
- JSDoc (with `@example`) on every public export: the JSDoc lint rule is an **error** on public
  exports, so this is enforced, not optional.
- Immutable output: produced nodes are `@cosyte/fhir` immutables; input v2 composites are never mutated.
- No `console.*` in library code. Return `{ value, issues }`; never throw on ambiguity.
- Short, testable functions over big mapping blobs.
- **The fail-safe rule (the whole point):** on any ambiguity (a naked timestamp, an unresolvable
  assigning authority, an unmapped code, a non-UCUM unit, a value that would fail R4 validation),
  emit a typed, value-free diagnostic and **refuse to produce a confident wrong FHIR value**. Never
  silently default, pad a truncation, guess a timezone, synthesize an identifier system, or coerce an
  unmapped code to a neighbor.
- **Grounded on the IG, never invented** (umbrella ADR 0018 applied to mappings). Every segment/
  field/datatype/table mapping is verified firsthand against the published HL7 v2-to-FHIR IG's
  ConceptMaps and cited in the source; a mapping the IG has no target for is flagged, not guessed.
- **Value-free diagnostics.** A `TransformIssue` carries a stable code, severity, the v2 location
  (segment/field/component index), and the FHIR path, **never a value**. Messages are static/per-code.
- Stable codes are a public API: `ISSUE_CODES` + `FATAL_CODES` are `key === value`; renaming/removing
  one is a **breaking change**; new codes are additions only.
- Coverage: per-directory >= 90% (lines/branches/functions/statements), enforced by
  `pnpm test:coverage`.

### The `attw` gate

Full narrative, every measurement: `documentation/agent-notes.md#the-attw-guardrail-in-full`.

**▶ The traps moved, unchanged, to
[`documentation/guardrail-attw.md`](documentation/guardrail-attw.md). Read them before you touch
`scripts/attw.mjs`, the publish gate, or either of the two nets the wrapper carries.**

### The PHI scanner

Measurements, the grid, the refuters, and the `--staged` ARGV traps (`--diff-filter` keeps `T`/`U`,
`--no-renames`, STATUS not mode, re-measure the stride):
`documentation/agent-notes.md#the-phi-scanner-guardrail-in-full`. **No counts.**

**▶ The traps moved, unchanged, to
[`documentation/guardrail-phi-scanner.md`](documentation/guardrail-phi-scanner.md). Read them
before you touch `scripts/phi-scan.ts`, its roots, its allow-list or its exit codes.**

### The agent-instruction contract gate

Full narrative, every measurement:
`documentation/agent-notes.md#the-agent-instruction-contract-gate-in-full`.

**▶ The traps moved, unchanged, to
[`documentation/guardrail-agent-notes-gate.md`](documentation/guardrail-agent-notes-gate.md).
Read them before you touch `scripts/check-agent-notes.ts` or either contract file.**

## Standing disciplines (every change)

Mirrors the three disciplines in the meta-repo's `documentation/conventions.md`, and they bind here too:

1. **Documentation follows code**. A change to the public surface/stack/status isn't done until the
   docs are: this repo's docs content (`README.md`, `docs-content/`), the meta-repo
   `documentation/repos/transform.md` (bump its "last verified" date), and the `ecosystem-map.md`
   status table.
2. **Version + changelog**: a Changeset (`patch` on the `0.0.x` ladder) per meaningful change.
   **The changeset summary IS the changelog entry** and `CHANGELOG.md` is generated output above
   `## Released before this file was generated`: `.changeset/config.json` names a `changelog`
   generator, so the release writes the version heading and the entry itself. **Do not hand-edit
   `CHANGELOG.md`**, and do not reintroduce a hand-maintained `[Unreleased]` heading: one stood
   there unrolled for the whole published history of this package, which is how a shipped tarball
   came to describe its own contents as unreleased. **The Prettier pass stays ON here** (no
   `"prettier": false`), derived from this repo having no `.prettierignore` and a `format:check`
   that globs root markdown, **not copied from a sibling**: a sibling whose `.prettierignore` lists
   `*.md` needs it off, and leaving it on there rewrote already-published text. **Re-measure both
   arms if the `version` script changes**: with the pass off, canonical output here rests entirely
   on `CHANGELOG.md` staying inside that script's `prettier --write` argument list.
   `test/scripts/changelog-generation.test.ts` pins all of it. Renaming a stable warning code is a
   **breaking change**.
3. **Crew + knowledgebase loop**: if this library's public API or issue codes change, flag/update
   the matching `crew` healthcare skills (`terminology-mapping`, `fhir-resource-design`) + the KB
   product doc.
4. **No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
   consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, the JSDoc
   their editor renders, the message text their log prints) says what the software does and what
   changed. Item identifiers (`TRANSFORM-6`), phase and wave language, roadmap section numbers, ADR
   numbers, meta-repo paths and "how this got built" commentary belong in the changeset,
   `CHANGELOG.md`, the commit, the PR and the roadmap. It is a **translation** at the boundary, not a
   deletion: when you strip a label off the front of a line, **repair the head**. Gated by
   `pnpm check:no-internal-refs`. Full rationale and every measurement:
   `documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface-in-full`.
   The traps:
   - **The gate keys on known project prefixes**, so a new programme prefix has to be added by hand;
     and it catches identifiers, not English sentences about our process: **the reviewer owns half
     the rule.**
   - **▶ NEVER RE-KEY THE RULE ON THE `WORD-N` SHAPE.** This repo's whole domain vocabulary is
     written that way (`MSH-9`, `PID-3`, `OBX-5`, `OBR-25`, `SCH-8`, `TXA-19`) and none of it is a
     violation. Never "resync" the prefix list with a sibling's copy without re-reading why this one
     keeps `SYNTH` and the `HL7-\d{3,4}` exclusion.
   - **Case sensitivity is load-bearing**: `FHIR-core`, `FHIR-required`, `FHIR-core-fixed` are live
     here, and a case-insensitive rule calls every one of them a violation.
   - **Three source surfaces, three answers:** `/** */` doc comments are **gated** (they render in a
     consumer's editor); string literals are **gated** (they reach a consumer as diagnostic text);
     `//` and `/* */` comments are **not gated and identifiers are welcome in them**, because the
     convention says source comments are a place identifiers belong.
   - **▶ DO NOT JUSTIFY THAT BOUNDARY FROM WHAT REACHES `dist/`**: two attempts to do so in a
     sibling repo were both false. Measured here, `dist/*.map` ships every tracked source byte in
     `sourcesContent`, so **all of `src/` is in the tarball anyway**. The line is what a consumer is
     **shown**, not what lands on their disk.
   - **Removing a doc comment to satisfy the gate is a REGRESSION, not a fix**: JSDoc with
     `@example` on every public export is a hard guardrail above, and neither lint nor coverage will
     catch its loss.
   - The gate cannot read `dist/` (untracked build output): it gates the **source** of the published
     text, not the published text.
5. **No em dash, anywhere** (founder directive, 2026-07-24), **commit messages and the PR title and
   body included**. `pnpm check:no-emdash` gates every tracked file and filename;
   `.github/workflows/no-emdash.yml` also gates the PR title, body and commit range. It landed
   **with** its sweep: a gate before the sweep reds `main`, a sweep before the gate grows it back.
   **Count the bytes in Python, never `grep`** (the container `grep` reads `0` here), and
   **`no-emdash-messages` must never be required** (Dependabot pastes upstream release notes into a
   PR body). Counts, exemptions, traps: `documentation/agent-notes.md#no-em-dash-anywhere`.

# @cosyte/transform — Project Guide for Claude

**▶ The long form lives in [`documentation/agent-notes.md`](documentation/agent-notes.md).** Every
trap below is a one-line imperative with a pointer into that file, where the incident, the
measurement and the rationale are written out **verbatim**. Relocated 2026-08-04, not deleted
(umbrella ADR 0023, amendment 2026-08-04). **When a one-liner here and a paragraph there disagree,
the notes are the measurement.** Re-measure before you soften either.

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

**A silently mis-transformed message is the same harm as a mis-parsed one.** Everything below marked
as a trap is clinical-safety content.

## Status

- **Phases 1–6 shipped** — datatype converters + diagnostic channel, ADT/ORU/ORM-OML/RXO/VXU/SIU/MDM
  message graphs, and the IG value-ConceptMap translation layer. Phases **7 (FHIR→v2)** and
  **8 (profiles)** and deeper terminology are deferred. Full per-phase inventory:
  `documentation/agent-notes.md#shipped-phase-history-phases-16`.
- **Never quote a version here.** This line read "not yet published to npm" for several releases
  after first publish, which is part of why a `VERSION` constant stuck at `"0.0.0"` shipped unnoticed.
  Derive it: `npm view @cosyte/transform version`.
- **▶ PUBLISHED IS NOT INSTALLABLE. `@cosyte/transform` is on the registry and `npm install
  @cosyte/transform` FAILS `E404`**, because its `@cosyte/fhir` peer is absent from the registry: its
  publish is refused with a **persistent, unexplained `E403` on `PUT`**, tracked as `FHIR-NPM-NAME`.
  Both halves travel together or neither is useful.
- **▶ THE "NAME-SIMILARITY" READING IS RETRACTED. DO NOT RENAME ANYTHING** — not the package, not the
  scope, not an export. `FHIR-NPM-NAME` is a label, not a diagnosis; the error never asked for a
  rename. Why: `documentation/agent-notes.md#publish-state-and-the-stale-claim-inside-it`.
- **▶ THIS REPO'S OLDER PUBLISH-STATE WORDING (`npm 404, a human-gated publish`) IS FLAGGED STALE**
  in the umbrella backlog alongside `hl7`, `mllp` and `deid`, and is **not** treated as fact here. It
  is quoted, dated and disputed in the notes — **relocating a disputed claim must not launder it into
  fact.** The misleading half is **`a human-gated publish`**: the registry refuses at policy, and
  **there is no approval button to press.** Same section as above. Derive, never recall:
  `npm view @cosyte/fhir version`. **Visibility and publish state are independent**; never infer one
  from the other.
- **Consumes two cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer dependencies**, vendored
  as `pnpm pack` tarballs in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008) — refresh with
  `pnpm vendor:refresh`. Pinned shas: hl7 `46d50eb`, fhir `7a099b2`. **They are not both unpublished
  — that wording was stale**; `@cosyte/hl7` is on the registry and it is the `fhir` peer alone that
  makes this package uninstallable. **Third-party runtime deps: zero.**

## Tech Stack (the shared `@cosyte/*` standard)

This repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files. The source of truth is the meta-repo's `documentation/conventions.md` — this is
a summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`. TypeScript 5.9.x, exact-pinned.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`). The `attw` script is
  **`scripts/attw.mjs`, not the bare CLI** — see the guardrail below.
- **Node:** **>= 22** (CI matrix 22 + 24).
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** + unified `typescript-eslint` (type-checked) via
  `@cosyte/eslint-config`; Prettier via `@cosyte/prettier-config`. Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-directory >= 90 gates on
  `src/datatypes`, `src/diagnostics`, `src/terminology` and `src/messages`. Property + fuzz
  (`fast-check`) over **two** boundaries: `test/datatypes/boundary.property.test.ts` and
  `test/messages/property.test.ts` — never-throw, only registered value-free issues, no dangling
  `urn:uuid:` reference, and an emit gate against `@cosyte/fhir.validateResource`.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows, plus one repo-local job
  (`no-internal-refs`). **The checks BIND** — ruleset `ci-required-checks`, id `19914044`.
- **Runtime deps:** **Zero third-party.** `@cosyte/hl7` + `@cosyte/fhir` are peer deps (ADR 0001).
- **License:** MIT.

## Branch protection, in one screen

Full section, with every measurement and provenance:
`documentation/agent-notes.md#branch-protection-and-the-limits-of-this-claim`. The traps:

- **Having a ruleset is not the same as being protected.** This repo had one that required a single
  context while `ci / verify`, `ci / actionlint` and `codeql` stayed advisory on the branch that
  publishes.
- **One ruleset per repo means one place to audit.** Fold new contexts into `19914044`; never add a
  second. `ncpdp` is the cautionary case — it read as "pinned" because *one* of its rulesets was.
- **Pin every required context to `integration_id: 15368`**, or any actor with write access can post
  a same-named commit status and satisfy it.
- **▶ Read context names off REAL CHECK RUNS, never off a workflow's `name:` field.** The workflow
  named `Public-surface gate` emits the context `no-internal-refs`. Requiring a context nothing emits
  does not fail a PR — it leaves it **pending and unmergeable forever**.
- **Never require `scorecard / analysis` or `release / release`** (neither runs on `pull_request`;
  requiring them strands every PR), **nor the Advanced-Security `CodeQL` check** (id `57789`) — it
  reports alert state, not that the analysis ran.
- **A required job gates all of its steps.** Splitting a step out of `ci / verify` into its own job
  silently un-requires it, no error and no warning. Banner on `ci.yml`.
- **Three of the five names are set upstream, on a floating ref** (`cosyte/.github@main` defaults).
  Change a default there and every PR here strands pending, with nothing local to warn you.
- **▶ THE GATE CAN LEAVE THE JOB.** Requiring `ci / verify` pins that `pnpm test` runs, not *what* it
  runs: the `include` glob in `vitest.config.ts` **and** the `test`/`test:coverage` script bodies in
  `package.json` both drop suites invisibly to the ruleset — including the property/fuzz suites that
  carry the fail-safe rule. Banner on `vitest.config.ts`.
- **The coverage gate is a thin, incidental backstop, not a real one** — a **1.29-point** margin, and
  it can never see the loss of the *properties* themselves.
- **PR #10 ("Version Packages") is structurally `BLOCKED`, not stale**: Changesets opens it as
  `github-actions[bot]` with the default `GITHUB_TOKEN`, which starts no workflow runs, and
  `bypass_actors: []` means nobody merges past it. Escape: one empty commit onto
  `changeset-release/main`, written out on `release.yml`.
- **▶ NOTHING INSIDE THIS REPOSITORY CAN OBSERVE ITS OWN RULESET.** Delete it and the suite,
  `verify.sh`, and this section all stay green. Verify from outside, and check **every** ruleset
  returned: `gh api 'repos/cosyte/transform/rulesets?includes_parents=true'`.
- **Recorded unproven, not fine:** no fork PR has ever run here.

## Dependency watching

Weekly `npm` + `github-actions` updates via `.github/dependabot.yml`. Two limits, both written into
that file: automatic **security** update PRs are a repo setting currently reading `disabled`, and
**Dependabot never resolves a `file:vendor/*.tgz` specifier** — so the vendored `@cosyte/hl7` and
`@cosyte/fhir` tarballs, the versions the tests actually exercise, are unwatched on both routes and
stay a `pnpm vendor:refresh` job by hand. Why: `documentation/agent-notes.md#dependency-watching`.

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

### The `attw` gate

Full narrative, every measurement: `documentation/agent-notes.md#the-attw-guardrail-in-full`.

- **▶ `attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE
  BARE CLI.** `getExitCode.js` returns 0 before the problem list is read; no `--profile`,
  `--ignore-rules` or config setting reaches that early return. For a package that ships types, that
  sentence means **a broken publish reported as a pass**.
- **The race only supplies the condition** — every `tsup` build has a **~1.6–2.0 s** window with no
  `.d.ts` on disk, reproduced with zero concurrency. **So the answer is not a lock, a lease or a
  build queue:** the gate must be able to say its own inputs were missing, whatever removed them.
- **`scripts/attw.mjs` carries two nets that catch different things** — a path preflight (catches the
  build window and *names* the missing file) and a post-check on the untyped sentence (catches
  declarations on disk but excluded from the tarball). **Do not collapse them into one.**
- **The post-check reads a string, so what would hide that string is refused by option NAME,
  wholesale, not by value** — `--quiet`, `--format`, `--config-path`, and `.attw.json` settings.
  A harmless value is refused anyway; that is the deliberate trade.
- **Do not reduce the wrapper to the bare CLI** — it reds 10 of `test/scripts/attw-gate.test.ts`'s 13
  tests, which is how the suite was checked for bite rather than assumed to have it.
- **A green `attw` has never meant a consumer can install the peer** — measured, `attw` never
  resolves `@cosyte/fhir` at all. And a **complete but stale `dist/`** passes both nets.
- **This is a per-repo script and the prose does NOT port with the code.** Re-measure every number on
  the package you port it to. Derive who still runs the bare CLI:
  `rg -l --glob '**/package.json' '"attw":' /workspace`.

### The PHI scanner

Full narrative, every measurement and both refuter passes:
`documentation/agent-notes.md#the-phi-scanner-guardrail-in-full`.

- **▶ THE CLAIM IS EXACTLY: the scanner refuses (exit 2) every entry it ENUMERATES, and every path
  NAMED DIRECTLY, that is not a regular file.** "It follows nothing" is the looser wording and **two
  separate refuter passes measured it FALSE.** Do not tighten the sentence back up.
- **Do not "fix" the link blindness by following the link** — it reads bytes the enumeration does not
  control (outside the repo, a loop, a device, a blocking FIFO), and git does not carry them anyway.
- **`lstat` answers for the FINAL COMPONENT ONLY.** A named path with a **symlinked ancestor**, or a
  plain absolute/`../` argument, is still followed. **Pre-existing, disclosed, deliberately NOT
  closed.** If you touch `buildTargetsForPaths`, **re-measure the sentence, do not re-assert it**.
- **▶ THE ONE-LETTER TRAP: `--diff-filter` MUST KEEP `T`.** Replacing a tracked file with a link is
  neither an add nor a modify — under `AM` the record dies before any mode is read and a mode-`120000`
  blob passes **green**. Keep `U` too (refused: no stage-0 entry), and keep `--no-renames`, which is
  what makes a staged rename arrive as a single-path `A`. Key on the **STATUS, not the mode**.
- **Adding any argument to that `git diff --cached` ARGV means re-measuring the record stride** —
  `--find-copies-harder` re-enables two-path records even placed *before* `--no-renames`.
- **A refusal never echoes the link target** — that is working-tree text and can itself carry PHI.
  Name the repo-relative path plus a token from the closed `entryKind`/`gitModeKind` sets, nothing
  else. **This applies to the prose too**: write the dangerous target as a *shape*, never an example.
- **The walk has NO extension scope of its own** (it skips regular `*.md` and takes everything else);
  `src/**.ts` is the **`--staged`** route's boundary. **Do not describe the two as one rule.**
- **Exit `2` means every failure to complete; exit `1` means HITS FOUND.** An uncaught throw used to
  land on node's `1`, so a caller read a gate that never ran as one that ran and fired.
- **Three residuals are disclosed, NOT closed** — (1) no refuse-a-scan-that-observed-nothing rule, so
  an empty enumeration reports clean; (2) the ancestor-component / absolute / `../` reads above; (3) a
  scan **root's own path** staged as a non-regular entry is outside the `--staged` route's prefix
  scope (`dicom`'s guard for this did not come across in the port). **Do not silently re-close any,
  and do not let a future edit read as though they were.**
- **Test against throwaway git repos under `os.tmpdir()`** — the scanner roots everything at
  `process.cwd()`, so **never write a link or a violator into this corpus** to test it.
- **The enumerate-then-read race is deliberately still open**, unreachable by scope today — _until a
  walk root widens_, which reintroduces it verbatim.

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
   changed. Item identifiers (`TRANSFORM-6`), phase and wave language, roadmap section numbers, ADR
   numbers, meta-repo paths and "how this got built" commentary belong in the changeset,
   `CHANGELOG.md`, the commit, the PR and the roadmap. It is a **translation** at the boundary, not a
   deletion — when you strip a label off the front of a line, **repair the head**. Gated by
   `pnpm check:no-internal-refs`. Full rationale and every measurement:
   `documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface-in-full`.
   The traps:
   - **The gate keys on known project prefixes**, so a new programme prefix has to be added by hand;
     and it catches identifiers, not English sentences about our process — **the reviewer owns half
     the rule.**
   - **▶ NEVER RE-KEY THE RULE ON THE `WORD-N` SHAPE.** This repo's whole domain vocabulary is
     written that way (`MSH-9`, `PID-3`, `OBX-5`, `OBR-25`, `SCH-8`, `TXA-19`) and none of it is a
     violation. Never "resync" the prefix list with a sibling's copy without re-reading why this one
     keeps `SYNTH` and the `HL7-\d{3,4}` exclusion.
   - **Case sensitivity is load-bearing** — `FHIR-core`, `FHIR-required`, `FHIR-core-fixed` are live
     here, and a case-insensitive rule calls every one of them a violation.
   - **Three source surfaces, three answers:** `/** */` doc comments are **gated** (they render in a
     consumer's editor); string literals are **gated** (they reach a consumer as diagnostic text);
     `//` and `/* */` comments are **not gated and identifiers are welcome in them**, because the
     convention says source comments are a place identifiers belong.
   - **▶ DO NOT JUSTIFY THAT BOUNDARY FROM WHAT REACHES `dist/`** — two attempts to do so in a
     sibling repo were both false. Measured here, `dist/*.map` ships every tracked source byte in
     `sourcesContent`, so **all of `src/` is in the tarball anyway**. The line is what a consumer is
     **shown**, not what lands on their disk.
   - **Removing a doc comment to satisfy the gate is a REGRESSION, not a fix** — JSDoc with
     `@example` on every public export is a hard guardrail above, and neither lint nor coverage will
     catch its loss.
   - The gate cannot read `dist/` (untracked build output): it gates the **source** of the published
     text, not the published text.

# @cosyte/transform

The HL7 v2 to FHIR R4 transformation library: it maps a message parsed by `@cosyte/hl7` to FHIR R4
resources checked with `@cosyte/fhir`, from the HL7 Version 2 to FHIR Implementation Guide (the IG),
with a narrow FHIR to v2 path back. It never parses bytes; we publish it to npm (MIT) with both
siblings as peers and no third-party runtime dependencies.

@AGENTS.md

## Gate

Required: `ci / verify (22, ubuntu-latest)`, `ci / verify (24, ubuntu-latest)`, `ci / actionlint`,
`codeql / analyze (javascript-typescript)`, `no-internal-refs / public-surface` and
`no-emdash / tracked-files`; CI also runs Node 26, `examples`, `standards` and `pr-title`. In order:

```sh
pnpm install --frozen-lockfile
pnpm typecheck && pnpm lint && pnpm format:check && pnpm phi-scan
pnpm test && pnpm test:coverage && pnpm build && pnpm attw
pnpm typecheck:examples && pnpm lint:examples && pnpm examples && pnpm phi-scan:examples
pnpm check:readme && pnpm check:claude-card && pnpm check:agent-notes && pnpm check:catalog
pnpm check:no-emdash && pnpm check:no-internal-refs
```

What they prove: documentation/agent-notes.md#branch-protection-and-the-limits-of-this-claim

## Hazard

This code sits in live patient-data flows: a mapping defect does not crash, it corrupts patient data
or sends it to the wrong patient or system in flight, and the receiver cannot tell. So every mapping
cites the IG row it implements, and anything left ambiguous becomes a typed, value-free diagnostic,
never a guessed value; an absent, flagged element is usually a cited decision, not a gap to fill.

## Rules

- Adding a segment must not change what a message without it produces: an ungated PV1-20 did (#46).
  documentation/agent-notes.md#shipped-phase-history-phases-1-to-6
- FHIR to v2: a v2-required field with no source stays absent and raises
  `TRANSFORM_V2_REQUIRED_FIELD_ABSENT`, never a default; the first cut raised nothing (#38).
  documentation/agent-notes.md#the-reverse-direction-and-what-it-does-not-claim
- Never write a version or publish state by hand; derive it with `npm view`: `VERSION` shipped as
  `"0.0.0"` until #22, and the README called a published package unpublished until #17.
  documentation/agent-notes.md#publish-state-and-the-stale-claim-inside-it
- Never hand-edit `CHANGELOG.md`; the release writes it from `.changeset/`. A hand-kept
  `[Unreleased]` heading shipped published code labelled unreleased until #28.
- `pnpm attw` runs `cosyte-attw`, never the bare `attw` CLI, which exits 0 on a tarball with no
  types (#19). documentation/agent-notes.md#the-attw-guardrail-in-full
- `scripts/phi-scan.ts` refuses, never passes, over a file it did not read: a missing root, a
  symlink and an honored `--allow-fixture` each printed clean (#35, #21, #44).
  documentation/agent-notes.md#the-phi-scanner-guardrail-in-full
- Public text (`README.md`, `docs-content/`, JSDoc, diagnostic strings) carries no item ids, phase
  names, ADR numbers or private paths (#11; `pnpm check:no-internal-refs`).
  documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface-in-full
- Keep `@cosyte/transform` in this title and a pointer here to every `##` of the notes, by hand: a
  copy was once rewritten to name another package (#29), and `pnpm check:agent-notes` checks
  neither. documentation/agent-notes.md#the-agent-instruction-contract-gate-in-full
- Take `@cosyte/hl7` and `@cosyte/fhir` from the registry, never a tarball under `vendor/`: the
  vendored parser sat nine releases behind (#39). documentation/agent-notes.md#dependency-watching
- Count dashes with `pnpm check:no-emdash` or Python over raw bytes, never `grep`, which printed 0
  and cut the first census short (#33). documentation/agent-notes.md#no-em-dash-anywhere

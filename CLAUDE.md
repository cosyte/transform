# @cosyte/transform

The HL7 v2 to FHIR R4 transformation library: it takes a message parsed by `@cosyte/hl7` and
returns FHIR R4 resources validated with `@cosyte/fhir`, mapped from the HL7 Version 2 to FHIR
Implementation Guide (the IG), plus a narrow FHIR to v2 path back. It sits above the parser
libraries and never parses bytes; we publish it to npm (MIT) with both siblings as peers and no
third-party runtime dependencies.

## Gate

From the repo root, in this order: the steps of `.github/workflows/ci.yml` (the shared
`cosyte/.github` ladder, then its examples job), `.github/workflows/no-emdash.yml` and
`.github/workflows/no-internal-refs.yml`.

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
pnpm typecheck:examples
pnpm lint:examples
pnpm examples
pnpm phi-scan:examples
pnpm check:no-emdash
pnpm ci:no-internal-refs
```

`package.json` pins pnpm 10, and scripts and tests call a bare `pnpm`: where the one on PATH is
another major, put corepack's first (`corepack enable --install-directory <dir> pnpm`, then prepend
`<dir>` to PATH). CI also runs checks with no script here: an ESM and a CJS import of the built
`dist/`, actionlint, CodeQL (`.github/workflows/codeql.yml`), and the shared pre-publish job that
packs the tarball and installs it into an empty directory. What the required checks prove and do
not: `documentation/agent-notes.md#branch-protection-and-the-limits-of-this-claim`.

## Hazard

This code sits in live patient-data flows: a mapping defect does not crash, it corrupts patient data
or sends it to the wrong patient or system in flight, and the receiver cannot tell. So every mapping
cites the IG row it implements, and anything left ambiguous becomes a typed, value-free diagnostic,
never a guessed value; an absent, flagged element is usually a cited decision, not a gap to fill.

## Rules, each from a recorded failure linked on its line

- Adding a segment must not change what a message without it produces, bundle or issues: an ungated PV1-20 declaration did during #46, and `test/messages/to-fhir.test.ts` now pins it (documentation/agent-notes.md#shipped-phase-history-phases-16).
- On the FHIR to v2 path, a v2-required field with no source stays absent and raises `TRANSFORM_V2_REQUIRED_FIELD_ABSENT`, never a default: the first cut in #38 returned no issue at all (documentation/agent-notes.md#the-reverse-direction-and-what-it-does-not-claim).
- Never write a version or publish state by hand, in prose or code; derive it with `npm view @cosyte/transform version`: `VERSION` shipped as `"0.0.0"` on every release until #22, and the README called a published package unpublished until #17 (documentation/agent-notes.md#publish-state-and-the-stale-claim-inside-it).
- Never hand-edit `CHANGELOG.md`: the release writes it from each `.changeset/` summary, and a hand-kept `[Unreleased]` heading shipped published code labelled unreleased until #28.
- `pnpm attw` runs `scripts/attw.mjs`; never swap in the bare `attw` CLI, which exits 0 on a tarball that carries no types (#19; documentation/agent-notes.md#the-attw-guardrail-in-full).
- `scripts/phi-scan.ts` must refuse, never pass, when it has not read every file it should: a root that never existed, a symlink and an honored `--allow-fixture` each printed clean over unread files (#35, #21, #44; documentation/agent-notes.md#the-phi-scanner-guardrail-in-full).
- `README.md`, `docs-content/`, JSDoc and diagnostic message strings carry no item IDs, phase names, ADR numbers or private repo paths: #11 swept them off every consumer surface and `pnpm check:no-internal-refs` keeps them off (documentation/agent-notes.md#no-internal-project-bookkeeping-on-a-public-surface-in-full).
- `pnpm check:agent-notes` checks this file against `documentation/agent-notes.md`: keep `@cosyte/transform` in the title above and a pointer here to every `##` section there, since a copy of this file was once rewritten to name another package (#29; documentation/agent-notes.md#the-agent-instruction-contract-gate-in-full).
- Take `@cosyte/hl7` and `@cosyte/fhir` from the registry as devDependencies, never as a tarball under `vendor/`: the vendored parser sat nine releases behind with nothing watching it until #39 (documentation/agent-notes.md#dependency-watching).
- Count dashes with `pnpm check:no-emdash` (em dash only) or Python over raw bytes, never `grep`: `grep` printed nothing for the pattern and the count read 0, which is how the first census came up short (#33; documentation/agent-notes.md#no-em-dash-anywhere).

The `Tech Stack (the shared `@cosyte/*` standard)` section of `CLAUDE.md`, relocated unchanged so the always-read file stays
inside its byte budget. `CLAUDE.md` keeps the heading and points here. Paths are written
relative to the repository root, as they were where this text came from.

## Tech Stack (the shared `@cosyte/*` standard)

This repo inherits the canonical toolchain by depending on the published `@cosyte/*` config packages,
not by copying files. The source of truth is the meta-repo's `documentation/conventions.md`: this is
a summary.

- **Language:** TypeScript (strict, full rigor set incl. `noUncheckedIndexedAccess`) via
  `@cosyte/tsconfig`. **Target ES2023**, `NodeNext`. TypeScript 5.9.x, exact-pinned.
- **Build:** dual ESM + CJS + `.d.ts` via `tsup` (`@cosyte/tsup-config`); `attw` is a publish gate
  (per-condition types: `.d.ts` for `import`, `.d.cts` for `require`). The `attw` script is
  **`scripts/attw.mjs`, not the bare CLI**: see the guardrail below.
- **Node:** **>= 22** (CI matrix 22 + 24).
- **Package manager:** `pnpm@10`.
- **Lint/format:** **ESLint 10** + unified `typescript-eslint` (type-checked) via
  `@cosyte/eslint-config`; Prettier via `@cosyte/prettier-config`. Lint at `--max-warnings=0`.
- **Testing:** **Vitest 4** + v8 coverage (`@cosyte/vitest-config`), per-directory >= 90 gates on
  `src/datatypes`, `src/diagnostics`, `src/terminology` and `src/messages`. Property + fuzz
  (`fast-check`) over **two** boundaries: `test/datatypes/boundary.property.test.ts` and
  `test/messages/property.test.ts`, asserting never-throw, only registered value-free issues, no dangling
  `urn:uuid:` reference, and an emit gate against `@cosyte/fhir.validateResource`.
- **CI/CD:** thin callers of the reusable `cosyte/.github` workflows, plus two repo-local workflows
  (`no-internal-refs`, `no-emdash`). **The checks BIND**: ruleset `ci-required-checks`, id `19914044`.
- **Runtime deps:** **Zero third-party.** `@cosyte/hl7` + `@cosyte/fhir` are peer deps (ADR 0001).
- **License:** MIT.

---
"@cosyte/transform": patch
---

Fix the exported `VERSION` constant lying about the release, and stop it drifting again.

`@cosyte/transform@0.0.4` is on the registry exporting `VERSION === "0.0.0"` — measured on the
released tarball, whose `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts` and `dist/index.d.cts`
all carry `"0.0.0"` — while `docs-content/installation.md` tells an installer to print exactly that constant
as the install smoke test. The `version` script ran `changeset version` alone, which rewrites
`package.json` and nothing else, so the constant never moved off its scaffold value.

The fix is structural, not a hand-bump: `scripts/sync-version.mjs` rewrites the declaration from
`package.json` and runs from the `version` script immediately after `changeset version`, so the bump
and the constant land in the same "Version Packages" commit. `test/sanity.test.ts` now compares the
export against `package.json` rather than asserting shape only, and fails on the unfixed tree. The
declaration gains the `: string` annotation the sync script keys on, which also stops the published
declaration file leaking the literal type `"0.0.0"` into consumers' types.

Also corrects `docs-content/installation.md`, which claimed the package was unpublished. It is
published; what blocks an npm install is the unpublished `@cosyte/fhir` peer, and the page now
carries both facts together.

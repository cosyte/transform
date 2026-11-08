---
"@cosyte/transform": patch
---

The package is now built by tsup 9, through our shared `@cosyte/process` tooling. The JavaScript
and the exported API are unchanged. The type declarations list the type-only exports in their own
`export type { ... }` statement, which the newer build tool writes, and the `VERSION` doc comment
and the source maps name `cosyte-process sync-version` as the step that keeps `VERSION` in step
with `package.json`.

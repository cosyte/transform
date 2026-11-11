---
"@cosyte/transform": patch
---

Importing `@cosyte/transform` no longer loads `node:crypto`. The default `generateId` now reads the
global Web Crypto `randomUUID` (`globalThis.crypto.randomUUID`) when the first id is minted, instead
of importing it from `node:crypto` when the package loads. The ids are the same random version 4
UUIDs as before, and a `generateId` you pass is used exactly as before. Nothing to change in your
code; the public API is unchanged.

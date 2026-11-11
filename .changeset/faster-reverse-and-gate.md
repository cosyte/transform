---
"@cosyte/transform": patch
---

Less work per call, with every output unchanged.

- The FHIR to v2 path (`toV2Observation`, `toV2Patient`) no longer inverts the code-system registry on every call. The default registry is inverted once, and a `codeSystems` object you pass is inverted once and reused for as long as its entries stay the same; change the object's entries and the next call inverts it again, so an answer is never stale. Nothing to change in your code; reusing one options object across calls is now the fastest way to call it.
- The emit gate hands `@cosyte/fhir`'s `validateResource` only the schema of the resource it is checking, or none for a type that has none, instead of every emit schema. The validator reads only the root type's schema, so every gate decision is the same, and it no longer merges fourteen schemas into a new registry for each resource.
- The peer dependencies now ask for `@cosyte/hl7` `^0.1.8` and `@cosyte/fhir` `^0.1.8` (they asked for `^0.1.0`). Those releases parse, validate and serialize faster; over a corpus of 1,205 synthetic inputs, every Bundle, issue and v2 message is the same under them as under 0.1.0. If you pin either package below 0.1.8, your package manager will now warn about the peer range: move it to 0.1.8 or later.

---
"@cosyte/transform": patch
---

`@cosyte/transform` now asks for `@cosyte/hl7` 0.1.12 or later (the peer range is `^0.1.12`, was
`^0.1.8`). That release of `@cosyte/hl7` imports in less than half the time it did, and most of a
cold import of `@cosyte/transform` is its peers loading. If your project pins `@cosyte/hl7` below
0.1.12, raise it; nothing else in your code has to change.

---
"@cosyte/transform": patch
---

Consume `@cosyte/hl7` from the registry at `0.0.10` instead of a vendored tarball at `0.0.1`, and prove by measurement that nothing this package emits moved with it. No emitted FHIR value changes, no diagnostic changes, no issue code is added, renamed or removed, and no mapping is touched: `src/` is byte-for-byte unchanged by this release.

The parser was nine published versions behind, pinned to a `pnpm pack` archive committed into the repository, which meant the version the tests exercised was watched by no dependency route and could only move by hand. It is now a plain devDependency resolved through the lockfile, the archive is deleted, and no copy of the library source remains in the tree. `@cosyte/fhir` is unaffected and stays vendored, for the one reason it always was: the registry does not have it.

Because this package sits in a PHI dataflow and its promise is never a confident wrong FHIR value, a green suite was not accepted as evidence on its own. Every HL7 v2 fixture the repository carries was collected mechanically into a frozen corpus, four synthetic inputs were authored for the malformed, truncated, empty and wrong-version classes, and all of it was transformed once on each side of the bump. The compared surface, meaning the FHIR output plus every diagnostic in emission order, is byte-identical across all 128 members. Both captures are committed beside the record so the comparison can be rerun rather than believed.

Two suites are added and none is removed or relaxed. One asserts the fail-safe rule class by class for malformed input, and sweeps every diagnostic the whole corpus raises to confirm each carries a registry-static message at a positional locator and no field content. The other records, as a call that compiles and runs, two upstream capabilities whose earlier absence shaped this package: an ADT message builder and a typed composite encoder both exist now. Neither is adopted here. The visit-carrying `Patient` plus `Encounter` output stays deferred, and the reverse path keeps building its fields by hand, because a refresh whose whole claim is that nothing moved cannot also change what is emitted.

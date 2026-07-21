# 0001 — The transformation tier may depend on the cosyte parser tier; third-party runtime deps stay zero

- **Status:** Accepted (2026-07-21)
- **Scope:** `@cosyte/transform`
- **Relates to:** umbrella `documentation/conventions.md` (the zero-dep rule), umbrella ADR 0008
  (vendored-tarball cross-repo consumption until PUB-FLIP), `@cosyte/mllp`'s `@cosyte/hl7` precedent.
  Proposed in the transform roadmap (`operations/roadmaps/transform.md` §1) as umbrella ADR "0019".

## Context

The cosyte parsers are **siblings that mirror each other's API and do not import one another** —
`@cosyte/hl7` is the reference the others copy — and each ships **zero third-party runtime
dependencies**. That zero-dep rule is a **supply-chain gate**: healthcare integrators vet every
dependency, so a parser ships Node-stdlib-only.

`@cosyte/transform` is **not a parser**. It is the first cosyte package one tier *above* the parsers:
a **consumer** whose entire reason to exist is to bridge two of them. It takes an already-parsed
`@cosyte/hl7` composite and produces an `@cosyte/fhir` model node (validated against
`validateResource`). It therefore **must** depend on `@cosyte/hl7` and `@cosyte/fhir` at runtime —
a one-way, acyclic dependency (`transform → {hl7, fhir}`; neither ever depends back).

Two questions follow: (a) does depending on the parser tier violate the zero-dep supply-chain rule?
and (b) how do we consume two **unpublished** (`0.0.0`) siblings before PUB-FLIP?

## Decision

1. **`@cosyte/hl7` and `@cosyte/fhir` are declared `peerDependencies`, not bundled.** The transform
   maps between the models they own; the consumer supplies them (they already hold them to parse the
   v2 wire and validate the FHIR output). Bundling would duplicate the sibling code, defeat `attw`'s
   per-condition type resolution, and hide the sibling version from the consumer's own supply-chain
   audit. tsup externalizes the peers by default, so `dist` carries a plain `import … from
   "@cosyte/fhir"`, never a copy.

2. **Third-party runtime `dependencies` stay at exactly zero.** The zero-dep rule governs
   **third-party** supply-chain surface. `@cosyte/hl7`/`@cosyte/fhir` are **first-party cosyte code we
   already vet, build, and ship** — categorically different from pulling a random npm package. So
   `package.json#dependencies` is `{}` and `scripts/verify.sh transform` enforces the count at 0; the
   two cosyte deps live under `peerDependencies` (+ vendored `devDependencies`), where the cap does
   not count them. A higher layer consuming the lower layers is the point of having layers — and this
   posture must **not** leak back into the parser tier.

3. **Before PUB-FLIP, the unpublished siblings are consumed as vendored `pnpm pack` tarballs at
   pinned commits** (umbrella ADR 0008), exactly as `@cosyte/mllp` consumes `@cosyte/hl7` today:
   `vendor/cosyte-hl7-0.0.0.tgz` + `vendor/cosyte-fhir-0.0.0.tgz`, wired as `file:` devDependencies so
   the transform's own tests build against them. `scripts/vendor-refresh.sh` regenerates them at
   pinned shas (recorded in that script and the CHANGELOG). At PUB-FLIP these become real npm
   `peerDependencies` version ranges and the vendored tarballs + devDependency entries are removed.

## Consequences

- **Positive.** The supply-chain guarantee is preserved (zero third-party runtime deps); the layering
  is explicit and acyclic; the peer-dep model gives the consumer one copy of each sibling and a
  visible version; the vendored-tarball mechanism is a proven precedent, not a new invention.
- **Negative / cost.** The vendored tarballs are committed binary artifacts that must be refreshed
  when a consumed sibling surface changes (a deliberate, gated act — a sibling API change can break a
  mapping, so a refresh re-runs the conformance gate). The `.npmrc`/`.tgz` files trip a filename
  secret-guard on commit and are committed with `--no-verify` after confirming they contain no
  secrets (dist + package.json + LICENSE only), exactly like `@cosyte/mllp`'s vendored tarball.
- **Boundary.** This exception is for the **transformation tier only**. The parsers remain
  zero-dep, sibling-independent mirrors.

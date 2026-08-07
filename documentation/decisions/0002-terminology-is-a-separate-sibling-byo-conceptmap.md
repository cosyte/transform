# 0002: Terminology is a separate `@cosyte/terminology` sibling; translation is BYO-ConceptMap

- **Status:** Accepted (2026-07-21)
- **Scope:** `@cosyte/transform`
- **Relates to:** transform roadmap (`operations/roadmaps/transform.md` §5, §10 Q7), umbrella ADR 0018
  (public-cited-only, never invent), `@cosyte/fhir`'s content-free terminology posture.

## Context

Mapping v2 → FHIR needs terminology in two places: **recognizing a coding system** (a v2 Table 0396
mnemonic like `LN`/`SCT` → a canonical URI like `http://loinc.org`) and, eventually, **translating a
value** between code systems (a local `99xxx` code → a SNOMED CT concept). The second is where the
licensing and architecture questions bite:

- **Recognition is structural and license-clean.** The 0396-mnemonic/OID → canonical-URI crosswalk is
  HL7-published (THO `NamingSystem` resources; FHIR core fixes the major URIs). Emitting a URI for a
  recognized identifier ships **no terminology content**.
- **Translation content is encumbered.** **SNOMED CT** (affiliate license) and **CPT** (AMA
  copyright) must **never** be bundled. A site's local-code maps are the site's, not ours.
- **FHIR already isolates terminology as a swappable service** (`$translate`/`$validate-code`/
  `$expand` over a `ConceptMap`), separate from transformation.

The open question (roadmap §10 Q7): does the terminology **machinery** (the NamingSystem resolver,
the `$translate`-shaped ConceptMap engine, the UCUM validator) live inside `transform`, or in its own
package? And whichever way, what do we ship as **content**?

## Decision

1. **The value-translation content posture is BYO-ConceptMap.** `transform` is a **structural
   recognizer + ConceptMap applier**, never a terminology dictionary. It recognizes a v2 coding system
   and emits the canonical URI structurally; for value translation it applies a **consumer-supplied**
   FHIR `ConceptMap`. We ship only **license-clean** maps (HL7's own v2→FHIR tables, THO NamingSystems,
   LOINC/RxNorm-core/ICD-10-CM/UCUM under their terms); the **encumbered** maps (into SNOMED/CPT, or a
   site's local codes) are supplied by the consumer, who holds the licenses. On an unmapped code the
   fail-safe holds: preserved + flagged, never coerced (roadmap §4.3).

2. **The terminology *machinery* is a separate sibling, `@cosyte/terminology`**: a planned package
   that will own the NamingSystem resolver, the `$translate`-shaped ConceptMap engine, and UCUM
   validation, mirroring the FHIR architecture that keeps terminology a swappable service. `transform`
   **consumes** it as a sibling (Phase 6), and **does not build it here.** Whether `@cosyte/terminology`
   becomes its own OSS product line is a **second founder decision** (roadmap §10 Q7), out of scope for
   this repo.

3. **Until that sibling exists, a *minimal* resolver ships inside `transform` behind a stable
   interface, for later extraction.** Phase 1 ships exactly that: `createNamingSystem()` returning a
   `NamingSystemRegistry` (HD → `Identifier.system`, v2 mnemonic → canonical URI) seeded only with the
   FHIR-core-fixed systems and the two unambiguous HD auto-derivations. The full HL7 THO crosswalk and
   the ConceptMap-application engine are deferred to Phase 6 / the sibling. The interface is designed
   so that extraction to `@cosyte/terminology` is a dependency swap, not a rewrite.

## Consequences

- **Positive.** Zero encumbered terminology ships; the license posture matches `@cosyte/fhir`'s
  content-free stance and the parsers' "map the standard, ship our code" discipline; the seam for
  `@cosyte/terminology` is drawn now, so Phase 6 extracts rather than untangles.
- **Negative / cost.** Value-translation quality for restricted/local systems is the consumer's
  ConceptMap, not something `transform` guarantees. A future `@cosyte/terminology` is a likely second
  founder/PUB-FLIP gate. The in-repo resolver is deliberately minimal in Phase 1 and must not grow into
  a de-facto terminology service inside `transform`.

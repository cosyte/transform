The `Status` section of `CLAUDE.md`, relocated unchanged so the always-read file stays
inside its byte budget. `CLAUDE.md` keeps the heading and points here. Paths are written
relative to the repository root, as they were where this text came from.

## Status

- **Phases 1-6 shipped**: datatype converters + diagnostic channel, ADT/ORU/ORM-OML/RXO/VXU/SIU/MDM
  message graphs, and the IG value-ConceptMap translation layer. Full per-phase inventory:
  `documentation/agent-notes.md#shipped-phase-history-phases-16`.
- **`AL1` is now built, `IAM` is still not.** An AL1 in any message becomes an `AllergyIntolerance`
  wired to the bundle Patient, so bundles carry a resource type they did not before and the
  completeness diagnostic no longer flags an AL1 it emits. **▶ `AllergyIntolerance.reaction.severity`
  IS DELIBERATELY NEVER POPULATED** and neither is a `category` the IG's own map has no target for:
  the guide publishes TWO maps over Table 0127 with different unmapped sets, so `MA` yields a type
  and no category and that is the answer, not a gap to fill. Why, and the fixed `clinicalStatus`,
  the alternate-codes extension, the withheld cases and the withdrawn AL1-6:
  `documentation/agent-notes.md#shipped-phase-history-phases-16`.
- **`DG1`, `PR1` and `IN1` are now built too: `Condition`, `Procedure`, `Coverage`, all wired to the
  bundle Patient**, with each Condition referenced back from `Encounter.diagnosis`. **▶
  `Coverage.status` IS NEVER ASSERTED**: the IN1 map publishes no row for it, so it ships
  value-absent with a `data-absent-reason` of `unknown` and a
  `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`, and its emit-schema entry deliberately carries NO required
  binding so that shape satisfies the cardinality. **▶ `Coverage.payor` DECIDES WHETHER THE COVERAGE
  EXISTS**: IN1-4 is its only source, so an unnamed insurer withholds the whole resource, and a named
  one is a `display` with no literal reference because no Organization is built. **▶
  `Procedure.status` IS THE `unknown` THE MAP'S OWN ROW DIRECTS**, never `completed`. `DG1-21`
  grounds exactly one status (`D` to `entered-in-error`) and `Condition.clinicalStatus` has no row at
  all, so a Condition here can fail R4's `con-3`. Every deferred row of the three maps is declared
  with a diagnostic rather than dropped, and the completeness baselines were SUPERSEDED, never
  recaptured. **▶ THE `PV1-20` DECLARATION IS GUARDED ON THE MESSAGE CARRYING AN `IN1`**: it is the
  one declaration sourced from a segment this reading does not otherwise touch, and ungated it added
  an issue to a message carrying none of the three, which must produce exactly what it produced
  before. All of it: `documentation/agent-notes.md#shipped-phase-history-phases-16`.
- **Phase 7 (FHIR→v2) shipped NARROWLY, and the narrowness is the point**: `toV2Patient` and
  `toV2Observation` emit a **complete** v2 message (`ADT^<trigger>` + PID, `ORU^<trigger>` + OBX)
  from the subset of the IG segment maps whose **inverse is one-to-one**. The **trigger is a required
  argument on every entry point** and is never inferred: no FHIR resource carries one.
  **▶ THE IG PUBLISHES NO FHIR-TO-V2 MAP**, so a many-to-one forward row has no usable inverse and is
  refused, never resolved to its most likely source code; and **round-trip is asserted only as
  "parses back", never as "equals"**. **▶ AND ABSENT IS NOT THE SAME AS SILENT**: a v2-REQUIRED field
  the resource gives no source for (PID-3, PID-5, OBX-11) stays absent and RAISES
  `TRANSFORM_V2_REQUIRED_FIELD_ABSENT`, and a conversion that grounds no field at all raises
  `TRANSFORM_NO_V2_MESSAGE_EMITTED` instead of returning an empty success. **The usage cells behind
  those rows are asserted, NOT extracted** (the pass that wrote them had no network egress), so
  re-extract before trusting or widening them. The `Patient` + `Encounter` visit-carrying ADT is
  **deferred, not dropped**, and **▶ THE UPSTREAM REASON FOR THE DEFERRAL IS GONE WHILE THE SHAPE IS
  STILL NOT BUILT**: the parser exported no ADT assembly entry point when it was deferred, and
  `@cosyte/hl7` `0.0.10` exports `buildAdt` (measured by a call that compiles and runs, in
  `test/upstream-capabilities.test.ts`). Nothing else about the deferral changed, so do not read
  "the builder exists" as "the shape is ready": hand-assembling PID + PV1 here would still invert
  the tier split, and the IG grounding is still owed. Every measurement, the refusal set, and the
  deferral: `documentation/agent-notes.md#the-reverse-direction-and-what-it-does-not-claim`; the
  dependency refresh that took the measurement: `documentation/hl7-refresh/record.md`. Phase **8
  (profiles)** and deeper terminology remain deferred.
- **Never quote a version here.** This line read "not yet published to npm" for several releases
  after first publish, which is part of why a `VERSION` constant stuck at `"0.0.0"` shipped unnoticed.
  Derive it: `npm view @cosyte/transform version`.
- **▶ PUBLISHED IS NOT INSTALLABLE.** `@cosyte/transform` is on the registry and
  **`npm install @cosyte/transform` FAILS `E404`**, because its `@cosyte/fhir` peer is absent from
  the registry: that peer's own publish is refused with a **persistent, unexplained `E403` on
  `PUT`**, tracked as `FHIR-NPM-NAME`. Both halves travel together or neither is useful.
- **▶ THE "NAME-SIMILARITY" READING IS RETRACTED. DO NOT RENAME ANYTHING**, not the package, not the
  scope, not an export. `FHIR-NPM-NAME` is a label, not a diagnosis; the error never asked for a
  rename. **And this repo's older wording (`npm 404, a human-gated publish`) IS FLAGGED STALE**: the
  registry refuses at policy and **there is no approval button to press.** It is quoted, dated and
  disputed in the notes; **relocating a disputed claim must not launder it into fact.** Derive,
  never recall: `npm view @cosyte/fhir version`. **Visibility and publish state are independent**;
  never infer one from the other. Why:
  `documentation/agent-notes.md#publish-state-and-the-stale-claim-inside-it`.
- **Consumes two cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer dependencies**, and the
  two are no longer consumed the same way for dev/test. **`@cosyte/hl7` is a plain registry
  devDependency** resolved through `pnpm-lock.yaml`; **▶ DO NOT RE-VENDOR IT**, and do not add
  `vendor/cosyte-hl7-*.tgz` back, because a second copy of that library in this tree is what
  removing it was for. **`@cosyte/fhir` alone stays a vendored `pnpm pack` tarball** in `vendor/`
  (ADR 0001 + umbrella ADR 0008; refresh with `pnpm vendor:refresh`, pinned sha `7a099b2`), for one
  reason and one only: the registry does not have it. **They were never both unpublished, and that
  wording was stale**; it is the `fhir` peer alone that makes this package uninstallable.
  **Third-party runtime deps: zero.**

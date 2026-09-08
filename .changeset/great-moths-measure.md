---
"@cosyte/transform": patch
---

Publish what this library's output conformance actually is, instead of a README sentence that reads
stronger than the check behind it. The guide's seven published v2 test messages are now carried in
the repository, transformed, and every resource of every resulting Bundle is validated against pinned
FHIR R4 4.0.1 definitions and the pinned `hl7.fhir.us.core` 9.0.0 profiles, with the outcome committed
as `documentation/conformance/report.md` and `documentation/conformance/result.json`.

**Nothing about the library's output moved.** No mapping, no emitted value, no issue code and no emit
gate changed, and the package entry point exports exactly what it exported before. This is an
apparatus, so the result it publishes on day one is a measurement of the library as it stands.

**The result, stated plainly: none of the seven messages produces a Bundle with zero error-severity
results** against R4 plus those profiles. Against base R4 4.0.1 alone, six of the seven are clean; the
exception is the `SIU_S12`, whose `Appointment` is `booked` with no start, which R4's own `app-3`
invariant forbids. The profile findings are mostly one shape: US Core requires elements the guide's
segment maps publish no row for, among them `Encounter.type`, `Coverage.relationship`,
`Observation.category` and `DocumentReference.category`, and this library leaves an ungrounded element
absent rather than guessing at it. Every finding is in the report with its element path, the profile
canonical it came from and that profile's version, so a result is reproducible against a pin rather
than against whatever was current.

The README's old claim, that every emitted resource "is validated against `@cosyte/fhir` before it
ships", is gone. What it described is a small internal required-element schema, and the replacement
says so and points at the measurement.

Three things keep the number honest. The published result is checked against a hand-written claims
register on every test run, in BOTH directions: a pair declared conformant that starts failing breaks
the build, and a pair declared non-conformant that stops failing breaks it too, so the register cannot
rot into a list of stale excuses. The report states which classes of check were performed and which
were not, external terminology resolution and mapping correctness among the latter, so it cannot be
read as a full implementation-guide validator's output. And the two definition packages are carried in
the repository and verified by digest at run time, with no network fetch and no fallback: an absent,
unreadable or mismatched package fails the run explicitly rather than reporting a pass, as do an empty
corpus, a zero-document run, and a corpus message that cannot be parsed or transformed.

The corpus fixtures carry their own provenance, including the one line the guide's own page mangles
(an `OBX` whose Base64 component the page emits as markup), which is recorded as published rather than
repaired with invented v2 content.

---
"@cosyte/transform": patch
---

Declare, rather than merely leave, what the reverse (FHIR to v2) direction cannot supply. Two issue codes are added, additions only: no existing `ISSUE_CODES` or `FATAL_CODES` key is renamed or removed, and no emitted segment content changes.

`TRANSFORM_V2_REQUIRED_FIELD_ABSENT` is raised once per v2-required field that ends up absent from an emitted segment because the FHIR resource carried no source this map could ground it from. Until now that absence was silent: a `Patient` with neither `identifier` nor `name` emitted an `ADT` whose `PID` carried neither PID-3 (Patient Identifier List) nor PID-5 (Patient Name), and an `Observation` with no `status` emitted an `ORU` whose `OBX` carried no OBX-11 (Observation Result Status), both with an empty `issues` array. The field is still left absent, exactly as before, because a placeholder written to satisfy v2 structure would be a fabricated clinical value; what changes is that the receiver is no longer the first to find out.

`TRANSFORM_NO_V2_MESSAGE_EMITTED` is raised when a conversion produces no message at all, because nothing in the resource grounded a single field of the target segment. That case previously returned `{ value: undefined, issues: [] }`, which a caller could not tell apart from a successful empty conversion. It is distinct from the refusals that name their own cause (an absent trigger, an unsupported resource type, a structurally malformed resource), each of which still returns its own code.

Both codes carry an `error` severity, a v2 location and a FHIR path, and no value, in keeping with the value-free diagnostic contract. Callers that branch on severity will now see these two, which is the intent: an emitted message missing a v2-required field is not conformant, and the diagnostic channel is where that is said.

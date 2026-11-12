---
id: concepts-archetype
title: How the transform works
sidebar_label: How the transform works
description: "The fail-safe rule, the value-free issue channel, how a message becomes a Bundle, and how the library reports what the Bundle does not carry."
---

# How the transform works

`@cosyte/transform` is not a byte parser: both ends of every conversion are typed models, a parsed
`@cosyte/hl7` message or composite on one side and `@cosyte/fhir` nodes on the other. What shapes
its behavior is one rule about ambiguity, and one channel for reporting it.

## The fail-safe rule

A transformed message drives treatment, filing, and identity matching, so the converters refuse to
guess. On any of these ambiguities:

- a v2 timestamp with a time-of-day but **no timezone** (FHIR forbids time without a zone),
- an assigning authority that cannot be **resolved to a system URI**,
- a code with an **unrecognized or absent coding system**,
- a unit that is not valid **UCUM**,
- a source component with **no FHIR target**,

the converter produces the value it *can* faithfully emit (often reduced in precision) and raises a
typed diagnostic. It never silently defaults, never pads a truncated date, never guesses a timezone,
never synthesizes an identifier system, and never coerces an unmapped code to a plausible neighbor.

## The diagnostic channel is value-free

Every diagnostic is a `TransformIssue`: a stable `code`, a severity, the **v2 location** (a segment /
field / component index, never a value), and the **FHIR path** it concerns. Messages are static and
per-code, so **no value from the message reaches an issue**, and an issue is safe to log. The
property tests thread a marker through every generated field and check that no issue ever carries
it. Render a list of issues as a FHIR `OperationOutcome` with `toOperationOutcome(issues)`.

Codes are `key === value` entries in `ISSUE_CODES` (non-fatal) and `FATAL_CODES`. Consumers branch on
them, so a code's name is part of the public contract: renaming or removing one is a **breaking
change**, and new codes are additions only.

## How a message becomes a Bundle

`toFhir(msg)` returns a FHIR message `Bundle`: a `MessageHeader` first, then the resources the
message describes, each with a `urn:uuid:` `fullUrl`. Every reference between them points at a
`fullUrl` in the same bundle.

- **Message maps and segment maps.** The guide publishes message maps for some triggers (the ADT
  triggers in `IG_MAPPED_ADT_TRIGGERS`, `ORU^R01`, `ORM^O01`, `OML^O21`, `VXU^V04`, `SIU^S12`,
  `MDM^T02`). For any other trigger, the graph is built from the guide's reusable segment maps and
  the bundle carries `TRANSFORM_SEGMENT_ASSEMBLED`, so you can tell the two apart. No message map is
  invented.
- **The emit gate.** Each resource is checked against a small required-element schema before it
  joins the bundle. One that fails is withheld with `TRANSFORM_RESOURCE_INVALID`, and anything that
  would have pointed at it is dropped rather than left dangling. The gate is a floor, not a
  conformance claim; [Conformance](./conformance.md) says what is actually measured.
- **Required elements nobody sent.** When FHIR requires an element and the message gives no faithful
  source for it (`MessageHeader.source.endpoint` from an MSH-3 that is not a URL, `Coverage.status`,
  `MedicationRequest.status`), the element carries a `data-absent-reason` or the code FHIR defines
  for "unknown", with `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`. Read it as unknown.

## What the bundle did not represent

Silence about a segment could mean two very different things: the segment reached the bundle, or
nobody looked. Two codes tell them apart, and one of them is raised for each segment occurrence that
contributed nothing to a resource the returned bundle contains:

| Code | What it tells you | What to do with it |
|---|---|---|
| `TRANSFORM_SEGMENT_NOT_EMITTED` | The IG publishes a segment map for this name, and nothing in the bundle carries what the segment held. | A gap in this library. Ask for it. |
| `TRANSFORM_SEGMENT_NO_IG_MAP` | The IG publishes no segment map for this name, **or** the name could not be classified at all. | A gap in the standard, or a damaged line. Not fixable here. |

Both carry severity `information` and the FHIR issue type `informational`: they are an observation
about the bundle you were handed, never a reason to fail a transform. Neither changes a resource,
a value, or any other issue, and both are appended after every issue the assembly itself raised.

An occurrence counts as having reached a resource only if the assembly took a value or the identity
of it **into a resource that is in the bundle**. Being read and refused is not reaching: an `RXE`
this library counts rather than assembles is reported, and so is a resource the emit gate withheld.
A segment whose values were all dropped by a datatype or terminology step is **not** reported here,
because the resource built from it did reach the bundle.

### Reading the location

The location is the only message-derived thing either code carries, and it comes in exactly two
shapes:

- `NAME[k]` when the segment name passed the HL7 v2 segment-identifier shape (three characters, a
  leading letter). `k` is **1-based among the occurrences of that name**: a message with three `DG1`
  gives you `DG1[1]`, `DG1[2]`, `DG1[3]`, and the index is present even for a first occurrence.
- `[#n]` when it did not. `n` is the 1-based position of the segment among all the segments of the
  message, counting the empty positions a blank line produces so the number matches the line the
  sender wrote. **No part of the name appears**, because a name this library cannot recognize is a
  name it will not reproduce: an unescaped line break inside a narrative field can forge a "segment"
  whose name is clinical text.

**Two index conventions share one issues list.** The locations these two codes carry are 1-based,
as above. The per-occurrence locations on the other codes (`NK1[0]`, `OBX[0]`, on the emit-gate and
dropped-element codes) are **0-based**. If you correlate two issues about the same occurrence, the
same segment is `NK1[0]` on the other code and `NK1[1]` on these.

**A damaged segment identifier reads as a standard gap, and the code therefore means two things.** A
line whose identifier arrived as `AL11` carries a name that could not be classified, so it takes
`TRANSFORM_SEGMENT_NO_IG_MAP` even though what the sender wrote was an IG-mapped `AL1`. That is
forced, not chosen: the name is never re-derived from the line, so a name that cannot be classified
stays unclassified, and a third code would only rename the same ignorance. Read the code as "the IG
publishes no map for this, **or** this name could not be classified", never as a claim about the IG.

The mapped-name set behind the split is transcribed by hand from the HL7 Version 2 to FHIR
Implementation Guide's Segment Maps index at version **1.0.0** (published **2025-10-07**), retrieved
**2026-08-22**, and is exported as `IG_MAPPED_SEGMENT_NAMES` beside `IG_SEGMENT_MAPS_VERSION`,
`IG_SEGMENT_MAPS_PUBLISHED`, `IG_SEGMENT_MAPS_RETRIEVED`, and `IG_SEGMENT_MAPS_SOURCE`, so a later
release of the guide can be told apart from a defect here.

Two limits worth knowing. A flagged segment is still **not** transformed: you learn what is missing,
not what it said. And issue volume is unbounded on purpose, because a summarized answer is one you
cannot act on segment by segment: a message with five thousand segments and nothing emitted returns
five thousand of these.

## Grounded on the IG, never invented

Every mapping is grounded firsthand on the published **HL7 Version 2 to FHIR** Implementation Guide's
datatype and table ConceptMaps (LOINC/SNOMED URIs from the FHIR core terminology systems). Where the
IG has no target for a code (an unmapped Table 0200 name-type, an unmapped Table 0190 address-type),
the value is surfaced, **never guessed**.

## The six datatype converters

The message assembly is built on six converters, each usable on its own: `toFhirDateTime`,
`toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`, `toFhirAddress` and
`toFhirQuantity`. Each returns `{ value, issues }`, where `value` is `undefined` when nothing could
be emitted safely. [Convert a single datatype](./convert-datatypes.md) shows each one and its
fail-safe.

## Immutability

Produced nodes are `@cosyte/fhir` immutable model nodes, and the input v2 composites are never
mutated. A converted value is safe to share across a pipeline without defensive copying.

## Guides that apply this

- [Transform an admission message](./transform-an-admission.md): the rule and the issues, step by
  step.
- [Read, log and return the issues](./handle-issues.md): branch on codes, find unreached segments,
  return an `OperationOutcome`.
- [Resolve assigning authorities](./resolve-assigning-authorities.md) and [Supply a sender timezone for a timestamp with no
  offset](./supply-a-sender-timezone.md): the two refusals you can resolve yourself.
- [Convert a single datatype](./convert-datatypes.md): the six converters.

---
id: concepts-archetype
title: Core concepts
sidebar_position: 1
---

# Core concepts

`@cosyte/transform` borrows the cosyte parser suite's **disciplines**: fail-safe on ambiguity, stable
typed diagnostics, immutable output, without being a byte parser. There is no wire format here; both
endpoints are typed models. What replaces Postel's Law is the **fail-safe rule**.

## The fail-safe rule

A transformed message drives treatment, filing, and identity matching, so the library's whole promise
is: **never emit a confident wrong FHIR value.** On any of these ambiguities:

- a v2 timestamp with a time-of-day but **no timezone** (FHIR forbids time without a zone),
- an assigning authority that can't be **resolved to a system URI**,
- a code with an **unrecognized or absent coding system**,
- a unit that isn't valid **UCUM**,
- a source component with **no FHIR target**,

the converter produces the value it *can* faithfully emit (often reduced in precision) and raises a
typed diagnostic. It never silently defaults, never pads a truncated date, never guesses a timezone,
never synthesizes an identifier system, and never coerces an unmapped code to a plausible neighbor.

## The diagnostic channel is value-free

Every diagnostic is a `TransformIssue`: a stable `code`, a severity, the **v2 location** (a segment /
field / component index, never a value), and the **FHIR path** it concerns. Messages are static and
per-code, so **no patient data can reach a log line**: the same value-free `OperationOutcome`
discipline `@cosyte/fhir` proves. Render a list of issues as a real FHIR `OperationOutcome` with
`toOperationOutcome(issues)`.

Codes are `key === value` entries in `ISSUE_CODES` (non-fatal) and `FATAL_CODES`. Consumers branch on
them, so a code's name is part of the public contract: renaming or removing one is a **breaking
change**, and new codes are additions only.

## What the bundle did not represent

An issues list that says nothing about a segment used to mean one of two very different things: the
segment reached the bundle, or nobody looked. Two codes now tell them apart, and both are raised once
per segment occurrence that contributed nothing to a resource the returned bundle contains:

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
because the resource built from it did reach the bundle and the dropped values have their own codes.

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

**Two index conventions now coexist on one issues list, and this is the one place that says so.**
The locations these two codes emit are 1-based, as above. The per-occurrence locations the library
already emitted elsewhere (`NK1[0]`, `OBX[0]`, on the emit-gate and dropped-element codes) are
**0-based**, and they have not changed. If you correlate two issues about the same occurrence, the
same segment is `NK1[0]` on the older code and `NK1[1]` on these.

**A damaged segment identifier reads as a standard gap, and the code therefore means two things.** A
line whose identifier arrived as `AL11` carries a name that could not be classified, so it takes
`TRANSFORM_SEGMENT_NO_IG_MAP` even though what the sender wrote was an IG-mapped `AL1`. That is
forced, not chosen: the name is never re-derived from the line, so a name that cannot be classified
stays unclassified, and a third code would only rename the same ignorance. Read the code as "the IG
publishes no map for this, **or** this name could not be classified", never as a claim about the IG.

The mapped-name set behind the split is transcribed by hand from the HL7 Version 2 to FHIR
Implementation Guide's Segment Maps index at version **1.0.0** (published **2025-10-07**), retrieved
**2026-08-22**, and is exported as `IG_MAPPED_SEGMENT_NAMES` beside `IG_SEGMENT_MAPS_VERSION`,
`IG_SEGMENT_MAPS_PUBLISHED`, `IG_SEGMENT_MAPS_RETRIEVED` and `IG_SEGMENT_MAPS_SOURCE`, so a later
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

| Converter | v2 → FHIR | Key fail-safe |
|---|---|---|
| `toFhirDateTime` | DTM/TS → `dateTime` | naked timestamp → date precision, never a guessed zone |
| `toFhirIdentifier` | CX → `Identifier` | HD.1-only → value with no system, never synthesized |
| `toFhirCodeableConcept` | CWE/CE → `CodeableConcept` | unmapped code → preserved, never coerced |
| `toFhirHumanName` | XPN → `HumanName` | unmapped name-use → absent, never guessed |
| `toFhirAddress` | XAD → `Address` | unmapped address-type → absent, never guessed |
| `toFhirQuantity` | NM + units → `Quantity` | non-UCUM unit → verbatim, magnitude never converted |

Each returns `{ value, issues }`; each output is designed to pass `@cosyte/fhir`'s `validateResource`
when embedded in a resource: the transform's emit gate.

## Immutability

Produced nodes are `@cosyte/fhir` immutable model nodes, and the input v2 composites are never
mutated. A converted value is safe to share across a pipeline without defensive copying.

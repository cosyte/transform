---
id: concepts-archetype
title: Core concepts
sidebar_position: 1
---

# Core concepts

`@cosyte/transform` borrows the cosyte parser suite's **disciplines** — fail-safe on ambiguity, stable
typed diagnostics, immutable output — without being a byte parser. There is no wire format here; both
endpoints are typed models. What replaces Postel's Law is the **fail-safe rule**.

## The fail-safe rule

A transformed message drives treatment, filing, and identity matching, so the library's whole promise
is: **never emit a confident wrong FHIR value.** On any ambiguity —

- a v2 timestamp with a time-of-day but **no timezone** (FHIR forbids time without a zone),
- an assigning authority that can't be **resolved to a system URI**,
- a code with an **unrecognized or absent coding system**,
- a unit that isn't valid **UCUM**,
- a source component with **no FHIR target** —

the converter produces the value it *can* faithfully emit (often reduced in precision) and raises a
typed diagnostic. It never silently defaults, never pads a truncated date, never guesses a timezone,
never synthesizes an identifier system, and never coerces an unmapped code to a plausible neighbor.

## The diagnostic channel is value-free

Every diagnostic is a `TransformIssue`: a stable `code`, a severity, the **v2 location** (a segment /
field / component index — never a value), and the **FHIR path** it concerns. Messages are static and
per-code, so **no patient data can reach a log line** — the same value-free `OperationOutcome`
discipline `@cosyte/fhir` proves. Render a list of issues as a real FHIR `OperationOutcome` with
`toOperationOutcome(issues)`.

Codes are `key === value` entries in `ISSUE_CODES` (non-fatal) and `FATAL_CODES`. Consumers branch on
them, so a code's name is part of the public contract — renaming or removing one is a **breaking
change**, and new codes are additions only.

## Grounded on the IG, never invented

Every mapping is grounded firsthand on the published **HL7 Version 2 to FHIR** Implementation Guide's
datatype and table ConceptMaps (LOINC/SNOMED URIs from the FHIR core terminology systems). Where the
IG has no target for a code — an unmapped Table 0200 name-type, an unmapped Table 0190 address-type —
the value is surfaced, **never guessed**.

## The six Phase-1 converters

| Converter | v2 → FHIR | Key fail-safe |
|---|---|---|
| `toFhirDateTime` | DTM/TS → `dateTime` | naked timestamp → date precision, never a guessed zone |
| `toFhirIdentifier` | CX → `Identifier` | HD.1-only → value with no system, never synthesized |
| `toFhirCodeableConcept` | CWE/CE → `CodeableConcept` | unmapped code → preserved, never coerced |
| `toFhirHumanName` | XPN → `HumanName` | unmapped name-use → absent, never guessed |
| `toFhirAddress` | XAD → `Address` | unmapped address-type → absent, never guessed |
| `toFhirQuantity` | NM + units → `Quantity` | non-UCUM unit → verbatim, magnitude never converted |

Each returns `{ value, issues }`; each output is designed to pass `@cosyte/fhir`'s `validateResource`
when embedded in a resource — the transform's emit gate.

## Immutability

Produced nodes are `@cosyte/fhir` immutable model nodes, and the input v2 composites are never
mutated. A converted value is safe to share across a pipeline without defensive copying.

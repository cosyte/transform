---
id: conformance
title: "Conformance: measured, not asserted"
sidebar_label: Conformance
description: "What the internal emit gate checks, how far the output conforms to FHIR R4 and US Core, how that is measured, and what the measurement cannot say."
---

# Conformance: measured, not asserted

Two different checks stand behind the FHIR this library returns, and they answer different
questions. This page says what each one is.

## The emit gate: a floor, not a conformance claim

Before `toFhir` adds a resource to the bundle, it runs `validateResource` from `@cosyte/fhir` on it.
A `Patient` is checked in strict mode against the schema `@cosyte/fhir` ships for it. Every other
resource type is checked in lenient mode against a small schema this library wrote for itself,
which names the elements each type requires, so a missing required element withholds the resource
while elements the schema does not model do not. A resource with a structural error is withheld
from the bundle and reported as `TRANSFORM_RESOURCE_INVALID`, and no other entry in the bundle is left pointing at
it.

That gate keeps a resource with a missing required element out of your hands. It is not a
statement that the output conforms to FHIR R4, or to any profile.

## The measurement

How far the output does conform is measured separately, and the result is published in the
repository as
[`documentation/conformance/report.md`](https://github.com/cosyte/transform/blob/main/documentation/conformance/report.md),
with the machine-readable form beside it in `documentation/conformance/result.json`.

- **The input** is the guide's own published v2 test messages, seven of them, carried in the
  repository.
- **The definitions** are `hl7.fhir.r4.core` 4.0.1 and the profiles of `hl7.fhir.us.core` 9.0.0,
  both carried in the repository and checked against a recorded sha256 on every run. Nothing is
  fetched over the network.
- **The checks** cover structure, cardinality, primitive value formats, required bindings that
  expand offline from those packages, profile fixed and pattern values, slicing, and the FHIRPath
  invariants within the engine's subset. Anything the run cannot evaluate is reported as unchecked,
  never counted as a pass.

Today, **none of the seven messages** produces a Bundle with zero error-severity results against R4
plus those profiles. Against the base R4 definitions alone, **six of the seven are clean**; the
exception is `SIU_S12`, whose `Appointment` is `booked` with no start, which R4's own `app-3`
invariant forbids. Most profile findings have one shape: US Core requires an element the guide's
segment maps publish no row for (`Encounter.type`, `Coverage.relationship`,
`Observation.category`, `DocumentReference.category`), and this library leaves an element it
cannot ground absent rather than guess it. The report lists every finding, per message, per
resource, with the element path and the profile it came from.

`pnpm run conformance` regenerates both files, and the test suite fails when the committed result
and a live run disagree, so the numbers on this page and in the report move only with the code.

## What the measurement cannot say

- **Whether the mapping is right.** A clean Bundle is well formed and conforms to the profiles
  named. It does not prove that the right v2 field reached the right FHIR element; no published
  artifact settles that.
- **Anything that needs a terminology server.** Membership in value sets drawn from SNOMED CT,
  LOINC, RxNorm, UCUM or any other externally maintained system is not checked.
- **Whether references resolve across the Bundle.** The report does not check it. The library's
  own property tests check that no `urn:uuid:` reference in a bundle points outside it.
- **Anything about messages unlike the seven.** The corpus is small and comes from the guide.

## Why the gap is left open

The profile findings come from elements US Core requires and the guide gives no v2 source for.
Filling them would mean choosing a value the message never stated, which is the one thing this
library is built not to do. [How the transform works](./concepts-archetype.md) explains that rule.
Where you know the value (your own encounter types, your own observation categories), add it to the
resource after the transform, where the choice is yours and visible.

## Guides that apply this

- [Read, log and return the issues](./handle-issues.md): find a withheld resource
  (`TRANSFORM_RESOURCE_INVALID`) and an element filled with a `data-absent-reason`
  (`TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`).
- [Transform a lab result](./transform-lab-results.md): the ORU graph, whose `Observation.category`
  is one of the elements left absent.

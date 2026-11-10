---
id: intro
title: "@cosyte/transform"
sidebar_label: Overview
description: "What @cosyte/transform maps from HL7 v2 to FHIR R4, who it is for, the fail-safe rule it follows, and what it does not do."
---

# @cosyte/transform

Turn a parsed HL7 v2 message into **FHIR R4**, mapped from the HL7 Version 2 to FHIR Implementation
Guide (the IG, `hl7.fhir.uv.v2mappings`), without hand-writing a ConceptMap.

`@cosyte/transform` is the transformation layer of the Cosyte libraries. It is not a parser: it
takes messages and composites already parsed by
[`@cosyte/hl7`](https://docs.cosyte.com/hl7) and produces
[`@cosyte/fhir`](https://docs.cosyte.com/fhir) model nodes. A narrow path also runs the other
way, from a FHIR `Patient` or `Observation` to a v2 message.

## Who it is for

Developers who receive HL7 v2 feeds (admissions, lab results, orders, immunizations, schedules,
documents) and need FHIR R4 resources from them, and who would rather get a gap reported than a
plausible value invented.

## What it does

- **Six datatype converters**: a v2 timestamp, identifier, coded element, name, address, or number
  with units becomes the matching FHIR datatype.
- **Message assembly** with `toFhir(msg)`: a whole message becomes a FHIR message `Bundle`. ADT
  becomes `Patient` and `Encounter`, with `RelatedPerson`, `AllergyIntolerance`, `Condition`,
  `Procedure` and `Coverage` from NK1, AL1, DG1, PR1 and IN1. ORU^R01 becomes `DiagnosticReport`,
  `Observation` and `Specimen`. ORM_O01 and OML_O21 become `ServiceRequest` and `MedicationRequest`,
  with a TQ1 schedule. VXU_V04 becomes `Immunization`, SIU_S12 `Appointment`, and MDM_T02
  `DocumentReference`.
- **Value translation** of coded fields through the IG's published value ConceptMaps: route and
  site, appointment type, order priority, substitution, and the AL1 allergy tables.
- **A narrow reverse path**: `toV2Patient` and `toV2Observation` emit a v2 message carrying a `PID`
  or an `OBX`. It is lossy by design and never a round trip.

[Mapping scope](./mapping-scope.md) lists what each message family reaches and what it does not.

## The fail-safe rule

A mapping defect does not crash. It produces a FHIR resource that looks valid and says something the
message did not, and the receiver cannot tell. So when a value is ambiguous (a timestamp with no
timezone, an assigning authority with no known system, an unmapped code, a unit that is not UCUM),
the library emits what it can faithfully emit and raises a typed, value-free issue. It never
guesses a timezone, never synthesizes an identifier system, and never coerces a code to a
neighbor. [How the transform works](./concepts-archetype.md) explains the rule and the issue
channel.

## What it is not

- **Not a parser.** Parse with `@cosyte/hl7` or `@cosyte/fhir` first.
- **Not a terminology server.** It carries the IG's published value maps and a small set of code
  system URIs. It bundles no SNOMED CT, LOINC or RxNorm content and converts no units.
- **Not a conformance validator.** Each resource passes a small required-element check this
  library wrote for itself before it joins the bundle. That check is a floor, not a conformance
  claim; [Conformance](./conformance.md) explains how far the output actually conforms and where
  that is measured.
- **R4 only.**

## Status

The 0.1 line, published to npm. While the package is below 1.0, a breaking change ships in a minor
version and is called out in the changelog.

## Next

- [Installation](./installation.md): install the package beside its two peers.
- [Quickstart](./quickstart.md): convert a name, then a whole message.
- [Transform an admission message](./transform-an-admission.md): the tutorial, from a raw message to
  a Bundle and its issues.

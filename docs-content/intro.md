---
id: intro
title: Getting started
sidebar_position: 1
---

# @cosyte/transform

Turn a parsed HL7 v2 message into **valid FHIR R4** — without reading the 900-page v2 spec, without
hand-writing a ConceptMap, and **without ever being handed a confident wrong FHIR value**.

`@cosyte/transform` is the healthcare **transformation** layer of the cosyte suite. Unlike the
parsers, it is a **consumer**: it takes already-parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
composites and produces validated [`@cosyte/fhir`](https://github.com/cosyte/fhir) model nodes,
grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`).

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. This release ships **Phases 1–6** — the
> six safety-critical datatype converters and the value-free diagnostic channel (Phase 1), and
> message-level assembly via `toFhir(msg)` for HL7 v2 **ADT → Patient + Encounter** (Phase 2),
> **ORU^R01 → DiagnosticReport + Observation** (Phase 3), the order-entry graph **ORM_O01 / OML_O21 →
> ServiceRequest** and **RXO → MedicationRequest** (Phase 4), and the thin IG singles **VXU_V04 →
> Immunization**, **SIU_S12 → Appointment**, and **MDM_T02 → DocumentReference** (Phase 5), plus
> **terminology value translation** of coded fields (Phase 6) — route/site, appointment type, order
> priority, and substitution translated through their IG `mappedVia` ConceptMaps. With Phase 5 the
> v2→FHIR direction is feature-complete for the IG-covered message set; deeper terminology, profiles,
> and the reverse direction land in later phases.

## The fail-safe promise

Every conversion is grounded on the IG and is **fail-safe**: an unmapped code, an ambiguous datatype,
a v2 timestamp with no timezone, or an unresolvable assigning authority becomes a **typed, value-free
diagnostic** — never a silent default, never a fabricated value, never a guessed UTC offset.

## Install

```bash
npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir
```

`@cosyte/hl7` and `@cosyte/fhir` are **peer dependencies** — the transform maps between the models
they own, so you install them alongside it.

## Next

- [Quickstart](./quickstart) — convert your first datatypes.
- [Core concepts](./concepts-archetype) — the fail-safe rule and the diagnostic channel.

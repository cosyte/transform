---
id: mapping-scope
title: Mapping scope
sidebar_label: Mapping scope
description: "What each v2 segment and message family becomes in FHIR, which fields reach a resource, and what is left out and how it is reported."
---

# Mapping scope

This page lists what `toFhir` builds from each message family, what the reverse path emits, and what
each one leaves out. Where something is left out, the issue that reports it is named. Every map is
taken from the HL7 Version 2 to FHIR Implementation Guide (the IG); a code or field it gives no
target for is reported, never guessed.

## Segments and resources

| Segment | FHIR resource | Key fields |
| --- | --- | --- |
| MSH | `MessageHeader` | MSH-9 to `eventCoding`; MSH-7 and MSH-10 to `Bundle.timestamp` and `Bundle.identifier` |
| PID | `Patient` | PID-3, PID-5, PID-7, PID-8, PID-11 to `identifier`, `name`, `birthDate`, `gender`, `address` |
| PV1 | `Encounter` | PV1-2 to `class` and `status` (Table 0004); PV1-19, PV1-44, PV1-45 to `identifier` and `period` |
| NK1 | `RelatedPerson` | NK1-2, NK1-3, NK1-4 to `name`, `relationship`, `address` |
| AL1 | `AllergyIntolerance` | AL1-2 to `category` and `type` (two maps); AL1-3, AL1-4, AL1-5 to `code`, `criticality`, `reaction` |
| DG1 | `Condition` | DG1-3, DG1-4 to `code`; DG1-5, DG1-19 to `onsetDateTime`, `recordedDate`; DG1-21 `D` to `verificationStatus` |
| PR1 | `Procedure` | PR1-3, PR1-4 to `code`; PR1-5 and PR1-7 to `performedDateTime` or `performedPeriod`; PR1-6, PR1-15 to `category`, `reasonCode` |
| IN1 | `Coverage` | IN1-2, IN1-15 to `identifier`, `type`; IN1-12, IN1-13 to `period`; IN1-4.1 to `payor.display` |
| OBR (ORU) | `DiagnosticReport` | OBR-4 to `code`; OBR-25 to `status`; OBR-24 to `category` |
| OBX (ORU) | `Observation` | OBX-3 to `code`; OBX-2 and OBX-5 to `value[x]`; OBX-11 to `status`; OBX-8 to `interpretation` |
| SPM (ORU) | `Specimen` | referenced from the report that scopes it |
| ORC with OBR | `ServiceRequest` | ORC-1 to `status` (when ORC-5 is empty); OBR-4 to `code`; OBR-5 to `priority` |
| ORC with RXO, RXR | `MedicationRequest` | RXO-1 to `medicationCodeableConcept`; RXO-2 to RXO-4 to the dose; RXR-1, RXR-2 to route and site |
| TQ1 (orders) | the order's `Timing` | see [Orders and schedules](#orders-and-schedules) |
| RXA, RXR, ORC (VXU) | `Immunization` | RXA-5 to `vaccineCode`; RXA-3 to `occurrenceDateTime`; RXA-20, RXA-21 to `status` |
| SCH, AIS (SIU) | `Appointment` | SCH-25 to `status`; SCH-8 to `appointmentType` |
| TXA, OBX (MDM) | `DocumentReference` | TXA-19 to `status`; TXA-2 to `type`; OBX-5 to `content.attachment` |

[Issue codes](./issue-codes.md) lists every code named below.

## Message families

`toFhir(msg)` assembles ADT into Patient and Encounter, ORU^R01 into DiagnosticReport and
Observation, ORM_O01 and OML_O21 into ServiceRequest, RXO into MedicationRequest, and the single
triggers VXU_V04 into Immunization, SIU_S12 into Appointment, and MDM_T02 into DocumentReference. An
AL1 in any of them becomes an AllergyIntolerance, a DG1 a Condition, a PR1 a Procedure, and an IN1 a
Coverage; a TQ1 in an order becomes that order's schedule. A trigger the IG publishes no message map
for is assembled from the segment maps and flagged `TRANSFORM_SEGMENT_ASSEMBLED`. Terminology depth
and profiles are not implemented.

## Patients and visits

A `Patient` is built from PID-3, PID-5, PID-7, PID-8 and PID-11 only, and from the first repetition
of PID-5 and PID-11. PID-10 race, PID-13 and PID-14 telecom, PID-15 primary language, PID-19 SSN,
PID-22 ethnic group, PID-29 death date and time, PID-30 death indicator, PID-35 species, PID-36
breed, PID-37 strain and PID-38 production class are not mapped: each one that is valued raises a
`TRANSFORM_ELEMENT_DROPPED` whose `v2Location` is that field, such as `PID.14`, `PID.29` or
`PID.35`. A `Patient` from a PID that records a death therefore has no `deceased[x]`, and `issues`
says so; a `Patient` from a veterinary PID has no species or breed, and `issues` says that too. The
four animal fields name no `fhirPath`, because FHIR R4 `Patient` has no element for them. Every other PID field is dropped with no issue. Read those fields from the
parsed message if you need them.

PID-7, PV1-44, PV1-45 and MSH-7 that are valued but could not be read as a date by `@cosyte/hl7`
raise `TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER`, and the element is left out.

## Lab results (ORU)

`DiagnosticReport.category` comes from OBR-24 when it is valued and is never defaulted. The results
graph uses the first PID/PV1 (multiple patient result groups are not handled), and OBR performers,
the OBR-sourced specimen row, and `basedOn` ServiceRequest are deferred. An OBX value type with no
settled FHIR `value[x]` (`RP`, whose extension target the guide itself marks unresolved, and any
type the guide does not map) preserves the raw value as `valueString` and flags it, never a
fabricated typed value. `DR`, `NR`, `TM`, and `NA` reach `valuePeriod`, `valueRange`, `valueTime`,
and `valueSampledData`, and an `ED` whose OBX-5.4 is `Base64` reaches the guide's named
`valueAttachment` extension with its payload carried byte-for-byte, undecoded; each of them still
falls back to the raw text plus a flagged drop when the value cannot be carried faithfully (a `TM`
with a UTC offset, a magnitude FHIR `decimal` cannot hold unaltered, an `ED` under any other
encoding). A `SampledData` never asserts an `origin` or a `period`: the guide sources neither, so
both ship value-absent with a `data-absent-reason` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`. An
`SPM` in an ORU becomes a `Specimen` the scoping `DiagnosticReport` references, withheld with that
report rather than left orphaned, and its `Specimen.status` is never asserted (the guide reaches it
only through a Table 0136 value map this library does not carry). An `NTE` inside the OBSERVATION
group becomes `Observation.note`; the PATIENT-level and ORDER_OBSERVATION-level `NTE` rows have no
published target and reach nothing.

## Orders and schedules

A TQ1 on an order group builds `dosageInstruction.timing` on a MedicationRequest and
`occurrenceTiming` on a ServiceRequest, from TQ1-3's repeat-pattern code (HL70335), period quantity,
period units and event code (the HL70528 rows the guide gives a `v3-TimingEvent` target), plus TQ1-7
/ TQ1-8 as `repeat.boundsPeriod`. TQ2 is not read. TQ1-10 and TQ1-11 reach the two different targets
the guide names on the medication path (`dosageInstruction.additionalInstruction.text` and the
resource's own `text` narrative) and are flagged as dropped on the service path, where the guide
targets an extension and an annotation this library does not build. **A schedule is fully grounded
or absent and flagged**, so the whole `Timing` is withheld with a `TRANSFORM_ELEMENT_DROPPED` or
`TRANSFORM_CODE_UNMAPPED` naming the cause when: a repeat component has no target in the guide
(calendar alignment, either end of the day-of-week range, institution-specified time, event offset,
general timing specification, or a component past the eleven the datatype defines); a code sits
outside its published table, or was sent under a coding system that is not that table (a site's
local `AC` is not asserted to be the published "before meal" concept); a period arrives without its
units, or written with a minus sign (R4's `tim-2` and `tim-5` reject both); a field narrows the
schedule (TQ1-4, TQ1-5, TQ1-6, TQ1-12, TQ1-13, TQ1-14, each needing a rescale, an invented date, or
an unbuilt element); a bound is unusable or inverted; or more than one TQ1 accompanies one order, or
one TQ1-3 carries more than one repeat pattern. A repetition of TQ1-3 that carries no value is not a
second pattern: `Q4H~`, `~Q4H`, and a second repetition the sender explicitly nulled each send one
schedule, and it is read from whichever repetition carries it. TQ1-2 and TQ1-9 are the exception:
they are flagged and the schedule still ships, because the dose and the priority already come from
the RXO/OBR path and are left exactly as they were.

## Allergies

`IAM` is not read (it is reported as `TRANSFORM_SEGMENT_NOT_EMITTED`), and
`AllergyIntolerance.reaction.severity` is never populated: the IG names `criticality` the base
target for AL1-4 and offers `reaction.severity` only as a local variation, conditioned on a severity
that was not used equivalently to criticality, which no v2 message states. So an AL1-4 of `MO` or
`U` leaves `criticality` absent with a `TRANSFORM_CODE_UNMAPPED`, rather than reappearing as a
reaction grading. AL1-2 resolves `category` and `type` against two separate IG maps with different
unmapped sets: `MA` yields a type and no category, `MC` yields neither, and each absence is flagged
on its own. The original AL1-2 / AL1-4 code is always carried in the IG's `alternate-codes`
extension, so an untranslated code is still on the resource. Two conditions withhold the whole
allergy, each with a `TRANSFORM_ELEMENT_DROPPED` naming it: no Patient in the bundle to anchor
`patient`, and an AL1-3 that grounds no allergen code and no allergen text. AL1-6 is read as
`onsetDateTime` only for a message whose version identifier is readable and earlier than 2.7, the
version that withdrew the field; on 2.7 or later, or when the version cannot be read, it is dropped
and flagged.

## Diagnoses, procedures and coverage

A DG1 becomes a Condition, a PR1 a Procedure, and an IN1 a Coverage, each wired to the bundle
Patient; with no Patient in the bundle every one of them is withheld and declared
`TRANSFORM_ELEMENT_DROPPED`, naming the occurrence and the reference it could not anchor.
**`Coverage.status` is never asserted.** No published row of the IN1 map grounds one, and R4's
binding has no neutral member, so the element ships value-absent with a `data-absent-reason` of
`unknown` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`: read it as unknown, never as active coverage.
**`Coverage.payor` names the insurer and resolves to nothing**: IN1-4.1 becomes a reference
`display` with no literal reference, because no Organization resource is built, and an IN1 that
names no insurance company is withheld entirely, since `payor` is required and nothing else grounds
it. `Procedure.status` is the `unknown` the map's own row directs where the message context
determines none; `completed` is never selected from a message that did not say so. A DG1-21 of `D`
sets `verificationStatus` to `entered-in-error`, the one value the map assigns; every other Table
0206 action code leaves the element absent with a `TRANSFORM_CODE_UNMAPPED`. A DG1 that grounds
neither a diagnosis code nor a description still becomes a Condition, with its empty `code` flagged,
so it is visible rather than reading as an intentionally empty one. `Condition.clinicalStatus` is
absent because no row grounds it, which can fail R4's `con-3` invariant under a full profile
validator. **The rows that need a resource this library does not build are declared, never silently
dropped**: `Condition.asserter` (DG1-16), `Procedure.performer.actor` (PR1-8, PR1-11, PR1-12),
`Procedure.location` (PR1-23), `Coverage.payer` (IN1-5), `Coverage.policyHolder` (IN1-10, IN1-11)
and `Coverage.subscriber` (IN1-16) each raise a `TRANSFORM_ELEMENT_DROPPED` when their field is
valued, and so do the rows whose reference resolves by identifier rather than by position (DG1-22,
PR1-25), the CPT modifier concatenation whose target is not an R4 element (PR1-16), and the
relationship whose value translation needs a table this library does not carry (IN1-17). A message
carrying a DG1 raises one more, for the `EpisodeOfCare` its diagnoses are not tied to. **The visit's
financial class (PV1-20) is declared only on an insured message**: the guide routes that field into
the same `Coverage` an IN1 creates, so a message carrying both gets a `TRANSFORM_ELEMENT_DROPPED`
naming it, while a message carrying no DG1, PR1, or IN1 gains nothing at all and produces exactly
the bundle and issue list it produced before.

## Immunizations, appointments and documents

Each family covers the single trigger the IG maps and the resource-internal fields; references to
resources this library does not build yet (Immunization performer/manufacturer/location, Appointment
practitioner/location participants, DocumentReference author/authenticator) are deferred and
flagged, never dangling. `Immunization.status` follows the IG's three conditioned rows (RXA-21 = `D`
→ `entered-in-error`, unvalued RXA-20 → `completed`, else the HL70322 map); a required status the IG
cannot ground withholds the resource (a valued-but-unmapped RXA-20, an IG-unmatched SCH-25, or a
non-`AV` TXA-19). The Appointment patient participant's IG-unsourced required `status` is a
`data-absent-reason` primitive, and the MDM document body is base64-encoded verbatim (the
IG-assigned `application/text` / `text/hl7v2` contentType), carried and never interpreted.

## Value translation

Coded fields with an IG `mappedVia` value ConceptMap are value-translated via
`toFhirCodeableConceptVia`, covering RXR route/site (HL70162/HL70550), SCH-8 appointment type
(HL70277), RXO-9 substitution (HL70161), and the AL1 allergy tables (HL70127 to category and to
type, HL70128 to criticality, plus the two original-code identity maps). Each map is transcribed and
verified firsthand against the raw published IG ConceptMap JSON; a source code the IG leaves in its
`(unmapped)` group is flagged (`TRANSFORM_CODE_UNMAPPED`), never coerced. Two fields the IG maps
into **SNOMED CT** (RXR-4 method, SCH-7 reason) stay structural (SNOMED is not bundled; BYO
ConceptMap), and fields the IG ships no value map for (TXA-2 document type, RXA-5 vaccine code) are
carried as-is. The built-in NamingSystem code-system seed is the FHIR-core-fixed systems; the full
HL7 THO crosswalk beyond these maps is not implemented. OBR-5 priority (HL70485) is translated
during assembly through `SERVICE_REQUEST_PRIORITY_MAP`.

## FHIR to v2

`toV2Patient` emits an `ADT`-shaped message carrying a `PID`, `toV2Observation` an `ORU`-shaped
message carrying an `OBX`. Both require the caller to pass the v2 trigger (no resource carries one,
so it is never inferred: a missing one returns no message and a `TRANSFORM_MISSING_TRIGGER`
diagnostic). The direction is **lossy by design and not a round-trip**: a mapping row whose inverse
is ambiguous is refused (`TRANSFORM_CODE_NOT_INVERTIBLE`), an element with no v2 field in this map
is flagged (`TRANSFORM_NO_V2_TARGET`), and a value v2 cannot carry unchanged is left out
(`TRANSFORM_VALUE_NOT_REPRESENTABLE`). Emitting a `Patient` **and** an `Encounter` together as a
visit-carrying ADT is not implemented.

PID-3 (Patient Identifier List), PID-5 (Patient Name) and OBX-11 (Observation Result Status) are
required fields with no safe default: a resource that carries no source for one leaves it absent,
never a fabricated placeholder, and raises one `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` per field naming
the v2 location and the FHIR path it would have come from. Supply the missing element on the
resource, or repair the message before you send it. If nothing in the resource grounds any field of
the target segment, there is no message to repair: the call returns `value: undefined` and one
`TRANSFORM_NO_V2_MESSAGE_EMITTED`, which is how an empty-handed conversion is told apart from a
successful one.

## Not covered

No terminology content (no SNOMED CT, LOINC or RxNorm content is bundled), no unit conversion, and
R4 only.

## See also

- [How the transform works](./concepts-archetype.md): why a gap is reported instead of filled.
- [Conformance](./conformance.md): what the output reaches against R4 and US Core.

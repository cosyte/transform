---
id: troubleshooting
title: Troubleshooting
sidebar_position: 1
---

# Troubleshooting

Common symptoms when converting v2 → FHIR, and how to read what the transform is telling you.

## A converter returned `value: undefined`

Nothing could be **safely** emitted. This is by design, not an error: it happens for an empty input
composite, an unparseable timestamp, or a numeric value that wasn't numeric. Check `issues` for the
typed reason (e.g. `TRANSFORM_TIMESTAMP_INVALID`).

## A field I expected is missing from the output

A missing FHIR element usually comes with a diagnostic explaining the refusal:

- **`Identifier.system` is absent** → `TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED`: the assigning
  authority wasn't resolvable. Seed it via `createNamingSystem({ authorities: { … } })`. The value is
  never attached to a guessed system.
- **`Coding.system` is absent** → `TRANSFORM_CODE_SYSTEM_UNRESOLVED` (unknown mnemonic) or
  `TRANSFORM_CODE_UNMAPPED` (no coding system at all). The code is preserved verbatim, never invented.
- **`HumanName.use` / `Address.use` is absent** → the v2 code has no equivalent in the IG's table map
  (`TRANSFORM_NAME_USE_UNMAPPED` / `TRANSFORM_ADDRESS_USE_UNMAPPED`). It is surfaced, never guessed.

## My timestamp lost its time-of-day

`TRANSFORM_TIMESTAMP_NO_TIMEZONE`: the v2 timestamp had a time but no offset, and FHIR forbids a time
without a zone, so it was reduced to date precision rather than assuming UTC (which would shift the
clinical instant by hours). Supply `assumeTimezoneOffsetMinutes` if you know the sender's offset.

## My unit didn't populate `Quantity.code`

`TRANSFORM_UNIT_NOT_UCUM`: the unit wasn't declared UCUM or failed the UCUM shape check, so it was
preserved verbatim in `Quantity.unit` with `code`/`system` absent. Magnitudes are **never** converted
(mg/dL ↔ mmol/L is analyte-dependent and unsafe to automate).

## My order has a TQ1 but the request carries no schedule

The whole `Timing` is withheld the moment any part of the TQ1 cannot be grounded, and never
partially built: a half-built schedule reads to the receiving system as a complete dosing
instruction, so "every 4 hours, but only between meals" must not arrive as "every 4 hours". Look for
a `TRANSFORM_ELEMENT_DROPPED` or `TRANSFORM_CODE_UNMAPPED` whose `v2Location` names the exact TQ1
field or repeat-pattern component that caused it (`TQ1.3.2`, `TQ1.6`, `TQ1.8`, …); the full list of
causes is under [Known limitations](#known-limitations). Note that no `boundsPeriod` survives a
refusal either, even when TQ1-7 and TQ1-8 were both perfectly usable: an unanchored pair of dates
would read as an open regimen the message never authorized.

## My TQ1 free-text instruction didn't reach the resource

TQ1-10 and TQ1-11 are `TX`, a v2 primitive with no component structure, so they are read **whole**:
a raw `^`, `&` or `~` inside one is content, and a taper written `2 tabs^then 1 tab` arrives intact
rather than truncated at the first delimiter. That holds when the delimiters are all the row
carries: `^&~` is the same characters as `^leading` with the letters removed, and it arrives as the
text it is rather than vanishing. Three cases still write nothing. An **absent** field
and the HL7 **explicit null** (`""`, the wire saying the field carries no value) both write nothing
and say nothing, because neither carried anything to drop. A field that **did** carry content whose
whole projection resolves away (display markup such as a `\H\` / `\N\` highlight pair with nothing
between, or, for TQ1-11 alone, nothing but whitespace, which R4's `txt-2` forbids in a narrative)
writes nothing and raises a `TRANSFORM_ELEMENT_DROPPED` naming the row, so it is never confused with
a field that was never sent.

## Are diagnostics safe to log?

Yes. A `TransformIssue` carries only a stable code, a severity, a **positional** v2 location, and a
FHIR path, **never a value**. Its `message` is static. Do not log the raw v2 message or the produced
resource values; those carry PHI.

## Known limitations

- **Message families: the IG-covered set.** `toFhir(msg)` assembles ADT → Patient + Encounter,
  ORU^R01 → DiagnosticReport + Observation, ORM_O01 / OML_O21 → ServiceRequest and
  RXO → MedicationRequest, and the thin IG singles VXU_V04 → Immunization, SIU_S12 →
  Appointment, and MDM_T02 → DocumentReference. An AL1 in any of them becomes an
  AllergyIntolerance, a DG1 a Condition, a PR1 a Procedure and an IN1 a Coverage, and a TQ1
  accompanying an order becomes that order's schedule. The v2→FHIR
  direction is feature-complete for the IG-covered message set; terminology depth and profiles are
  not implemented.
- **Schedule scope: TQ1 only, and four of its repeat-pattern components.** A TQ1 on an order group
  builds `dosageInstruction.timing` on a MedicationRequest and `occurrenceTiming` on a
  ServiceRequest, from TQ1-3's repeat-pattern code (HL70335), period quantity, period units and
  event code (the HL70528 rows the guide gives a `v3-TimingEvent` target), plus TQ1-7 / TQ1-8 as
  `repeat.boundsPeriod`. TQ2 is not read. TQ1-10 and TQ1-11 reach the two different targets the
  guide names on the medication path (`dosageInstruction.additionalInstruction.text` and the
  resource's own `text` narrative) and are flagged as dropped on the service path, where the guide
  targets an extension and an annotation this tier does not build. **A schedule is fully grounded or
  absent and flagged**, so the whole `Timing` is withheld with a `TRANSFORM_ELEMENT_DROPPED` or
  `TRANSFORM_CODE_UNMAPPED` naming the cause when: a repeat component has no target in the guide
  (calendar alignment, either end of the day-of-week range, institution-specified time, event
  offset, general timing specification, or a component past the eleven the datatype defines); a code
  sits outside its
  published table, or was sent under a coding system that is not that table (a site's local `AC` is
  not asserted to be the published "before meal" concept); a period arrives without its units, or
  written with a minus sign (R4's `tim-2` and `tim-5` reject both); a field narrows the schedule
  (TQ1-4, TQ1-5, TQ1-6, TQ1-12, TQ1-13, TQ1-14, each needing a rescale, an invented date or an
  unbuilt element); a bound is unusable or inverted; or more than one TQ1 accompanies one order, or
  one TQ1-3 carries more than one repeat pattern. A repetition of TQ1-3 that carries no value is not
  a second pattern: `Q4H~`, `~Q4H` and a second repetition the sender explicitly nulled each send
  one schedule, and it is read from whichever repetition carries it.
  TQ1-2 and TQ1-9 are the exception: they are flagged and the schedule still ships, because the dose
  and the priority already come from the RXO/OBR path and are left exactly as they were.
- **Allergy scope: AL1 only, and `criticality` only.** `IAM` is not read (it keeps reporting
  `TRANSFORM_SEGMENT_NOT_EMITTED`), and `AllergyIntolerance.reaction.severity` is never populated:
  the IG names `criticality` the base target for AL1-4 and offers `reaction.severity` only as a
  local variation, conditioned on a severity that was not used equivalently to criticality, which no
  v2 message states. So an AL1-4 of `MO` or `U` leaves `criticality` absent with a
  `TRANSFORM_CODE_UNMAPPED`, rather than reappearing as a reaction grading. AL1-2 resolves
  `category` and `type` against two separate IG maps with different unmapped sets: `MA` yields a
  type and no category, `MC` yields neither, and each absence is flagged on its own. The original
  AL1-2 / AL1-4 code is always carried in the IG's `alternate-codes` extension, so an untranslated
  code is still on the resource. Two conditions withhold the whole allergy, each with a
  `TRANSFORM_ELEMENT_DROPPED` naming it: no Patient in the bundle to anchor `patient`, and an AL1-3
  that grounds no allergen code and no allergen text. AL1-6 is read as `onsetDateTime` only for a
  message whose version identifier is readable and earlier than 2.7, the version that withdrew the
  field; on 2.7 or later, or when the version cannot be read, it is dropped and flagged.
- **Diagnosis, procedure and coverage scope: what the three segment maps ground, and no more.** A
  DG1 becomes a Condition, a PR1 a Procedure and an IN1 a Coverage, each wired to the bundle
  Patient; with no Patient in the bundle every one of them is withheld and declared
  `TRANSFORM_ELEMENT_DROPPED`, naming the occurrence and the reference it could not anchor.
  **`Coverage.status` is never asserted.** No published row of the IN1 map grounds one, and R4's
  binding has no neutral member, so the element ships value-absent with a `data-absent-reason` of
  `unknown` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`: read it as unknown, never as active
  coverage. **`Coverage.payor` names the insurer and resolves to nothing**: IN1-4.1 becomes a
  reference `display` with no literal reference, because no Organization resource is built, and an
  IN1 that names no insurance company is withheld entirely, since `payor` is required and nothing
  else grounds it. `Procedure.status` is the `unknown` the map's own row directs where the message
  context determines none; `completed` is never selected from a message that did not say so. A DG1-21
  of `D` sets `verificationStatus` to `entered-in-error`, the one value the map assigns; every other
  Table 0206 action code leaves the element absent with a `TRANSFORM_CODE_UNMAPPED`. A DG1 that
  grounds neither a diagnosis code nor a description still becomes a Condition, with its empty
  `code` flagged, so it is visible rather than reading as an intentionally empty one.
  `Condition.clinicalStatus` is absent because no row grounds it, which can fail R4's `con-3`
  invariant under a full profile validator. **The rows that need a resource this tier does not
  build are declared, never silently dropped**: `Condition.asserter` (DG1-16),
  `Procedure.performer.actor` (PR1-8, PR1-11, PR1-12), `Procedure.location` (PR1-23),
  `Coverage.payer` (IN1-5), `Coverage.policyHolder` (IN1-10, IN1-11) and `Coverage.subscriber`
  (IN1-16) each raise a `TRANSFORM_ELEMENT_DROPPED` when their field is valued, and so do the rows
  whose reference resolves by identifier rather than by position (DG1-22, PR1-25), the CPT modifier
  concatenation whose target is not an R4 element (PR1-16), the relationship whose value translation
  needs a table this library does not carry (IN1-17), the financial class that also targets a
  Coverage (PV1-20), and the `EpisodeOfCare` a DG1 is not tied to.
- **Reverse (FHIR → v2) scope: two shapes, deliberately.** `toV2Patient` emits an `ADT`-shaped
  message carrying a `PID`, `toV2Observation` an `ORU`-shaped message carrying an `OBX`. Both
  require the caller to pass the v2 trigger (no resource carries one, so it is never inferred: a
  missing one returns no message and a `TRANSFORM_MISSING_TRIGGER` diagnostic). The direction is
  **lossy by design and not a round-trip**: a mapping row whose inverse is ambiguous is refused
  (`TRANSFORM_CODE_NOT_INVERTIBLE`), an element with no v2 field in this map is flagged
  (`TRANSFORM_NO_V2_TARGET`), and a value v2 cannot carry unchanged is left out
  (`TRANSFORM_VALUE_NOT_REPRESENTABLE`). Emitting a `Patient` **and** an `Encounter` together as a
  visit-carrying ADT is not implemented.
- **An emitted message can be missing a field v2 requires, and it tells you so.** PID-3 (Patient
  Identifier List), PID-5 (Patient Name) and OBX-11 (Observation Result Status) are required fields
  with no safe default: a resource that carries no source for one leaves it absent, never a
  fabricated placeholder, and raises one `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` per field naming the v2
  location and the FHIR path it would have come from. Supply the missing element on the resource, or
  repair the message before you send it. If nothing in the resource grounds any field of the target
  segment, there is no message to repair: the call returns `value: undefined` and one
  `TRANSFORM_NO_V2_MESSAGE_EMITTED`, which is how an empty-handed conversion is told apart from a
  successful one.
- **Thin-IG-single scope**: each family covers the single trigger the IG maps and the
  resource-internal fields; references to resources this tier does not yet build (Immunization
  performer/manufacturer/location, Appointment practitioner/location participants, DocumentReference
  author/authenticator) are deferred and flagged, never dangling. `Immunization.status` follows the IG's
  three conditioned rows (RXA-21 = `D` → `entered-in-error`, unvalued RXA-20 → `completed`, else the
  HL70322 map); a required status the IG cannot ground withholds the resource (a valued-but-unmapped
  RXA-20, an IG-unmatched SCH-25, or a non-`AV` TXA-19). The Appointment patient participant's
  IG-unsourced required `status` is a `data-absent-reason` primitive, and the MDM document body is
  base64-encoded verbatim (the IG-assigned `application/text` / `text/hl7v2` contentType), carried and
  never interpreted.
- **ORU scope**: `DiagnosticReport.category` is not defaulted (the IG segment map sets none; it is
  realm-dependent), the results graph uses the first PID/PV1 (multiple patient result groups are not
  handled), and OBR performers/specimen and `basedOn` ServiceRequest are deferred. An OBX value
  type with no first-class FHIR `value[x]` (`NA`, `ED`, `DR`, `TM`, `NR`, …) preserves the raw value as
  `valueString` and flags it, never a fabricated typed value.
- **Terminology value translation**: coded fields with an IG `mappedVia` value ConceptMap
  are value-translated via `toFhirCodeableConceptVia`, covering RXR route/site (HL70162/HL70550), SCH-8
  appointment type (HL70277), RXO-9 substitution (HL70161), OBR-5 priority (HL70485), and the AL1
  allergy tables (HL70127 to category and to type, HL70128 to criticality, plus the two
  original-code identity maps). Each map is
  transcribed and verified firsthand against the raw published IG ConceptMap JSON; a source code the IG
  leaves in its `(unmapped)` group is flagged (`TRANSFORM_CODE_UNMAPPED`), never coerced. Two fields the
  IG maps into **SNOMED CT** (RXR-4 method, SCH-7 reason) stay structural (SNOMED is not bundled; BYO
  ConceptMap), and fields the IG ships no value map for (TXA-2 document type, RXA-5 vaccine code) are
  carried as-is. The built-in NamingSystem code-system seed is still the FHIR-core-fixed systems; the
  full HL7 THO crosswalk beyond these maps is not implemented.
- **No terminology content, no unit conversion, R4-only.**

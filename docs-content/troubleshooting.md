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

## Are diagnostics safe to log?

Yes. A `TransformIssue` carries only a stable code, a severity, a **positional** v2 location, and a
FHIR path, **never a value**. Its `message` is static. Do not log the raw v2 message or the produced
resource values; those carry PHI.

## Known limitations

- **Message families: the IG-covered set.** `toFhir(msg)` assembles ADT → Patient + Encounter,
  ORU^R01 → DiagnosticReport + Observation, ORM_O01 / OML_O21 → ServiceRequest and
  RXO → MedicationRequest, and the thin IG singles VXU_V04 → Immunization, SIU_S12 →
  Appointment, and MDM_T02 → DocumentReference. An AL1 in any of them becomes an
  AllergyIntolerance. The v2→FHIR direction is
  feature-complete for the IG-covered message set; terminology depth and profiles are not
  implemented.
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

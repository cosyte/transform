---
id: troubleshooting
title: Troubleshooting
sidebar_position: 1
---

# Troubleshooting

Common symptoms when converting v2 → FHIR, and how to read what the transform is telling you.

## A converter returned `value: undefined`

Nothing could be **safely** emitted. This is by design, not an error — it happens for an empty input
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
without a zone — so it was reduced to date precision rather than assuming UTC (which would shift the
clinical instant by hours). Supply `assumeTimezoneOffsetMinutes` if you know the sender's offset.

## My unit didn't populate `Quantity.code`

`TRANSFORM_UNIT_NOT_UCUM`: the unit wasn't declared UCUM or failed the UCUM shape check, so it was
preserved verbatim in `Quantity.unit` with `code`/`system` absent. Magnitudes are **never** converted
(mg/dL ↔ mmol/L is analyte-dependent and unsafe to automate).

## Are diagnostics safe to log?

Yes. A `TransformIssue` carries only a stable code, a severity, a **positional** v2 location, and a
FHIR path — **never a value**. Its `message` is static. Do not log the raw v2 message or the produced
resource values; those carry PHI.

## Known limitations (Phases 1–5)

- **Message families so far: the IG-covered set** — `toFhir(msg)` assembles ADT → Patient + Encounter
  (Phase 2), ORU^R01 → DiagnosticReport + Observation (Phase 3), ORM_O01 / OML_O21 → ServiceRequest and
  RXO → MedicationRequest (Phase 4), and the thin IG singles VXU_V04 → Immunization, SIU_S12 →
  Appointment, and MDM_T02 → DocumentReference (Phase 5). With Phase 5 the v2→FHIR direction is
  feature-complete for the IG-covered message set; terminology depth, profiles, and the reverse
  direction land in later phases.
- **Thin-IG-single scope (Phase 5)** — each family covers the single trigger the IG maps and the
  resource-internal fields; references to resources this tier does not yet build (Immunization
  performer/manufacturer/location, Appointment practitioner/location participants, DocumentReference
  author/authenticator) are deferred and flagged, never dangling. `Immunization.status` follows the IG's
  three conditioned rows (RXA-21 = `D` → `entered-in-error`, unvalued RXA-20 → `completed`, else the
  HL70322 map); a required status the IG cannot ground withholds the resource (a valued-but-unmapped
  RXA-20, an IG-unmatched SCH-25, or a non-`AV` TXA-19). The Appointment patient participant's
  IG-unsourced required `status` is a `data-absent-reason` primitive, and the MDM document body is
  base64-encoded verbatim (the IG-assigned `application/text` / `text/hl7v2` contentType), carried and
  never interpreted.
- **ORU scope** — `DiagnosticReport.category` is not defaulted (the IG segment map sets none; it is
  realm-dependent), the results graph uses the first PID/PV1 (multiple patient result groups are a
  later concern), and OBR performers/specimen and `basedOn` ServiceRequest are deferred. An OBX value
  type with no first-class FHIR `value[x]` (`NA`, `ED`, `DR`, `TM`, `NR`, …) preserves the raw value as
  `valueString` and flags it — never a fabricated typed value.
- **Minimal NamingSystem registry** — the built-in code-system seed is the FHIR-core-fixed systems;
  the full HL7 THO crosswalk is Phase 6.
- **No terminology content, no unit conversion, R4-only** — see the roadmap for the full non-goals.

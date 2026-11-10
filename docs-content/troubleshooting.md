---
id: troubleshooting
title: Troubleshooting
sidebar_label: Troubleshooting
description: "Why a value or element is missing from the output, whether diagnostics are safe to log, and the known limitations."
---

# Troubleshooting

Common symptoms when converting v2 to FHIR, and how to read what the transform is telling you. Each
code named here is listed with its severity and message in [Issue codes](./issue-codes.md).

## A converter returned `value: undefined`

Nothing could be **safely** emitted. This is by design, not an error: it happens for an empty input
composite, an unparseable timestamp, or a numeric value that was not numeric. Check `issues` for the
typed reason (e.g. `TRANSFORM_TIMESTAMP_INVALID`).

## A field I expected is missing from the output

A missing FHIR element can come with a diagnostic explaining the refusal:

- **`Identifier.system` is absent** → `TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED`: the assigning
  authority was not resolvable. Seed it with `createNamingSystem({ authorities })`
  ([Resolve assigning authorities](./guides-overview.md)). The value is never attached to a guessed
  system.
- **`Coding.system` is absent** → `TRANSFORM_CODE_SYSTEM_UNRESOLVED` (unknown mnemonic) or
  `TRANSFORM_CODE_UNMAPPED` (no coding system at all). The code is preserved verbatim, never invented.
- **`HumanName.use` / `Address.use` is absent** → the v2 code has no equivalent in the IG's table map
  (`TRANSFORM_NAME_USE_UNMAPPED` / `TRANSFORM_ADDRESS_USE_UNMAPPED`). It is surfaced, never guessed.
- **`Patient.birthDate`, `Encounter.period` or `Bundle.timestamp` is absent** →
  `TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER` at `PID.7`, `PV1.44`, `PV1.45` or `MSH.7`: the field was
  valued, but `@cosyte/hl7`'s typed view could not read it as a date, so no timestamp reached the
  transform. Nothing else changes: an unreadable PV1-45 does not make the encounter `finished`. If
  the sender writes dates in another layout, declare it with `parseHL7(raw, { dateFormats })`.

Some missing elements come with no diagnostic at all. A `Patient` is built from PID-3, PID-5, PID-7,
PID-8 and PID-11 only, and from the first repetition of PID-5 and PID-11. PID-13 and PID-14
(telecom) raise one `TRANSFORM_ELEMENT_DROPPED`; every other PID field is dropped with no issue,
among them PID-10 race, PID-15 primary language, PID-19 SSN, PID-22 ethnic group, PID-29 death date
and time and PID-30 death indicator. A `Patient` from a PID that records a death therefore has no
`deceased[x]`. Read those fields from the parsed message if you need them.

## My timestamp lost its time of day

`TRANSFORM_TIMESTAMP_NO_TIMEZONE`: the v2 timestamp had a time but no offset, and FHIR forbids a time
without a zone, so it was reduced to date precision rather than assuming UTC (which would shift the
clinical instant by hours). Supply `assumeTimezoneOffsetMinutes` if you know the sender's offset
([Keep the time on a timestamp with no offset](./supply-a-sender-timezone.md)). It
must be a whole number of minutes from -840 to 840 (-14:00 to +14:00), the range FHIR can write; any
other value is ignored and the timestamp is still reduced to its date.

A `TRANSFORM_ELEMENT_DROPPED` at `TS.1` on a timestamp that did carry an offset means the time could
not be written: the offset was outside FHIR's range (a v2 DTM allows up to +2359), or the time had
only hours or hours and minutes, and FHIR needs seconds. On a `TS` you built by hand it can also mean
a part had no place in FHIR: a time with no day or month, a day with no month, or a minute or second
with no hour. The value keeps the date parts it can place.

The same flag marks a part no calendar or clock has: hour 25, minute 60, month 13, or a day the
month does not have, such as 31 February. That part is dropped with every part after it, and the
value keeps the parts before it. `@cosyte/hl7` reads `20260231` as a valid date, so this can happen
on a parsed message too. Fractional seconds that are not digits are dropped on their own, and the
whole second is still written. A year FHIR cannot write (outside 0001 to 9999) leaves no value and
raises `TRANSFORM_TIMESTAMP_INVALID`.

## My unit did not populate `Quantity.code`

`TRANSFORM_UNIT_NOT_UCUM`: the unit was not declared UCUM or failed the UCUM shape check, so it was
preserved verbatim in `Quantity.unit` with `code`/`system` absent. Magnitudes are **never** converted
(mg/dL ↔ mmol/L is analyte-dependent and unsafe to automate).

## My order has a TQ1 but the request carries no schedule

The whole `Timing` is withheld the moment any part of the TQ1 cannot be grounded, and never
partially built: a half-built schedule reads to the receiving system as a complete dosing
instruction, so "every 4 hours, but only between meals" must not arrive as "every 4 hours". Look for
a `TRANSFORM_ELEMENT_DROPPED` or `TRANSFORM_CODE_UNMAPPED` whose `v2Location` names the exact TQ1
field or repeat-pattern component that caused it (`TQ1.3.2`, `TQ1.6`, `TQ1.8`, …); the full list of
causes is under [Mapping scope](./mapping-scope.md#orders-and-schedules). Note that no `boundsPeriod` survives a
refusal either, even when TQ1-7 and TQ1-8 were both perfectly usable: an unanchored pair of dates
would read as an open regimen the message never authorized.

## My TQ1 free-text instruction did not reach the resource

TQ1-10 and TQ1-11 are `TX`, a v2 primitive with no component structure, so they are read **whole**:
a raw `^`, `&`, or `~` inside one is content, and a taper written `2 tabs^then 1 tab` arrives intact
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

## A resource I expected is not in the bundle

Look for `TRANSFORM_RESOURCE_INVALID`: the resource failed the required-element check and was
withheld, usually because a required element such as `status` had no grounded value (an order
control, result status or document status the guide's map has no target for). Look also for a
`TRANSFORM_ELEMENT_DROPPED` whose FHIR path ends in `.patient` or `.subject`: an allergy,
diagnosis, procedure or coverage is withheld when the bundle has no `Patient` to point at.

## A segment I sent produced nothing

Each segment occurrence that reached no resource raises `TRANSFORM_SEGMENT_NOT_EMITTED` (the guide
maps the segment, this library does not carry it) or `TRANSFORM_SEGMENT_NO_IG_MAP` (the guide maps
no segment by that name, or the name could not be read). [How the transform
works](./concepts-archetype.md#what-the-bundle-did-not-represent) explains both and their locations.

## Known limitations

[Mapping scope](./mapping-scope.md) lists, family by family, what reaches a resource and what is
left out. In short: no terminology content, no unit conversion, R4 only, and a narrow FHIR to v2
path ([Why FHIR to v2 is narrow](./reverse-direction.md)).

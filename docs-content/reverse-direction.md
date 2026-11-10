---
id: reverse-direction
title: Why FHIR to v2 is narrow
sidebar_label: The reverse direction
description: "Why the FHIR to v2 path covers two shapes, needs the trigger from you, refuses ambiguous codes, and is never a round trip."
---

# Why FHIR to v2 is narrow

The library has two reverse functions, `toV2Patient` and `toV2Observation`, and they do less than a
reader might expect. This page explains why.

## The guide runs one way

The HL7 Version 2 to FHIR Implementation Guide maps v2 **to** FHIR. It publishes no map from FHIR
to v2. Every row the reverse path uses is the inverse of a published forward row, and an inverse is
only trustworthy where the forward row is one-to-one.

Several rows are not. Three v2 administrative-sex codes all become FHIR `other`; two v2 name types
become `official` and two become `temp`; two address types become `work`; two result statuses become
`entered-in-error`. Going back from `other`, there is no telling which of the three codes the sender
meant. Picking the likeliest would be a confident wrong value sent to another clinical system, so the
library keeps an inverse only when exactly one v2 code maps to the FHIR code (`invertCodeMap` does
this), and refuses the rest with `TRANSFORM_CODE_NOT_INVERTIBLE`, leaving the field empty.

## The trigger comes from you

A v2 message type has a trigger event: `ADT^A28`, `ORU^R01`. No FHIR resource records one, so
there is nothing to derive it from. The caller passes it, and a missing one returns no message and
`TRANSFORM_MISSING_TRIGGER`. A trigger that is not bare (with spaces, or with a delimiter that would
split MSH-9) is refused with `TRANSFORM_VALUE_NOT_REPRESENTABLE` rather than trimmed into something
you did not ask for.

## It is not a round trip

Transforming a message to FHIR and back does not give the original message. The forward direction
drops what the guide does not map, the reverse direction refuses what it cannot invert, and the
assigning authority of an identifier appears only when you name it. The test suite checks that each
emitted message parses back without a fatal error and that MSH-9 carries your trigger as given. It
does not check, and nothing here claims, that the result equals any message the resource came from.

## Gaps are reported, not filled

v2 requires some fields: PID-3 and PID-5 on a `PID`, OBX-11 on an `OBX`. When the resource has no
source for one, the field stays empty and `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` says so, at `error`
severity. A placeholder would make the message look conformant and would tell the receiver
something false; an empty field and an issue let you decide before it goes out. A resource that
grounds no field at all yields no message and `TRANSFORM_NO_V2_MESSAGE_EMITTED`, so an empty result
is never mistaken for a success.

## Two shapes, on purpose

`toV2Patient` emits an `ADT`-shaped message carrying a `PID`, and `toV2Observation` an `ORU`-shaped
message carrying an `OBX`. An `Observation` names its patient only by reference, so no `PID` is
built for it. Emitting a `Patient` and an `Encounter` together as an ADT that carries a visit is
not implemented.

## Guides that apply this

- [Emit a v2 message from a FHIR resource](./emit-v2-from-fhir.md): the calls, the options and the
  checks before sending.
- [Read, log and return the issues](./handle-issues.md): hold a message with an `error` for review.

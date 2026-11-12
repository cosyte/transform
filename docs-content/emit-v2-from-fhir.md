---
id: emit-v2-from-fhir
title: Emit a v2 message from a FHIR resource
sidebar_label: Emit v2 from FHIR
description: "Turn a FHIR Patient into an ADT message carrying a PID, or an Observation into an ORU message carrying an OBX, and check the issues before you send it."
---

# Emit a v2 message from a FHIR resource

Two functions go from FHIR back to v2: `toV2Patient` builds an `ADT` message carrying a `PID`, and
`toV2Observation` builds an `ORU` message carrying an `OBX`. Both return `{ value, issues }`, where
`value` is an `@cosyte/hl7` message. The path is narrow and lossy by design;
[Why FHIR to v2 is narrow](./reverse-direction.md) explains why.

## Emit a patient

You supply the v2 trigger. No FHIR resource carries one, so the library never infers it. Map each
identifier system you send to the assigning-authority code the receiver expects, and set the MSH
fields in `envelope`.

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { toV2Patient } from "@cosyte/transform";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Patient",
    identifier: [{ system: "urn:oid:2.16.840.1.113883.19", value: "MRN12345" }],
    name: [{ family: "Public", given: ["Jane"] }],
    gender: "female",
    birthDate: "1980-01-15",
  }),
);

const { value, issues } = toV2Patient(resource, "A28", {
  assigningAuthorities: { "urn:oid:2.16.840.1.113883.19": "HOSP" },
  envelope: { sendingApp: "EHR", sendingFacility: "MAIN", controlId: "MSG0100" },
});

// The PID segment below is synthetic: it is asserted here, and a real one is never logged.
value?.toString().split("\r")[1]; // => "PID|||MRN12345^^^HOSP||Public^Jane||19800115|F"
issues; // => []
```

An identifier whose system is not in `assigningAuthorities` is written with its value and no
assigning authority, flagged with `TRANSFORM_NO_V2_TARGET` rather than invented.

## Emit an observation

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { toV2Observation } from "@cosyte/transform";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Observation",
    status: "final",
    code: { coding: [{ system: "http://loinc.org", code: "2093-3", display: "Cholesterol" }] },
    valueQuantity: { value: 210, unit: "mg/dL", system: "http://unitsofmeasure.org", code: "mg/dL" },
  }),
);

const { value, issues } = toV2Observation(resource, "R01");

value?.toString().includes("ORU^R01"); // => true
value?.toString().split("\r")[1]; // => "OBX||NM|2093-3^Cholesterol^LN||210|mg/dL^mg/dL^UCUM|||||F"
issues; // => []
```

The message carries the `OBX` alone. An `Observation` names its patient only by reference, and a
`PID` assembled from a reference would be made up.

## Check the trigger

An absent or empty trigger returns no message and `TRANSFORM_MISSING_TRIGGER`, and nothing is built.

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { ISSUE_CODES, toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient","gender":"female"}');

const refused = toV2Patient(resource, "");
refused.value; // => undefined
refused.issues[0]?.code === ISSUE_CODES.TRANSFORM_MISSING_TRIGGER; // => true
```

## Check what could not be carried

Several of the guide's rows map more than one v2 code to the same FHIR code, so going back is
ambiguous. FHIR `gender` `other` could have come from three v2 codes; the library refuses to pick
one and leaves the field empty:

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { ISSUE_CODES, toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient","name":[{"family":"Public"}],"gender":"other"}');
const { issues } = toV2Patient(resource, "A28");

issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE && i.v2Location === "PID.8"); // => true
```

The other refusals work the same way: an element with no v2 field in this map raises
`TRANSFORM_NO_V2_TARGET`, a value v2 cannot carry unchanged raises
`TRANSFORM_VALUE_NOT_REPRESENTABLE`, and a coding system with no v2 mnemonic raises
`TRANSFORM_CODE_SYSTEM_NOT_V2`. Each leaves its field out.

## Check the required fields before you send

A `PID` needs PID-3 (Patient Identifier List) and PID-5 (Patient Name); an `OBX` needs OBX-11
(Observation Result Status). None has a safe default. When the resource gives no source for one,
the message is still built, the field is left empty rather than filled with a placeholder, and the
issues say so with `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` at `error` severity:

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { ISSUE_CODES, toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient","identifier":[{"value":"MRN1"}]}');
const { value, issues } = toV2Patient(resource, "A28");

value?.toString().includes("PID|||MRN1"); // => true
issues[0]?.code === ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT; // => true
issues[0]?.v2Location; // => "PID.5"
```

Add the element to the resource, or repair the message, before it goes out. If nothing in the
resource grounds a single field of the segment, there is no message at all, and that is reported as
`TRANSFORM_NO_V2_MESSAGE_EMITTED` rather than returned as an empty success:

```ts runnable
import { parseResource } from "@cosyte/fhir";
import { ISSUE_CODES, toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient"}');
const { value, issues } = toV2Patient(resource, "A28");

value; // => undefined
issues[0]?.code === ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED; // => true
```

## Reference

- [`toV2Patient`](./api/README.md#tov2patient) and
  [`toV2Observation`](./api/README.md#tov2observation)
- [`ReverseOptions`](./api/README.md#reverseoptions) and
  [`ReverseResult`](./api/README.md#reverseresult)
- [`GENDER_TO_V2`](./api/README.md#gender_to_v2),
  [`NAME_USE_TO_V2`](./api/README.md#name_use_to_v2),
  [`ADDRESS_USE_TO_V2`](./api/README.md#address_use_to_v2) and
  [`OBSERVATION_STATUS_TO_V2`](./api/README.md#observation_status_to_v2): the inverted maps
- [Issue codes](./issue-codes.md)

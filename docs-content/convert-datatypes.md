---
id: convert-datatypes
title: Convert a single datatype
sidebar_label: Convert a single datatype
description: "Convert one v2 timestamp, identifier, coded element, name, address or number with units into its FHIR datatype, and read what each refuses."
---

# Convert a single datatype

`toFhir` converts whole messages. When you hold one parsed v2 value instead, call its converter.
Each takes the composite `@cosyte/hl7` parsed (or one you build with the same fields) and returns
`{ value, issues }`; `value` is `undefined` when nothing could be emitted safely.

| Converter | v2 | FHIR | What it refuses to do |
| --- | --- | --- | --- |
| `toFhirDateTime` | DTM, TS | `dateTime` | guess a timezone; pad a partial time |
| `toFhirIdentifier` | CX | `Identifier` | make a system from an authority's short code |
| `toFhirCodeableConcept` | CWE, CE | `CodeableConcept` | invent a coding system; move a code to a neighbor |
| `toFhirHumanName` | XPN | `HumanName` | guess a name use the guide does not map |
| `toFhirAddress` | XAD | `Address` | guess an address use or type the guide does not map |
| `toFhirQuantity` | NM and units | `Quantity` | make a UCUM code; convert a magnitude |

Two of them look things up in a naming system: `toFhirIdentifier` for an assigning authority and
`toFhirCodeableConcept` for a coding system. Pass one in the last argument,
`{ namingSystem: createNamingSystem() }`. Without it they resolve no identifier system and no coding
system. `toFhirQuantity` needs one only for a unit whose coding system is not the literal `UCUM`: a
unit declared `UCUM` is treated as UCUM with or without a naming system, and any other mnemonic is
asked of the naming system, so without one that unit stays in `Quantity.unit` alone.

## A timestamp

```ts runnable
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";

toFhirDateTime(parseDtm("20260721143000-0500")).value; // => "2026-07-21T14:30:00-05:00"
toFhirDateTime(parseDtm("202607")).value; // => "2026-07"
toFhirDateTime(parseDtm("20260721143000")).value; // => "2026-07-21"
```

A date-only value keeps its precision and is never zero-filled. A time with no offset is cut to its
date with `TRANSFORM_TIMESTAMP_NO_TIMEZONE`; [Supply a sender timezone for a timestamp with no
offset](./supply-a-sender-timezone.md) shows the option that keeps it.

## An identifier

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhirIdentifier } from "@cosyte/transform";

const { value, issues } = toFhirIdentifier(
  {
    idNumber: "MRN12345",
    identifierTypeCode: "MR",
    assigningAuthority: { universalId: "2.16.840.1.113883.19", universalIdType: "ISO" },
  },
  { namingSystem: createNamingSystem() },
);

value === undefined ? undefined : JSON.parse(serializeResource(value)); // => { type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] }, system: "urn:oid:2.16.840.1.113883.19", value: "MRN12345" }
issues; // => []
```

[Resolve assigning authorities](./resolve-assigning-authorities.md) covers every way a system is found.

## A coded element

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhirCodeableConcept } from "@cosyte/transform";

const namingSystem = createNamingSystem();

const loinc = toFhirCodeableConcept(
  { identifier: "2093-3", text: "Cholesterol", nameOfCodingSystem: "LN" },
  { namingSystem },
);
loinc.value === undefined ? undefined : JSON.parse(serializeResource(loinc.value)); // => { coding: [{ system: "http://loinc.org", code: "2093-3", display: "Cholesterol" }] }

const local = toFhirCodeableConcept({ identifier: "CHOL", nameOfCodingSystem: "L" }, { namingSystem });
local.issues.map((i) => i.code); // => ["TRANSFORM_CODE_SYSTEM_UNRESOLVED"]
```

An unknown coding system keeps the code and leaves `Coding.system` out. To translate a code from one
HL7 table into a FHIR code system, see [Translate a coded field through a value
map](./translate-coded-values.md).

## A name

```ts runnable
import { toFhirHumanName } from "@cosyte/transform";

toFhirHumanName({ familyName: "Public", givenName: "Jane", nameTypeCode: "L" }).issues; // => []
toFhirHumanName({ familyName: "Public", nameTypeCode: "ZZ" }).issues.map((i) => i.code); // => ["TRANSFORM_NAME_USE_UNMAPPED"]
```

XPN-7 becomes `HumanName.use` through the guide's Table 0200 map (`NAME_USE_MAP`). A name type the
map has no target for leaves `use` out.

## An address

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { toFhirAddress } from "@cosyte/transform";

const { value, issues } = toFhirAddress({
  street: "100 Main St",
  city: "Springfield",
  stateOrProvince: "IL",
  zipOrPostalCode: "62701",
  addressType: "H",
});

value === undefined ? undefined : JSON.parse(serializeResource(value)); // => { use: "home", line: ["100 Main St"], city: "Springfield", state: "IL", postalCode: "62701" }
issues; // => []
```

XAD-7 becomes `Address.use` or `Address.type` through the guide's Table 0190 maps
(`ADDRESS_USE_MAP`, `ADDRESS_TYPE_MAP`). An address type neither map covers leaves both out with
`TRANSFORM_ADDRESS_USE_UNMAPPED`.

## A number with units

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhirQuantity } from "@cosyte/transform";

const namingSystem = createNamingSystem();

const ucum = toFhirQuantity(
  { raw: "7.20", value: 7.2 },
  { identifier: "mmol/L", nameOfCodingSystem: "UCUM" },
  { namingSystem },
);
ucum.value === undefined ? undefined : serializeResource(ucum.value); // => '{"value":7.20,"unit":"mmol/L","system":"http://unitsofmeasure.org","code":"mmol/L"}'

const local = toFhirQuantity({ raw: "7.20", value: 7.2 }, { identifier: "mmol per liter" }, { namingSystem });
local.value === undefined ? undefined : serializeResource(local.value); // => '{"value":7.20,"unit":"mmol per liter"}'
local.issues.map((i) => i.code); // => ["TRANSFORM_UNIT_NOT_UCUM"]

// A unit declared with the literal `UCUM` needs no naming system.
const noContext = toFhirQuantity({ raw: "7.20", value: 7.2 }, { identifier: "mmol/L", nameOfCodingSystem: "UCUM" });
noContext.value === undefined ? undefined : serializeResource(noContext.value); // => '{"value":7.20,"unit":"mmol/L","system":"http://unitsofmeasure.org","code":"mmol/L"}'
noContext.issues.length; // => 0
```

The magnitude keeps its digits as sent, from the `raw` text. A unit that is not declared UCUM, or
does not look like UCUM, stays in `Quantity.unit` alone. A magnitude is never converted between
units: whether mg/dL can become mmol/L depends on the analyte. A value that is not a valid FHIR
decimal as written (a leading `+`, a leading zero, a trailing dot) gives no `Quantity` and
`TRANSFORM_QUANTITY_VALUE_INVALID`, rather than a rewritten number.

## Reference

- [`toFhirDateTime`](./api/README.md#tofhirdatetime), [`toFhirIdentifier`](./api/README.md#tofhiridentifier),
  [`toFhirCodeableConcept`](./api/README.md#tofhircodeableconcept),
  [`toFhirHumanName`](./api/README.md#tofhirhumanname), [`toFhirAddress`](./api/README.md#tofhiraddress)
  and [`toFhirQuantity`](./api/README.md#tofhirquantity)
- [`ConvertResult`](./api/README.md#convertresult) and [`TransformContext`](./api/README.md#transformcontext)
- [`NAME_USE_MAP`](./api/README.md#name_use_map), [`ADDRESS_USE_MAP`](./api/README.md#address_use_map)
  and [`ADDRESS_TYPE_MAP`](./api/README.md#address_type_map)
- [Issue codes](./issue-codes.md)

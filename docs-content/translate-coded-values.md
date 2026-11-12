---
id: translate-coded-values
title: Translate a coded field through a value map
sidebar_label: Translate coded values
description: "Translate a v2 table code to its FHIR code with the guide's value maps, keep the original coding beside it, and see what happens to a code the map leaves out."
---

# Translate a coded field through a value map

Some v2 coded fields hold a code from an HL7 table that the guide maps to a different FHIR code
system: route of administration (Table 0162) to the v3 route codes, for example. The message
assembly applies those maps for you. To apply one yourself, to a coded element you read from a
message, call `toFhirCodeableConceptVia` with the element and the map.

## Translate a code

```ts runnable
import { serializeResource } from "@cosyte/fhir";
import { ROUTE_VALUE_MAP, toFhirCodeableConceptVia } from "@cosyte/transform";

const { value, issues } = toFhirCodeableConceptVia({ identifier: "IM" }, ROUTE_VALUE_MAP);

value === undefined ? undefined : JSON.parse(serializeResource(value)); // => { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0162", code: "IM" }, { system: "http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration", code: "IM", display: "Injection, intramuscular" }] }
issues; // => []
```

The translation is additive: the original code stays first, in its v2 table's system, and the FHIR
code is added after it. Nothing the sender wrote is replaced.

## Know which maps ship

| Map | v2 table | Field |
| --- | --- | --- |
| `ROUTE_VALUE_MAP` | 0162 | RXR-1 route |
| `SITE_VALUE_MAP` | 0550 | RXR-2 site |
| `APPOINTMENT_TYPE_VALUE_MAP` | 0277 | SCH-8 appointment type |
| `SUBSTITUTION_VALUE_MAP` | 0161 | RXO-9 substitution |
| `ALLERGY_CATEGORY_VALUE_MAP` | 0127 | AL1-2, to `AllergyIntolerance.category` |
| `ALLERGY_TYPE_VALUE_MAP` | 0127 | AL1-2, to `AllergyIntolerance.type` |
| `ALLERGY_CRITICALITY_VALUE_MAP` | 0128 | AL1-4, to `AllergyIntolerance.criticality` |
| `ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP` | 0127 | AL1-2, the original code in the `alternate-codes` extension |
| `ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP` | 0128 | AL1-4, the original code in the `alternate-codes` extension |

Each was transcribed from the guide's published ConceptMap and checked against it. OBR-5 priority is
translated during assembly through `SERVICE_REQUEST_PRIORITY_MAP`, the guide's Table 0485 map, kept
as a lookup table rather than a map you pass here.

## Handle a code the map leaves out

A code the guide's map has no target for is not moved to a neighbor. The raw coding is kept, with no
system, and the result carries `TRANSFORM_CODE_UNMAPPED`:

```ts runnable
import { ROUTE_VALUE_MAP, toFhirCodeableConceptVia } from "@cosyte/transform";

const { issues } = toFhirCodeableConceptVia({ identifier: "XYZ" }, ROUTE_VALUE_MAP);

issues.map((i) => `${i.code} ${i.v2Location}`); // => ["TRANSFORM_CODE_UNMAPPED CWE.1"]
```

## Handle a code from another coding system

The map applies only when the element's coding system (CWE-3) is empty or names the map's own table
(`HL70162` or `0162` for routes). A code sent under any other system is a different code, even when
it is spelled the same, so it is carried as sent and not translated:

```ts runnable
import { createNamingSystem, ROUTE_VALUE_MAP, toFhirCodeableConceptVia } from "@cosyte/transform";

const { issues } = toFhirCodeableConceptVia(
  { identifier: "IM", nameOfCodingSystem: "99LOCAL" },
  ROUTE_VALUE_MAP,
  { namingSystem: createNamingSystem() },
);

issues.map((i) => i.code); // => ["TRANSFORM_CODE_SYSTEM_UNRESOLVED"]
```

Seed the naming system with `99LOCAL`'s URI ([Resolve assigning
authorities](./resolve-assigning-authorities.md#seed-coding-systems-too)) and the coding gets its system, still
untranslated.

## What is not translated

Fields the guide maps into SNOMED CT (RXR-4 method, SCH-7 reason) are carried as they arrive: SNOMED
CT content is not bundled. Fields the guide publishes no value map for (TXA-2 document type, RXA-5
vaccine code) are carried as they arrive too.

## Reference

- [`toFhirCodeableConceptVia`](./api/README.md#tofhircodeableconceptvia),
  [`translateBound`](./api/README.md#translatebound) and
  [`CodedValueMap`](./api/README.md#codedvaluemap)
- [`ROUTE_VALUE_MAP`](./api/README.md#route_value_map) and the other maps in the table
- [`toFhirCodeableConcept`](./api/README.md#tofhircodeableconcept): the structural converter used
  when no map applies
- [Issue codes](./issue-codes.md)

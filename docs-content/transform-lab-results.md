---
id: transform-lab-results
title: Transform a lab result
sidebar_label: Transform a lab result
description: "Turn an ORU^R01 into a DiagnosticReport with its Observations, and read each result's status, value type, notes and specimen."
---

# Transform a lab result

An `ORU^R01` carries lab results: an `OBR` per report and an `OBX` per result. `toFhir` turns each
`OBR` into a `DiagnosticReport` and each `OBX` under it into an `Observation` the report references.
This guide shows the result and the decisions that matter when you read it.

## Transform the message

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|LAB|LABFAC|EHR|HOSP|20260721150000-0500||ORU^R01^ORU_R01|MSG0002|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "OBR|1|PLACER1|FILLER1|24331-1^Lipid Panel^LN|||20260721143000-0500|||||||||||||||20260721150000-0500||LAB|F",
  "OBX|1|NM|2093-3^Cholesterol^LN||210.50|mg/dL^mg/dL^UCUM|<200|H|||F|||20260721143000-0500",
  "NTE|1||Fasting sample",
  "OBX|2|CWE|32207-3^Appearance^LN||NORMAL^Normal^L||||||C",
].join("\r");

const { bundle } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
});
const json = JSON.parse(serializeResource(bundle)) as {
  entry: { fullUrl: string; resource: Record<string, unknown> & { resourceType: string } }[];
};

json.entry.map((e) => e.resource.resourceType); // => ["MessageHeader", "Patient", "DiagnosticReport", "Observation", "Observation"]

const report = json.entry[2]?.resource;
report?.["status"]; // => "final"
(report?.["result"] as { reference: string }[]).map((r) => r.reference); // => [json.entry[3]?.fullUrl, json.entry[4]?.fullUrl]
```

The report's `status` comes from OBR-25 and each observation's from OBX-11, each through the
guide's status map.

## Read each result's status

The status maps are exported, so you can see exactly what each v2 code becomes. A corrected result
is `corrected` and a cancelled one `cancelled`; neither is ever reported as `final`. A code the map
has no target for leaves `status` absent, and because `status` is required, that resource is
withheld from the bundle with `TRANSFORM_RESOURCE_INVALID` rather than sent with a guessed status.

```ts runnable
import { DIAGNOSTIC_REPORT_STATUS_MAP, OBSERVATION_STATUS_MAP } from "@cosyte/transform";

OBSERVATION_STATUS_MAP["F"]; // => "final"
OBSERVATION_STATUS_MAP["C"]; // => "corrected"
OBSERVATION_STATUS_MAP["X"]; // => "cancelled"
DIAGNOSTIC_REPORT_STATUS_MAP["F"]; // => "final"
```

## Read each result's value

OBX-2 says what kind of value OBX-5 holds, and it picks the `value[x]` element. A result is never
forced into a `Quantity` it is not. When a value cannot be carried faithfully in its element (a
`TM` with a UTC offset, an `NA` with a magnitude a FHIR `decimal` cannot hold unchanged, an `NR`
neither of whose bounds a `decimal` can hold unchanged, an `ED` in any encoding but `Base64`), it
falls back to the raw text in `valueString` with `TRANSFORM_ELEMENT_DROPPED`; the `NA` and `NR`
cases also raise `TRANSFORM_QUANTITY_VALUE_INVALID` for each magnitude refused. An `NM` or `SN`
magnitude a `decimal` cannot hold unchanged, such as `+210`, also falls back to the raw text in
`valueString`, but it raises `TRANSFORM_QUANTITY_VALUE_INVALID` and no
`TRANSFORM_ELEMENT_DROPPED`.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|LAB|LABFAC|EHR|HOSP|20260721150000-0500||ORU^R01^ORU_R01|MSG0003|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "OBR|1|PLACER1|FILLER1|24331-1^Lipid Panel^LN|||20260721143000-0500|||||||||||||||20260721150000-0500||LAB|F",
  "OBX|1|NM|2093-3^Cholesterol^LN||+210|mg/dL^mg/dL^UCUM|||||F",
].join("\r");

const { bundle, issues } = toFhir(parseHL7(raw));
serializeResource(bundle).includes('"valueString":"+210"'); // => true
issues.some((i) => i.code === "TRANSFORM_QUANTITY_VALUE_INVALID"); // => true
issues.some((i) => i.code === "TRANSFORM_ELEMENT_DROPPED"); // => false
```

| OBX-2 | FHIR element |
| --- | --- |
| `NM` | `valueQuantity` |
| `CWE`, `CE`, `CF`, `CNE`, `IS` | `valueCodeableConcept` |
| `DT`, `DTM`, `TS` | `valueDateTime` |
| `SN` | a `valueQuantity` with a comparator, a `valueRange` or a `valueRatio` |
| `DR` | `valuePeriod` |
| `NR` | `valueRange` |
| `TM` | `valueTime` |
| `NA` | `valueSampledData` |
| `ED` with `Base64` encoding | the guide's `valueAttachment` extension, the payload carried as sent |
| `ST`, `TX`, `FT` | `valueString` |
| any other, such as `RP` | the raw text in `valueString`, with `TRANSFORM_ELEMENT_DROPPED` |

A numeric value keeps its digits exactly as sent: `210.50` stays `210.50` in the serialized JSON,
never the number `210.5`. The unit becomes `Quantity.code` only when it is declared UCUM and looks
like UCUM; otherwise it stays in `Quantity.unit` alone with `TRANSFORM_UNIT_NOT_UCUM`. Magnitudes are
never converted between units.

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|LAB|LABFAC|EHR|HOSP|20260721150000-0500||ORU^R01^ORU_R01|MSG0002|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "OBR|1|PLACER1|FILLER1|24331-1^Lipid Panel^LN|||20260721143000-0500|||||||||||||||20260721150000-0500||LAB|F",
  "OBX|1|NM|2093-3^Cholesterol^LN||210.50|mg/dL^mg/dL^UCUM|<200|H|||F|||20260721143000-0500",
  "NTE|1||Fasting sample",
].join("\r");

const { bundle } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
});
const text = serializeResource(bundle);

text.includes('"valueQuantity":{"value":210.50,"unit":"mg/dL","system":"http://unitsofmeasure.org","code":"mg/dL"}'); // => true
text.includes('"note":[{"text":"Fasting sample"}]'); // => true
text.includes('"referenceRange":[{"text":"<200"}]'); // => true
```

Read the result from the serialized JSON when the exact digits matter: `JSON.parse` turns
`210.50` into the number `210.5`.

## Notes and specimens

- An `NTE` right after an `OBX` becomes that observation's `note`. An `NTE` at the patient or order
  level has no published target and reaches nothing.
- An `SPM` becomes a `Specimen` the report references. If the report is withheld, its specimen is
  withheld with it rather than left on its own. `Specimen.status` is never set.

## What is not mapped

`DiagnosticReport.category` comes from OBR-24 when it is valued and is never defaulted. Only the
first `PID` and `PV1` are read, so a message with several patient result groups is not handled. OBR
performers, the specimen OBR names, and `basedOn` are not built. [Mapping
scope](./mapping-scope.md#lab-results-oru) has the full list.

## Reference

- [`toFhir`](./api/README.md#tofhir)
- [`OBSERVATION_STATUS_MAP`](./api/README.md#observation_status_map) and
  [`DIAGNOSTIC_REPORT_STATUS_MAP`](./api/README.md#diagnostic_report_status_map)
- [`HL70078_INTERPRETATION_CODES`](./api/README.md#hl70078_interpretation_codes)
- [`OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL`](./api/README.md#observation_value_attachment_extension_url)
- [Issue codes](./issue-codes.md)

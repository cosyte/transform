# Trademarks

`@cosyte/transform` is an independent open-source project. Cosyte is **not affiliated with,
endorsed by, or sponsored by** any organization named in this repository or its documentation.

## Why these names appear

This package maps HL7 v2 messages to FHIR R4 resources row by row from the HL7 Version 2 to FHIR
Implementation Guide, and the rows it implements name the code systems their values come from. A
mapping cannot be described, or checked against its source, without naming the standard, the guide,
and the code system it reads and writes.

Every reference is **descriptive**: it identifies the standard, guide, or code system a mapping
uses, and nothing more. No code-system content ships in this package.

## HL7 and FHIR

HL7 and FHIR are the registered trademarks of Health Level Seven International and their use does
not constitute endorsement by HL7.

## Names referenced

| Name                                       | Owner or publisher               | Where it appears                                                                                      |
| ------------------------------------------ | -------------------------------- | ----------------------------------------------------------------------------------------------------- |
| HL7, HL7 v2                                | Health Level Seven International | The source format, throughout the README, the docs, and the API.                                      |
| FHIR, FHIR R4                              | Health Level Seven International | The target format, throughout the README, the docs, and the API.                                      |
| HL7 Version 2 to FHIR Implementation Guide | Health Level Seven International | The mapping source every conversion cites (`hl7.fhir.uv.v2mappings`).                                 |
| US Core                                    | Health Level Seven International | The profiles the conformance report validates against (`hl7.fhir.us.core`).                           |
| SNOMED CT                                  | SNOMED International             | Named where a guide row targets it. Those fields stay structural; no SNOMED CT content ships.         |
| LOINC                                      | Regenstrief Institute            | Named among the code-system URIs the guide's maps cite, and in code examples. No LOINC content ships. |
| UCUM                                       | Regenstrief Institute            | The unit syntax `toFhirQuantity` checks a unit against. No UCUM table ships.                          |
| CPT                                        | American Medical Association     | Named in the troubleshooting page, for a modifier row of the guide that this package does not build.  |

All product names, logos, and brands are the property of their respective owners. Use of a name here
does not imply any affiliation with, or endorsement by, its owner. If you own one of these marks and
would like a reference changed, please open an issue.

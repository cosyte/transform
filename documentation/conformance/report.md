# Output conformance: measured, not asserted

This file is generated. Run `pnpm run conformance` to regenerate it and `documentation/conformance/result.json` beside it; the test suite fails the build when either drifts from what the harness now measures.

## The result

**0 of the 7 v2 test messages the implementation guide publishes produce a FHIR Bundle with zero error-severity results** against FHIR R4 4.0.1 plus the profiles named below from `hl7.fhir.us.core` version 9.0.0.

No message is clean on that measure. Every message and every finding is listed below.

Against the base R4 4.0.1 definitions alone, without any profile, 6 of 7 are clean: `ADT_A01`, `ORM_O01`, `OML_O21`, `ORU_R01`, `MDM_T02`, `VXU_V04`.

49 resources were validated in total, producing 38 error-severity results.

**This says nothing about mapping correctness.** A message with zero findings carries FHIR that is well formed and conforms to the profiles named here. It does not say the right v2 field reached the right FHIR element; no published artifact settles that, and this measurement does not try to.

## What was measured against

| package | version | role | sha256 | source |
|---|---|---|---|---|
| `hl7.fhir.r4.core` | 4.0.1 | base-definitions | `b090bf929e1f665cf2c91583720849695bc38d2892a7c5037c56cb00817fb091` | https://packages2.fhir.org/packages/hl7.fhir.r4.core/4.0.1 |
| `hl7.fhir.us.core` | 9.0.0 | profiles | `d7b54d2ec2a48cea94ffea5d939ad67a681f80b94d69594a08cebac36da9e059` | https://packages2.fhir.org/packages/hl7.fhir.us.core/9.0.0 |

The corpus is the guide's own published test messages, taken from https://hl7.org/fhir/uv/v2mappings/test_conversions.html (retrieved 2026-09-08, sha256 `a25b317e58c872b8bd21a3dcfb893b00f7fc2d24025dd21a83cef11678642a38`). Both packages are carried in this repository and verified by sha256 on every run: an absent, unreadable or hash-mismatched package fails the run explicitly, and nothing is fetched over the network.

## Which checks were performed, and which were not

A result is only as strong as the checks behind it, so they are listed here rather than left to be assumed.

| check | performed | detail |
|---|---|---|
| structure | yes | Every element of every resource is resolved against the R4 4.0.1 definition of its type; an element R4 does not define, a resource with no type, and an ambiguous choice element are errors. |
| element cardinality | yes | Minimum and maximum cardinality of every direct element, from the R4 4.0.1 snapshot, plus any cardinality the applied profile tightens. |
| primitive value domain | yes | The lexical form of every primitive is checked against its R4 datatype pattern. |
| required-binding membership | yes | Enforced for every `code` element whose required-strength value set expands offline from the pinned packages alone. A binding needing a filter, an exclusion, or a code system the packages do not publish complete is NOT evaluated; the counts are published beside this list. |
| profile fixed and pattern values | yes | `fixed[x]` and `pattern[x]` constraints of every applied profile. |
| profile slicing | yes | Slice membership by `value`, `pattern` and `exists` discriminators. A slicing whose discriminator cannot be evaluated is reported unchecked rather than passed. |
| must-support | yes | Reported at information severity only, never as an error: must-support is a system obligation, not an instance-presence requirement, so it never affects the passing count. |
| FHIRPath invariants | yes | Constraints on the base R4 definition and on every applied profile are evaluated where the expression is within the engine's FHIRPath subset; anything outside it is reported unchecked, at information severity, and never counted as a pass. |
| external terminology resolution | **no** | No terminology server is consulted and none is bundled. Membership in a value set drawn from SNOMED CT, LOINC, RxNorm, UCUM or any other externally-maintained system is NOT checked. |
| reference resolution across the Bundle | **no** | Whether a `Reference` resolves to an entry of the same Bundle is not evaluated here; the library's own property suite covers dangling `urn:uuid:` references. |
| mapping correctness | **no** | Nothing here says the right v2 field reached the right FHIR element. A zero-error result says the FHIR is well formed and conforms to the profiles named, not that the transform is right. |

Required-binding membership is enforced on 182 elements whose value set expands from the pinned packages alone, and is **not evaluated** on 13, each of which needs a code system or a filter the packages do not resolve offline.

## Which profile was applied to what

The profile package publishes several profiles for some resource types and none for others, and no resource can satisfy two topic-scoped profiles of the same type at once. The applied selection is reviewed by hand in `test/_support/conformance-claims.json`; the count the package publishes is read off the package itself, so the denominator is always visible.

| resource type | published by the package | applied here | why |
|---|---|---|---|
| AllergyIntolerance | 1 | `us-core-allergyintolerance` | The one AllergyIntolerance profile the package publishes. |
| Appointment | 0 | none (base R4 only) | US Core 9.0.0 publishes no Appointment profile. Validated against base R4 4.0.1 alone, and never recorded as profile-conformant. |
| Bundle | 0 | none (base R4 only) | US Core 9.0.0 publishes no Bundle profile. Validated against base R4 4.0.1 alone, and never recorded as profile-conformant. |
| Coverage | 1 | `us-core-coverage` | The one Coverage profile the package publishes. |
| DiagnosticReport | 2 | `us-core-diagnosticreport-lab` | The package publishes two DiagnosticReport profiles, one for laboratory results and one for clinical notes. The corpus carries one DiagnosticReport, from the ORU_R01, whose OBR-4 is a LOINC laboratory order and whose OBX results are laboratory values, so the laboratory profile is the one that applies. |
| DocumentReference | 2 | `us-core-documentreference` | The package publishes two DocumentReference profiles, the general one and one scoped to advance-directive documents. The corpus carries one DocumentReference, from the MDM_T02, whose TXA-2 document type is a discharge summary and not an advance directive, so the general profile is the one that applies. |
| Encounter | 1 | `us-core-encounter` | The one Encounter profile the package publishes. |
| Immunization | 1 | `us-core-immunization` | The one Immunization profile the package publishes. |
| MessageHeader | 0 | none (base R4 only) | US Core 9.0.0 publishes no MessageHeader profile. Validated against base R4 4.0.1 alone, and never recorded as profile-conformant. |
| Observation | 26 | `us-core-simple-observation` | Every Observation profile the package publishes is topic-scoped, so no resource can satisfy them all and applying them all would measure conformance to a set nothing can conform to. How many it publishes is printed beside this reason, read off the package itself rather than written here. The default applied is the package's own catch-all for observations no other profile covers. |
| Observation in `ORU_R01` | | `us-core-observation-lab` | The ORU_R01's three Observations are laboratory results, each carrying a LOINC code and a quantity, so the laboratory-result profile applies to them rather than the catch-all. |
| Patient | 1 | `us-core-patient` | The one Patient profile the package publishes. |
| RelatedPerson | 1 | `us-core-relatedperson` | The one RelatedPerson profile the package publishes. |
| ServiceRequest | 1 | `us-core-servicerequest` | The one ServiceRequest profile the package publishes. |

## Every message, every finding

### ADT_A01

7 resources validated, 5 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| RelatedPerson | `us-core-relatedperson` 9.0.0 | `RelatedPerson.active` | CARDINALITY_MIN | Required element is missing. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage` | INVARIANT_VIOLATED (us-core-15) | A resource invariant (content-validation constraint) was violated. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage.relationship` | CARDINALITY_MIN | Required element is missing. |

### SIU_S12

5 resources validated, 3 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| Appointment | base R4 4.0.1 | `Appointment` | INVARIANT_VIOLATED (app-3) | A resource invariant (content-validation constraint) was violated. |

### ORM_O01

7 resources validated, 5 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage` | INVARIANT_VIOLATED (us-core-15) | A resource invariant (content-validation constraint) was violated. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage.identifier.type` | CARDINALITY_MIN | Required element is missing. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage.relationship` | CARDINALITY_MIN | Required element is missing. |

### OML_O21

7 resources validated, 5 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage` | INVARIANT_VIOLATED (us-core-15) | A resource invariant (content-validation constraint) was violated. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage.identifier.type` | CARDINALITY_MIN | Required element is missing. |
| Coverage | `us-core-coverage` 9.0.0 | `Coverage.relationship` | CARDINALITY_MIN | Required element is missing. |

### ORU_R01

8 resources validated, 12 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Patient | `us-core-patient` 9.0.0 | `Patient.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| DiagnosticReport | `us-core-diagnosticreport-lab` 9.0.0 | `DiagnosticReport` | INVARIANT_VIOLATED (us-core-9) | A resource invariant (content-validation constraint) was violated. |
| DiagnosticReport | `us-core-diagnosticreport-lab` 9.0.0 | `DiagnosticReport.category` | CARDINALITY_MIN | Required element is missing. |
| DiagnosticReport | `us-core-diagnosticreport-lab` 9.0.0 | `DiagnosticReport.category:LaboratorySlice` | CARDINALITY_MIN | Required element is missing. |
| Observation | `us-core-observation-lab` 9.0.0 | `Observation.category` | CARDINALITY_MIN | Required element is missing. |
| Observation | `us-core-observation-lab` 9.0.0 | `Observation.category:us-core` | CARDINALITY_MIN | Required element is missing. |

### MDM_T02

5 resources validated, 4 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Patient | `us-core-patient` 9.0.0 | `Patient.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.identifier.system` | CARDINALITY_MIN | Required element is missing. |
| Encounter | `us-core-encounter` 9.0.0 | `Encounter.type` | CARDINALITY_MIN | Required element is missing. |
| DocumentReference | `us-core-documentreference` 9.0.0 | `DocumentReference.category` | CARDINALITY_MIN | Required element is missing. |

### VXU_V04

10 resources validated, 4 error-severity results.

| resource | validated against | element | finding | what it means |
|---|---|---|---|---|
| Observation | `us-core-simple-observation` 9.0.0 | `Observation.category` | CARDINALITY_MIN | Required element is missing. |

## The reviewed claims

Every pair below is a line somebody wrote on purpose. A pair declared conformant that starts failing breaks the build; so does a pair declared non-conformant that stops failing, so the register cannot rot into a list of stale excuses.

| message | resource | validated against | conformant |
|---|---|---|---|
| ADT_A01 | AllergyIntolerance | `us-core-allergyintolerance` | yes |
| ADT_A01 | Bundle | base R4 4.0.1 only | yes |
| ADT_A01 | Coverage | `us-core-coverage` | no (2) |
| ADT_A01 | Encounter | `us-core-encounter` | no (2) |
| ADT_A01 | MessageHeader | base R4 4.0.1 only | yes |
| ADT_A01 | Patient | `us-core-patient` | yes |
| ADT_A01 | RelatedPerson | `us-core-relatedperson` | no (1) |
| MDM_T02 | Bundle | base R4 4.0.1 only | yes |
| MDM_T02 | DocumentReference | `us-core-documentreference` | no (1) |
| MDM_T02 | Encounter | `us-core-encounter` | no (2) |
| MDM_T02 | MessageHeader | base R4 4.0.1 only | yes |
| MDM_T02 | Patient | `us-core-patient` | no (1) |
| OML_O21 | AllergyIntolerance | `us-core-allergyintolerance` | yes |
| OML_O21 | Bundle | base R4 4.0.1 only | yes |
| OML_O21 | Coverage | `us-core-coverage` | no (3) |
| OML_O21 | Encounter | `us-core-encounter` | no (2) |
| OML_O21 | MessageHeader | base R4 4.0.1 only | yes |
| OML_O21 | Patient | `us-core-patient` | yes |
| OML_O21 | ServiceRequest | `us-core-servicerequest` | yes |
| ORM_O01 | AllergyIntolerance | `us-core-allergyintolerance` | yes |
| ORM_O01 | Bundle | base R4 4.0.1 only | yes |
| ORM_O01 | Coverage | `us-core-coverage` | no (3) |
| ORM_O01 | Encounter | `us-core-encounter` | no (2) |
| ORM_O01 | MessageHeader | base R4 4.0.1 only | yes |
| ORM_O01 | Patient | `us-core-patient` | yes |
| ORM_O01 | ServiceRequest | `us-core-servicerequest` | yes |
| ORU_R01 | Bundle | base R4 4.0.1 only | yes |
| ORU_R01 | DiagnosticReport | `us-core-diagnosticreport-lab` | no (3) |
| ORU_R01 | Encounter | `us-core-encounter` | no (2) |
| ORU_R01 | MessageHeader | base R4 4.0.1 only | yes |
| ORU_R01 | Observation | `us-core-observation-lab` | no (6) |
| ORU_R01 | Patient | `us-core-patient` | no (1) |
| SIU_S12 | Appointment | base R4 4.0.1 only | no (1) |
| SIU_S12 | Bundle | base R4 4.0.1 only | yes |
| SIU_S12 | Encounter | `us-core-encounter` | no (2) |
| SIU_S12 | MessageHeader | base R4 4.0.1 only | yes |
| SIU_S12 | Patient | `us-core-patient` | yes |
| VXU_V04 | Bundle | base R4 4.0.1 only | yes |
| VXU_V04 | Immunization | `us-core-immunization` | yes |
| VXU_V04 | MessageHeader | base R4 4.0.1 only | yes |
| VXU_V04 | Observation | `us-core-simple-observation` | no (4) |
| VXU_V04 | Patient | `us-core-patient` | yes |


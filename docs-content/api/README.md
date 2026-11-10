# @cosyte/transform

Public entry point for `@cosyte/transform`: the HL7 v2 → FHIR R4 transformation library.

`@cosyte/transform` is **not** a parser; it is a **consumer** one tier above the parser suite. It
takes already-parsed `@cosyte/hl7` composites and produces validated `@cosyte/fhir` model nodes,
grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`,
STU Edition 1). Its whole promise is narrow and honest: **IG-grounded, fail-safe transformation
with typed, value-free diagnostics, never a confident wrong FHIR value.**

This module ships the six safety-critical datatype converters, the immutable
`OperationOutcome`-shaped diagnostic channel and the NamingSystem resolver they consult,
the message-level assembly (HL7 v2 **ADT → FHIR Patient + Encounter**, the
**ORU^R01 → DiagnosticReport + Observation** results graph, the order-entry graph
(**ORM_O01 / OML_O21 → ServiceRequest** and **RXO → MedicationRequest**), and the thin IG
singles (**VXU_V04 → Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference**),
all through `toFhir(msg)`), and the **terminology value-translation** layer: a
`$translate`-shaped [toFhirCodeableConceptVia](#tofhircodeableconceptvia) engine applying the license-clean IG value
ConceptMaps to the previously structural-only coded fields (route/site, appointment type,
substitution). OBR-5 order priority is not one of them: it is a lookup in
[SERVICE\_REQUEST\_PRIORITY\_MAP](#service_request_priority_map).

It also ships a **narrow reverse path**, FHIR → v2: [toV2Patient](#tov2patient) and
[toV2Observation](#tov2observation) emit a complete v2 message carrying a `PID` or an `OBX` built from the
subset of the IG segment maps whose inverse is defensible. Each requires the caller to supply the
v2 trigger, because no FHIR resource carries one. It is **lossy by design and not a round-trip**:
a value the inverse of the IG map cannot ground is flagged and left absent, never guessed.
Terminology **depth beyond these maps**, profiles, and any wider FHIR → v2 conversion are not
implemented.

## Classes

### SegmentReachLedger

Tracks, across one message-level assembly, which segment occurrences CONTRIBUTED to a resource the
returned bundle contains, and turns the rest into one value-free issue each.

The assembly marks an occurrence only where a resource has just cleared the emit gate and joined
the bundle, so "reached" means contributed-and-present by construction: an occurrence that was
read and refused, or that built a resource the gate withheld, is never marked and is therefore
reported.

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { SegmentReachLedger } from "@cosyte/transform";
// const ledger = new SegmentReachLedger(parseHL7(raw));
// ledger.markFirstOfType("MSH");
// ledger.issues(); // one issue per occurrence that reached nothing
```

#### Constructors

##### Constructor

> **new SegmentReachLedger**(`msg`): [`SegmentReachLedger`](#segmentreachledger)

###### Parameters

###### msg

`Hl7Message`

The parsed message whose occurrences are being tracked.

###### Returns

[`SegmentReachLedger`](#segmentreachledger)

#### Methods

##### issues()

> **issues**(): readonly [`TransformIssue`](#transformissue)[]

One value-free issue per reportable occurrence, in message order: the library-gap code when the
IG publishes a segment map for the name, the standard-gap code otherwise, and the standard-gap
code for every name that could not be classified at all.

###### Returns

readonly [`TransformIssue`](#transformissue)[]

##### mark()

> **mark**(...`segments`): `void`

Record that each given segment contributed to a resource now present in the bundle. `undefined`
entries are ignored, so a call site can pass an optional part of a group without branching.

###### Parameters

###### segments

...readonly (`Segment`\<`string`\> \| `undefined`)[]

###### Returns

`void`

##### markFirstOfType()

> **markFirstOfType**(`type`): `void`

Record that the FIRST occurrence of `type` contributed. The parser's derived views (`patient`,
`visit`, `meta`) are built from the first segment of their type, so this is how a resource built
from a view marks the occurrence it came from.

###### Parameters

###### type

`string`

###### Returns

`void`

##### markNthOfType()

> **markNthOfType**(`type`, `index`): `void`

Record that the `index`-th (0-based) occurrence of `type` contributed: the counterpart of
[SegmentReachLedger.markFirstOfType](#markfirstoftype) for the repeating views (`nextOfKin()`), whose
entries are in document order.

###### Parameters

###### type

`string`

###### index

`number`

###### Returns

`void`

##### reportable()

> **reportable**(): readonly [`SegmentOccurrence`](#segmentoccurrence)[]

The occurrences that contributed to no resource present in the bundle, in message order.

###### Returns

readonly [`SegmentOccurrence`](#segmentoccurrence)[]

## Interfaces

### AllergyBuildOptions

How much of the IG's AL1 mapping to carry: the alternate-codes extension is the one variable.

#### Properties

##### carryAlternateCodes?

> `readonly` `optional` **carryAlternateCodes?**: `boolean`

Whether to carry the IG's `alternate-codes` extension on `category` / `criticality`. Defaults to
`true`; the emit path builds a second draft with it off only when the first draft fails the
conservative-emit gate.

***

### CodedTarget

A translated FHIR target coding: the target CodeSystem URI + code, and the IG's target display.

#### Properties

##### code

> `readonly` **code**: `string`

The FHIR target code.

##### display?

> `readonly` `optional` **display?**: `string`

The IG map's target display, when it carries one (absent for the identity table maps).

##### system

> `readonly` **system**: `string`

The FHIR target CodeSystem canonical URI.

***

### CodedValueMap

A license-clean v2-table → FHIR value ConceptMap: it translates a **source table code** to its
[CodedTarget](#codedtarget), or `undefined` when the code is not in the map's *mapped* group (the IG's
`(unmapped)` group). Never fabricates a target.

#### Properties

##### name

> `readonly` **name**: `string`

The IG ConceptMap id this map transcribes (its citation).

##### sourceMnemonics

> `readonly` **sourceMnemonics**: `ReadonlySet`\<`string`\>

The CWE.3 (`nameOfCodingSystem`) mnemonics that denote this map's **bound source table**: the
HL7 forms (`"HL70162"`, `"0162"`, …). Translation applies **only** when the field's primary
coding is from the bound table: CWE.3 absent/empty (a positionally-bound bare code) **or** CWE.3 ∈
this set. A CWE that declares a **different** coding system (a local `99…`, or SNOMED) is not a
source-table code, so the map is not applied to it: the raw coding is carried structurally + its
system flagged, never asserted as the standard concept.

##### sourceSystem

> `readonly` **sourceSystem**: `string`

The source table's canonical CodeSystem URI (what the raw v2 code is a member of when mapped).

##### translate

> `readonly` **translate**: (`code`) => [`CodedTarget`](#codedtarget) \| `undefined`

Translate a source table code to its FHIR target, or `undefined` when the IG map has no target.

###### Parameters

###### code

`string`

###### Returns

[`CodedTarget`](#codedtarget) \| `undefined`

***

### ConvertResult

The result of one datatype conversion: the produced FHIR value (or `undefined` when the input was
empty or un-emittable) plus the diagnostics raised.

#### Example

```ts
import { toFhirHumanName } from "@cosyte/transform";
const { value, issues } = toFhirHumanName({ familyName: "Public" });
// value is a FHIR HumanName node; issues is [] here
void value;
void issues;
```

#### Type Parameters

##### T

`T`

The produced FHIR value's type (a `FhirComplex` datatype node, or a lexical string
  for `dateTime`).

#### Properties

##### issues

> `readonly` **issues**: readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics raised during the conversion, in emission order.

##### value

> `readonly` **value**: `T` \| `undefined`

The produced FHIR value, or `undefined` when nothing could be safely emitted.

***

### EntityIdentifier

One EI field read as a FHIR `Identifier`: the value, and whether an authority went unused.

#### Properties

##### authorityValued

> `readonly` **authorityValued**: `boolean`

Whether EI.2, EI.3 or EI.4 carried an assigning authority this library did not resolve.

##### identifier

> `readonly` **identifier**: `FhirComplex` \| `undefined`

The `Identifier` node built from EI.1, or `undefined` when EI.1 carries nothing.

***

### NamingSystemRegistry

The resolver consulted by the identity- and code-conversion paths.

#### Properties

##### resolveAssigningAuthority

> `readonly` **resolveAssigningAuthority**: (`hd`) => `string` \| `undefined`

Resolve an assigning authority (HD) to a FHIR `Identifier.system` URI, or `undefined` when it
cannot be resolved safely. **Never** synthesizes a URI from HD.1 alone.

###### Parameters

###### hd

`HD`

###### Returns

`string` \| `undefined`

##### resolveCodeSystem

> `readonly` **resolveCodeSystem**: (`mnemonic`) => `string` \| `undefined`

Resolve a v2 coding-system mnemonic to a canonical URI, or `undefined` when unrecognized.

###### Parameters

###### mnemonic

`string`

###### Returns

`string` \| `undefined`

***

### NamingSystemSeed

A seed for [createNamingSystem](#createnamingsystem): extra coding systems and explicit assigning authorities.

#### Properties

##### authorities?

> `readonly` `optional` **authorities?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Explicit assigning-authority entries, keyed by **HD.1 namespace mnemonic** and/or **HD.2
universal ID (OID)** → the `Identifier.system` URI. This is the safe, caller-vetted path the IG
calls for; the registry never derives a system from a mnemonic on its own.

##### codeSystems?

> `readonly` `optional` **codeSystems?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Extra v2 coding-system mnemonic → canonical URI entries (merged over the defaults).

***

### ReverseOptions

Caller context for a reverse (FHIR to v2) conversion. Every entry is **caller-vetted**: nothing
here is derived from resource content, and omitting all of it is safe (the conversion then flags
what it cannot resolve rather than guessing it).

#### Example

```ts
import { toV2Patient } from "@cosyte/transform";
const options = {
  assigningAuthorities: { "urn:oid:2.16.840.1.113883.19": "HOSP" },
  envelope: { sendingApp: "EHR", sendingFacility: "MAIN" },
};
void options;
void toV2Patient;
```

#### Properties

##### assigningAuthorities?

> `readonly` `optional` **assigningAuthorities?**: `Readonly`\<`Record`\<`string`, `string`\>\>

`Identifier.system` URI to the v2 assigning-authority namespace (HD.1) that stands for it. There
is no derivation from a URI to a namespace, so an identifier whose system is absent here is
emitted with its value and **no** assigning authority, flagged rather than invented.

##### codeSystems?

> `readonly` `optional` **codeSystems?**: `Readonly`\<`Record`\<`string`, `string`\>\>

Extra v2 coding-system mnemonic to canonical URI entries, merged over
[DEFAULT\_V2\_CODE\_SYSTEMS](#default_v2_code_systems) and then inverted. Same shape and direction as the forward
registry's seed, so one declaration serves both directions.

##### envelope?

> `readonly` `optional` **envelope?**: `Omit`\<`BuildMessageInit`, `"type"`\>

MSH envelope fields for the emitted message (sending/receiving application and facility, control
id, timestamp, version, processing id). The message type is never taken from here: it is fixed
by the shape plus the caller's trigger argument.

***

### SegmentOccurrence

One segment occurrence of a parsed message: a segment as it appears in the message, in message
order, with everything needed to locate it in a value-free way and nothing else.

#### Properties

##### name

> `readonly` **name**: `string` \| `undefined`

The renderable segment name, present only when it passed the shape test.

##### nameIndex

> `readonly` **nameIndex**: `number` \| `undefined`

1-based position among the occurrences of [SegmentOccurrence.name](#name-1), when there is one.

##### ordinal

> `readonly` **ordinal**: `number`

1-based position among **all** parsed positions, empty ones included, so it matches the wire.

##### segment

> `readonly` **segment**: `Segment`

The parsed segment this occurrence wraps.

***

### TransformContext

The context a converter consults. Carries the [NamingSystemRegistry](#namingsystemregistry) used to resolve an
assigning authority (HD) to an `Identifier.system` and a v2 coding-system mnemonic to a canonical
URI, plus the [TransformOptions](#transformoptions).

#### Properties

##### namingSystem?

> `readonly` `optional` **namingSystem?**: [`NamingSystemRegistry`](#namingsystemregistry)

The registry used to resolve HD → system and v2 mnemonic → canonical URI.

##### options?

> `readonly` `optional` **options?**: [`TransformOptions`](#transformoptions)

Conversion policy.

***

### TransformIssue

A single value-free diagnostic.

#### Example

```ts
import { ISSUE_CODES } from "@cosyte/transform";
// issue.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE
// issue.v2Location === "TS.1"; issue.fhirPath === "dateTime"
```

#### Properties

##### code

> `readonly` **code**: [`IssueCode`](#issuecode)

The stable code. One of [ISSUE\_CODES](#issue_codes).

##### fhirPath?

> `readonly` `optional` **fhirPath?**: `string`

The FHIR path this issue concerns (e.g. `Identifier.system`), when applicable.

##### message

> `readonly` **message**: `string`

A static, value-free description drawn from [ISSUE\_REGISTRY](#issue_registry).

##### severity

> `readonly` **severity**: [`TransformSeverity`](#transformseverity)

The `OperationOutcome`-style severity, fixed per code.

##### v2Location

> `readonly` **v2Location**: `string`

The v2 source location: a segment / field / component **index**, never a value.

***

### TransformOptions

Caller/profile policy for a conversion.

#### Remarks

`assumeTimezoneOffsetMinutes` is the **only** way a naked v2 timestamp acquires a time-of-day in
FHIR: the caller asserts the sender's offset (in minutes east of UTC, e.g. `-300` for US Eastern
standard time). It is a *sender-asserted* value, flagged as such; absent it, a naked timestamp is
reduced to date precision, **never** assumed to be UTC. Only an offset FHIR can write is applied:
a whole number of minutes from `-840` to `840` (`-14:00` to `+14:00`). Any other value is treated
as no offset, so a naked timestamp is still reduced to date precision and flagged.

#### Properties

##### assumeTimezoneOffsetMinutes?

> `readonly` `optional` **assumeTimezoneOffsetMinutes?**: `number`

The sender's UTC offset in minutes, asserted by the caller to resolve naked timestamps.

##### generateId?

> `readonly` `optional` **generateId?**: () => `string`

Allocator for the `urn:uuid:` `Bundle.entry.fullUrl` / reference identities the assembler mints.
Defaults to `crypto.randomUUID`. Inject a deterministic generator to make bundle output
reproducible (e.g. for golden fixtures). It must return a fresh, unique value per call: the
assembler relies on uniqueness for intra-bundle reference integrity.

###### Returns

`string`

##### namingSystem?

> `readonly` `optional` **namingSystem?**: [`NamingSystemRegistry`](#namingsystemregistry)

The [NamingSystemRegistry](#namingsystemregistry) the message-level transform threads into every datatype
conversion (HD → `Identifier.system`, v2 mnemonic → canonical URI). When omitted, a default
registry (`createNamingSystem()`) is used: it resolves only the FHIR-core-fixed systems and the
two unambiguous HD auto-derivations, so an un-seeded assigning authority surfaces a typed issue
rather than a guessed system.

***

### TransformResult

The immutable result of a message-level transform: the FHIR `Bundle` model and the value-free
diagnostics raised assembling it.

#### Properties

##### bundle

> `readonly` **bundle**: `FhirComplex`

The FHIR R4 `Bundle` resource node (a message Bundle: MessageHeader first, then focal resources).

##### issues

> `readonly` **issues**: readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics raised during assembly, in emission order.

## Type Aliases

### CodedElement

> **CodedElement** = `Pick`\<`CWE`, `"identifier"` \| `"text"` \| `"nameOfCodingSystem"` \| `"alternateIdentifier"` \| `"alternateText"` \| `"nameOfAlternateCodingSystem"` \| `"codingSystemVersionId"` \| `"alternateCodingSystemVersionId"` \| `"originalText"`\>

The subset of CWE fields a CE also provides, so `toFhirCodeableConcept` accepts both.

***

### FatalCode

> **FatalCode** = *typeof* [`FATAL_CODES`](#fatal_codes)\[keyof *typeof* [`FATAL_CODES`](#fatal_codes)\]

A value from [FATAL\_CODES](#fatal_codes): the type carried by a thrown fatal error.

***

### IssueCode

> **IssueCode** = *typeof* [`ISSUE_CODES`](#issue_codes)\[keyof *typeof* [`ISSUE_CODES`](#issue_codes)\]

A value from [ISSUE\_CODES](#issue_codes): the type consumers narrow `issue.code` against.

***

### ReverseResult

> **ReverseResult** = [`ConvertResult`](#convertresult)\<`Hl7Message`\>

What a reverse conversion returns: the complete `@cosyte/hl7` message it could faithfully build
(or `undefined` when it could not), plus the value-free diagnostics it raised. The same fail-safe
envelope the forward converters return, in the other direction.

#### Example

```ts
import { toV2Patient } from "@cosyte/transform";
// const { value, issues } = toV2Patient(patientNode, "A28");
// value?.toString() -> "MSH|^~\\&|...|ADT^A28|...\rPID|||MRN1\r"
void toV2Patient;
```

***

### TransformSeverity

> **TransformSeverity** = `"error"` \| `"warning"` \| `"information"`

The severity a [TransformIssue](#transformissue) carries: an `OperationOutcome.issue.severity` value.

## Variables

### ADDRESS\_TYPE\_MAP

> `const` **ADDRESS\_TYPE\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0190 address-type code → FHIR `address-type`, exactly per the IG HL70190→address-type map.

***

### ADDRESS\_USE\_MAP

> `const` **ADDRESS\_USE\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0190 address-type code → FHIR `address-use`, exactly per the IG HL70190→address-use map.

***

### ADDRESS\_USE\_TO\_V2

> `const` **ADDRESS\_USE\_TO\_V2**: `Readonly`\<`Record`\<`string`, `string`\>\>

FHIR `address-use` to HL7 v2 Table 0190, the invertible rows of the IG's **HL70190 to
address-use** map. `work` is absent on purpose (`B` and `O`), as is every `Address.type` row.

#### Example

```ts
import { ADDRESS_USE_TO_V2 } from "@cosyte/transform";
ADDRESS_USE_TO_V2["home"]; // => "H"
```

***

### ADMINISTRATIVE\_GENDER\_MAP

> `const` **ADMINISTRATIVE\_GENDER\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0001 (Administrative Sex) → FHIR `administrative-gender`, exactly per the IG
**Table HL70001 to Administrative Gender** ConceptMap (every row "is equivalent to"). `A`
(Ambiguous) and `N` (Not applicable) both narrow to `other`: the map's stated equivalence, carried
as-is. A code absent here (the map defines no `unmapped` default) leaves `gender` absent and is
flagged [ISSUE\_CODES.TRANSFORM\_CODE\_UNMAPPED](#transform_code_unmapped), never coerced to `unknown`.

***

### AL1\_ONSET\_WITHDRAWN\_AT

> `const` **AL1\_ONSET\_WITHDRAWN\_AT**: readonly `number`[]

The HL7 v2 version at which AL1-6 Identification Date was withdrawn, per the IG map's own comment
on that row ("Withdrawn as of 2.7, Refer to IAM-11 Onset or IAM-13 Reported Date"). A message at
this version or later carries no AL1-6 that this library will read as an onset.

#### Example

```ts
import { AL1_ONSET_WITHDRAWN_AT } from "@cosyte/transform";
AL1_ONSET_WITHDRAWN_AT; // [2, 7]
```

***

### ALLERGY\_CATEGORY\_VALUE\_MAP

> `const` **ALLERGY\_CATEGORY\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**AL1-2 Allergen Type to category**: IG `ConceptMap/table-hl70127-to-allergy-intolerance-category`.
One **mapped** group of six rows into the FHIR R4 `AllergyIntoleranceCategory` code system (`DA`
drug to `medication`, `FA` food to `food`, `EA` environmental to `environment`, `AA` animal to
`biologic`, `PA` plant to `environment`, `LA` pollen to `environment`, each `equivalent`, with the
IG target displays), and an `(unmapped)` group of two: **`MA` and `MC` have no category target**.

The IG applies this map to `AllergyIntolerance.category` **only**; `AllergyIntolerance.type` has
its own map ([ALLERGY\_TYPE\_VALUE\_MAP](#allergy_type_value_map)) over the same source table, and the two are resolved
independently. `MA` therefore yields a type and no category, which is the guide's answer and not a
gap to be filled: a category is never borrowed from the type map or from a neighbouring code.

***

### ALLERGY\_CLINICAL\_STATUS\_CODE

> `const` **ALLERGY\_CLINICAL\_STATUS\_CODE**: `"active"` = `"active"`

The fixed `clinicalStatus` code the IG assigns. The guide's own note explains why it is fixed
rather than derived: constraint ait-1 requires a clinicalStatus unless the verificationStatus is
`entered-in-error`, and no AL1 component can ground that retraction.

#### Example

```ts
import { ALLERGY_CLINICAL_STATUS_CODE } from "@cosyte/transform";
ALLERGY_CLINICAL_STATUS_CODE; // "active"
```

***

### ALLERGY\_CLINICAL\_STATUS\_SYSTEM

> `const` **ALLERGY\_CLINICAL\_STATUS\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"` = `"http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical"`

The code system of the fixed `clinicalStatus` the IG assigns to every AllergyIntolerance built
from an AL1, transcribed from the segment map's own sort-order 0 row.

#### Example

```ts
import { ALLERGY_CLINICAL_STATUS_SYSTEM } from "@cosyte/transform";
ALLERGY_CLINICAL_STATUS_SYSTEM.endsWith("allergyintolerance-clinical"); // true
```

***

### ALLERGY\_CRITICALITY\_VALUE\_MAP

> `const` **ALLERGY\_CRITICALITY\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**AL1-4 Allergy Severity to criticality**: IG
`ConceptMap/table-hl70128-to-allergy-intolerance-criticality`. One **mapped** group of two rows
into the FHIR R4 `AllergyIntoleranceCriticality` code system (`SV` severe to `high`, `MI` mild to
`low`, both `equivalent`, with the IG target displays), and an `(unmapped)` group of two: **`MO`
moderate and `U` unknown have no criticality target**.

The unmapped pair is the whole reason this field fails safe. `criticality` is an overall risk
assessment a prescriber acts on, so a moderate severity is left absent and flagged rather than
rounded to `low` or `high`, and `AllergyIntolerance.reaction.severity` is never populated from the
same component instead: the IG offers that only as a local variation, conditioned on a severity
that was **not** used equivalently to criticality, which no v2 message states.

***

### ALLERGY\_INTOLERANCE\_CATEGORY\_SYSTEM

> `const` **ALLERGY\_INTOLERANCE\_CATEGORY\_SYSTEM**: `"http://hl7.org/fhir/allergy-intolerance-category"` = `"http://hl7.org/fhir/allergy-intolerance-category"`

FHIR R4 `AllergyIntoleranceCategory` CodeSystem URI (the IG's AL1-2 category target).

***

### ALLERGY\_INTOLERANCE\_CRITICALITY\_SYSTEM

> `const` **ALLERGY\_INTOLERANCE\_CRITICALITY\_SYSTEM**: `"http://hl7.org/fhir/allergy-intolerance-criticality"` = `"http://hl7.org/fhir/allergy-intolerance-criticality"`

FHIR R4 `AllergyIntoleranceCriticality` CodeSystem URI (the IG's AL1-4 criticality target).

***

### ALLERGY\_INTOLERANCE\_TYPE\_SYSTEM

> `const` **ALLERGY\_INTOLERANCE\_TYPE\_SYSTEM**: `"http://hl7.org/fhir/allergy-intolerance-type"` = `"http://hl7.org/fhir/allergy-intolerance-type"`

FHIR R4 `AllergyIntoleranceType` CodeSystem URI (the IG's AL1-2 type target).

***

### ALLERGY\_ORIGINAL\_CATEGORY\_VALUE\_MAP

> `const` **ALLERGY\_ORIGINAL\_CATEGORY\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**AL1-2 original code**: IG `ConceptMap/table-hl70127-to-v2-0127`. A single **identity** group of
all eight Table 0127 codes (`DA`, `FA`, `MA`, `MC`, `EA`, `AA`, `PA`, `LA` to themselves, each
`equivalent`, source and target both `v2-0127`).

This is the map behind the `alternate-codes` extension the IG puts on `category`: whatever the
category map does or does not translate, the code the sender actually wrote survives on the
resource in its own code system, so a consumer can always see what the message said.

***

### ALLERGY\_ORIGINAL\_CRITICALITY\_VALUE\_MAP

> `const` **ALLERGY\_ORIGINAL\_CRITICALITY\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**AL1-4 original code**: IG `ConceptMap/table-hl70128-original-to-v2-0128`. A single **identity**
group of all four Table 0128 codes (`SV`, `MO`, `MI`, `U` to themselves, each `equivalent`, source
and target both `v2-0128`), the map behind the `alternate-codes` extension on `criticality`.

Its four codes are a superset of the two [ALLERGY\_CRITICALITY\_VALUE\_MAP](#allergy_criticality_value_map) translates, which
is the point: a `MO` that yields no criticality still yields the original severity code here.

***

### ALLERGY\_TYPE\_VALUE\_MAP

> `const` **ALLERGY\_TYPE\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**AL1-2 Allergen Type to type**: IG `ConceptMap/table-hl70127-to-allergy-intolerance-type`. One
**mapped** group of seven rows into the FHIR R4 `AllergyIntoleranceType` code system (`DA`, `FA`,
`MA`, `EA`, `AA`, `PA`, `LA` all to `allergy`, each `equivalent`, display `Allergy`), and an
`(unmapped)` group of one: **`MC` miscellaneous contraindication has no type target**.

Read beside [ALLERGY\_CATEGORY\_VALUE\_MAP](#allergy_category_value_map): the guide publishes two maps over Table 0127 with
different unmapped sets, so a code can be mapped by one and not the other. `MC` is the only code
neither map carries.

***

### ALTERNATE\_CODES\_EXTENSION\_URL

> `const` **ALTERNATE\_CODES\_EXTENSION\_URL**: `"http://hl7.org/fhir/StructureDefinition/alternate-codes"` = `"http://hl7.org/fhir/StructureDefinition/alternate-codes"`

The canonical URL of the FHIR `alternate-codes` extension, the IG's fixed assignment for the
`category.extension.url` and `criticality.extension.url` rows.

#### Example

```ts
import { ALTERNATE_CODES_EXTENSION_URL } from "@cosyte/transform";
ALTERNATE_CODES_EXTENSION_URL; // "http://hl7.org/fhir/StructureDefinition/alternate-codes"
```

***

### APPOINTMENT\_STATUS\_MAP

> `const` **APPOINTMENT\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0278 (Filler Status Code) → FHIR `appointmentstatus` (`Appointment.status`), per the IG
**Table HL70278 to AppointmentStatus** ConceptMap (each `is equivalent to`). The three source codes
the IG leaves **unmatched** (`Discontinued`, `Blocked`, `Overbook`) are absent here on purpose: an
SCH-25 carrying one of them (or any local code) leaves `Appointment.status` absent + flagged and the
required-`status` emit gate withholds the Appointment.

***

### APPOINTMENT\_TYPE\_VALUE\_MAP

> `const` **APPOINTMENT\_TYPE\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**SCH-8 Appointment Type**: IG `ConceptMap/table-hl70277-to-v2-0277`. A single **identity** group
of the three v2-0277 codes (`Normal`, `Tentative`, `Complete` → themselves, each `equivalent`,
source and target both `v2-0277`). Any other code is unmapped → raw coding preserved + flagged.

***

### CONDITION\_ENTERED\_IN\_ERROR

> `const` **CONDITION\_ENTERED\_IN\_ERROR**: `"entered-in-error"` = `"entered-in-error"`

The `verificationStatus` code the DG1-21 row assigns, transcribed from the segment map's own
`Condition.verificationStatus.coding.code` assignment.

#### Example

```ts
import { CONDITION_ENTERED_IN_ERROR } from "@cosyte/transform";
CONDITION_ENTERED_IN_ERROR; // "entered-in-error"
```

***

### CONDITION\_VERIFICATION\_STATUS\_SYSTEM

> `const` **CONDITION\_VERIFICATION\_STATUS\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/condition-ver-status"` = `"http://terminology.hl7.org/CodeSystem/condition-ver-status"`

The code system of the `verificationStatus` the DG1-21 row assigns, transcribed from the segment
map's own `Condition.verificationStatus.coding.system` assignment.

#### Example

```ts
import { CONDITION_VERIFICATION_STATUS_SYSTEM } from "@cosyte/transform";
CONDITION_VERIFICATION_STATUS_SYSTEM.endsWith("condition-ver-status"); // true
```

***

### COVERAGE\_STATUS\_UNKNOWN

> `const` **COVERAGE\_STATUS\_UNKNOWN**: `"unknown"` = `"unknown"`

The `data-absent-reason` code carried by `Coverage.status`, the one FHIR-required element of this
resource that no published row of the segment map grounds.

#### Example

```ts
import { COVERAGE_STATUS_UNKNOWN } from "@cosyte/transform";
COVERAGE_STATUS_UNKNOWN; // "unknown"
```

***

### COVERAGE\_SUBSCRIBER\_ID\_EXTENSION\_URL

> `const` **COVERAGE\_SUBSCRIBER\_ID\_EXTENSION\_URL**: `"http://hl7.org/fhir/5.0/StructureDefinition/extension-subscriberId"` = `"http://hl7.org/fhir/5.0/StructureDefinition/extension-subscriberId"`

The canonical URL of the subscriber-id extension the IN1-10 and IN1-49 rows assign, transcribed
from the segment map's own `Coverage.extension.url` assignment.

#### Example

```ts
import { COVERAGE_SUBSCRIBER_ID_EXTENSION_URL } from "@cosyte/transform";
COVERAGE_SUBSCRIBER_ID_EXTENSION_URL.endsWith("extension-subscriberId"); // true
```

***

### DEFAULT\_V2\_CODE\_SYSTEMS

> `const` **DEFAULT\_V2\_CODE\_SYSTEMS**: `Readonly`\<`Record`\<`string`, `string`\>\>

A small, license-clean seed of v2 Table 0396 coding-system mnemonic → canonical URI, for the
FHIR-core-fixed systems whose URIs are universally cited (FHIR R4 terminologies-systems.html).
The full HL7 THO NamingSystem crosswalk is not bundled; callers extend this via
[createNamingSystem](#createnamingsystem). **No terminology *content* is bundled: only identity URIs.**

***

### DG1\_RETRACTION\_ACTION\_CODE

> `const` **DG1\_RETRACTION\_ACTION\_CODE**: `"D"` = `"D"`

The Table 0206 (Segment Action Code) code the DG1-21 assignment covers. The row assigns a
retraction and names no source code; `D` is Delete, and the row's own comment excludes the rest.

#### Example

```ts
import { DG1_RETRACTION_ACTION_CODE } from "@cosyte/transform";
DG1_RETRACTION_ACTION_CODE; // "D"
```

***

### DIAGNOSTIC\_REPORT\_STATUS\_MAP

> `const` **DIAGNOSTIC\_REPORT\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0123 (Result Status) → FHIR `diagnostic-report-status` (`DiagnosticReport.status`), per
the IG **Table HL70123 [Queries] to Diagnostic Report Status** ConceptMap (each `is equivalent to`).
Only these **eight** source codes carry a target; the IG leaves `A`, `M`, `N`, `Y`, `Z` unmapped
(verified firsthand against the published v1.0.0 ConceptMap: `N` "Procedure completed, results
pending" is in the `(not mapped)` group, and the map declares no `unmapped` default), so an OBR-25
with one of them leaves `status` absent + flagged and the report is withheld. In particular a
results-**pending** `N` is **never** emitted as the post-final `appended`. **`C`→`corrected` and
`X`→`cancelled` guarantee a corrected/cancelled report never emits as `final`.**

***

### ED\_BASE64\_ENCODING

> `const` **ED\_BASE64\_ENCODING**: `"Base64"` = `"Base64"`

The OBX-5.4 encoding the OBX map conditions **both** of its `ED` rows on. Any other encoding
(`A`, `Hex`, `Ascii`, a local token) leaves those rows unapplied, so no attachment is built.

#### Example

```ts
import { ED_BASE64_ENCODING } from "@cosyte/transform";
ED_BASE64_ENCODING; // "Base64"
```

***

### ENCOUNTER\_CLASS\_V3\_MAP

> `const` **ENCOUNTER\_CLASS\_V3\_MAP**: `Readonly`\<`Record`\<`string`, \{ `code`: `string`; `display`: `string`; \}\>\>

HL7 v2 Table 0004 (Patient Class) → FHIR v3 ActCode (`Encounter.class`), per the IG **Table HL70004
to V3 ActCode** ConceptMap (each "is equivalent to"). Only these four v2 classes have a v3 ActCode
equivalent; the remaining classes (R/B/C/N/U) map to themselves and stay in the v2-0004 system
(V2\_0004\_SYSTEM) per the same map's V2→V2 rows.

***

### ENCOUNTER\_STATUS\_MAP

> `const` **ENCOUNTER\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0004 (Patient Class) → FHIR `Encounter.status`, per the IG **Table HL70004 to
Encounter Status** ConceptMap. Applied only when PV1-45 (discharge date) is *not* valued: a valued
discharge sets `status = finished` per the PV1→Encounter map.

***

### FATAL\_CODES

> `const` **FATAL\_CODES**: `object`

Stable **fatal codes**: the reserved names for unrecoverable input conditions. **Nothing in this
library throws one today**; every path, datatype and message level alike, fails safe to a
value-free issue instead. They are declared so that a future one is an addition rather than a
rename.

#### Type Declaration

##### EMPTY\_INPUT

> `readonly` **EMPTY\_INPUT**: `"EMPTY_INPUT"` = `"EMPTY_INPUT"`

The input carried nothing to transform.

##### TRANSFORM\_UNSUPPORTED\_INPUT

> `readonly` **TRANSFORM\_UNSUPPORTED\_INPUT**: `"TRANSFORM_UNSUPPORTED_INPUT"` = `"TRANSFORM_UNSUPPORTED_INPUT"`

The input was not a shape this transform accepts.

#### Example

```ts
import { FATAL_CODES } from "@cosyte/transform";
void FATAL_CODES.EMPTY_INPUT;
```

***

### GENDER\_TO\_V2

> `const` **GENDER\_TO\_V2**: `Readonly`\<`Record`\<`string`, `string`\>\>

FHIR `administrative-gender` to HL7 v2 Table 0001, the invertible rows of the IG's **HL70001 to
Administrative Gender** map. `other` is absent on purpose: three source codes carry it.

#### Example

```ts
import { GENDER_TO_V2 } from "@cosyte/transform";
GENDER_TO_V2["female"]; // => "F"
GENDER_TO_V2["other"]; // => undefined (ambiguous inverse, flagged instead)
```

***

### HL70078\_INTERPRETATION\_CODES

> `const` **HL70078\_INTERPRETATION\_CODES**: `ReadonlySet`\<`string`\>

HL7 v2 Table 0078 (Abnormal Flags) → FHIR v3 ObservationInterpretation (`Observation.interpretation`),
per the IG **Table HL70078 to v3 ObservationInterpretation** ConceptMap. Every mapped row is
`is equivalent to` an **identically-spelled** v3 code (the map is code-preserving), so this is the set
of codes that carry a target: a flag **absent** from this set has no equivalent and is flagged
[ISSUE\_CODES.TRANSFORM\_CODE\_UNMAPPED](#transform_code_unmapped), never coerced (the IG leaves `AC`/`HM`/`OBX`/`QCF`/`TOX`
and any local flag unmapped, and declares no `unmapped` default).

***

### IG\_ALLERGY\_VALUE\_MAPS\_PUBLISHED

> `const` **IG\_ALLERGY\_VALUE\_MAPS\_PUBLISHED**: `"2025-10-07"` = `"2025-10-07"`

The publication date of [IG\_ALLERGY\_VALUE\_MAPS\_VERSION](#ig_allergy_value_maps_version), so a later release of the guide can
be told apart from a defect in this library.

#### Example

```ts
import { IG_ALLERGY_VALUE_MAPS_PUBLISHED } from "@cosyte/transform";
IG_ALLERGY_VALUE_MAPS_PUBLISHED; // "2025-10-07"
```

***

### IG\_ALLERGY\_VALUE\_MAPS\_RETRIEVED

> `const` **IG\_ALLERGY\_VALUE\_MAPS\_RETRIEVED**: `"2026-08-28"` = `"2026-08-28"`

The date the five AL1 allergy ConceptMaps were retrieved and transcribed into the maps below. A
target that surprises a reader is answered by re-reading the guide at this date: each map is a
transcription of a published document at a moment, not a live query.

#### Example

```ts
import { IG_ALLERGY_VALUE_MAPS_RETRIEVED } from "@cosyte/transform";
IG_ALLERGY_VALUE_MAPS_RETRIEVED; // "2026-08-28"
```

***

### IG\_ALLERGY\_VALUE\_MAPS\_SOURCE

> `const` **IG\_ALLERGY\_VALUE\_MAPS\_SOURCE**: `"https://hl7.org/fhir/uv/v2mappings/ConceptMap-segment-al1-to-allergyintolerance.html"` = `"https://hl7.org/fhir/uv/v2mappings/ConceptMap-segment-al1-to-allergyintolerance.html"`

The IG segment map the five AL1 allergy value maps hang off, so a reader can audit any row: it is
the page that names which vocabulary map applies to which AL1 field.

#### Example

```ts
import { IG_ALLERGY_VALUE_MAPS_SOURCE } from "@cosyte/transform";
IG_ALLERGY_VALUE_MAPS_SOURCE.startsWith("https://"); // true
```

***

### IG\_ALLERGY\_VALUE\_MAPS\_VERSION

> `const` **IG\_ALLERGY\_VALUE\_MAPS\_VERSION**: `"1.0.0"` = `"1.0.0"`

The published version of the HL7 Version 2 to FHIR Implementation Guide the five **AL1 allergy**
value maps below were transcribed from.

Recorded per map family rather than once for the file, because the earlier value maps here were
transcribed on their own date and this constant must not backdate or forward-date them.

#### Example

```ts
import { IG_ALLERGY_VALUE_MAPS_VERSION } from "@cosyte/transform";
IG_ALLERGY_VALUE_MAPS_VERSION; // "1.0.0"
```

***

### IG\_MAPPED\_ADT\_TRIGGERS

> `const` **IG\_MAPPED\_ADT\_TRIGGERS**: `ReadonlySet`\<`string`\>

The ADT trigger events the IG ships a **message** map for. Other triggers still transform, from the
reusable segment maps, but are flagged [ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_APPOINTMENT\_TRIGGERS

> `const` **IG\_MAPPED\_APPOINTMENT\_TRIGGERS**: `ReadonlySet`\<`string`\>

The scheduling trigger the IG ships a **message** map for. The IG maps only `SIU^S12`; other SIU
triggers still assemble their Appointment from the reusable SCH/AIS/PID segment maps but are flagged
[ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_DOCUMENT\_TRIGGERS

> `const` **IG\_MAPPED\_DOCUMENT\_TRIGGERS**: `ReadonlySet`\<`string`\>

The medical-document trigger the IG ships a **message** map for. The IG maps only `MDM^T02`; other MDM
triggers still assemble their DocumentReference from the reusable TXA/OBX segment maps but are flagged
[ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_IMMUNIZATION\_TRIGGERS

> `const` **IG\_MAPPED\_IMMUNIZATION\_TRIGGERS**: `ReadonlySet`\<`string`\>

The immunization trigger the IG ships a **message** map for. The IG maps only `VXU^V04`; other VXU
triggers still assemble their Immunization graph from the reusable RXA/RXR/ORC segment maps but are
flagged [ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_ORDER\_TRIGGERS

> `const` **IG\_MAPPED\_ORDER\_TRIGGERS**: `ReadonlySet`\<`string`\>

The order-message trigger events the IG ships a **message** map for, keyed `CODE^TRIGGER`. Only
`ORM^O01` and `OML^O21` are message-map-grounded; other order families (`OMP`, `OMG`, `RDE`, …)
still assemble their request graph from the reusable ORC/OBR/RXO/RXR segment maps but are flagged
[ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_ORU\_TRIGGERS

> `const` **IG\_MAPPED\_ORU\_TRIGGERS**: `ReadonlySet`\<`string`\>

The ORU trigger events the IG ships a **message** map for. The IG maps only `R01`; other ORU triggers
still assemble their results graph from the reusable OBR/OBX segment maps but are flagged
[ISSUE\_CODES.TRANSFORM\_SEGMENT\_ASSEMBLED](#transform_segment_assembled).

***

### IG\_MAPPED\_SEGMENT\_NAMES

> `const` **IG\_MAPPED\_SEGMENT\_NAMES**: `ReadonlySet`\<`string`\>

Every v2 segment name the guide publishes at least one segment-to-resource map for, at
[IG\_SEGMENT\_MAPS\_VERSION](#ig_segment_maps_version), as of [IG\_SEGMENT\_MAPS\_RETRIEVED](#ig_segment_maps_retrieved).

Thirty-three names, transcribed chapter by chapter from [IG\_SEGMENT\_MAPS\_SOURCE](#ig_segment_maps_source): Control
(`MSA`, `MSH`, `NTE`, `SFT`), Patient Administration (`AL1`, `EVN`, `IAM`, `MRG`, `NK1`, `PD1`,
`PID`, `PV1`, `PV2`), Order Entry (`OBR`, `ORC`, `TQ1`), Pharmacy and Vaccination (`RXA`, `RXO`,
`RXR`), Financial Management (`DG1`, `IN1`, `IN3`, `PR1`), Observation Reporting (`OBX`, `PRT`,
`SPM`), Medical Records (`TXA`), Scheduling (`AIG`, `AIL`, `AIP`, `AIS`, `SCH`) and Personnel
Management (`ROL`).

Two absences a reader is most likely to check, because they look like oversights and are not:
**`RXE` is not on this set** (the guide publishes no map for it, which is why this library counts
an `RXE` and refuses to assemble one), and neither is **`GT1`**.

#### Example

```ts
import { IG_MAPPED_SEGMENT_NAMES } from "@cosyte/transform";
IG_MAPPED_SEGMENT_NAMES.has("IAM"); // true
IG_MAPPED_SEGMENT_NAMES.has("RXE"); // false
```

***

### IG\_SEGMENT\_MAPS\_PUBLISHED

> `const` **IG\_SEGMENT\_MAPS\_PUBLISHED**: `"2025-10-07"` = `"2025-10-07"`

The publication date of [IG\_SEGMENT\_MAPS\_VERSION](#ig_segment_maps_version), so a later release of the guide can be
told apart from a defect in this library.

#### Example

```ts
import { IG_SEGMENT_MAPS_PUBLISHED } from "@cosyte/transform";
IG_SEGMENT_MAPS_PUBLISHED; // "2025-10-07"
```

***

### IG\_SEGMENT\_MAPS\_RETRIEVED

> `const` **IG\_SEGMENT\_MAPS\_RETRIEVED**: `"2026-08-22"` = `"2026-08-22"`

The date the Segment Maps index was retrieved and transcribed into [IG\_MAPPED\_SEGMENT\_NAMES](#ig_mapped_segment_names).

A classification that surprises a reader is answered by re-reading the index at this date: the set
is a transcription of a published document at a moment, not a live query.

#### Example

```ts
import { IG_SEGMENT_MAPS_RETRIEVED } from "@cosyte/transform";
IG_SEGMENT_MAPS_RETRIEVED; // "2026-08-22"
```

***

### IG\_SEGMENT\_MAPS\_SOURCE

> `const` **IG\_SEGMENT\_MAPS\_SOURCE**: `"https://hl7.org/fhir/uv/v2mappings/segment_maps.html"` = `"https://hl7.org/fhir/uv/v2mappings/segment_maps.html"`

The Segment Maps index this set was transcribed from, so a reader can audit any entry.

#### Example

```ts
import { IG_SEGMENT_MAPS_SOURCE } from "@cosyte/transform";
IG_SEGMENT_MAPS_SOURCE.startsWith("https://"); // true
```

***

### IG\_SEGMENT\_MAPS\_VERSION

> `const` **IG\_SEGMENT\_MAPS\_VERSION**: `"1.0.0"` = `"1.0.0"`

The published version of the HL7 Version 2 to FHIR Implementation Guide this set was read from.

#### Example

```ts
import { IG_SEGMENT_MAPS_VERSION } from "@cosyte/transform";
IG_SEGMENT_MAPS_VERSION; // "1.0.0"
```

***

### IMMUNIZATION\_STATUS\_MAP

> `const` **IMMUNIZATION\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0322 (Completion Status) → FHIR `Immunization.status`, per the IG **Table HL70322 to
Event Status** ConceptMap (each `is equivalent to`). Table 0322 has exactly these **four** source
codes and every one carries a target; the two distinct targets (`completed`, `not-done`) are both
valid members of the `immunization-status` required binding, so applying this map to
`Immunization.status` is faithful. Consulted only for a **valued** RXA-20 when **RXA-21 ≠ "D"** (the
IG's `mappedVia` condition on that row); the two other IG status rows assign fixed values directly (a
delete → `entered-in-error`, an unvalued RXA-20 → `completed`) and do not consult this map. See
buildStatus.

***

### IN1\_SUBSCRIBER\_NUMBER\_TYPE

> `const` **IN1\_SUBSCRIBER\_NUMBER\_TYPE**: `"SN"` = `"SN"`

The Table 0203 identifier-type code the IN1-10 row conditions its subscriber-id assignment on
(`IF CX.5 IS "SN"`, Subscriber Number). Any other identifier type leaves that row unapplied.

#### Example

```ts
import { IN1_SUBSCRIBER_NUMBER_TYPE } from "@cosyte/transform";
IN1_SUBSCRIBER_NUMBER_TYPE; // "SN"
```

***

### ISSUE\_CODES

> `const` **ISSUE\_CODES**: `object`

Stable **non-fatal issue codes**: the typed diagnostics the fail-safe rule emits.

#### Type Declaration

##### TRANSFORM\_ADDRESS\_USE\_UNMAPPED

> `readonly` **TRANSFORM\_ADDRESS\_USE\_UNMAPPED**: `"TRANSFORM_ADDRESS_USE_UNMAPPED"` = `"TRANSFORM_ADDRESS_USE_UNMAPPED"`

An XAD.7 address-type code has no equivalent in the IG's HL70190 → address-use/type
ConceptMaps; `Address.use`/`.type` are left absent rather than guessed.

##### TRANSFORM\_CODE\_NOT\_INVERTIBLE

> `readonly` **TRANSFORM\_CODE\_NOT\_INVERTIBLE**: `"TRANSFORM_CODE_NOT_INVERTIBLE"` = `"TRANSFORM_CODE_NOT_INVERTIBLE"`

A FHIR code has no usable inverse in the IG ConceptMap that governs its field: either several
v2 source codes map onto it (so the inverse is ambiguous) or the map has no row for it at all.
The v2 field is left absent, never resolved to one arbitrary member of the ambiguous set.

##### TRANSFORM\_CODE\_SYSTEM\_NOT\_V2

> `readonly` **TRANSFORM\_CODE\_SYSTEM\_NOT\_V2**: `"TRANSFORM_CODE_SYSTEM_NOT_V2"` = `"TRANSFORM_CODE_SYSTEM_NOT_V2"`

A `Coding.system` is not a system this library can name with a v2 coding-system mnemonic, so
the coding cannot be written into a v2 coded field. It is flagged rather than emitted with no
table context or with a code from an unrelated table.

##### TRANSFORM\_CODE\_SYSTEM\_UNRESOLVED

> `readonly` **TRANSFORM\_CODE\_SYSTEM\_UNRESOLVED**: `"TRANSFORM_CODE_SYSTEM_UNRESOLVED"` = `"TRANSFORM_CODE_SYSTEM_UNRESOLVED"`

A coding-system mnemonic (CWE.3 / CWE.6) was not recognized, so no canonical system URI could
be emitted. The code is preserved; a URI is **never** invented.

##### TRANSFORM\_CODE\_UNMAPPED

> `readonly` **TRANSFORM\_CODE\_UNMAPPED**: `"TRANSFORM_CODE_UNMAPPED"` = `"TRANSFORM_CODE_UNMAPPED"`

A coded value could not be mapped to a FHIR concept: either it carried no coding-system context
(CWE.3 absent), or it is a table code the IG ConceptMap has **no target** for (e.g. an OBX-11/
OBR-25 result status the HL70085/HL70123 map does not carry, or an OBX-8 abnormal flag absent from
HL70078). The original code is preserved / the FHIR value left absent; **never** coerced to a
neighbor and **never** guessed to `final`/`normal`.

##### TRANSFORM\_ELEMENT\_DROPPED

> `readonly` **TRANSFORM\_ELEMENT\_DROPPED**: `"TRANSFORM_ELEMENT_DROPPED"` = `"TRANSFORM_ELEMENT_DROPPED"`

A populated source element was not carried to its FHIR target and was dropped, either because
the IG map defines no target, or because that target's conversion is **not implemented**
(e.g. XTN→ContactPoint telecom, PV1 participants). Surfaced here rather than silently discarded,
never a fabricated value.

##### TRANSFORM\_IDENTIFIER\_SYSTEM\_UNRESOLVED

> `readonly` **TRANSFORM\_IDENTIFIER\_SYSTEM\_UNRESOLVED**: `"TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"` = `"TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"`

The assigning authority (HD) could not be resolved to a FHIR `Identifier.system` URI via the
NamingSystem registry. The identifier is emitted with its value and **no** system: a system URI
is **never** synthesized from HD.1 alone.

##### TRANSFORM\_MISSING\_TRIGGER

> `readonly` **TRANSFORM\_MISSING\_TRIGGER**: `"TRANSFORM_MISSING_TRIGGER"` = `"TRANSFORM_MISSING_TRIGGER"`

A reverse (FHIR to v2) conversion was called without the explicit message trigger it requires.
No FHIR resource carries a v2 trigger, so it is never inferred from resource content and never
defaulted: no message is built and no builder is called.

##### TRANSFORM\_NAME\_USE\_UNMAPPED

> `readonly` **TRANSFORM\_NAME\_USE\_UNMAPPED**: `"TRANSFORM_NAME_USE_UNMAPPED"` = `"TRANSFORM_NAME_USE_UNMAPPED"`

An XPN.7 name-type code has no equivalent in the IG's HL70200 → name-use ConceptMap;
`HumanName.use` is left absent rather than guessed.

##### TRANSFORM\_NO\_V2\_MESSAGE\_EMITTED

> `readonly` **TRANSFORM\_NO\_V2\_MESSAGE\_EMITTED**: `"TRANSFORM_NO_V2_MESSAGE_EMITTED"` = `"TRANSFORM_NO_V2_MESSAGE_EMITTED"`

A reverse (FHIR to v2) conversion produced **no message at all**: nothing in the resource
grounded a single field of the target segment, and an empty segment is never emitted. Raised so
that an empty-handed conversion is never indistinguishable from a successful one, and separate
from the refusals that name their own cause (an absent trigger, an unsupported resource type, a
structurally malformed resource).

##### TRANSFORM\_NO\_V2\_TARGET

> `readonly` **TRANSFORM\_NO\_V2\_TARGET**: `"TRANSFORM_NO_V2_TARGET"` = `"TRANSFORM_NO_V2_TARGET"`

A populated FHIR element has no v2 field in the narrow reverse map that covers this shape
(the IG map defines no source for it, or its inverse is not implemented here). The element is
surfaced and left out, never approximated into a neighbouring v2 field.

##### TRANSFORM\_QUANTITY\_VALUE\_INVALID

> `readonly` **TRANSFORM\_QUANTITY\_VALUE\_INVALID**: `"TRANSFORM_QUANTITY_VALUE_INVALID"` = `"TRANSFORM_QUANTITY_VALUE_INVALID"`

A v2 numeric value (NM) could not be represented as a FHIR `decimal` without altering it, e.g.
a leading `+`, a leading zero, or a trailing dot, which FHIR's `decimal` lexical form forbids. No
`Quantity` value is emitted rather than a canonicalized (and therefore altered) magnitude.

##### TRANSFORM\_REQUIRED\_ELEMENT\_UNKNOWN

> `readonly` **TRANSFORM\_REQUIRED\_ELEMENT\_UNKNOWN**: `"TRANSFORM_REQUIRED_ELEMENT_UNKNOWN"` = `"TRANSFORM_REQUIRED_ELEMENT_UNKNOWN"`

A FHIR-required element's value could not be faithfully derived from the source, so it was
emitted with a `data-absent-reason` extension (value `unknown`) rather than fabricated, e.g.
`MessageHeader.source.endpoint` from an MSH-3 application namespace that is not a URL.

##### TRANSFORM\_RESOURCE\_INVALID

> `readonly` **TRANSFORM\_RESOURCE\_INVALID**: `"TRANSFORM_RESOURCE_INVALID"` = `"TRANSFORM_RESOURCE_INVALID"`

A produced FHIR resource failed `@cosyte/fhir` R4 structural validation and was **withheld**
from the bundle rather than emitted as a silently-invalid resource: the conservative-emit gate.

##### TRANSFORM\_RESOURCE\_MALFORMED

> `readonly` **TRANSFORM\_RESOURCE\_MALFORMED**: `"TRANSFORM_RESOURCE_MALFORMED"` = `"TRANSFORM_RESOURCE_MALFORMED"`

A resource handed to a reverse (FHIR to v2) conversion is not structurally a FHIR resource of
its expected type (not an object, no `resourceType`, or an element carrying the wrong node
kind). Nothing is emitted and nothing is thrown.

##### TRANSFORM\_SEGMENT\_ASSEMBLED

> `readonly` **TRANSFORM\_SEGMENT\_ASSEMBLED**: `"TRANSFORM_SEGMENT_ASSEMBLED"` = `"TRANSFORM_SEGMENT_ASSEMBLED"`

The message's trigger event has no IG *message* map, so its resource graph was assembled from
the reusable IG *segment* maps rather than a message map. The graph is best-effort and flagged
as such, never a fabricated message map.

##### TRANSFORM\_SEGMENT\_NO\_IG\_MAP

> `readonly` **TRANSFORM\_SEGMENT\_NO\_IG\_MAP**: `"TRANSFORM_SEGMENT_NO_IG_MAP"` = `"TRANSFORM_SEGMENT_NO_IG_MAP"`

A segment the message carried did **not** reach any resource in the returned bundle, and its
name is **not** one the IG publishes a segment map for: a **standard gap**, not fixable here.
Custom Z-segments and `RXE` land on this code, and so does a name this library could not
classify at all, because a damaged segment identifier is never re-derived from the line: an
`AL1` whose identifier arrived as `AL11` reads as unclassifiable, not as an IG omission. Such an
occurrence is located `[#n]` by its 1-based position among the segments of the message, with no
name part at all.

##### TRANSFORM\_SEGMENT\_NOT\_EMITTED

> `readonly` **TRANSFORM\_SEGMENT\_NOT\_EMITTED**: `"TRANSFORM_SEGMENT_NOT_EMITTED"` = `"TRANSFORM_SEGMENT_NOT_EMITTED"`

A segment the message carried did **not** reach any resource in the returned bundle, and the IG
*does* publish a segment map for its name: a **library gap**, fixable here. Raised once per
occurrence, located `NAME[k]` with `k` counted 1-based among the occurrences of that name
(`DG1[1]`, `DG1[2]`), so a consumer can tell how much of the message the bundle represents
without diffing the two by hand. The occurrence may have been read and refused rather than never
read: being counted, or already named by another issue, is not the same as reaching a resource.

##### TRANSFORM\_TIMESTAMP\_DROPPED\_BY\_PARSER

> `readonly` **TRANSFORM\_TIMESTAMP\_DROPPED\_BY\_PARSER**: `"TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER"` = `"TRANSFORM_TIMESTAMP_DROPPED_BY_PARSER"`

A valued v2 date/time field reached this library with no timestamp at all, because the
`@cosyte/hl7` typed view it is read through hands back nothing for a value it cannot read:
PID-7, PV1-44, PV1-45 and MSH-7. No value is emitted and nothing else changes. Distinct from
[ISSUE\_CODES.TRANSFORM\_TIMESTAMP\_INVALID](#transform_timestamp_invalid), which is raised for a timestamp that did arrive
and could not be written; here there was nothing to try. Raised only when the field's own text
does not read as a timestamp either, so a view a caller replaced on purpose raises nothing.

##### TRANSFORM\_TIMESTAMP\_INVALID

> `readonly` **TRANSFORM\_TIMESTAMP\_INVALID**: `"TRANSFORM_TIMESTAMP_INVALID"` = `"TRANSFORM_TIMESTAMP_INVALID"`

A v2 DTM/TS could not be parsed into a valid FHIR date/time; no value was emitted.

##### TRANSFORM\_TIMESTAMP\_NO\_TIMEZONE

> `readonly` **TRANSFORM\_TIMESTAMP\_NO\_TIMEZONE**: `"TRANSFORM_TIMESTAMP_NO_TIMEZONE"` = `"TRANSFORM_TIMESTAMP_NO_TIMEZONE"`

A v2 DTM/TS carried a time-of-day but no timezone offset. FHIR forbids time-without-zone, so
the value was reduced to date precision (or an explicit sender offset applied via options),
**never** a guessed UTC.

##### TRANSFORM\_UNIT\_NOT\_UCUM

> `readonly` **TRANSFORM\_UNIT\_NOT\_UCUM**: `"TRANSFORM_UNIT_NOT_UCUM"` = `"TRANSFORM_UNIT_NOT_UCUM"`

A unit was not a valid UCUM code (or was not declared UCUM). It is preserved verbatim in
`Quantity.unit`; `Quantity.code`/`.system` are left absent: a UCUM code is **never** fabricated
and a magnitude is **never** converted.

##### TRANSFORM\_UNSUPPORTED\_RESOURCE

> `readonly` **TRANSFORM\_UNSUPPORTED\_RESOURCE**: `"TRANSFORM_UNSUPPORTED_RESOURCE"` = `"TRANSFORM_UNSUPPORTED_RESOURCE"`

A reverse (FHIR to v2) conversion was handed a resource outside the narrow set of shapes it
supports. No v2 message is emitted and no segment layout is guessed.

##### TRANSFORM\_V2\_REQUIRED\_FIELD\_ABSENT

> `readonly` **TRANSFORM\_V2\_REQUIRED\_FIELD\_ABSENT**: `"TRANSFORM_V2_REQUIRED_FIELD_ABSENT"` = `"TRANSFORM_V2_REQUIRED_FIELD_ABSENT"`

A v2 field the segment's own attribute table marks **required** (usage `R`) is absent from an
emitted segment, because the FHIR resource carried no source this reverse map could ground it
from, or the source it carried had no faithful v2 form. The field is left absent per v2
optionality rules and **declared here**: a placeholder is never written to satisfy v2 structure,
and the receiver is never left to discover the gap. Distinct from
[ISSUE\_CODES.TRANSFORM\_REQUIRED\_ELEMENT\_UNKNOWN](#transform_required_element_unknown), which is the forward direction's
FHIR-required element.

##### TRANSFORM\_VALUE\_NOT\_REPRESENTABLE

> `readonly` **TRANSFORM\_VALUE\_NOT\_REPRESENTABLE**: `"TRANSFORM_VALUE_NOT_REPRESENTABLE"` = `"TRANSFORM_VALUE_NOT_REPRESENTABLE"`

A FHIR value cannot be carried into its v2 target without altering it (a lexical form v2 has
no representation for, or content that exceeds the target's component structure). The v2 field
is left absent rather than truncated, rounded, or coerced.

#### Example

```ts
import { ISSUE_CODES } from "@cosyte/transform";
if (issue.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE) {
  // a v2 timestamp had a time-of-day but no timezone offset: reduced to date precision
}
```

***

### ISSUE\_REGISTRY

> `const` **ISSUE\_REGISTRY**: `Readonly`\<`Record`\<[`IssueCode`](#issuecode), `IssueMeta`\>\>

The per-code registry: severity, FHIR `issue-type`, and a static message. Frozen and exhaustive
over [ISSUE\_CODES](#issue_codes) (enforced by the `Record<IssueCode, …>` type: a new code will not
compile until it has an entry).

***

### NAME\_USE\_MAP

> `const` **NAME\_USE\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0200 name-type code → FHIR `name-use`, exactly per the IG **HL70200 → name-use**
ConceptMap (every row is "is equivalent to"). Codes absent here (A, B, C, F, I, K, NB, NOUSE, P,
REL, S, T, U, …) have **no FHIR equivalent** and are surfaced, never guessed.

***

### NAME\_USE\_TO\_V2

> `const` **NAME\_USE\_TO\_V2**: `Readonly`\<`Record`\<`string`, `string`\>\>

FHIR `name-use` to HL7 v2 Table 0200, the invertible rows of the IG's **HL70200 to name-use** map.
`official` and `temp` are absent on purpose: two source codes each.

#### Example

```ts
import { NAME_USE_TO_V2 } from "@cosyte/transform";
NAME_USE_TO_V2["maiden"]; // => "M"
```

***

### OBSERVATION\_STATUS\_MAP

> `const` **OBSERVATION\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0085 (Observation Result Status) → FHIR `observation-status` (`Observation.status`),
per the IG **Table HL70085 to Observation Status** ConceptMap (each `is equivalent to`). Only these
seven source codes carry a target; the codes the IG leaves unmapped (`B`, `I`, `N`, `O`, `R`, `S`,
`U`, `V`) are **absent here on purpose**: an OBX-11 with one of them (or any local code) leaves
`Observation.status` absent + flagged, and the required-`status` emit gate withholds the Observation.
**`C`→`corrected` and `X`→`cancelled` guarantee a corrected/cancelled result never emits as `final`.**

***

### OBSERVATION\_STATUS\_TO\_V2

> `const` **OBSERVATION\_STATUS\_TO\_V2**: `Readonly`\<`Record`\<`string`, `string`\>\>

FHIR `observation-status` to HL7 v2 Table 0085, the invertible rows of the IG's **HL70085 to
Observation Status** map. `entered-in-error` is absent on purpose (`D` and `W` both carry it), as
are the FHIR statuses the map never targets (`registered`, `unknown`).

#### Example

```ts
import { OBSERVATION_STATUS_TO_V2 } from "@cosyte/transform";
OBSERVATION_STATUS_TO_V2["corrected"]; // => "C"
OBSERVATION_STATUS_TO_V2["entered-in-error"]; // => undefined (ambiguous inverse, flagged instead)
```

***

### OBSERVATION\_VALUE\_ATTACHMENT\_EXTENSION\_URL

> `const` **OBSERVATION\_VALUE\_ATTACHMENT\_EXTENSION\_URL**: `"https://hl7.org/fhir/5.0/StructureDefinition/extension-Observation.valueAttachment"` = `"https://hl7.org/fhir/5.0/StructureDefinition/extension-Observation.valueAttachment"`

The extension URL the OBX map **fixes** on the `IF OBX-2 EQUALS "ED" AND IF OBX-5.4 EQUALS
"Base64"` rows, transcribed from the map's own `Observation.extension.url` assignment. R4 has no
`Observation.valueAttachment`, so the guide carries the R5 element as this named extension.

#### Example

```ts
import { OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL } from "@cosyte/transform";
OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL.endsWith("extension-Observation.valueAttachment"); // true
```

***

### PROCEDURE\_STATUS\_UNKNOWN

> `const` **PROCEDURE\_STATUS\_UNKNOWN**: `"unknown"` = `"unknown"`

The `Procedure.status` the PR1 map's own narrative row directs when the message context does not
determine one. No PR1 component carries a procedure status, so this is the value every Procedure
built from a PR1 carries.

#### Example

```ts
import { PROCEDURE_STATUS_UNKNOWN } from "@cosyte/transform";
PROCEDURE_STATUS_UNKNOWN; // "unknown"
```

***

### REQUEST\_STATUS\_MAP

> `const` **REQUEST\_STATUS\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0119 (Order Control Codes) → FHIR `request-status` (`ServiceRequest.status`), per the
IG **Table HL70119 to Request Status** ConceptMap (each `is equivalent to`). Only these **19** source
codes carry a target; every other v2-0119 code sits in the IG's explicit `(unmapped)` group
(verified firsthand against the published v1.0.0 ConceptMap: CH/CN/CP/DE/LI/NA/OE/OF/OP/OR/PA/RE/
RF/RP/RR/RU/SC/SN/SR/SS/UA/UC/UD/UF/UH/UM/UN/UR/UX/XO/XR/XX/MC are all `unmatched`, and the map
declares no `unmapped` default), so an ORC-1 with one of them leaves `status` absent + flagged and
the request is withheld. `request-status` has no `cancelled`; the cancel/discontinue codes map to
`revoked` and the hold codes to `on-hold`, exactly as the IG table specifies.

***

### ROUTE\_VALUE\_MAP

> `const` **ROUTE\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**RXR-1 Route**: IG `ConceptMap/table-hl70162-to-v2-0162`. Two IG groups, transcribed verbatim:
a 41-code **identity** group (source `v2-0162` → target `v2-0162`, each `equivalent`) and a 6-code
**remap** group into `v3-RouteOfAdministration` (`ID→IDINJ`, `IM→IM`, `IV→IVINJ`, `PO→PO`, `SC→SQ`,
`TD→TRNSDERM`, each `equivalent`, with the IG target displays). The two source-code sets are
disjoint. Any other v2-0162 code (or a non-table code) is unmapped → the raw coding is preserved
and flagged, never coerced.

***

### SAMPLED\_DATA\_ABSENT\_POINT

> `const` **SAMPLED\_DATA\_ABSENT\_POINT**: `"E"` = `"E"`

The `SampledData.data` token the Implementation Considerations chapter's own worked example
directs for a data point a repetition did not carry (`"set .dimensions to 4 and use E for the
data points not present"`). It is the FHIR-defined "error" token, and it is written **only** for
an absent position, never for a value that arrived and could not be converted.

#### Example

```ts
import { SAMPLED_DATA_ABSENT_POINT } from "@cosyte/transform";
SAMPLED_DATA_ABSENT_POINT; // "E"
```

***

### SAMPLED\_DATA\_UNGROUNDED

> `const` **SAMPLED\_DATA\_UNGROUNDED**: `"unknown"` = `"unknown"`

The `data-absent-reason` code carried by `SampledData.origin` and `SampledData.period`, the two
R4-required elements of that datatype that **no row of the IG's NA map, and no line of the
Implementation Considerations chapter it points at, supplies a source for**.

#### Example

```ts
import { SAMPLED_DATA_UNGROUNDED } from "@cosyte/transform";
SAMPLED_DATA_UNGROUNDED; // "unknown"
```

***

### SEGMENT\_IDENTIFIER\_SHAPE

> `const` **SEGMENT\_IDENTIFIER\_SHAPE**: `RegExp`

The HL7 v2 Chapter 2 segment-identifier shape: three characters, a leading letter, applied to the
name value ITSELF as a positive membership test that must pass before any name is rendered.

Everything else is a malformed name without exception: the empty string, a withheld marker, a raw
pre-delimiter token, a bare numeric like `202`, a four-character `AL11`. A malformed occurrence has
no name in this library's vocabulary and is identified by position instead.

#### Example

```ts
import { SEGMENT_IDENTIFIER_SHAPE } from "@cosyte/transform";
SEGMENT_IDENTIFIER_SHAPE.test("ZAL"); // true
SEGMENT_IDENTIFIER_SHAPE.test("202"); // false
```

***

### SERVICE\_REQUEST\_PRIORITY\_MAP

> `const` **SERVICE\_REQUEST\_PRIORITY\_MAP**: `Readonly`\<`Record`\<`string`, `string`\>\>

HL7 v2 Table 0485 (Extended Priority Codes) → FHIR `request-priority` (`ServiceRequest.priority`),
per the IG **Table HL70485 to Request Priority** ConceptMap (each `is equivalent to`; verified
firsthand against the published v1.0.0 ConceptMap). Only these **three** source codes carry a
target; every other v2-0485 code, namely `P` (Preop), `C` (Callback), `T` (Timing critical), the
`T{S,M,H,D,W,L}<integer>` timing-critical family, and `PRN` (As needed), sits in the IG's
`(unmapped)` group with no target, so an OBR-5 carrying one leaves `priority` absent + flagged.
All three targets (`stat`/`asap`/`routine`) are valid `request-priority` members.

***

### SITE\_VALUE\_MAP

> `const` **SITE\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**RXR-2 Administration Site**: IG `ConceptMap/table-hl70550-to-v2-0550`. A single **identity**
group of 443 body-part codes (source `v2-0550` → target `v2-0550`, each `equivalent`), transcribed
verbatim from the published STU1 ConceptMap, **including** its as-published data-quality artifacts
(`CHESTÂ`, a lone `Â`, `KIDNÂ`, where a stray U+00C2 leaked from the IG's source
encoding). They are preserved for source-fidelity; they are inert (a clean `CHEST`/`KIDN` simply
falls through to unmapped). A code not in the table is unmapped → raw coding preserved + flagged.

***

### SPM\_SHIPMENT\_IDENTIFIER\_TYPE

> `const` **SPM\_SHIPMENT\_IDENTIFIER\_TYPE**: `"SHIP"` = `"SHIP"`

The Table 0203 identifier-type code the SPM-32 row **assigns** to the shipment identifier
(`Specimen.identifier[3].type.coding.code = "SHIP"`, with the v2-0203 system beside it).

#### Example

```ts
import { SPM_SHIPMENT_IDENTIFIER_TYPE } from "@cosyte/transform";
SPM_SHIPMENT_IDENTIFIER_TYPE; // "SHIP"
```

***

### SUBSTITUTION\_VALUE\_MAP

> `const` **SUBSTITUTION\_VALUE\_MAP**: [`CodedValueMap`](#codedvaluemap)

**RXO-9 Allow Substitutions**: IG `ConceptMap/table-hl70161-to-v2-0161`. A single **identity**
group of the three v2-0161 codes (`N` NOT authorized, `G` generic, `T` therapeutic → themselves,
each `equivalent`, source and target both `v2-0161`), the target for
`MedicationRequest.substitution.allowedCodeableConcept`. Any other code is unmapped → the
substitution is withheld + flagged, never a fabricated substitution permission.

***

### TRANSFORM\_ISSUE\_SYSTEM

> `const` **TRANSFORM\_ISSUE\_SYSTEM**: `"https://cosyte.com/fhir/CodeSystem/transform-issue-codes"` = `"https://cosyte.com/fhir/CodeSystem/transform-issue-codes"`

The code system under which the transform's stable issue codes are carried in `details.coding`.

***

### V2\_0127\_SYSTEM

> `const` **V2\_0127\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0127"` = `"http://terminology.hl7.org/CodeSystem/v2-0127"`

HL7 v2 Table 0127 (Allergen Type) THO CodeSystem URI.

***

### V2\_0128\_SYSTEM

> `const` **V2\_0128\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0128"` = `"http://terminology.hl7.org/CodeSystem/v2-0128"`

HL7 v2 Table 0128 (Allergy Severity) THO CodeSystem URI.

***

### V2\_0161\_SYSTEM

> `const` **V2\_0161\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0161"` = `"http://terminology.hl7.org/CodeSystem/v2-0161"`

HL7 v2 Table 0161 (Allow Substitution) THO CodeSystem URI.

***

### V2\_0162\_SYSTEM

> `const` **V2\_0162\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0162"` = `"http://terminology.hl7.org/CodeSystem/v2-0162"`

HL7 v2 Table 0162 (Route of Administration) THO CodeSystem URI.

***

### V2\_0203\_SYSTEM

> `const` **V2\_0203\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0203"` = `"http://terminology.hl7.org/CodeSystem/v2-0203"`

The HL7 v2 Table 0203 identifier-type code system canonical URI: used to build `Identifier.type`.
(FHIR R4 terminologies-systems.html)

***

### V2\_0277\_SYSTEM

> `const` **V2\_0277\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0277"` = `"http://terminology.hl7.org/CodeSystem/v2-0277"`

HL7 v2 Table 0277 (Appointment Type Codes) THO CodeSystem URI.

***

### V2\_0550\_SYSTEM

> `const` **V2\_0550\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v2-0550"` = `"http://terminology.hl7.org/CodeSystem/v2-0550"`

HL7 v2 Table 0550 (Body Parts) THO CodeSystem URI.

***

### V3\_OBSERVATION\_INTERPRETATION\_SYSTEM

> `const` **V3\_OBSERVATION\_INTERPRETATION\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"` = `"http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation"`

The v3 ObservationInterpretation canonical system (FHIR `Observation.interpretation` binding).

#### Example

```ts
import { V3_OBSERVATION_INTERPRETATION_SYSTEM } from "@cosyte/transform";
V3_OBSERVATION_INTERPRETATION_SYSTEM.endsWith("v3-ObservationInterpretation"); // => true
```

***

### V3\_ROUTE\_OF\_ADMINISTRATION\_SYSTEM

> `const` **V3\_ROUTE\_OF\_ADMINISTRATION\_SYSTEM**: `"http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration"` = `"http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration"`

HL7 v3 RouteOfAdministration CodeSystem URI (the IG's remap target for the six common routes).

***

### VERSION

> `const` **VERSION**: `string` = `"0.1.5"`

Package version marker exported from the `@cosyte/transform` root.

Kept in lockstep with `package.json` by `cosyte-process sync-version`, which the `version` script
runs immediately after `changeset version`. The `: string` annotation is deliberate: without it
TypeScript infers the *literal* type (`declare const VERSION = "0.0.0"`), which leaks the current
release into consumers' types and makes an equality check against any other version a compile
error.

#### Example

```typescript
import { VERSION } from "@cosyte/transform";
console.log(VERSION);
```

## Functions

### addMinutes()

> **addMinutes**(`start`, `minutes`): `string` \| `undefined`

Add whole minutes to a FHIR `dateTime` that carries a time of day, preserving its stated offset and
its fractional seconds exactly. Returns `undefined` when the value is not a full zoned timestamp,
because a date is not a start a duration can be added to.

#### Parameters

##### start

`string`

The FHIR `dateTime` lexical value the conversion produced.

##### minutes

`number`

The number of minutes to add.

#### Returns

`string` \| `undefined`

#### Example

```ts
import { addMinutes } from "@cosyte/transform";
addMinutes("2026-01-15T10:30:00-05:00", 45); // "2026-01-15T11:15:00-05:00"
addMinutes("2026-01-15", 45); // undefined
```

***

### buildAnnotations()

> **buildAnnotations**(`notes`, `ctx`, `issues`): `FhirNode` \| `undefined`

Every FHIR `Annotation` a run of `NTE` segments contributes, in message order: one per valued
`NTE-3` repetition, each carrying that repetition's rendered text and the segment's `NTE-6` time.

Returns `undefined` when the segments carry no comment text at all, so a caller adds no empty
`note` element. The diagnostics raised are value-free: no byte of a note ever reaches one.

#### Parameters

##### notes

readonly `Segment`\<`string`\>[]

The `NTE` segments to read, in message order.

##### ctx

[`TransformContext`](#transformcontext)

The transform context (naming-system registry + timezone policy).

##### issues

[`TransformIssue`](#transformissue)[]

The issue sink for the deferred-row and timestamp diagnostics.

#### Returns

`FhirNode` \| `undefined`

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const nte = parseHL7(raw).segments("NTE");
// buildAnnotations(nte, {}, []); // a FHIR list of Annotation nodes, or undefined
```

***

### buildCondition()

> **buildCondition**(`dg1`, `patientFullUrl`, `ctx`, `v2Location`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Build a FHIR `Condition` resource node from one `DG1` occurrence, wired to the bundle's Patient.
Always produces a Condition: a DG1 states a diagnosis, so an occurrence that grounds neither a
code nor a description is emitted with its empty `code` declared rather than withheld.

#### Parameters

##### dg1

`Segment`

The `DG1` `@cosyte/hl7` `Segment`.

##### patientFullUrl

`string`

The bundle's Patient fullUrl, for `subject` (required 1..1).

##### ctx

[`TransformContext`](#transformcontext)

The transform context (naming-system registry + timezone policy).

##### v2Location

`string`

The occurrence's v2 location, for the codeless diagnostic (e.g. `DG1[0]`).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const dg1 = parseHL7(raw).segments("DG1")[0];
// const { value } = buildCondition(dg1!, "urn:uuid:pat", {}, "DG1[0]");
```

***

### buildCoverage()

> **buildCoverage**(`in1`, `patientFullUrl`, `ctx`, `v2Location`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Build a FHIR `Coverage` resource node from one `IN1` occurrence, wired to the bundle's Patient.
Returns `{ value: undefined }` when IN1-4 names no insurance company, because `payor` is required
by R4 and no other row of the segment map grounds it.

#### Parameters

##### in1

`Segment`

The `IN1` `@cosyte/hl7` `Segment`.

##### patientFullUrl

`string`

The bundle's Patient fullUrl, for `beneficiary` (required 1..1).

##### ctx

[`TransformContext`](#transformcontext)

The transform context (naming-system registry + timezone policy).

##### v2Location

`string`

The occurrence's v2 location, for the withholding diagnostic (e.g. `IN1[0]`).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const in1 = parseHL7(raw).segments("IN1")[0];
// const { value } = buildCoverage(in1!, "urn:uuid:pat", {}, "IN1[0]");
```

***

### buildProcedure()

> **buildProcedure**(`pr1`, `patientFullUrl`, `ctx`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Build a FHIR `Procedure` resource node from one `PR1` occurrence, wired to the bundle's Patient.
Always produces a Procedure: a PR1 states that a procedure happened, and `status` is grounded on
the map's own row rather than on the message, so nothing here can fail to be groundable.

#### Parameters

##### pr1

`Segment`

The `PR1` `@cosyte/hl7` `Segment`.

##### patientFullUrl

`string`

The bundle's Patient fullUrl, for `subject` (required 1..1).

##### ctx

[`TransformContext`](#transformcontext)

The transform context (naming-system registry + timezone policy).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const pr1 = parseHL7(raw).segments("PR1")[0];
// const { value } = buildProcedure(pr1!, "urn:uuid:pat", {});
```

***

### buildSpecimen()

> **buildSpecimen**(`spm`, `subjectFullUrl`, `ctx`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Build a FHIR `Specimen` resource node from one parsed HL7 v2 SPM segment. Returns
`{ value: undefined }` when the segment grounds no element of the map at all, because an empty
`Specimen` in a bundle is a claim that a sample was described when nothing about it was sent.

#### Parameters

##### spm

`Segment`

The SPM `@cosyte/hl7` `Segment`.

##### subjectFullUrl

`string` \| `undefined`

The `urn:uuid:` fullUrl of the bundle's Patient → `Specimen.subject`.

##### ctx

[`TransformContext`](#transformcontext)

The transform context (naming-system registry + timezone policy).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const spm = parseHL7(raw).segments("SPM")[0];
// const { value } = buildSpecimen(spm!, "urn:uuid:pat", {});
```

***

### carriesLegacyOnsetDate()

> **carriesLegacyOnsetDate**(`version`): `boolean`

Whether a message's MSH-12 version identifier is readable **and** earlier than the version at
which AL1-6 was withdrawn ([AL1\_ONSET\_WITHDRAWN\_AT](#al1_onset_withdrawn_at)).

Fails closed in both directions a version can be unusable: an absent MSH-12 and one this library
cannot compare (a vendor string, an empty component, anything outside the dotted-numeric shape)
both answer `false`, so a valued AL1-6 is dropped and flagged rather than read as an onset on a
message that may never have meant one.

#### Parameters

##### version

`string` \| `undefined`

The MSH-12 version identifier exactly as the parser published it.

#### Returns

`boolean`

#### Example

```ts
import { carriesLegacyOnsetDate } from "@cosyte/transform";
carriesLegacyOnsetDate("2.5.1"); // true
carriesLegacyOnsetDate("2.7"); // false
carriesLegacyOnsetDate(undefined); // false
```

***

### codeableConceptFromTarget()

> **codeableConceptFromTarget**(`target`, `text?`): `FhirComplex`

Build a FHIR `CodeableConcept` node for a [CodedTarget](#codedtarget): the single translated coding, with
an optional free-`text`. Used by translate-or-withhold callers (e.g. substitution) that build the
CodeableConcept only on a successful translation.

#### Parameters

##### target

[`CodedTarget`](#codedtarget)

The translated target coding.

##### text?

`string`

The original free text (`CWE.9`) to carry as `CodeableConcept.text`, if any.

#### Returns

`FhirComplex`

#### Example

```ts
import { codeableConceptFromTarget, V2_0161_SYSTEM } from "@cosyte/transform";
const cc = codeableConceptFromTarget({ system: V2_0161_SYSTEM, code: "G" });
void cc;
```

***

### collectAllergies()

> **collectAllergies**(`msg`): readonly `Segment`\<`string`\>[]

Every `AL1` occurrence a message carries, in message order. One AllergyIntolerance is created per
occurrence, per the IG message map's `0..-1` cardinality on the AL1 row.

#### Parameters

##### msg

`Hl7Message`

The parsed `@cosyte/hl7` message.

#### Returns

readonly `Segment`\<`string`\>[]

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// collectAllergies(parseHL7(raw)).length; // one entry per AL1 in the message
```

***

### collectCoverages()

> **collectCoverages**(`msg`): readonly `Segment`\<`string`\>[]

Every `IN1` occurrence a message carries, in message order. One Coverage is created per
occurrence, per the IG message map's INSURANCE group.

#### Parameters

##### msg

`Hl7Message`

The parsed `@cosyte/hl7` message.

#### Returns

readonly `Segment`\<`string`\>[]

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// collectCoverages(parseHL7(raw)).length; // one entry per IN1 in the message
```

***

### collectDiagnoses()

> **collectDiagnoses**(`msg`): readonly `Segment`\<`string`\>[]

Every `DG1` occurrence a message carries, in message order. One Condition is created per
occurrence, per the IG message map's `0..-1` cardinality on the DG1 row.

#### Parameters

##### msg

`Hl7Message`

The parsed `@cosyte/hl7` message.

#### Returns

readonly `Segment`\<`string`\>[]

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// collectDiagnoses(parseHL7(raw)).length; // one entry per DG1 in the message
```

***

### collectProcedures()

> **collectProcedures**(`msg`): readonly `Segment`\<`string`\>[]

Every `PR1` occurrence a message carries, in message order. One Procedure is created per
occurrence, per the IG message map's `0..-1` cardinality on the PROCEDURE group.

#### Parameters

##### msg

`Hl7Message`

The parsed `@cosyte/hl7` message.

#### Returns

readonly `Segment`\<`string`\>[]

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// collectProcedures(parseHL7(raw)).length; // one entry per PR1 in the message
```

***

### createNamingSystem()

> **createNamingSystem**(`seed?`): [`NamingSystemRegistry`](#namingsystemregistry)

Create a [NamingSystemRegistry](#namingsystemregistry). With no seed it resolves the built-in FHIR-core code systems
and the two unambiguous HD auto-derivations (OID/UUID); a seed adds caller-vetted code systems and
explicit assigning-authority URIs.

#### Parameters

##### seed?

[`NamingSystemSeed`](#namingsystemseed) = `{}`

#### Returns

[`NamingSystemRegistry`](#namingsystemregistry)

#### Example

```ts
import { createNamingSystem } from "@cosyte/transform";
const registry = createNamingSystem({
  authorities: { HOSPMRN: "urn:oid:2.16.840.1.113883.19.5" },
});
registry.resolveCodeSystem("LN"); // => "http://loinc.org"
```

***

### deferredCoverageIssues()

> **deferredCoverageIssues**(`in1`): readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics for the IN1 rows this library reads and deliberately does not build:
the payer address and the two policy-holder rows (each an Organization resource), the subscriber
(a Patient or RelatedPerson reference), and the relationship, whose value translation needs a
table this library does not carry.

Raised for the occurrence whether or not the Coverage itself is emitted, so a deferred row a
message actually valued is in the issues list rather than silently absent.

#### Parameters

##### in1

`Segment`

The `IN1` `@cosyte/hl7` `Segment`.

#### Returns

readonly [`TransformIssue`](#transformissue)[]

#### Example

```ts
// deferredCoverageIssues(in1).length; // one per valued deferred row
```

***

### deferredDiagnosisIssues()

> **deferredDiagnosisIssues**(`dg1`): readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics for the DG1 rows this library reads and deliberately does not build:
the diagnosing clinician (a Practitioner resource), and the parent diagnosis (a reference resolved
by identifier rather than by bundle position).

Raised for the occurrence whether or not the Condition itself is emitted, so a deferred row a
message actually valued is in the issues list rather than silently absent.

#### Parameters

##### dg1

`Segment`

The `DG1` `@cosyte/hl7` `Segment`.

#### Returns

readonly [`TransformIssue`](#transformissue)[]

#### Example

```ts
// deferredDiagnosisIssues(dg1).length; // one per valued deferred row
```

***

### deferredProcedureIssues()

> **deferredProcedureIssues**(`pr1`): readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics for the PR1 rows this library reads and deliberately does not build:
the three practitioner roles, the treating organizational unit, the parent procedure, and the code
modifier whose target is not an R4 element.

Raised for the occurrence whether or not the Procedure itself is emitted, so a deferred row a
message actually valued is in the issues list rather than silently absent.

#### Parameters

##### pr1

`Segment`

The `PR1` `@cosyte/hl7` `Segment`.

#### Returns

readonly [`TransformIssue`](#transformissue)[]

#### Example

```ts
// deferredProcedureIssues(pr1).length; // one per valued deferred row
```

***

### emitEncounterDiagnosis()

> **emitEncounterDiagnosis**(`encounter`, `conditionFullUrls`, `gate`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

The Encounter that should replace the emitted one once the message's diagnoses exist: the same
resource carrying the back-references, put through the conservative-emit gate first. When the
gate refuses the linked draft the ORIGINAL Encounter is returned unchanged and the link is
declared [ISSUE\_CODES.TRANSFORM\_ELEMENT\_DROPPED](#transform_element_dropped), so a detail never costs the visit.

The gate is a parameter rather than a call into the assembler, so what "the gate refuses this"
means stays in one place and the refusal branch is reachable from a test without a hand-built
invalid resource: the same shape the allergy emit path uses.

#### Parameters

##### encounter

`FhirComplex`

The Encounter node already in the bundle.

##### conditionFullUrls

readonly `string`[]

The fullUrls of the Conditions emitted for the same message, in order.

##### gate

(`resource`) => `boolean`

The conservative-emit predicate: `true` when the linked Encounter may replace it.

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
// emitEncounterDiagnosis(encounter, ["urn:uuid:cond-1"], () => true).value; // the linked one
```

***

### enumerateSegmentOccurrences()

> **enumerateSegmentOccurrences**(`msg`): readonly [`SegmentOccurrence`](#segmentoccurrence)[]

Every segment occurrence of a parsed message, in message order.

A position that carries neither a name nor any field content is the parser's ordinal placeholder
for a blank line: it is not a segment occurrence, it is left out, and it still advances the
ordinal of everything after it. A position that carries field content is an occurrence even when
its name is empty.

#### Parameters

##### msg

`Hl7Message`

The parsed message.

#### Returns

readonly [`SegmentOccurrence`](#segmentoccurrence)[]

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { enumerateSegmentOccurrences } from "@cosyte/transform";
// enumerateSegmentOccurrences(parseHL7(raw))[0]?.name; // "MSH"
```

***

### fhirIssueTypeFor()

> **fhirIssueTypeFor**(`code`): `string`

The FHIR `issue-type` code for an [IssueCode](#issuecode): used by the `OperationOutcome` renderer.

#### Parameters

##### code

[`IssueCode`](#issuecode)

The stable [IssueCode](#issuecode).

#### Returns

`string`

#### Example

```ts
import { fhirIssueTypeFor, ISSUE_CODES } from "@cosyte/transform";
fhirIssueTypeFor(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED); // "not-found"
```

***

### insuranceCompanyName()

> **insuranceCompanyName**(`in1`): `string`

The insurance company name an IN1 carries, read from XON.1 of IN1-4, or `""` when that component
carries nothing. The only row of the segment map that grounds the required `payor`.

#### Parameters

##### in1

`Segment`

The `IN1` `@cosyte/hl7` `Segment`.

#### Returns

`string`

#### Example

```ts
// insuranceCompanyName(in1); // the XON.1 organization name, verbatim
```

***

### invertCodeMap()

> **invertCodeMap**(`forward`): `Readonly`\<`Record`\<`string`, `string`\>\>

Invert a forward v2-to-FHIR code map, keeping **only** the targets exactly one v2 code maps to.

This is the bijective-subset rule as code. Where several v2 codes are "equivalent to" one FHIR
concept (Table 0001 `O`/`A`/`N` all map to `other`), the inverse is ambiguous: the target is
dropped here, and its caller flags `TRANSFORM_CODE_NOT_INVERTIBLE` rather than picking one member
of the set.

#### Parameters

##### forward

`Readonly`\<`Record`\<`string`, `string`\>\>

A v2 code to FHIR code map, as published by the IG ConceptMap.

#### Returns

`Readonly`\<`Record`\<`string`, `string`\>\>

#### Example

```ts
import { invertCodeMap } from "@cosyte/transform";
invertCodeMap({ F: "female", O: "other", A: "other" }); // => { female: "F" }
```

***

### isIgMappedSegmentName()

> **isIgMappedSegmentName**(`name`): `boolean`

Whether the guide publishes a segment map for `name`, decided against
[IG\_MAPPED\_SEGMENT\_NAMES](#ig_mapped_segment_names) and against nothing else.

The comparison is exact: a name this library could not classify is not in the set, and is reported
as a standard gap for that reason rather than because the guide was consulted and published
nothing. That conflation is deliberate and is documented on the code itself; the alternative would
be re-deriving a name the parser refused to vouch for.

#### Parameters

##### name

`string`

A v2 segment name, exactly as the parser published it.

#### Returns

`boolean`

#### Example

```ts
import { isIgMappedSegmentName } from "@cosyte/transform";
isIgMappedSegmentName("DG1"); // true
isIgMappedSegmentName("ZAL"); // false
```

***

### issue()

> **issue**(`code`, `v2Location`, `fhirPath?`): [`TransformIssue`](#transformissue)

Construct a value-free [TransformIssue](#transformissue). The severity and message come from
[ISSUE\_REGISTRY](#issue_registry); the caller supplies only positional metadata, so an issue can carry no PHI.

#### Parameters

##### code

[`IssueCode`](#issuecode)

The stable [IssueCode](#issuecode).

##### v2Location

`string`

The v2 source location (segment / field / component index), never a value.

##### fhirPath?

`string`

The FHIR path the issue concerns, when applicable.

#### Returns

[`TransformIssue`](#transformissue)

#### Example

```ts
import { issue, ISSUE_CODES } from "@cosyte/transform";
const i = issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime");
void i.severity; // "warning"
```

***

### isWellFormedSegmentName()

> **isWellFormedSegmentName**(`name`): `boolean`

Whether a segment name may be rendered: the shape test of [SEGMENT\_IDENTIFIER\_SHAPE](#segment_identifier_shape) applied
to the value itself.

Deliberately NOT an exclusion of known-bad literals. An exclusion test admits any value it has not
heard of, which is the wrong direction for a rule whose whole job is to keep message bytes out of
a diagnostic, and it would silently couple this library to one release of the parser package.

#### Parameters

##### name

`string`

The value the parser published as the occurrence's segment type.

#### Returns

`boolean`

#### Example

```ts
import { isWellFormedSegmentName } from "@cosyte/transform";
isWellFormedSegmentName("ZAL");  // true
isWellFormedSegmentName("AL11"); // false
```

***

### segmentOccurrenceLocation()

> **segmentOccurrenceLocation**(`occurrence`): `string`

The v2 location of an occurrence: `NAME[k]` for a name that passed the shape test, `[#n]` for one
that did not. Those are the only two shapes, and neither carries a field or component index.

#### Parameters

##### occurrence

[`SegmentOccurrence`](#segmentoccurrence)

The occurrence to locate.

#### Returns

`string`

#### Example

```ts
import { segmentOccurrenceLocation } from "@cosyte/transform";
// segmentOccurrenceLocation(occ); // "DG1[2]" or "[#4]"
```

***

### toFhir()

> **toFhir**(`msg`, `opts?`): [`TransformResult`](#transformresult)

Transform a parsed HL7 v2 message into a FHIR R4 message `Bundle`. Never throws for a well-formed
Hl7Message; every ambiguity, unmapped code, dropped element, or withheld resource surfaces
as a value-free [TransformIssue](#transformissue).

#### Parameters

##### msg

`Hl7Message`

A parsed `@cosyte/hl7` message.

##### opts?

[`TransformOptions`](#transformoptions) = `{}`

Transform options: the [TransformOptions.namingSystem](#namingsystem-1) registry, the naked-
  timestamp [TransformOptions.assumeTimezoneOffsetMinutes](#assumetimezoneoffsetminutes) policy, and a
  [TransformOptions.generateId](#generateid) allocator for reproducible fullUrls.

#### Returns

[`TransformResult`](#transformresult)

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
import { toFhir, createNamingSystem } from "@cosyte/transform";
const { bundle, issues } = toFhir(parseHL7(raw), { namingSystem: createNamingSystem() });
void bundle;
void issues;
```

***

### toFhirAddress()

> **toFhirAddress**(`xad`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Convert a parsed HL7 v2 XAD to a FHIR `Address` node. Returns `{ value: undefined }` when the
address carries no emittable part.

#### Parameters

##### xad

`XAD`

A parsed `@cosyte/hl7` `XAD`.

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirAddress } from "@cosyte/transform";
const { value } = toFhirAddress({ street: "1 Main St", city: "Boston", stateOrProvince: "MA", addressType: "H" });
// value === Address { use: "home", line: ["1 Main St"], city: "Boston", state: "MA" }
void value;
```

***

### toFhirCodeableConcept()

> **toFhirCodeableConcept**(`cwe`, `ctx?`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Convert a parsed HL7 v2 CWE (or CE) to a FHIR `CodeableConcept` node, fail-safe on the coding
system and on unmapped codes. Returns `{ value: undefined }` when the element is empty.

#### Parameters

##### cwe

[`CodedElement`](#codedelement)

A parsed `@cosyte/hl7` `CWE` (a `CE` is accepted as its subset).

##### ctx?

[`TransformContext`](#transformcontext) = `{}`

The transform context; `ctx.namingSystem` resolves the coding-system mnemonic.

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirCodeableConcept, createNamingSystem } from "@cosyte/transform";
const { value } = toFhirCodeableConcept(
  { identifier: "789-8", text: "Hemoglobin", nameOfCodingSystem: "LN" },
  { namingSystem: createNamingSystem() },
);
// coding[0] === { system: "http://loinc.org", code: "789-8", display: "Hemoglobin" }
void value;
```

***

### toFhirCodeableConceptVia()

> **toFhirCodeableConceptVia**(`cwe`, `map`, `ctx?`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Value-translate a coded v2 element to a FHIR `CodeableConcept` **via** a license-clean
[CodedValueMap](#codedvaluemap), **additively** and fail-safe, never mutating or discarding what the message
said:

- **Primary code recognized as a bound-table code** ([translateBound](#translatebound): CWE.3 absent or names
  the bound table, and the code is in the IG map's mapped group) → the **primary** coding is emitted
  in the recognized source-table system (`map.sourceSystem`, carrying `CWE.7` version) and the
  **derived** target coding is *appended* when it differs (a remap such as `SC→SQ`); the **alternate
  triplet** (`CWE.4/5/6`, via buildCoding, with its own system resolution + flags) and the
  original `CWE.9` text are preserved. No primary unmapped flag: the value was faithfully recognized.
- **Otherwise**: the primary declares a **foreign** coding system (not the bound table), the code is
  empty, or it is in the IG's `(unmapped)` group → this defers entirely to the **structural**
  [toFhirCodeableConcept](#tofhircodeableconcept), which preserves the raw coding (and its `CWE.4/5/6` alternate and
  `CWE.7` version) and flags it ([ISSUE\_CODES.TRANSFORM\_CODE\_UNMAPPED](#transform_code_unmapped) /
  `TRANSFORM_CODE_SYSTEM_UNRESOLVED`). A target is **never** fabricated, and a code that declares a
  foreign system is **never** asserted to be the standard concept.

#### Parameters

##### cwe

[`CodedElement`](#codedelement)

The parsed `@cosyte/hl7` coded element (its `identifier` is the candidate table code).

##### map

[`CodedValueMap`](#codedvaluemap)

The license-clean value map to apply (e.g. [ROUTE\_VALUE\_MAP](#route_value_map)).

##### ctx?

[`TransformContext`](#transformcontext) = `{}`

The transform context (threaded to the structural path + the alternate-triplet resolver).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirCodeableConceptVia, ROUTE_VALUE_MAP } from "@cosyte/transform";
const { value } = toFhirCodeableConceptVia({ identifier: "IM" }, ROUTE_VALUE_MAP);
// coding === [{ system: ".../v2-0162", code: "IM" },
//            { system: ".../v3-RouteOfAdministration", code: "IM", display: "Injection, intramuscular" }]
void value;
```

***

### toFhirDateTime()

> **toFhirDateTime**(`ts`, `options?`): [`ConvertResult`](#convertresult)\<`string`\>

Convert a parsed HL7 v2 timestamp to a FHIR `dateTime` lexical string, fail-safe on timezone and
precision. Returns `{ value: undefined }` only when the timestamp is unparseable.

#### Parameters

##### ts

`DtmParts`

A parsed `@cosyte/hl7` `TS` (`DtmParts`).

##### options?

[`TransformOptions`](#transformoptions) = `{}`

Conversion policy; `assumeTimezoneOffsetMinutes` supplies a sender-asserted offset.

#### Returns

[`ConvertResult`](#convertresult)\<`string`\>

#### Example

```ts
import { parseDtm } from "@cosyte/hl7";
import { toFhirDateTime } from "@cosyte/transform";
const { value } = toFhirDateTime(parseDtm("20260721"));
// value === "2026-07-21"
void value;
```

***

### toFhirEntityIdentifier()

> **toFhirEntityIdentifier**(`field`): [`EntityIdentifier`](#entityidentifier)

Read one EI (Entity Identifier) field as a FHIR `Identifier`, carrying EI.1 as
`Identifier.value` and nothing else. The same reading orderIdentifier applies to the
placer/filler order numbers, without the v2-0203 identifier type those rows assign.

`Identifier.system` is deliberately left absent even when EI.2 to EI.4 name an assigning
authority: a system URI is never synthesized from a bare namespace, because two senders reusing
one namespace would otherwise collide. The caller is told the authority went unused through
[EntityIdentifier.authorityValued](#authorityvalued) so it can raise its own value-free diagnostic.

#### Parameters

##### field

`Field`

The `EI` field, exactly as the parser published it.

#### Returns

[`EntityIdentifier`](#entityidentifier)

#### Example

```ts
import { parseHL7 } from "@cosyte/hl7";
// const dg1 = parseHL7(raw).segments("DG1")[0];
// toFhirEntityIdentifier(dg1!.field(20)).identifier; // { value: "<EI.1>" } or undefined
```

***

### toFhirHumanName()

> **toFhirHumanName**(`xpn`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Convert a parsed HL7 v2 XPN to a FHIR `HumanName` node. Returns `{ value: undefined }` when the
name carries no emittable part.

#### Parameters

##### xpn

`XPN`

A parsed `@cosyte/hl7` `XPN`.

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirHumanName } from "@cosyte/transform";
const { value } = toFhirHumanName({ familyName: "Public", givenName: "Jane", nameTypeCode: "L" });
// value === HumanName { use: "official", family: "Public", given: ["Jane"] }
void value;
```

***

### toFhirIdentifier()

> **toFhirIdentifier**(`cx`, `ctx?`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Convert a parsed HL7 v2 CX to a FHIR `Identifier` node, fail-safe on the assigning authority.
Returns `{ value: undefined }` when the CX carries no identifier value at all.

#### Parameters

##### cx

`CX`

A parsed `@cosyte/hl7` `CX`.

##### ctx?

[`TransformContext`](#transformcontext) = `{}`

The transform context; `ctx.namingSystem` resolves the assigning authority (HD).

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirIdentifier, createNamingSystem } from "@cosyte/transform";
const { value, issues } = toFhirIdentifier(
  { idNumber: "12345", assigningAuthority: { namespaceId: "HOSPMRN" } },
  { namingSystem: createNamingSystem() },
);
// no registry entry for a bare "HOSPMRN" namespace → value emitted, system absent, one issue
void value;
void issues;
```

***

### toFhirQuantity()

> **toFhirQuantity**(`value`, `units`, `ctx?`): [`ConvertResult`](#convertresult)\<`FhirComplex`\>

Convert a parsed HL7 v2 numeric value plus its units to a FHIR `Quantity` node, fail-safe on the
unit. Returns `{ value: undefined }` when the numeric magnitude is absent or non-numeric (a
Quantity without a value cannot be safely emitted).

#### Parameters

##### value

`NM`

A parsed `@cosyte/hl7` `NM` (its `.raw` carries the exact lexical value).

##### units

`CWE`

The units component (an OBX-6 `CWE`); its CWE.1 is the candidate UCUM code.

##### ctx?

[`TransformContext`](#transformcontext) = `{}`

The transform context; used to recognize the UCUM coding system.

#### Returns

[`ConvertResult`](#convertresult)\<`FhirComplex`\>

#### Example

```ts
import { toFhirQuantity } from "@cosyte/transform";
const { value } = toFhirQuantity(
  { raw: "5.4", value: 5.4 },
  { identifier: "mg/dL", nameOfCodingSystem: "UCUM" },
);
// value === Quantity { value: 5.4, unit: "mg/dL", system: "http://unitsofmeasure.org", code: "mg/dL" }
void value;
```

***

### toOperationOutcome()

> **toOperationOutcome**(`issues`): `FhirComplex`

Build a FHIR `OperationOutcome` FhirComplex from the given issues. An empty list still
produces a structurally-valid `OperationOutcome` with a single `information` "all clear" issue
(FHIR requires `OperationOutcome.issue` to be non-empty).

#### Parameters

##### issues

readonly [`TransformIssue`](#transformissue)[]

The value-free diagnostics to render.

#### Returns

`FhirComplex`

#### Example

```ts
import { toOperationOutcome } from "@cosyte/transform";
const oo = toOperationOutcome([]);
// oo is a FhirComplex resource node with resourceType "OperationOutcome"
void oo;
```

***

### toV2Observation()

> **toV2Observation**(`resource`, `trigger`, `options?`): [`ReverseResult`](#reverseresult)

Convert a FHIR R4 `Observation` into a **complete** v2 message carrying an `OBX` segment, in the
result-report (`ORU`) shape.

The `trigger` argument is **required and never inferred**: no `Observation` element maps to a v2
message trigger, so the caller supplies it, and a missing, empty or non-string one returns
`{ value: undefined }` plus [ISSUE\_CODES.TRANSFORM\_MISSING\_TRIGGER](#transform_missing_trigger) without calling the
message builder at all. It is used verbatim as MSH-9.2 under the `ORU` message code this shape
fixes.

The message carries the `OBX` alone: this shape's input is an `Observation`, which names no
patient, and a subject segment assembled from a reference would be fabricated. Lossy by design and
never round-trip-safe.

An `OBX` field v2 requires (OBX-11 Observation Result Status) that this resource gives no source
for stays absent and is declared with [ISSUE\_CODES.TRANSFORM\_V2\_REQUIRED\_FIELD\_ABSENT](#transform_v2_required_field_absent),
rather than defaulted to `F`: a result reported as final that the sender never called final is the
confidently wrong value this library exists to refuse. An `Observation` that grounds no `OBX`
field at all yields no message and [ISSUE\_CODES.TRANSFORM\_NO\_V2\_MESSAGE\_EMITTED](#transform_no_v2_message_emitted).

#### Parameters

##### resource

`FhirNode`

The FHIR `Observation` node.

##### trigger

`string`

The bare v2 trigger, e.g. `"R01"`. Required; never derived from the resource.

##### options?

[`ReverseOptions`](#reverseoptions) = `{}`

Caller-vetted reverse context: code systems and the MSH envelope.

#### Returns

[`ReverseResult`](#reverseresult)

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { toV2Observation } from "@cosyte/transform";

const { resource } = parseResource(
  '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]}}',
);
const { value, issues } = toV2Observation(resource, "R01");
// value.toString() carries "ORU^R01" in MSH-9, then an OBX whose OBX-3 is "789-8^^LN"
void value;
void issues;
```

***

### toV2Patient()

> **toV2Patient**(`resource`, `trigger`, `options?`): [`ReverseResult`](#reverseresult)

Convert a FHIR R4 `Patient` into a **complete** v2 message carrying a `PID` segment, for the
demographics-only trigger events (`A28`, `A31`, `A29`, ...) that carry a patient with no visit.

The `trigger` argument is **required and never inferred**: no `Patient` element maps to a v2
message trigger, so the caller supplies it, and a missing, empty or non-string one returns
`{ value: undefined }` plus [ISSUE\_CODES.TRANSFORM\_MISSING\_TRIGGER](#transform_missing_trigger) without calling the
message builder at all. It is used verbatim as MSH-9.2 under the `ADT` message code this shape
fixes; the caller never supplies the code and it never varies per call.

Lossy by design and never round-trip-safe: a value the inverse of the IG map cannot ground is
flagged and left absent, never guessed, and a resource of another type is refused outright.

A `PID` field v2 requires (PID-3 Patient Identifier List, PID-5 Patient Name) that this resource
gives no source for stays absent and is declared with
[ISSUE\_CODES.TRANSFORM\_V2\_REQUIRED\_FIELD\_ABSENT](#transform_v2_required_field_absent): the emitted message is honest about what
it lacks rather than padded to look conformant. A `Patient` that grounds no `PID` field at all
yields no message and [ISSUE\_CODES.TRANSFORM\_NO\_V2\_MESSAGE\_EMITTED](#transform_no_v2_message_emitted).

#### Parameters

##### resource

`FhirNode`

The FHIR `Patient` node (build one with `@cosyte/fhir`'s `parseResource`).

##### trigger

`string`

The bare v2 trigger, e.g. `"A28"`. Required; never derived from the resource.

##### options?

[`ReverseOptions`](#reverseoptions) = `{}`

Caller-vetted reverse context: assigning authorities, code systems, MSH envelope.

#### Returns

[`ReverseResult`](#reverseresult)

#### Example

```ts
import { parseResource } from "@cosyte/fhir";
import { toV2Patient } from "@cosyte/transform";

const { resource } = parseResource('{"resourceType":"Patient","gender":"female"}');
const { value, issues } = toV2Patient(resource, "A28");
// value.toString() starts "MSH|^~\\&|" and carries "ADT^A28" in MSH-9, then a PID segment
void value;
void issues;
```

***

### translateBound()

> **translateBound**(`cwe`, `map`): [`CodedTarget`](#codedtarget) \| `undefined`

The bound-table target for a coded element's **primary** coding, or `undefined` when the map does
not faithfully apply, i.e. the primary declares a coding system that is **not** this map's bound
table (CWE.3 present and not in [CodedValueMap.sourceMnemonics](#sourcemnemonics)), the primary code is empty, or
the code is in the IG map's `(unmapped)` group. Never asserts a standard translation for a foreign
coding system, and never fabricates a target.

#### Parameters

##### cwe

[`CodedElement`](#codedelement)

The parsed coded element (its `identifier` is the candidate source-table code).

##### map

[`CodedValueMap`](#codedvaluemap)

The license-clean value map to consider applying.

#### Returns

[`CodedTarget`](#codedtarget) \| `undefined`

#### Example

```ts
import { translateBound, ROUTE_VALUE_MAP } from "@cosyte/transform";
translateBound({ identifier: "IM" }, ROUTE_VALUE_MAP)?.code; // "IM" (v3 route)
translateBound({ identifier: "IM", nameOfCodingSystem: "99LOCAL" }, ROUTE_VALUE_MAP); // undefined
```

***

### withCodeableText()

> **withCodeableText**(`concept`, `textValue`): `FhirComplex`

The same `CodeableConcept` with its `text` replaced by `textValue`, so a segment row that targets
`code.text` directly can override the original text the datatype map read out of the coded field.

#### Parameters

##### concept

`FhirComplex`

The `CodeableConcept` node the datatype converter produced.

##### textValue

`string`

The text the segment map's own row assigns.

#### Returns

`FhirComplex`

#### Example

```ts
// withCodeableText(concept, "Diabetes mellitus") -> the same codings, that text
```

***

### withEncounterDiagnosis()

> **withEncounterDiagnosis**(`encounter`, `conditionFullUrls`): `FhirComplex`

The same Encounter carrying one `diagnosis` entry per Condition the bundle holds, per the ADT_A01
message map's `Encounter[1].diagnosis.reference = Condition[1].id` row. Each entry's `condition`
points at that Condition's `fullUrl`, so the link resolves inside the bundle.

Applied after the diagnoses are built, because the Encounter joins the bundle before them and the
produced nodes are immutable: this returns a new node rather than mutating the emitted one.

#### Parameters

##### encounter

`FhirComplex`

The Encounter node already in the bundle.

##### conditionFullUrls

readonly `string`[]

The fullUrls of the Conditions emitted for the same message, in order.

#### Returns

`FhirComplex`

#### Example

```ts
// withEncounterDiagnosis(encounter, ["urn:uuid:cond-1"]); // adds one diagnosis entry
```

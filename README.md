<a href="https://cosyte.com">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://cosyte.com/tile/cosyte-lockup-tile-on-dark-1200x300.png">
    <img alt="Cosyte: a plus mark set in two overlapping rounded squares, one solid and one outlined, beside the Cosyte wordmark" src="https://cosyte.com/tile/cosyte-lockup-tile-on-light-1200x300.png">
  </picture>
</a>

# @cosyte/transform

> HL7 v2 → FHIR R4 transformation for Node.js and TypeScript: **IG-grounded, fail-safe, value-free
> diagnostics; never a confident wrong FHIR value**.

`@cosyte/transform` is the healthcare **transformation** layer of the cosyte suite. Unlike the
parsers, it is a **consumer**: it takes already-parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
composites and produces validated [`@cosyte/fhir`](https://github.com/cosyte/fhir) model nodes,
grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`).

> **Status:** pre-alpha (`0.0.x`), published to npm. This release ships the
> six safety-critical datatype converters and the value-free diagnostic channel, the
> message-level assembly, HL7 v2 **ADT → FHIR Patient + Encounter**, the **ORU^R01 → FHIR
> DiagnosticReport + Observation** results graph, the order-entry graph (**ORM_O01 /
> OML_O21 → ServiceRequest** and **RXO → MedicationRequest**), the thin IG singles
> (**VXU_V04 → Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference**), all
> via `toFhir(msg)`, and **terminology value translation** of coded fields: route/site,
> appointment type, order priority, and substitution are now value-translated through their IG
> `mappedVia` ConceptMaps via `toFhirCodeableConceptVia`, fail-safe on any code the IG leaves unmapped.
> The v2→FHIR direction is feature-complete for the IG-covered message set; deeper
> terminology, profiles, and the reverse FHIR → v2 direction are not implemented.

## Install

```bash
npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir
```

`@cosyte/hl7` and `@cosyte/fhir` are **peer dependencies**: the transform maps between the models
they own. Its own third-party runtime dependencies are **zero**.

**That command does not work yet.** This package is published, but `@cosyte/fhir` is not on the
registry, so npm fails with `ERESOLVE` and refuses to resolve that peer. Until it publishes, consume
this package from source or a workspace link.

## Convert a datatype

```ts
import { toFhirHumanName } from "@cosyte/transform";

const { value, issues } = toFhirHumanName({
  familyName: "Public",
  givenName: "Jane",
  nameTypeCode: "L", // HL7 Table 0200 "Legal name" → FHIR name-use "official"
});
// value: a FHIR HumanName node; issues: [] (clean, fully mapped)
```

Each converter returns `{ value, issues }`: the FHIR datatype node it could faithfully produce, plus
the value-free diagnostics it raised.

## The fail-safe rule

Every conversion is grounded on the IG and **refuses to guess**. On any of these ambiguities:

- a v2 timestamp with a time-of-day but **no timezone** (FHIR forbids time without a zone),
- an assigning authority that can't be **resolved to a system URI** (never synthesized from a bare
  namespace, which would merge two patients),
- a code with an **unrecognized or absent coding system**,
- a unit that isn't valid **UCUM** (magnitudes are never converted),

the converter produces what it _can_ (often reduced in precision) and raises a **typed, value-free
`TransformIssue`**: a stable code, the v2 location, and the FHIR path, never a value. Render a list
of issues as a FHIR `OperationOutcome` with `toOperationOutcome(issues)`.

## The six datatype converters

| Converter               | v2 → FHIR                  |
| ----------------------- | -------------------------- |
| `toFhirDateTime`        | DTM/TS → `dateTime`        |
| `toFhirIdentifier`      | CX → `Identifier`          |
| `toFhirCodeableConcept` | CWE/CE → `CodeableConcept` |
| `toFhirHumanName`       | XPN → `HumanName`          |
| `toFhirAddress`         | XAD → `Address`            |
| `toFhirQuantity`        | NM + units → `Quantity`    |

## Assemble a message

`toFhir(msg)` takes a parsed `@cosyte/hl7` **ADT** message and returns a FHIR R4 **message `Bundle`**:
a `MessageHeader`, then the `Patient` and `Encounter` (and `RelatedPerson`) it describes, plus the
value-free issues, each map grounded firsthand on the IG's segment/table ConceptMaps.

```ts
import { parseHL7 } from "@cosyte/hl7";
import { toFhir, createNamingSystem } from "@cosyte/transform";

const { bundle, issues } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
});
// bundle.type === "message"; every reference resolves to a urn:uuid: fullUrl inside the bundle.
```

| Segment | FHIR resource   | key maps                                                                 |
| ------- | --------------- | ------------------------------------------------------------------------ |
| MSH     | `MessageHeader` | MSH-9 → `eventCoding`; MSH-7/10 → `Bundle.timestamp`/`.identifier`       |
| PID     | `Patient`       | PID-3/5/7/8/11 → `identifier`/`name`/`birthDate`/`gender`/`address`      |
| PV1     | `Encounter`     | PV1-2 → `class`/`status` (HL70004); PV1-19/44/45 → `identifier`/`period` |
| NK1     | `RelatedPerson` | NK1-2/3/4 → `name`/`relationship`/`address`                              |

The fail-safe rule holds at the message level: an unmapped patient class, a naked timestamp, or an
unresolvable authority becomes a typed issue, never a fabricated value. A trigger the IG has no
**message** map for is assembled from the segment maps and flagged, never invented; every emitted
resource is validated against `@cosyte/fhir` before it ships.

The same `toFhir(msg)` handles the other message families: **ORU^R01** → `DiagnosticReport` (OBR) +
`Observation` (OBX), and the order-entry graph, **ORM_O01 / OML_O21** ORC/OBR →
`ServiceRequest` and **RXO** (+ RXR route) → `MedicationRequest`, with `ServiceRequest.status`
grounded on the HL70119 → request-status ConceptMap and withheld when it cannot be grounded, and a
`MedicationRequest` whose IG-ungrounded status is the honest `unknown` rather than a guess. `RXE` has no
STU1 IG map and is flagged, never assembled.

The thin single-trigger families complete the IG-covered message set: **VXU_V04** RXA (+
RXR route, ORC) → `Immunization` (status via the IG's three conditioned rows: a delete action →
`entered-in-error`, an unvalued RXA-20 → `completed`, else the HL70322 → event-status ConceptMap, with a
valued-but-unmapped code withheld), **SIU_S12** SCH/AIS/PID → `Appointment` (status via the
HL70278 → appointmentstatus ConceptMap, the Patient wired as the required participant, its IG-unsourced
required status a `data-absent-reason` primitive), and **MDM_T02** TXA/OBX → `DocumentReference` (status
grounded only for TXA-19 `AV` → `current`, the document body base64-encoded verbatim, carried and never
interpreted). Timezone-naked instants are dropped and flagged, never assigned a fabricated UTC offset.

`toFhirCodeableConceptVia(cwe, map)` applies a license-clean IG value ConceptMap
(transcribed and verified firsthand against the raw published IG JSON): **RXR** route/site
(HL70162/HL70550), **SCH-8** appointment type (HL70277), **RXO-9** substitution (HL70161), and **OBR-5**
priority (HL70485), translating the source table code to its FHIR target coding, additively (the raw
coding is preserved alongside the derived one). It is fail-safe by refusal: a code the IG map leaves in
its `(unmapped)` group is flagged, never coerced to a neighbour. Fields whose IG target is **SNOMED CT**
(RXR-4 method, SCH-7 reason) stay structural, because SNOMED is not bundled (BYO ConceptMap), and fields the
IG ships no value map for (TXA-2 document type, RXA-5 vaccine code) are carried as-is, never invented.

## License

MIT © Cosyte

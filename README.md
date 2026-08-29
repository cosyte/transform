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
> The v2→FHIR direction is feature-complete for the IG-covered message set. It also ships a
> **narrow reverse path**, FHIR → v2: `toV2Patient(patient, trigger)` and
> `toV2Observation(observation, trigger)` emit a complete v2 message carrying a `PID` or an `OBX`.
> Deeper terminology, profiles, and any wider FHIR → v2 conversion are not implemented.

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

**And silence is not completeness.** Every segment occurrence that contributed nothing to a resource
in the returned bundle raises one value-free issue naming it, so you can read the issues list instead
of diffing the message against the bundle: `TRANSFORM_SEGMENT_NOT_EMITTED` when the IG publishes a
segment map for that name (a gap here), `TRANSFORM_SEGMENT_NO_IG_MAP` when it publishes none, or when
the name could not be classified at all (a gap in the standard, or a damaged line). The location is
`DG1[2]` for a name that passes the v2 segment-identifier shape, 1-based among that name's
occurrences, and `[#4]` for one that does not, with no part of the name reproduced. Being read and
refused is not reaching: a counted `RXE`, an orphan `OBX` and a resource the emit gate withheld are
all reported. A flagged segment is still not transformed: you learn what is missing, not what it
said.

The same `toFhir(msg)` handles the other message families: **ORU^R01** → `DiagnosticReport` (OBR) +
`Observation` (OBX), and the order-entry graph, **ORM_O01 / OML_O21** ORC/OBR →
`ServiceRequest` and **RXO** (+ RXR route) → `MedicationRequest`, with `ServiceRequest.status`
grounded on the HL70119 → request-status ConceptMap and withheld when it cannot be grounded, and a
`MedicationRequest` whose IG-ungrounded status is the honest `unknown` rather than a guess. `RXE` has no
STU1 IG map and is flagged, never assembled.

An order's **`TQ1`** becomes the schedule that order carries: `dosageInstruction.timing` on the
`MedicationRequest`, `occurrenceTiming` on the `ServiceRequest` (and a group that would also yield an
`occurrenceDateTime` from `OBR-6` emits the timing alone and flags the dropped one, because
`occurrence[x]` is a choice). `TQ1-3` grounds `Timing.code` from the HL70335 repeat-pattern rows,
`repeat.period`, `repeat.periodUnit` and `repeat.when` from the HL70528 rows the guide gives a
`v3-TimingEvent` target; `TQ1-7` / `TQ1-8` give `repeat.boundsPeriod`; `TQ1-10` and `TQ1-11` are
carried verbatim to the two different targets the guide names, `dosageInstruction.additionalInstruction.text`
and the resource's own `text` narrative. **A schedule is fully grounded or absent and flagged**: a
repeat component the guide gives no target for, a code outside its published table, a value that
would need a unit rescale or an invented date, a field that narrows the schedule (`TQ1-4`, `TQ1-5`,
`TQ1-6`, `TQ1-12`, `TQ1-13`, `TQ1-14`), an unusable or inverted bound, or a second `TQ1` on one
order, each withholds the whole `Timing` and raises a value-free diagnostic naming the cause. A
half-built timing would read to the receiving system as a complete dosing instruction, which is the
one outcome this library will not produce.

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

## Emit v2 back out, narrowly

Two entry points go the other way, FHIR → v2. Each takes the FHIR resource **plus the v2 trigger you
want the message to carry**, and returns the same `{ value, issues }` envelope, where `value` is a
complete `@cosyte/hl7` message:

| Function                                | in                 | out                                        |
| --------------------------------------- | ------------------ | ------------------------------------------ |
| `toV2Patient(patient, trigger)`         | FHIR `Patient`     | a v2 `ADT^<trigger>` message with a `PID`  |
| `toV2Observation(observation, trigger)` | FHIR `Observation` | a v2 `ORU^<trigger>` message with an `OBX` |

```ts
import { parseResource } from "@cosyte/fhir";
import { toV2Patient } from "@cosyte/transform";

const { resource } = parseResource(patientJson);
const { value, issues } = toV2Patient(resource, "A28", {
  assigningAuthorities: { "urn:oid:1.2.840.114350": "HOSP" },
  envelope: { sendingApp: "EHR", sendingFacility: "MAIN" },
});
// value.toString() -> "MSH|^~\\&|EHR|MAIN|...|ADT^A28|...\rPID|||MRN1||Public^Jane\r"
```

**The trigger is required and is never inferred.** No FHIR resource carries an HL7 v2 message
trigger, so there is nothing to derive one from: supply it, or the call returns no message and one
`TRANSFORM_MISSING_TRIGGER` diagnostic, without building anything.

**This direction is lossy by design, and it is not a round-trip.** The published mapping guide runs
v2 → FHIR, and several of its rows are many-to-one, so their inverse is ambiguous and is **refused**:
`gender` `other`, name use `official` and `temp`, address use `work`, every `Address.type`, and
`Observation.status` `entered-in-error` each leave their v2 field absent with a
`TRANSFORM_CODE_NOT_INVERTIBLE` diagnostic rather than picking one of the v2 codes that could have
produced them. An element with no v2 field in this narrow map is flagged
(`TRANSFORM_NO_V2_TARGET`), a value v2 cannot carry unchanged is flagged and left out
(`TRANSFORM_VALUE_NOT_REPRESENTABLE`), and a coding system with no v2 mnemonic is flagged rather than
written under a borrowed table (`TRANSFORM_CODE_SYSTEM_NOT_V2`). Nothing here reconstructs the
message a resource came from, and nothing claims to.

**What v2 requires but your resource does not carry is left absent, and said out loud.** A `PID`
needs PID-3 (Patient Identifier List) and PID-5 (Patient Name); an `OBX` needs OBX-11 (Observation
Result Status). A resource that gives no source for one of them still gets a message with that field
absent, never a placeholder invented to satisfy v2 structure, and one
`TRANSFORM_V2_REQUIRED_FIELD_ABSENT` diagnostic per field, carrying the v2 location and the FHIR path
it would have come from. A resource that grounds no field of the target segment at all returns no
message and one `TRANSFORM_NO_V2_MESSAGE_EMITTED`, so an empty-handed conversion is never mistaken
for a successful one. Both are `error` severity: an emitted message missing a field v2 requires is
not conformant, and this is where you find that out rather than at the receiver.

## License

MIT © Cosyte

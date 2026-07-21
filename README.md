# @cosyte/transform

> HL7 v2 → FHIR R4 transformation for Node.js and TypeScript — **IG-grounded, fail-safe, value-free
> diagnostics; never a confident wrong FHIR value**.

`@cosyte/transform` is the healthcare **transformation** layer of the cosyte suite. Unlike the
parsers, it is a **consumer**: it takes already-parsed [`@cosyte/hl7`](https://github.com/cosyte/hl7)
composites and produces validated [`@cosyte/fhir`](https://github.com/cosyte/fhir) model nodes,
grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`).

> **Status:** pre-alpha (`0.0.x`), not yet published to npm. This release ships **Phase 1** — the six
> safety-critical datatype converters and the value-free diagnostic channel. Message-level assembly
> (`toFhir(msg)`), terminology depth, and profiles land in later phases.

## Install

```bash
npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir
```

`@cosyte/hl7` and `@cosyte/fhir` are **peer dependencies** — the transform maps between the models
they own. Its own third-party runtime dependencies are **zero**.

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

Each converter returns `{ value, issues }` — the FHIR datatype node it could faithfully produce, plus
the value-free diagnostics it raised.

## The fail-safe rule

Every conversion is grounded on the IG and **refuses to guess**. On any ambiguity —

- a v2 timestamp with a time-of-day but **no timezone** (FHIR forbids time without a zone),
- an assigning authority that can't be **resolved to a system URI** (never synthesized from a bare
  namespace — that would merge two patients),
- a code with an **unrecognized or absent coding system**,
- a unit that isn't valid **UCUM** (magnitudes are never converted),

— the converter produces what it _can_ (often reduced in precision) and raises a **typed, value-free
`TransformIssue`**: a stable code, the v2 location, and the FHIR path — never a value. Render a list
of issues as a FHIR `OperationOutcome` with `toOperationOutcome(issues)`.

## The six Phase-1 converters

| Converter               | v2 → FHIR                  |
| ----------------------- | -------------------------- |
| `toFhirDateTime`        | DTM/TS → `dateTime`        |
| `toFhirIdentifier`      | CX → `Identifier`          |
| `toFhirCodeableConcept` | CWE/CE → `CodeableConcept` |
| `toFhirHumanName`       | XPN → `HumanName`          |
| `toFhirAddress`         | XAD → `Address`            |
| `toFhirQuantity`        | NM + units → `Quantity`    |

## License

MIT © Cosyte

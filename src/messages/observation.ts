/**
 * OBX → FHIR `Observation`: the highest-clinical-stakes segment map,
 * grounded firsthand on the IG **Segment OBX to Observation** ConceptMap plus its two governing table
 * ConceptMaps (`hl7.fhir.uv.v2mappings`, STU1). The rows used here, verified against the published maps
 * (`ConceptMap-segment-obx-to-observation.html`, `-table-hl70078-to-v3-observationinterpretation.html`,
 * `-table-hl70085-to-observation-status.html`):
 *
 * | OBX field | FHIR target | via |
 * |---|---|---|
 * | OBX-2 Value Type | discriminates OBX-5 → `value[x]` | {@link buildValue}, never assume `Quantity` |
 * | OBX-3 Observation Identifier (CWE) | `Observation.code` | {@link toFhirCodeableConcept} |
 * | OBX-5 Observation Value | `Observation.value[x]` | per OBX-2 |
 * | OBX-6 Units (CWE) | `valueQuantity.unit`/`.code`/`.system` | {@link quantityFromRawMagnitude} |
 * | OBX-7 Reference Range | `Observation.referenceRange.text` | mapped to `.text` (never decomposed) |
 * | OBX-8 Abnormal Flags | `Observation.interpretation` | {@link HL70078_INTERPRETATION_CODES} |
 * | OBX-11 Result Status | `Observation.status` | {@link OBSERVATION_STATUS_MAP} (HL70085) |
 * | OBX-14 Date/Time of Observation | `Observation.effectiveDateTime` | {@link toFhirDateTime} |
 * | (OBSERVATION-group NTE) | `Observation.note` | {@link buildAnnotations} (`NTE[ServiceRequest]`) |
 *
 * **What OBX-2 selects, row by row** (`ConceptMap-segment-obx-to-observation.html`, the OBX-5 rows):
 *
 * | OBX-2 | FHIR target | datatype map |
 * |---|---|---|
 * | `NM` | `valueQuantity` | `NM[Quantity]` |
 * | `SN` | `valueQuantity` (with a comparator) / `valueRange` / `valueRatio` | the row's own conditions |
 * | `CWE`/`CE`/`CF`/`CNE`/`IS` | `valueCodeableConcept` | `CWE[CodeableConcept]` |
 * | `DT`/`DTM`/`TS` | `valueDateTime` | `DTM[DateTime]` |
 * | `ST`/`TX`/`FT` | `valueString` | (direct) |
 * | `DR` | `valuePeriod` | `DR[Period]` |
 * | `NR` | `valueRange` | `NR[Range]` |
 * | `TM` | `valueTime` | (direct, an R4 `time`) |
 * | `NA` | `valueSampledData` | `NA[SampledData]` |
 * | `ED` **and** OBX-5.4 = `Base64` | the {@link OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL} extension | `ED[Attachment]` |
 * | `RP`, `ID`, anything else | `valueString` + flagged | (no settled target) |
 *
 * **The "never a confident wrong result" fail-safes:**
 * - **OBX-2 drives `value[x]`**, per the table above, and every row of it degrades to the raw OBX-5
 *   text as `valueString` + {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} rather than emit a value
 *   the map cannot ground: a `DR` neither of whose bounds is a dateTime this library will emit, an
 *   `NR` neither of whose bounds is a faithful `decimal`, a `TM` carrying a UTC offset (an R4 `time`
 *   admits none, and discarding one would move the instant), an `NA` carrying a magnitude `decimal`
 *   cannot hold unaltered, an `ED` whose OBX-5.4 is not `Base64` (both ED rows are conditioned on
 *   it), and `RP`, whose extension target the guide's own comment marks unsettled.
 * - **The published NA row spells its attribute `Observation.valueSampedData`.** That is a typo in
 *   the guide; the R4 element is `valueSampledData` and that is what is emitted.
 * - **A SampledData asserts no origin and no period.** R4 makes both `1..1` and the NA map has no
 *   source row for either, so they ship value-absent with a `data-absent-reason` and
 *   {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}: an `origin` of 0 or a `period` of 1
 *   would be a magnitude this message never sent, on a waveform.
 * - **An ED payload is carried, never read.** OBX-5.5 reaches `Attachment.data` byte-for-byte: no
 *   decode, no re-encode, no normalization, no validation, no truncation.
 * - **A corrected/cancelled result never emits as `final`.** OBX-11 `C`→`corrected`, `X`→`cancelled`,
 *   `D`/`W`→`entered-in-error` (HL70085). A status code with **no** HL70085 target leaves
 *   `Observation.status` absent (flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}); the required-`status`
 *   emit gate then **withholds** the Observation rather than shipping it, never coerced to `final`.
 * - **An unrecognized abnormal flag is surfaced, never coerced to normal.** Each OBX-8 flag in
 *   {@link HL70078_INTERPRETATION_CODES} becomes an `interpretation` coding (the map is code-preserving);
 *   a flag absent from the table is flagged and dropped, never emitted as `N`/normal.
 *
 * Numeric magnitudes (NM, SN) are read from the **raw OBX-5 field**, not the `@cosyte/hl7`
 * `Observation` view's JS `number`, so a reported lab value's exact lexical precision (`120.50`) is
 * carried through the string-backed FHIR `decimal`, never routed through a lossy `number`.
 *
 * @packageDocumentation
 */

import { parseDtm, type CWE, type Field, type Segment } from "@cosyte/hl7";
import {
  complex,
  decimal,
  primitive,
  list,
  validatePrimitiveValue,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { quantityFromRawMagnitude } from "../datatypes/quantity.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { ALTERNATE_CODES_EXTENSION_URL } from "./allergy-intolerance.js";
import { buildAnnotations } from "./note.js";
import { dataAbsent, dataAbsentComplex, reference } from "./reference.js";

/**
 * The v3 ObservationInterpretation canonical system (FHIR `Observation.interpretation` binding).
 *
 * @example
 * ```ts
 * import { V3_OBSERVATION_INTERPRETATION_SYSTEM } from "@cosyte/transform";
 * V3_OBSERVATION_INTERPRETATION_SYSTEM.endsWith("v3-ObservationInterpretation"); // => true
 * ```
 */
export const V3_OBSERVATION_INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

/**
 * HL7 v2 Table 0078 (Abnormal Flags) → FHIR v3 ObservationInterpretation (`Observation.interpretation`),
 * per the IG **Table HL70078 to v3 ObservationInterpretation** ConceptMap. Every mapped row is
 * `is equivalent to` an **identically-spelled** v3 code (the map is code-preserving), so this is the set
 * of codes that carry a target: a flag **absent** from this set has no equivalent and is flagged
 * {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}, never coerced (the IG leaves `AC`/`HM`/`OBX`/`QCF`/`TOX`
 * and any local flag unmapped, and declares no `unmapped` default).
 */
export const HL70078_INTERPRETATION_CODES: ReadonlySet<string> = new Set([
  "<",
  ">",
  "A",
  "AA",
  "B",
  "CAR",
  "D",
  "DET",
  "E",
  "EX",
  "EXP",
  "H",
  "HH",
  "HU",
  "I",
  "IE",
  "IND",
  "L",
  "LL",
  "LU",
  "MS",
  "N",
  "NCL",
  "ND",
  "NEG",
  "NR",
  "NS",
  "POS",
  "R",
  "RR",
  "S",
  "SDD",
  "SYN-R",
  "SYN-S",
  "U",
  "UNE",
  "VS",
  "W",
  "WR",
]);

/**
 * HL7 v2 Table 0085 (Observation Result Status) → FHIR `observation-status` (`Observation.status`),
 * per the IG **Table HL70085 to Observation Status** ConceptMap (each `is equivalent to`). Only these
 * seven source codes carry a target; the codes the IG leaves unmapped (`B`, `I`, `N`, `O`, `R`, `S`,
 * `U`, `V`) are **absent here on purpose**: an OBX-11 with one of them (or any local code) leaves
 * `Observation.status` absent + flagged, and the required-`status` emit gate withholds the Observation.
 * **`C`→`corrected` and `X`→`cancelled` guarantee a corrected/cancelled result never emits as `final`.**
 */
export const OBSERVATION_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  A: "amended",
  C: "corrected",
  D: "entered-in-error",
  F: "final",
  P: "preliminary",
  W: "entered-in-error",
  X: "cancelled",
});

/**
 * The extension URL the OBX map **fixes** on the `IF OBX-2 EQUALS "ED" AND IF OBX-5.4 EQUALS
 * "Base64"` rows, transcribed from the map's own `Observation.extension.url` assignment. R4 has no
 * `Observation.valueAttachment`, so the guide carries the R5 element as this named extension.
 *
 * @example
 * ```ts
 * import { OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL } from "@cosyte/transform";
 * OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL.endsWith("extension-Observation.valueAttachment"); // true
 * ```
 */
export const OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL =
  "https://hl7.org/fhir/5.0/StructureDefinition/extension-Observation.valueAttachment";

/**
 * The OBX-5.4 encoding the OBX map conditions **both** of its `ED` rows on. Any other encoding
 * (`A`, `Hex`, `Ascii`, a local token) leaves those rows unapplied, so no attachment is built.
 *
 * @example
 * ```ts
 * import { ED_BASE64_ENCODING } from "@cosyte/transform";
 * ED_BASE64_ENCODING; // "Base64"
 * ```
 */
export const ED_BASE64_ENCODING = "Base64";

/**
 * The `SampledData.data` token the Implementation Considerations chapter's own worked example
 * directs for a data point a repetition did not carry (`"set .dimensions to 4 and use E for the
 * data points not present"`). It is the FHIR-defined "error" token, and it is written **only** for
 * an absent position, never for a value that arrived and could not be converted.
 *
 * @example
 * ```ts
 * import { SAMPLED_DATA_ABSENT_POINT } from "@cosyte/transform";
 * SAMPLED_DATA_ABSENT_POINT; // "E"
 * ```
 */
export const SAMPLED_DATA_ABSENT_POINT = "E";

/**
 * The `data-absent-reason` code carried by `SampledData.origin` and `SampledData.period`, the two
 * R4-required elements of that datatype that **no row of the IG's NA map, and no line of the
 * Implementation Considerations chapter it points at, supplies a source for**.
 *
 * @example
 * ```ts
 * import { SAMPLED_DATA_UNGROUNDED } from "@cosyte/transform";
 * SAMPLED_DATA_UNGROUNDED; // "unknown"
 * ```
 */
export const SAMPLED_DATA_UNGROUNDED = "unknown";

/** The FHIR `Quantity.comparator` codes an SN.1 comparator can populate (SN `=`/`<>` do not). */
const SN_COMPARATORS: ReadonlySet<string> = new Set([">", "<", ">=", "<="]);

/** OBX-2 value types the IG maps to `valueCodeableConcept`. */
const CODED_VALUE_TYPES: ReadonlySet<string> = new Set(["CWE", "CE", "CF", "CNE", "IS"]);
/** OBX-2 value types the IG maps to `valueDateTime`. */
const DATETIME_VALUE_TYPES: ReadonlySet<string> = new Set(["DT", "DTM", "TS"]);
/** OBX-2 value types the IG maps directly to `valueString`. */
const STRING_VALUE_TYPES: ReadonlySet<string> = new Set(["ST", "TX", "FT"]);

/** The decoded first-subcomponent of a field's component at 0-based `index`, or `undefined` when empty. */
function rawComponent(field: Field, index: number): string | undefined {
  const c = field.repetitions[0]?.components[index]?.subcomponents[0];
  return c === undefined || c === "" ? undefined : c;
}

/**
 * Whether a field carries nothing at all, asked of its **whole** repetition tree rather than of
 * `Field.value` (the first subcomponent of the first component of the first repetition). An OBX-5
 * of `^20260722` is empty by the latter question and is plainly not empty: a composite value type
 * has to be asked the composite question or the emptiness test silently drops content.
 */
function fieldEmpty(field: Field): boolean {
  return field.repetitions.every((r) =>
    r.components.every((c) => c.subcomponents.every((s) => s === "")),
  );
}

/**
 * `DR` → `Period` per the IG **DR to Period** datatype map: `DR.1` to `Period.start` and `DR.2` to
 * `Period.end`, both `0..1`, both through the `DTM[DateTime]` map. Nothing else is mapped, so a
 * missing bound stays missing: the observation time, the message time and the other bound are all
 * refused as substitutes. Returns `undefined` when neither component yields a dateTime.
 */
function buildPeriodValue(
  field: Field,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];
  for (const [index, name] of [
    [0, "start"],
    [1, "end"],
  ] as const) {
    const raw = rawComponent(field, index);
    if (raw === undefined) continue;
    const converted = toFhirDateTime(parseDtm(raw), ctx.options);
    issues.push(...converted.issues);
    if (converted.value !== undefined) props.push({ name, value: primitive(converted.value) });
  }
  return props.length === 0 ? undefined : complex(props);
}

/**
 * One `Range` bound: a `SimpleQuantity` carrying the magnitude and **nothing else**. The NR map
 * grounds `Range.low.value` and `Range.high.value` and no unit, code or system anywhere, so none is
 * written, and OBX-6 is deliberately not borrowed for it. The magnitude keeps its exact lexical
 * form through the string-backed FHIR `decimal`; a form `decimal` cannot carry faithfully yields no
 * bound and a value-free {@link ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID}, never a rescaled one.
 */
function rangeBound(
  raw: string | undefined,
  fhirPath: string,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (raw === undefined) return undefined;
  try {
    return complex([{ name: "value", value: primitive(decimal(raw)) }]);
  } catch {
    issues.push(issue(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID, "OBX.5", fhirPath));
    return undefined;
  }
}

/** `NR` → `Range` per the IG **NR to Range** map, or `undefined` when neither bound converts. */
function buildRangeValue(field: Field, issues: TransformIssue[]): FhirComplex | undefined {
  const low = rangeBound(rawComponent(field, 0), "Range.low.value", issues);
  const high = rangeBound(rawComponent(field, 1), "Range.high.value", issues);
  const props: { name: string; value: FhirNode }[] = [];
  if (low !== undefined) props.push({ name: "low", value: low });
  if (high !== undefined) props.push({ name: "high", value: high });
  return props.length === 0 ? undefined : complex(props);
}

/**
 * A v2 `TM` read as a FHIR `time`, or `undefined` when it is not one this library will emit.
 *
 * The OBX map routes `TM` straight to `Observation.valueTime` with no datatype map, so the R4
 * `time` value domain is the whole contract, and it admits **no timezone offset and no partial
 * precision**. A v2 TM may carry both. Discarding a `+0530` would move the clinical instant by
 * hours with nothing said, and padding `1430` to `14:30:00` would fabricate a precision the sender
 * did not send: both are refused here, and the caller falls back to the raw text. The candidate is
 * checked against `@cosyte/fhir`'s own `time` domain rather than trusted to this shape test alone.
 */
function timeValue(raw: string): string | undefined {
  const parts = /^(\d{2})(\d{2})(\d{2})(\.\d{1,4})?$/.exec(raw);
  if (parts === null) return undefined;
  const candidate = `${parts[1] ?? ""}:${parts[2] ?? ""}:${parts[3] ?? ""}${parts[4] ?? ""}`;
  return validatePrimitiveValue(candidate, "time") === "ok" ? candidate : undefined;
}

/**
 * `NA` → `SampledData` per the IG **NA to SampledData** map and the "Numeric Array to Sampled Data
 * Mapping" section of the Implementation Considerations chapter its comment points at.
 *
 * `.dimensions` is "the number of values present within each repeat separated by the component
 * delimiter", read off the widest repetition so a short or absent row does not shrink the array's
 * declared width. A field carrying **one** repetition is the chapter's own vector case (its 8-value
 * example sets `.dimensions` to `1`): with no second repetition there is no second dimension to
 * count, and each value is its own time point. `.data` is the values in row-major order, space
 * separated, with {@link SAMPLED_DATA_ABSENT_POINT} for every position a repetition did not carry,
 * which is exactly the set of positions the chapter's sparse example enumerates as not present.
 *
 * Returns `undefined` when any value that DID arrive is not a magnitude FHIR `decimal` carries
 * faithfully: the caller then falls back to the raw text rather than shipping a rewritten waveform.
 */
function buildSampledData(field: Field, issues: TransformIssue[]): FhirComplex | undefined {
  const rows = field.repetitions.map((r) => r.components.map((c) => c.subcomponents[0] ?? ""));
  if (rows.length === 0) return undefined;
  const width = Math.max(...rows.map((r) => r.length));
  const dimensions = rows.length === 1 ? 1 : width;

  const points: string[] = [];
  for (const row of rows) {
    for (let i = 0; i < width; i++) {
      const cell = row[i] ?? "";
      if (cell === "") {
        points.push(SAMPLED_DATA_ABSENT_POINT);
        continue;
      }
      try {
        // `decimal` throws on a lexical form FHIR's decimal cannot carry unaltered (a leading `+`,
        // a leading zero, a trailing dot): the whole array is refused rather than canonicalized.
        // The wire text itself is what is written, so the magnitude keeps its exact precision.
        decimal(cell);
        points.push(cell);
      } catch {
        issues.push(
          issue(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID, "OBX.5", "SampledData.data"),
        );
        return undefined;
      }
    }
  }

  // R4 makes `origin` and `period` required, and the map grounds neither: they ship value-absent
  // with a data-absent-reason, which satisfies the cardinality while asserting no magnitude.
  for (const path of ["SampledData.origin", "SampledData.period"]) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "OBX.5", path));
  }
  return complex([
    { name: "origin", value: dataAbsentComplex(SAMPLED_DATA_UNGROUNDED) },
    { name: "period", value: dataAbsent(SAMPLED_DATA_UNGROUNDED) },
    { name: "dimensions", value: primitive(decimal(String(dimensions))) },
    { name: "data", value: primitive(points.join(" ")) },
  ]);
}

/**
 * `ED` (encoded data) → the IG-named `valueAttachment` extension, per the OBX map's two
 * `IF OBX-2 EQUALS "ED" AND IF OBX-5.4 EQUALS "Base64"` rows and the **ED to Attachment** datatype
 * map behind the second of them: `ED.3` (OBX-5.3) to `Attachment.contentType`, `ED.5` (OBX-5.5) to
 * `Attachment.data`, and `ED.2` to an `alternate-codes` extension on the Attachment **only** when
 * `ED.3` is unvalued. `ED.1` and `ED.4` have no target.
 *
 * **The payload is carried, never read.** OBX-5.4 already declares it Base64 and the row is
 * conditioned on that, so it is copied into `Attachment.data` exactly as received: not decoded, not
 * re-encoded, not normalized, not length-checked, not truncated. This library has no business
 * deciding a binary is malformed, and a "repaired" attachment is the worst kind of confident wrong
 * value. Returns `undefined` when OBX-5.5 carries nothing to attach.
 */
function buildAttachmentExtension(field: Field, issues: TransformIssue[]): FhirNode | undefined {
  const payload = rawComponent(field, 4);
  if (payload === undefined) return undefined;

  const attachment: { name: string; value: FhirNode }[] = [];
  const subtype = rawComponent(field, 2);
  const typeOfData = rawComponent(field, 1);
  if (subtype === undefined && typeOfData !== undefined) {
    // The ED map's `IF ED.3 NOT VALUED` row: the type of data is carried as an alternate code
    // rather than guessed into a MIME `contentType` this message never stated.
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBX.5", "Attachment.contentType"));
    attachment.push({
      name: "extension",
      value: list([
        complex([
          { name: "url", value: primitive(ALTERNATE_CODES_EXTENSION_URL) },
          {
            name: "valueCodeableConcept",
            value: complex([
              {
                name: "coding",
                value: list([complex([{ name: "code", value: primitive(typeOfData) }])]),
              },
            ]),
          },
        ]),
      ]),
    });
  }
  if (subtype !== undefined) attachment.push({ name: "contentType", value: primitive(subtype) });
  attachment.push({ name: "data", value: primitive(payload) });

  return list([
    complex([
      { name: "url", value: primitive(OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL) },
      { name: "valueAttachment", value: complex(attachment) },
    ]),
  ]);
}

/** Reconstruct an SN's human string (`>90`, `10-20`, `1:2`) from its raw components, for a fallback. */
function snText(field: Field): string {
  return [0, 1, 2, 3].map((i) => rawComponent(field, i) ?? "").join("");
}

/** A `valueString` property carrying the raw OBX-5 text (a faithful, never-fabricated fallback). */
function valueStringProp(raw: string): { name: string; value: FhirNode } {
  return { name: "valueString", value: primitive(raw) };
}

/**
 * Build a FHIR `Quantity` node wrapped as a `valueRange`/`valueRatio` endpoint pair, or `undefined`
 * when either magnitude is not a faithful decimal. Both endpoints share the OBX-6 units.
 */
function endpointPair(
  field: Field,
  units: CWE,
  ctx: TransformContext,
  issues: TransformIssue[],
): { first: FhirComplex; second: FhirComplex } | undefined {
  const n1 = rawComponent(field, 1);
  const n2 = rawComponent(field, 3);
  if (n1 === undefined || n2 === undefined) return undefined;
  const first = quantityFromRawMagnitude(n1, units, ctx);
  const second = quantityFromRawMagnitude(n2, units, ctx);
  issues.push(...first.issues, ...second.issues);
  if (first.value === undefined || second.value === undefined) return undefined;
  return { first: first.value, second: second.value };
}

/**
 * SN (structured numeric) → `value[x]`, per the IG's OBX-2 = `SN` conditional: a separator `-` with two
 * numbers is a `valueRange`; a `:`/`/` separator is a `valueRatio`; a comparator with a single number is
 * a `valueQuantity` (comparator carried); anything else preserves the raw SN string as `valueString`.
 */
function buildSnValue(
  field: Field,
  units: CWE,
  ctx: TransformContext,
  issues: TransformIssue[],
): { name: string; value: FhirNode } {
  const sn = field.asSn();
  const separator = sn?.separatorOrSuffix;

  if (separator === "-") {
    const pair = endpointPair(field, units, ctx, issues);
    if (pair !== undefined) {
      return {
        name: "valueRange",
        value: complex([
          { name: "low", value: pair.first },
          { name: "high", value: pair.second },
        ]),
      };
    }
    return valueStringProp(snText(field));
  }

  if (separator === ":" || separator === "/") {
    const pair = endpointPair(field, units, ctx, issues);
    if (pair !== undefined) {
      return {
        name: "valueRatio",
        value: complex([
          { name: "numerator", value: pair.first },
          { name: "denominator", value: pair.second },
        ]),
      };
    }
    return valueStringProp(snText(field));
  }

  // Comparator + single number → valueQuantity. SN `<>` (unequal) has no FHIR comparator → string.
  const comparator = sn?.comparator;
  const num1 = rawComponent(field, 1);
  if (comparator !== "<>" && num1 !== undefined) {
    const fhirComparator =
      comparator !== undefined && SN_COMPARATORS.has(comparator) ? comparator : undefined;
    const q = quantityFromRawMagnitude(num1, units, ctx, fhirComparator);
    issues.push(...q.issues);
    if (q.value !== undefined) return { name: "valueQuantity", value: q.value };
  }
  return valueStringProp(snText(field));
}

/**
 * The five value types this discrimination maps through a datatype (or extension) target rather
 * than through `Field.value`. Each is a composite whose first component is not the whole value, so
 * emptiness is asked of the whole field and the fallback carries the whole OBX-5 text.
 */
const COMPOSITE_VALUE_TYPES: ReadonlySet<string> = new Set(["DR", "NR", "TM", "NA", "ED"]);

/**
 * The IG-mapped target for one of {@link COMPOSITE_VALUE_TYPES}, or `undefined` when this OBX-5
 * carries nothing that target can be built from faithfully (the caller then falls back).
 */
function buildMappedValue(
  field: Field,
  vt: string,
  ctx: TransformContext,
  issues: TransformIssue[],
): { name: string; value: FhirNode } | undefined {
  if (vt === "DR") {
    const period = buildPeriodValue(field, ctx, issues);
    return period === undefined ? undefined : { name: "valuePeriod", value: period };
  }
  if (vt === "NR") {
    const range = buildRangeValue(field, issues);
    return range === undefined ? undefined : { name: "valueRange", value: range };
  }
  if (vt === "TM") {
    // TM is a v2 primitive, so the whole field is the time; a component structure it never had
    // would only be a damaged line, and `timeValue` refuses one.
    const time = timeValue(field.text);
    return time === undefined ? undefined : { name: "valueTime", value: primitive(time) };
  }
  if (vt === "NA") {
    const sampled = buildSampledData(field, issues);
    // The OBX map's own NA row spells this attribute `valueSampedData`, which is a typo in the
    // published guide: R4 names the element `valueSampledData`, and that is what is emitted.
    return sampled === undefined ? undefined : { name: "valueSampledData", value: sampled };
  }
  // ED, and only under the OBX map's `IF OBX-5.4 EQUALS "Base64"` condition both its rows carry.
  if (rawComponent(field, 3) !== ED_BASE64_ENCODING) return undefined;
  const extension = buildAttachmentExtension(field, issues);
  return extension === undefined ? undefined : { name: "extension", value: extension };
}

/**
 * Discriminate OBX-5 by OBX-2 value type into the correct FHIR `Observation.value[x]` property, or
 * `undefined` when OBX-5 is empty. Never assumes `Quantity`; a value type with no first-class target
 * degrades to `valueString` + a {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} flag, never fabricated.
 */
function buildValue(
  obx: Segment,
  valueType: string,
  ctx: TransformContext,
  issues: TransformIssue[],
): { name: string; value: FhirNode } | undefined {
  const field = obx.field(5);
  const rawValue = field.value;
  const vt = valueType.toUpperCase();

  if (COMPOSITE_VALUE_TYPES.has(vt)) {
    // An empty OBX-5 is nothing to carry and nothing to flag, exactly as every already-mapped
    // value type treats one. The question is asked of the whole field: `Field.value` reads only
    // the first component, and a DR that valued only its end bound is not an empty field.
    if (fieldEmpty(field)) return undefined;
    const mapped = buildMappedValue(field, vt, ctx, issues);
    if (mapped !== undefined) return mapped;
    // The IG-mapped type could not carry this value faithfully: the raw OBX-5 text is preserved in
    // full (never truncated to its first component, which would drop the rest of a composite) and
    // the drop is flagged, which is the same fail-safe floor this library has always had here.
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "OBX.5", "Observation.value[x]"));
    return valueStringProp(field.text);
  }

  if (vt === "NM") {
    const q = quantityFromRawMagnitude(field.asNm().raw, obx.field(6).asCwe(), ctx);
    issues.push(...q.issues);
    if (q.value !== undefined) return { name: "valueQuantity", value: q.value };
    // A present-but-non-decimal NM: preserve the raw text rather than drop the result.
    return rawValue === "" ? undefined : valueStringProp(rawValue);
  }

  if (vt === "SN") {
    if (rawValue === "" && snText(field) === "") return undefined;
    return buildSnValue(field, obx.field(6).asCwe(), ctx, issues);
  }

  if (CODED_VALUE_TYPES.has(vt)) {
    const cc = toFhirCodeableConcept(field.asCwe(), ctx);
    issues.push(...cc.issues);
    return cc.value === undefined ? undefined : { name: "valueCodeableConcept", value: cc.value };
  }

  if (DATETIME_VALUE_TYPES.has(vt)) {
    if (rawValue === "") return undefined;
    const dt = toFhirDateTime(field.asTs(), ctx.options);
    issues.push(...dt.issues);
    return dt.value === undefined
      ? undefined
      : { name: "valueDateTime", value: primitive(dt.value) };
  }

  if (rawValue === "") return undefined;
  if (STRING_VALUE_TYPES.has(vt)) return valueStringProp(rawValue);

  // A value type with no first-class FHIR value[x] here (RP, ID, unknown): the raw value is
  // preserved as a string and the richer typed mapping is flagged as deferred, never guessed. `RP`
  // has a nominal extension target whose own IG comment marks it unsettled ("To be resolved when we
  // resolve DocumentReference and valueAttachment"), so it stays here on purpose.
  issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "OBX.5", "Observation.value[x]"));
  return valueStringProp(rawValue);
}

/** Build `Observation.interpretation` from OBX-8 abnormal flags (HL70078), or `undefined` when none map. */
function buildInterpretation(obx: Segment, issues: TransformIssue[]): FhirNode | undefined {
  const flags = obx
    .field(8)
    .repetitions.map((r) => r.components[0]?.subcomponents[0] ?? "")
    .filter((f) => f !== "");
  const codings: FhirComplex[] = [];
  for (const flag of flags) {
    if (HL70078_INTERPRETATION_CODES.has(flag)) {
      codings.push(
        complex([
          {
            name: "coding",
            value: list([
              complex([
                { name: "system", value: primitive(V3_OBSERVATION_INTERPRETATION_SYSTEM) },
                { name: "code", value: primitive(flag) },
              ]),
            ]),
          },
        ]),
      );
    } else {
      // An unrecognized abnormal flag is surfaced and dropped: NEVER coerced to `N`/normal.
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBX.8", "Observation.interpretation"),
      );
    }
  }
  return codings.length === 0 ? undefined : list(codings);
}

/**
 * Build a FHIR `Observation` resource node from one parsed HL7 v2 OBX segment. Returns
 * `{ value: undefined }` when the OBX carries no observation identifier (OBX-3): an Observation with
 * no `code` cannot be emitted. `Observation.status` is left absent (and the resource later withheld by
 * the emit gate) when OBX-11 is missing or has no HL70085 target, never guessed.
 *
 * @param obx - The OBX `@cosyte/hl7` `Segment`.
 * @param subjectFullUrl - The `urn:uuid:` fullUrl of the bundle's Patient, wired to `Observation.subject`.
 * @param encounterFullUrl - The `urn:uuid:` fullUrl of the bundle's Encounter, wired to `.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @param notes - The `NTE` segments of this OBX's own OBSERVATION group → `Observation.note`. Only
 *   that group's row has a target; a PATIENT-level or ORDER_OBSERVATION-level NTE has none, so the
 *   caller passes none here and the occurrence is reported as unread instead.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const obx = parseHL7(raw).segments("OBX")[0];
 * // const { value } = buildObservation(obx!, "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildObservation(
  obx: Segment,
  subjectFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
  notes: readonly Segment[] = [],
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Observation") },
  ];

  // OBX-11 → Observation.status (HL70085). Absent/unmapped → left absent (emit gate withholds), never
  // guessed; a corrected/cancelled status is modelled exactly, never emitted as `final`.
  const statusCode = obx.field(11).value;
  if (statusCode !== "") {
    const status = Object.hasOwn(OBSERVATION_STATUS_MAP, statusCode)
      ? OBSERVATION_STATUS_MAP[statusCode]
      : undefined;
    if (status === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBX.11", "Observation.status"));
    } else {
      props.push({ name: "status", value: primitive(status) });
    }
  }

  // OBX-3 → Observation.code (required 1..1). Absent → nothing emittable.
  const code = toFhirCodeableConcept(obx.field(3).asCwe(), ctx);
  issues.push(...code.issues);
  if (code.value === undefined) return { value: undefined, issues };
  props.push({ name: "code", value: code.value });

  // Observation.subject / .encounter → the bundle's Patient / Encounter (message-map reference wiring).
  if (subjectFullUrl !== undefined)
    props.push({ name: "subject", value: reference(subjectFullUrl) });
  if (encounterFullUrl !== undefined) {
    props.push({ name: "encounter", value: reference(encounterFullUrl) });
  }

  // OBX-14 → Observation.effectiveDateTime.
  if (obx.field(14).value !== "") {
    const effective = toFhirDateTime(obx.field(14).asTs(), ctx.options);
    issues.push(...effective.issues);
    if (effective.value !== undefined) {
      props.push({ name: "effectiveDateTime", value: primitive(effective.value) });
    }
  }

  // OBX-2 / OBX-5 → Observation.value[x] (value-type discriminated; never assume Quantity).
  const value = buildValue(obx, obx.field(2).value, ctx, issues);
  if (value !== undefined) props.push(value);

  // OBX-8 → Observation.interpretation (HL70078; unrecognized flag surfaced, never coerced to normal).
  const interpretation = buildInterpretation(obx, issues);
  if (interpretation !== undefined) props.push({ name: "interpretation", value: interpretation });

  // The OBSERVATION group's NTE segments → Observation.note (ORU_R01 row 4.2.4.3.3, via NTE[ServiceRequest]).
  const note = buildAnnotations(notes, ctx, issues);
  if (note !== undefined) props.push({ name: "note", value: note });

  // OBX-7 → Observation.referenceRange.text (the IG maps it to `.text`; never decomposed/evaluated).
  const refRange = obx.field(7).value;
  if (refRange !== "") {
    props.push({
      name: "referenceRange",
      value: list([complex([{ name: "text", value: primitive(refRange) }])]),
    });
  }

  return { value: complex(props), issues };
}

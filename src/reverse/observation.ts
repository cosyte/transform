/**
 * FHIR `Observation` to a v2 message carrying an `OBX` segment: the inverse of the IG **Segment OBX
 * to Observation** ConceptMap, over the rows whose inverse is defensible.
 *
 * | FHIR element | OBX field | inverse |
 * |---|---|---|
 * | `Observation.code` | OBX-3 (CWE) | coding to CWE.1/2/3 (+ one alternate triplet), `text` to CWE.9 |
 * | `Observation.value[x]` | OBX-2 + OBX-5 | the value type OBX-2 declares is derived from which `value[x]` is present |
 * | `Observation.valueQuantity` units | OBX-6 (CWE) | UCUM code/display, other systems flagged |
 * | `Observation.referenceRange.text` | OBX-7 | carried verbatim, never composed from `low`/`high` |
 * | `Observation.interpretation` | OBX-8 | v3 ObservationInterpretation codes the HL70078 map carries |
 * | `Observation.status` | OBX-11 | Table 0085 where the map inverts |
 * | `Observation.effectiveDateTime` | OBX-14 | lexical timestamp, precision preserved |
 *
 * **OBX-2 is derived, never assumed.** `valueQuantity` writes `NM` (or `SN` when the quantity
 * carries a comparator, which is the only OBX-2 type that can hold one), `valueCodeableConcept`
 * writes `CWE`, `valueString` writes `ST`, `valueDateTime` writes `DTM`. A `value[x]` with no
 * faithful OBX-5 form (`valueRange`, `valueRatio`, `valueBoolean`, ...) writes **nothing** and is
 * flagged: emitting the magnitude of a comparator-bearing or ranged value as a bare number would be
 * a confidently wrong result, which is the one thing this library never does.
 *
 * `Observation.subject` and `.encounter` are flagged rather than emitted: this shape's input is an
 * `Observation` alone, and a PID or PV1 assembled from a bare reference would be fabricated.
 *
 * @packageDocumentation
 */

import type { FhirComplex, FhirNode } from "@cosyte/fhir";
import type { RawField } from "@cosyte/hl7";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import {
  HL70078_INTERPRETATION_CODES,
  OBSERVATION_STATUS_MAP,
  V3_OBSERVATION_INTERPRETATION_SYSTEM,
} from "../messages/observation.js";
import {
  codeableToCwe,
  codeInSystem,
  reverseContext,
  type ReverseContext,
  type ReverseOptions,
} from "./coding.js";
import {
  emitMessage,
  flagUnmapped,
  hasTrigger,
  readResource,
  type RequiredV2Field,
  type ReverseResult,
  type ReverseShape,
} from "./message.js";
import { at, readComplexes, readNumberText, readString } from "./read.js";
import { invertCodeMap, v2Field, v2Number, v2Timestamp, type V2Components } from "./v2.js";

/**
 * FHIR `observation-status` to HL7 v2 Table 0085, the invertible rows of the IG's **HL70085 to
 * Observation Status** map. `entered-in-error` is absent on purpose (`D` and `W` both carry it), as
 * are the FHIR statuses the map never targets (`registered`, `unknown`).
 *
 * @example
 * ```ts
 * import { OBSERVATION_STATUS_TO_V2 } from "@cosyte/transform";
 * OBSERVATION_STATUS_TO_V2["corrected"]; // => "C"
 * OBSERVATION_STATUS_TO_V2["entered-in-error"]; // => undefined (ambiguous inverse, flagged instead)
 * ```
 */
export const OBSERVATION_STATUS_TO_V2: Readonly<Record<string, string>> =
  invertCodeMap(OBSERVATION_STATUS_MAP);

/** The FHIR `Quantity.comparator` codes an SN can carry (SN has no "not equal" comparator). */
const SN_COMPARATORS: ReadonlySet<string> = new Set(["<", "<=", ">=", ">"]);

/** The `Observation` elements this map carries into OBX. */
const OBSERVATION_MAPPED: ReadonlySet<string> = new Set([
  "resourceType",
  "code",
  "status",
  "effectiveDateTime",
  "interpretation",
  "referenceRange",
  "valueQuantity",
  "valueCodeableConcept",
  "valueString",
  "valueDateTime",
]);

// The OBX rows whose v2.5.1 usage is `R`, and ONLY those two. OBX-2 (Value Type)
// and OBX-5 (Observation Value) are `C`, conditional on each other rather than
// required, and OBX-4 is `C` too, so none of the three is declared here: a
// conditional field reported as required is a false diagnostic on a clinical
// field. OBX-1 and OBX-6 through OBX-14 are `O`. Read the grounding banner above
// `RequiredV2Field` in `message.ts` before adding a row to this list.
/** The OBX fields v2.5.1 requires, with the `Observation` element this map sources each from. */
const OBX_REQUIRED: readonly RequiredV2Field[] = [
  // OBX-3 Observation Identifier. UNREACHABLE TODAY BY CONSTRUCTION, and kept
  // anyway: `obxFields` returns no field at all when it cannot build OBX-3, so an
  // emitted OBX always carries one and this row can only fire if that early return
  // is ever relaxed. It guards the next edit rather than changing this one.
  { position: 3, location: "OBX.3", fhirPath: "Observation.code" },
  // OBX-11 Observation Result Status.
  { position: 11, location: "OBX.11", fhirPath: "Observation.status" },
];

/** What `toV2Observation` emits: an `ORU` message carrying an `OBX`, required fields above. */
const OBSERVATION_SHAPE: ReverseShape = {
  messageCode: "ORU",
  segment: "OBX",
  resourceName: "Observation",
  required: OBX_REQUIRED,
};

/** `Observation` elements with a known OBX/OBR home this narrow map does not implement. */
const OBSERVATION_UNMAPPED: Readonly<Record<string, string>> = Object.freeze({
  valueBoolean: "OBX.5",
  valueInteger: "OBX.5",
  valueRange: "OBX.5",
  valueRatio: "OBX.5",
  valueTime: "OBX.5",
  valuePeriod: "OBX.5",
  valueSampledData: "OBX.5",
  valueAttachment: "OBX.5",
  dataAbsentReason: "OBX.5",
  effectivePeriod: "OBX.14",
  effectiveInstant: "OBX.14",
  issued: "OBX.19",
  performer: "OBX.16",
  method: "OBX.17",
  specimen: "OBX.18",
  device: "OBX.18",
  bodySite: "OBX.20",
  identifier: "OBX.21",
  note: "NTE",
  subject: "PID",
  encounter: "PV1",
  basedOn: "OBR",
  category: "OBR",
  component: "OBX",
  hasMember: "OBX",
  derivedFrom: "OBX",
});

/** The units CWE for a quantity, or `undefined` when it carries no unit at all. */
function unitComponents(
  quantity: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): V2Components | undefined {
  const unit = readString(at(quantity, "unit"), "OBX.6", "Observation.valueQuantity.unit", issues);
  const code = readString(at(quantity, "code"), "OBX.6", "Observation.valueQuantity.code", issues);
  const system = readString(
    at(quantity, "system"),
    "OBX.6",
    "Observation.valueQuantity.system",
    issues,
  );
  const mnemonic = system === undefined ? undefined : ctx.mnemonicFor(system);
  if (code !== undefined && mnemonic !== undefined) return [code, unit, mnemonic];
  if (code !== undefined) {
    // A coded unit whose system has no v2 mnemonic (or none at all) cannot be written as a coded
    // unit: the display text survives, the code does not get a borrowed table.
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2, "OBX.6", "Observation.valueQuantity.system"),
    );
  }
  return unit === undefined ? undefined : [undefined, unit];
}

/** OBX-2 / OBX-5 / OBX-6 for a `valueQuantity`. */
function quantityValue(
  quantity: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): { valueType: string; value: V2Components; units: V2Components | undefined } | undefined {
  const raw = readNumberText(
    at(quantity, "value"),
    "OBX.5",
    "Observation.valueQuantity.value",
    issues,
  );
  const magnitude = raw === undefined ? undefined : v2Number(raw);
  if (magnitude === undefined) {
    if (raw !== undefined) {
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE,
          "OBX.5",
          "Observation.valueQuantity.value",
        ),
      );
    }
    return undefined;
  }
  const units = unitComponents(quantity, ctx, issues);
  const comparator = readString(
    at(quantity, "comparator"),
    "OBX.5",
    "Observation.valueQuantity.comparator",
    issues,
  );
  if (comparator === undefined) return { valueType: "NM", value: [magnitude], units };
  if (!SN_COMPARATORS.has(comparator)) {
    // Emitting the magnitude without its comparator would assert a different result: emit neither.
    issues.push(
      issue(
        ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE,
        "OBX.5",
        "Observation.valueQuantity.comparator",
      ),
    );
    return undefined;
  }
  // SN.1 comparator, SN.2 number: the structured-numeric shape the IG's OBX-2 = SN row describes.
  return { valueType: "SN", value: [comparator, magnitude], units };
}

/** OBX-2 / OBX-5 / OBX-6 for whichever `value[x]` the observation carries, if any. */
function observationValue(
  observation: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): { valueType: string; value: V2Components; units: V2Components | undefined } | undefined {
  const quantity = readComplexes(
    at(observation, "valueQuantity"),
    "OBX.5",
    "Observation.valueQuantity",
    issues,
  )[0];
  if (quantity !== undefined) return quantityValue(quantity, ctx, issues);

  const concept = readComplexes(
    at(observation, "valueCodeableConcept"),
    "OBX.5",
    "Observation.valueCodeableConcept",
    issues,
  )[0];
  if (concept !== undefined) {
    const cwe = codeableToCwe(concept, ctx, "OBX.5", "Observation.valueCodeableConcept", issues);
    return cwe === undefined ? undefined : { valueType: "CWE", value: cwe, units: undefined };
  }

  const text = readString(
    at(observation, "valueString"),
    "OBX.5",
    "Observation.valueString",
    issues,
  );
  if (text !== undefined) return { valueType: "ST", value: [text], units: undefined };

  const instant = readString(
    at(observation, "valueDateTime"),
    "OBX.5",
    "Observation.valueDateTime",
    issues,
  );
  if (instant !== undefined) {
    const dtm = v2Timestamp(instant);
    if (dtm === undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "OBX.5", "Observation.valueDateTime"),
      );
      return undefined;
    }
    return { valueType: "DTM", value: [dtm], units: undefined };
  }
  return undefined;
}

/** OBX-8: the abnormal flags whose v3 interpretation code the HL70078 map carries. */
function interpretationField(
  observation: FhirComplex,
  issues: TransformIssue[],
): RawField | undefined {
  const flags: V2Components[] = [];
  for (const concept of readComplexes(
    at(observation, "interpretation"),
    "OBX.8",
    "Observation.interpretation",
    issues,
  )) {
    const code = codeInSystem(
      concept,
      V3_OBSERVATION_INTERPRETATION_SYSTEM,
      "OBX.8",
      "Observation.interpretation",
      issues,
    );
    if (code === undefined) continue;
    // The HL70078 map is code-preserving, so a v3 code it carries is its own v2 flag; one it does
    // not carry has no v2 abnormal flag and is never coerced to a neighbouring one.
    if (HL70078_INTERPRETATION_CODES.has(code)) flags.push([code]);
    else {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE, "OBX.8", "Observation.interpretation"),
      );
    }
  }
  return v2Field(flags);
}

/** OBX-7: the reference range's text, carried verbatim and never composed from its endpoints. */
function referenceRangeField(
  observation: FhirComplex,
  issues: TransformIssue[],
): RawField | undefined {
  const ranges = readComplexes(
    at(observation, "referenceRange"),
    "OBX.7",
    "Observation.referenceRange",
    issues,
  );
  if (ranges.length > 1) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "OBX.7", "Observation.referenceRange"),
    );
  }
  const first = ranges[0];
  if (first === undefined) return undefined;
  const text = readString(at(first, "text"), "OBX.7", "Observation.referenceRange.text", issues);
  if (text === undefined) {
    // low/high are structured endpoints; OBX-7's own IG row is the text one, and assembling
    // "3.5-5.0" from two Quantities would be composing a v2 value this map has no row for.
    issues.push(issue(ISSUE_CODES.TRANSFORM_NO_V2_TARGET, "OBX.7", "Observation.referenceRange"));
    return undefined;
  }
  return v2Field([[text]]);
}

/** Every OBX field this map produces, keyed by HL7 field position. */
function obxFields(
  observation: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): ReadonlyMap<number, RawField> {
  const fields = new Map<number, RawField>();

  // OBX-3 is the observation identifier: without one there is no OBX to emit at all.
  const concept = readComplexes(at(observation, "code"), "OBX.3", "Observation.code", issues)[0];
  if (concept === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, "OBX.3", "Observation.code"));
    return fields;
  }
  const cwe = codeableToCwe(concept, ctx, "OBX.3", "Observation.code", issues);
  const obx3 = cwe === undefined ? undefined : v2Field([cwe]);
  if (obx3 === undefined) return fields;
  fields.set(3, obx3);

  const value = observationValue(observation, ctx, issues);
  if (value !== undefined) {
    const obx2 = v2Field([[value.valueType]]);
    const obx5 = v2Field([value.value]);
    if (obx2 !== undefined && obx5 !== undefined) {
      fields.set(2, obx2);
      fields.set(5, obx5);
    }
    const obx6 = value.units === undefined ? undefined : v2Field([value.units]);
    if (obx6 !== undefined) fields.set(6, obx6);
  }

  const referenceRange = referenceRangeField(observation, issues);
  if (referenceRange !== undefined) fields.set(7, referenceRange);

  const interpretation = interpretationField(observation, issues);
  if (interpretation !== undefined) fields.set(8, interpretation);

  const status = readString(at(observation, "status"), "OBX.11", "Observation.status", issues);
  if (status !== undefined) {
    const code = Object.hasOwn(OBSERVATION_STATUS_TO_V2, status)
      ? OBSERVATION_STATUS_TO_V2[status]
      : undefined;
    if (code === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE, "OBX.11", "Observation.status"));
    } else {
      const obx11 = v2Field([[code]]);
      if (obx11 !== undefined) fields.set(11, obx11);
    }
  }

  const effective = readString(
    at(observation, "effectiveDateTime"),
    "OBX.14",
    "Observation.effectiveDateTime",
    issues,
  );
  if (effective !== undefined) {
    const dtm = v2Timestamp(effective);
    if (dtm === undefined) {
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE,
          "OBX.14",
          "Observation.effectiveDateTime",
        ),
      );
    } else {
      const obx14 = v2Field([[dtm]]);
      if (obx14 !== undefined) fields.set(14, obx14);
    }
  }

  return fields;
}

/**
 * Convert a FHIR R4 `Observation` into a **complete** v2 message carrying an `OBX` segment, in the
 * result-report (`ORU`) shape.
 *
 * The `trigger` argument is **required and never inferred**: no `Observation` element maps to a v2
 * message trigger, so the caller supplies it, and a missing, empty or non-string one returns
 * `{ value: undefined }` plus {@link ISSUE_CODES.TRANSFORM_MISSING_TRIGGER} without calling the
 * message builder at all. It is used verbatim as MSH-9.2 under the `ORU` message code this shape
 * fixes.
 *
 * The message carries the `OBX` alone: this shape's input is an `Observation`, which names no
 * patient, and a subject segment assembled from a reference would be fabricated. Lossy by design and
 * never round-trip-safe.
 *
 * An `OBX` field v2 requires (OBX-11 Observation Result Status) that this resource gives no source
 * for stays absent and is declared with {@link ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT},
 * rather than defaulted to `F`: a result reported as final that the sender never called final is the
 * confidently wrong value this library exists to refuse. An `Observation` that grounds no `OBX`
 * field at all yields no message and {@link ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED}.
 *
 * @param resource - The FHIR `Observation` node.
 * @param trigger - The bare v2 trigger, e.g. `"R01"`. Required; never derived from the resource.
 * @param options - Caller-vetted reverse context: code systems and the MSH envelope.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { toV2Observation } from "@cosyte/transform";
 *
 * const { resource } = parseResource(
 *   '{"resourceType":"Observation","status":"final","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]}}',
 * );
 * const { value, issues } = toV2Observation(resource, "R01");
 * // value.toString() carries "ORU^R01" in MSH-9, then an OBX whose OBX-3 is "789-8^^LN"
 * void value;
 * void issues;
 * ```
 */
export function toV2Observation(
  resource: FhirNode,
  trigger: string,
  options: ReverseOptions = {},
): ReverseResult {
  const issues: TransformIssue[] = [];
  const triggerOk = hasTrigger(trigger, issues);
  const observation = readResource(resource, "Observation", "OBX", issues);
  if (!triggerOk || observation === undefined) return { value: undefined, issues };

  flagUnmapped(observation, OBSERVATION_MAPPED, OBSERVATION_UNMAPPED, "Observation", "OBX", issues);
  const ctx = reverseContext(options);
  const fields = obxFields(observation, ctx, issues);
  const value = emitMessage(OBSERVATION_SHAPE, trigger, fields, ctx, issues);
  return { value, issues };
}

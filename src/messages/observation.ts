/**
 * OBX → FHIR `Observation` — the highest-clinical-stakes segment map,
 * grounded firsthand on the IG **Segment OBX to Observation** ConceptMap plus its two governing table
 * ConceptMaps (`hl7.fhir.uv.v2mappings`, STU1). The rows used here, verified against the published maps
 * (`ConceptMap-segment-obx-to-observation.html`, `-table-hl70078-to-v3-observationinterpretation.html`,
 * `-table-hl70085-to-observation-status.html`):
 *
 * | OBX field | FHIR target | via |
 * |---|---|---|
 * | OBX-2 Value Type | discriminates OBX-5 → `value[x]` | {@link buildValue} — never assume `Quantity` |
 * | OBX-3 Observation Identifier (CWE) | `Observation.code` | {@link toFhirCodeableConcept} |
 * | OBX-5 Observation Value | `Observation.value[x]` | per OBX-2 |
 * | OBX-6 Units (CWE) | `valueQuantity.unit`/`.code`/`.system` | {@link quantityFromRawMagnitude} |
 * | OBX-7 Reference Range | `Observation.referenceRange.text` | mapped to `.text` (never decomposed) |
 * | OBX-8 Abnormal Flags | `Observation.interpretation` | {@link HL70078_INTERPRETATION_CODES} |
 * | OBX-11 Result Status | `Observation.status` | {@link OBSERVATION_STATUS_MAP} (HL70085) |
 * | OBX-14 Date/Time of Observation | `Observation.effectiveDateTime` | {@link toFhirDateTime} |
 *
 * **The "never a confident wrong result" fail-safes:**
 * - **OBX-2 drives `value[x]`.** `NM`→`valueQuantity`, `CWE`/`CE`/`CF`/`CNE`/`IS`→`valueCodeableConcept`,
 *   `SN`→structured (`valueQuantity` with a comparator / `valueRange` / `valueRatio`), `ST`/`TX`/`FT`→
 *   `valueString`. A value type with no first-class target here (`NA`, `ED`, `DR`, `TM`, `NR`, unknown)
 *   preserves the raw value as `valueString` and flags {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}
 *   (the richer FHIR type is deferred) — never a fabricated `Quantity`.
 * - **A corrected/cancelled result never emits as `final`.** OBX-11 `C`→`corrected`, `X`→`cancelled`,
 *   `D`/`W`→`entered-in-error` (HL70085). A status code with **no** HL70085 target leaves
 *   `Observation.status` absent (flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}); the required-`status`
 *   emit gate then **withholds** the Observation rather than shipping it — never coerced to `final`.
 * - **An unrecognized abnormal flag is surfaced, never coerced to normal.** Each OBX-8 flag in
 *   {@link HL70078_INTERPRETATION_CODES} becomes an `interpretation` coding (the map is code-preserving);
 *   a flag absent from the table is flagged and dropped, never emitted as `N`/normal.
 *
 * Numeric magnitudes (NM, SN) are read from the **raw OBX-5 field** — not the `@cosyte/hl7`
 * `Observation` view's JS `number` — so a reported lab value's exact lexical precision (`120.50`) is
 * carried through the string-backed FHIR `decimal`, never routed through a lossy `number`.
 *
 * @packageDocumentation
 */

import type { CWE, Field, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { quantityFromRawMagnitude } from "../datatypes/quantity.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";

/** The v3 ObservationInterpretation canonical system (FHIR `Observation.interpretation` binding). */
const V3_OBSERVATION_INTERPRETATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation";

/**
 * HL7 v2 Table 0078 (Abnormal Flags) → FHIR v3 ObservationInterpretation (`Observation.interpretation`),
 * per the IG **Table HL70078 to v3 ObservationInterpretation** ConceptMap. Every mapped row is
 * `is equivalent to` an **identically-spelled** v3 code (the map is code-preserving), so this is the set
 * of codes that carry a target — a flag **absent** from this set has no equivalent and is flagged
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
 * `U`, `V`) are **absent here on purpose** — an OBX-11 with one of them (or any local code) leaves
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

/** Reconstruct an SN's human string (`>90`, `10-20`, `1:2`) from its raw components — for a fallback. */
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

  // A value type with no first-class FHIR value[x] here (NA, ED, RP, DR, TM, NR, ID, unknown): the raw
  // value is preserved as a string and the richer typed mapping is flagged as deferred — never guessed.
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
      // An unrecognized abnormal flag is surfaced and dropped — NEVER coerced to `N`/normal.
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBX.8", "Observation.interpretation"),
      );
    }
  }
  return codings.length === 0 ? undefined : list(codings);
}

/**
 * Build a FHIR `Observation` resource node from one parsed HL7 v2 OBX segment. Returns
 * `{ value: undefined }` when the OBX carries no observation identifier (OBX-3) — an Observation with
 * no `code` cannot be emitted. `Observation.status` is left absent (and the resource later withheld by
 * the emit gate) when OBX-11 is missing or has no HL70085 target — never guessed.
 *
 * @param obx - The OBX `@cosyte/hl7` `Segment`.
 * @param subjectFullUrl - The `urn:uuid:` fullUrl of the bundle's Patient, wired to `Observation.subject`.
 * @param encounterFullUrl - The `urn:uuid:` fullUrl of the bundle's Encounter, wired to `.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
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

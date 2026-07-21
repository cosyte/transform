/**
 * NM + units (CWE) → FHIR `Quantity` (roadmap §4.6).
 *
 * Grounded on the IG datatype maps for OBX-5 (NM)→`Quantity.value` and OBX-6 (CWE units)→
 * `Quantity.unit`/`.code`/`.system`. Two hard fail-safes:
 *
 * - **Never convert magnitudes.** The numeric value is carried through **precision-exact** via
 *   `@cosyte/fhir`'s string-backed `decimal` (a dose or lab value is never routed through a JS
 *   `number`). UCUM magnitude conversion (mg/dL ↔ mmol/L) is analyte-dependent and a
 *   clinical-safety footgun — an explicit non-goal, never a transform side effect.
 * - **Never fabricate a UCUM code.** A unit is emitted into `Quantity.code`/`.system` **only** when
 *   it is declared UCUM and passes `@cosyte/fhir`'s UCUM shape check. Any other unit is preserved
 *   verbatim in `Quantity.unit` with `code`/`system` absent, flagged
 *   {@link ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM}.
 *
 * @packageDocumentation
 */

import type { CWE, NM } from "@cosyte/hl7";
import {
  decimal,
  primitive,
  UCUM_SYSTEM,
  validateUcumShape,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { object, text } from "./build.js";

/**
 * Convert a parsed HL7 v2 numeric value plus its units to a FHIR `Quantity` node, fail-safe on the
 * unit. Returns `{ value: undefined }` when the numeric magnitude is absent or non-numeric (a
 * Quantity without a value cannot be safely emitted).
 *
 * @param value - A parsed `@cosyte/hl7` `NM` (its `.raw` carries the exact lexical value).
 * @param units - The units component (an OBX-6 `CWE`); its CWE.1 is the candidate UCUM code.
 * @param ctx - The transform context; used to recognize the UCUM coding system.
 * @example
 * ```ts
 * import { toFhirQuantity } from "@cosyte/transform";
 * const { value } = toFhirQuantity(
 *   { raw: "5.4", value: 5.4 },
 *   { identifier: "mg/dL", nameOfCodingSystem: "UCUM" },
 * );
 * // value === Quantity { value: 5.4, unit: "mg/dL", system: "http://unitsofmeasure.org", code: "mg/dL" }
 * void value;
 * ```
 */
export function toFhirQuantity(
  value: NM,
  units: CWE,
  ctx: TransformContext = {},
): ConvertResult<FhirComplex> {
  // No numeric magnitude → nothing safe to emit as a Quantity (never guess a value).
  if (value.value === undefined || value.raw === "") {
    return { value: undefined, issues: [] };
  }
  return quantityFromRawMagnitude(value.raw, units, ctx);
}

/**
 * Build a FHIR `Quantity` from a **raw lexical magnitude string** plus its units, fail-safe on both
 * the magnitude and the unit, with an optional `Quantity.comparator`. This is the shared core behind
 * {@link toFhirQuantity} (NM) and the SN → `valueQuantity`/`valueRange`/`valueRatio` observation path
 * (§4.7): both must carry the magnitude through **precision-exact** as a string-backed `decimal` and
 * apply the identical no-fabricated-UCUM unit gate — so they share one implementation rather than two
 * that could drift.
 *
 * Returns `{ value: undefined }` (+ a {@link ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID} issue) when
 * the raw magnitude is not a faithful FHIR `decimal` literal — never a canonicalized (altered) value.
 *
 * @param raw - The magnitude's exact lexical form (e.g. OBX-5 NM `.raw`, or an SN component string).
 * @param units - The units component (a CWE); its CWE.1 is the candidate UCUM code.
 * @param ctx - The transform context; used to recognize the UCUM coding system.
 * @param comparator - An optional FHIR `Quantity.comparator` (`<` `<=` `>=` `>`), from an SN comparator.
 * @param valueLocation - The v2 location of the magnitude, for the invalid-value issue (default `OBX.5`).
 * @example
 * ```ts
 * // internal shared core (used by toFhirQuantity for NM and the observation SN path):
 * // const { value } = quantityFromRawMagnitude("90", { identifier: "mg/dL", nameOfCodingSystem: "UCUM" }, {}, ">");
 * // value === Quantity { comparator: ">", value: 90, unit: "mg/dL", system: UCUM, code: "mg/dL" }
 * ```
 */
export function quantityFromRawMagnitude(
  raw: string,
  units: CWE,
  ctx: TransformContext = {},
  comparator?: string,
  valueLocation = "OBX.5",
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  if (raw === "") {
    return { value: undefined, issues };
  }
  // A raw magnitude keeps its v2 lexical form (v2 allows a leading `+`, leading zeros, a trailing dot),
  // but the FHIR `decimal` literal forbids those. Rather than canonicalize — which would ALTER the
  // magnitude's lexical form — fail safe: if a faithful decimal can't be built, emit a typed issue and
  // no value. (`decimal` throws on a non-conforming literal; catch it so this never throws — §4.6.)
  let valueNode: FhirNode;
  try {
    valueNode = primitive(decimal(raw));
  } catch {
    return {
      value: undefined,
      issues: [
        issue(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID, valueLocation, "Quantity.value"),
      ],
    };
  }

  const unitCode = units.identifier; // CWE.1 — the candidate coded (UCUM) unit
  const unitDisplay = units.text; // CWE.2 — the human display unit
  const hasUnit =
    (unitCode !== undefined && unitCode !== "") ||
    (unitDisplay !== undefined && unitDisplay !== "");

  let ucumCode: string | undefined;
  let system: string | undefined;
  let unitStr: string | undefined = unitDisplay ?? unitCode;

  if (hasUnit) {
    const mnemonic = units.nameOfCodingSystem;
    const declaredUcum =
      mnemonic === "UCUM" ||
      (mnemonic !== undefined && ctx.namingSystem?.resolveCodeSystem(mnemonic) === UCUM_SYSTEM);
    if (
      declaredUcum &&
      unitCode !== undefined &&
      unitCode !== "" &&
      validateUcumShape(unitCode) === "ok"
    ) {
      ucumCode = unitCode;
      system = UCUM_SYSTEM;
      unitStr = unitDisplay ?? unitCode;
    } else {
      // Non-UCUM or unvalidatable → preserve verbatim, no code/system, magnitude untouched.
      issues.push(issue(ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM, "OBX.6", "Quantity.code"));
    }
  }

  const quantity = object([
    ["comparator", text(comparator)],
    ["value", valueNode],
    ["unit", text(unitStr)],
    ["system", text(system)],
    ["code", text(ucumCode)],
  ]);

  return { value: quantity, issues };
}

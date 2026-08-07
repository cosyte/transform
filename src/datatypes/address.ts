/**
 * XAD → FHIR `Address`.
 *
 * Grounded on the IG datatype ConceptMap **XAD → Address**: `XAD.1`/`XAD.2`→`line`, `XAD.3`→`city`,
 * `XAD.4`→`state`, `XAD.5`→`postalCode`, `XAD.6`→`country`, `XAD.9` (county/parish)→`district`, and
 * the **value-conditional `XAD.7`** split across two independent FHIR axes:
 * - `XAD.7 IN {BA, BI, C, B, H, O}` → `Address.use` (via the IG **HL70190 → address-use** map);
 * - `XAD.7 IN {M, SH}` → `Address.type` (via the IG **HL70190 → address-type** map);
 * - a vacation address (`V` in Table 0190; the datatype map references `HV`) → an ISO-21090 extension
 *   the IG defines, **not emitted**, and flagged rather than invented;
 * - any other code → `use`/`type` left absent, flagged {@link ISSUE_CODES.TRANSFORM_ADDRESS_USE_UNMAPPED}.
 *
 * FHIR deliberately separates `use` (home/work/temp) from `type` (postal/physical), so one v2 code
 * cannot always populate both axes: round-trip is not stable, and the drop is surfaced, never hidden.
 * `XAD.8` (other geographic designation) has no FHIR target and is flagged dropped.
 *
 * @packageDocumentation
 */

import type { XAD } from "@cosyte/hl7";
import type { FhirComplex } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import { arr, object, text } from "./build.js";

/** HL7 v2 Table 0190 address-type code → FHIR `address-use`, exactly per the IG HL70190→address-use map. */
export const ADDRESS_USE_MAP: Readonly<Record<string, string>> = Object.freeze({
  BA: "old",
  BI: "billing",
  C: "temp",
  B: "work",
  H: "home",
  O: "work",
});

/** HL7 v2 Table 0190 address-type code → FHIR `address-type`, exactly per the IG HL70190→address-type map. */
export const ADDRESS_TYPE_MAP: Readonly<Record<string, string>> = Object.freeze({
  M: "postal",
  SH: "postal",
});

/**
 * Convert a parsed HL7 v2 XAD to a FHIR `Address` node. Returns `{ value: undefined }` when the
 * address carries no emittable part.
 *
 * @param xad - A parsed `@cosyte/hl7` `XAD`.
 * @example
 * ```ts
 * import { toFhirAddress } from "@cosyte/transform";
 * const { value } = toFhirAddress({ street: "1 Main St", city: "Boston", stateOrProvince: "MA", addressType: "H" });
 * // value === Address { use: "home", line: ["1 Main St"], city: "Boston", state: "MA" }
 * void value;
 * ```
 */
export function toFhirAddress(xad: XAD): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // XAD.7 → use and/or type across the two independent axes; unmapped (incl. HV) → flagged, absent.
  let use: string | undefined;
  let type: string | undefined;
  if (xad.addressType !== undefined && xad.addressType !== "") {
    use = Object.hasOwn(ADDRESS_USE_MAP, xad.addressType)
      ? ADDRESS_USE_MAP[xad.addressType]
      : undefined;
    type = Object.hasOwn(ADDRESS_TYPE_MAP, xad.addressType)
      ? ADDRESS_TYPE_MAP[xad.addressType]
      : undefined;
    if (use === undefined && type === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ADDRESS_USE_UNMAPPED, "XAD.7", "Address.use"));
    }
  }

  // XAD.8 (other geographic designation) has no FHIR target: flag the drop.
  if (xad.otherGeographicDesignation !== undefined && xad.otherGeographicDesignation !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "XAD.8"));
  }

  const value = object([
    ["use", text(use)],
    ["type", text(type)],
    ["line", arr([text(xad.street), text(xad.otherDesignation)])],
    ["city", text(xad.city)],
    ["district", text(xad.countyParishCode)],
    ["state", text(xad.stateOrProvince)],
    ["postalCode", text(xad.zipOrPostalCode)],
    ["country", text(xad.country)],
  ]);

  return { value, issues };
}

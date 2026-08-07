/**
 * XPN → FHIR `HumanName`.
 *
 * Grounded on the IG datatype ConceptMap **XPN → HumanName**: `XPN.1`→`family`, `XPN.2`→`given[0]`,
 * `XPN.3`→`given[1]`, `XPN.4`→`suffix`, `XPN.5`→`prefix`, `XPN.6` (degree)→`suffix`,
 * `XPN.7`→`use` (via the IG **HL70200 → name-use** ConceptMap), `XPN.14` (professional suffix)→`suffix`.
 *
 * `XPN.7`→`use` is a **lossy code translation**: only the codes the IG's HL70200→name-use map covers
 * are translated; any other name-type code leaves `use` **absent** and raises
 * {@link ISSUE_CODES.TRANSFORM_NAME_USE_UNMAPPED}, never guessed. Not converted, and flagged:
 * the name-validity period (`XPN.12`/`XPN.13`), whose FHIR `period` needs the timezone policy of the
 * dateTime path.
 *
 * @packageDocumentation
 */

import type { XPN } from "@cosyte/hl7";
import type { FhirComplex } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import { arr, object, text } from "./build.js";

/**
 * HL7 v2 Table 0200 name-type code → FHIR `name-use`, exactly per the IG **HL70200 → name-use**
 * ConceptMap (every row is "is equivalent to"). Codes absent here (A, B, C, F, I, K, NB, NOUSE, P,
 * REL, S, T, U, …) have **no FHIR equivalent** and are surfaced, never guessed.
 */
export const NAME_USE_MAP: Readonly<Record<string, string>> = Object.freeze({
  BAD: "old",
  D: "usual",
  L: "official",
  M: "maiden",
  MSK: "anonymous",
  N: "nickname",
  NAV: "temp",
  R: "official",
  TEMP: "temp",
});

/**
 * Convert a parsed HL7 v2 XPN to a FHIR `HumanName` node. Returns `{ value: undefined }` when the
 * name carries no emittable part.
 *
 * @param xpn - A parsed `@cosyte/hl7` `XPN`.
 * @example
 * ```ts
 * import { toFhirHumanName } from "@cosyte/transform";
 * const { value } = toFhirHumanName({ familyName: "Public", givenName: "Jane", nameTypeCode: "L" });
 * // value === HumanName { use: "official", family: "Public", given: ["Jane"] }
 * void value;
 * ```
 */
export function toFhirHumanName(xpn: XPN): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // XPN.7 → use, via the HL70200 → name-use map; unmapped → absent + flagged.
  let use: string | undefined;
  if (xpn.nameTypeCode !== undefined && xpn.nameTypeCode !== "") {
    use = Object.hasOwn(NAME_USE_MAP, xpn.nameTypeCode)
      ? NAME_USE_MAP[xpn.nameTypeCode]
      : undefined;
    if (use === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_NAME_USE_UNMAPPED, "XPN.7", "HumanName.use"));
    }
  }

  // XPN.12 / XPN.13 name-validity period is deferred (needs the dateTime timezone policy): flagged.
  if (xpn.effectiveDate !== undefined && xpn.effectiveDate !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "XPN.12", "HumanName.period"));
  }
  if (xpn.expirationDate !== undefined && xpn.expirationDate !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "XPN.13", "HumanName.period"));
  }

  const value = object([
    ["use", text(use)],
    ["family", text(xpn.familyName)],
    ["given", arr([text(xpn.givenName), text(xpn.secondName)])],
    ["prefix", arr([text(xpn.prefix)])],
    // XPN.4 (suffix), XPN.6 (degree), XPN.14 (professional suffix) all land in HumanName.suffix.
    ["suffix", arr([text(xpn.suffix), text(xpn.degree), text(xpn.professionalSuffix)])],
  ]);

  return { value, issues };
}

/**
 * CWE / CE → FHIR `CodeableConcept` — the code-fidelity path (roadmap §4.3).
 *
 * Grounded on the IG datatype ConceptMap **CWE → CodeableConcept**: `CWE.1`→`coding[0].code`,
 * `CWE.2`→`coding[0].display`, `CWE.3`→`coding[0].system` **(indirect — the vocabulary table gives
 * the actual URI)**, `CWE.7`→`coding[0].version`, the alternate triplet `CWE.4/5/6`→`coding[1]` (+
 * `CWE.8`→`coding[1].version`), and `CWE.9`→`text`. `CE` is the 6-component subset of `CWE` and maps
 * through the same shape.
 *
 * Two fail-safes, neither of which ever fabricates a code:
 * - **Unrecognized coding-system mnemonic** (CWE.3/CWE.6) → the code is preserved with **no system**,
 *   flagged {@link ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED}. A canonical URI is never invented.
 * - **A bare code with no coding system at all** (CWE.1 present, CWE.3 absent) → preserved verbatim,
 *   flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}. Never coerced to a plausible neighbor.
 *
 * Phase 1 does **no ConceptMap value translation** (that is Phase 6); it recognizes systems and
 * preserves codes.
 *
 * @packageDocumentation
 */

import type { CWE } from "@cosyte/hl7";
import type { FhirComplex } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { arr, object, text } from "./build.js";

/** The subset of CWE fields a CE also provides — so `toFhirCodeableConcept` accepts both. */
export type CodedElement = Pick<
  CWE,
  | "identifier"
  | "text"
  | "nameOfCodingSystem"
  | "alternateIdentifier"
  | "alternateText"
  | "nameOfAlternateCodingSystem"
  | "codingSystemVersionId"
  | "alternateCodingSystemVersionId"
  | "originalText"
>;

/** The four inputs to {@link buildCoding} — one CWE/CE coding triplet (code, display, system, version). */
export interface CodingParts {
  readonly code: string | undefined;
  readonly display: string | undefined;
  readonly mnemonic: string | undefined;
  readonly version: string | undefined;
}

/**
 * Build one `Coding` and accumulate any system/unmapped issue against it. Returns `undefined` when
 * the triplet carries no code and no display (nothing to emit). Exported so the value-translation
 * engine ({@link ../terminology/concept-map.js}) can reuse the exact same alternate-triplet
 * (`CWE.4/5/6`) resolution + fail-safe flagging when it builds an additively-translated concept.
 *
 * @param parts - The one coding triplet's code/display/system-mnemonic/version.
 * @param ctx - The transform context (its `namingSystem` resolves the mnemonic to a canonical URI).
 * @param codeLocation - The v2 location of the code component (e.g. `"CWE.4"`), for a value-free issue.
 * @param systemLocation - The v2 location of the coding-system component (e.g. `"CWE.6"`).
 * @param issues - The issue sink this call appends any system/unmapped diagnostic to.
 * @example
 * ```ts
 * // Internal helper (re-used by the terminology engine):
 * //   const issues = [];
 * //   const coding = buildCoding(
 * //     { code: "789-8", display: "Hgb", mnemonic: "LN", version: undefined },
 * //     { namingSystem: createNamingSystem() }, "CWE.1", "CWE.3", issues,
 * //   );
 * ```
 */
export function buildCoding(
  parts: CodingParts,
  ctx: TransformContext,
  codeLocation: string,
  systemLocation: string,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (
    (parts.code === undefined || parts.code === "") &&
    (parts.display === undefined || parts.display === "")
  ) {
    return undefined;
  }

  let system: string | undefined;
  if (parts.mnemonic !== undefined && parts.mnemonic !== "") {
    system = ctx.namingSystem?.resolveCodeSystem(parts.mnemonic);
    if (system === undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED, systemLocation, "Coding.system"),
      );
    }
  } else if (parts.code !== undefined && parts.code !== "") {
    // A code with no coding-system context at all — preserved, but unmapped to any FHIR system.
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, codeLocation, "Coding.code"));
  }

  return object([
    ["system", text(system)],
    ["version", text(parts.version)],
    ["code", text(parts.code)],
    ["display", text(parts.display)],
  ]);
}

/**
 * Convert a parsed HL7 v2 CWE (or CE) to a FHIR `CodeableConcept` node, fail-safe on the coding
 * system and on unmapped codes. Returns `{ value: undefined }` when the element is empty.
 *
 * @param cwe - A parsed `@cosyte/hl7` `CWE` (a `CE` is accepted as its subset).
 * @param ctx - The transform context; `ctx.namingSystem` resolves the coding-system mnemonic.
 * @example
 * ```ts
 * import { toFhirCodeableConcept, createNamingSystem } from "@cosyte/transform";
 * const { value } = toFhirCodeableConcept(
 *   { identifier: "789-8", text: "Hemoglobin", nameOfCodingSystem: "LN" },
 *   { namingSystem: createNamingSystem() },
 * );
 * // coding[0] === { system: "http://loinc.org", code: "789-8", display: "Hemoglobin" }
 * void value;
 * ```
 */
export function toFhirCodeableConcept(
  cwe: CodedElement,
  ctx: TransformContext = {},
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  const primary = buildCoding(
    {
      code: cwe.identifier,
      display: cwe.text,
      mnemonic: cwe.nameOfCodingSystem,
      version: cwe.codingSystemVersionId,
    },
    ctx,
    "CWE.1",
    "CWE.3",
    issues,
  );
  const alternate = buildCoding(
    {
      code: cwe.alternateIdentifier,
      display: cwe.alternateText,
      mnemonic: cwe.nameOfAlternateCodingSystem,
      version: cwe.alternateCodingSystemVersionId,
    },
    ctx,
    "CWE.4",
    "CWE.6",
    issues,
  );

  const value = object([
    ["coding", arr([primary, alternate])],
    ["text", text(cwe.originalText)],
  ]);

  return { value, issues };
}

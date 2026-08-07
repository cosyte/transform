/**
 * CX → FHIR `Identifier`: the patient-identity-integrity path.
 *
 * Grounded on the IG datatype ConceptMap **CX → Identifier**: `CX.1` → `Identifier.value`, `CX.4`
 * (assigning authority HD) → `Identifier.system` *when the authority resolves in a registry* (else
 * the IG maps it to `Identifier.assigner`: a message-level Organization reference this library does
 * not build), and `CX.5` (Table 0203) → `Identifier.type`.
 *
 * The load-bearing fail-safe: the assigning authority is resolved through the
 * {@link NamingSystemRegistry}, which **never synthesizes a system URI from HD.1 (the bare namespace)
 * alone**. Two hospitals reusing "MR"/"HOSPMRN" would otherwise collide and merge two patients. On
 * an unresolved authority the identifier is emitted with its **value and no system**, plus a typed
 * {@link ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED} issue, never a guessed system.
 *
 * @packageDocumentation
 */

import type { CX } from "@cosyte/hl7";
import type { FhirComplex } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { V2_0203_SYSTEM } from "../terminology/naming-system.js";
import { arr, object, text } from "./build.js";

/** Build `Identifier.type` (a CodeableConcept over v2-0203) from CX.5, or `undefined` when absent. */
function buildType(typeCode: string | undefined): FhirComplex | undefined {
  if (typeCode === undefined || typeCode === "") return undefined;
  const coding = object([
    ["system", text(V2_0203_SYSTEM)],
    ["code", text(typeCode)],
  ]);
  return object([["coding", arr([coding])]]);
}

/**
 * Convert a parsed HL7 v2 CX to a FHIR `Identifier` node, fail-safe on the assigning authority.
 * Returns `{ value: undefined }` when the CX carries no identifier value at all.
 *
 * @param cx - A parsed `@cosyte/hl7` `CX`.
 * @param ctx - The transform context; `ctx.namingSystem` resolves the assigning authority (HD).
 * @example
 * ```ts
 * import { toFhirIdentifier, createNamingSystem } from "@cosyte/transform";
 * const { value, issues } = toFhirIdentifier(
 *   { idNumber: "12345", assigningAuthority: { namespaceId: "HOSPMRN" } },
 *   { namingSystem: createNamingSystem() },
 * );
 * // no registry entry for a bare "HOSPMRN" namespace → value emitted, system absent, one issue
 * void value;
 * void issues;
 * ```
 */
export function toFhirIdentifier(cx: CX, ctx: TransformContext = {}): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // Nothing to key an identifier on → emit nothing (an empty CX is not an error).
  if (cx.idNumber === undefined || cx.idNumber === "") {
    return { value: undefined, issues };
  }

  // CX.4 (HD) → Identifier.system, never synthesized from HD.1 alone.
  let system: string | undefined;
  const hd = cx.assigningAuthority;
  const hasAuthority =
    hd !== undefined &&
    (hd.namespaceId !== undefined ||
      hd.universalId !== undefined ||
      hd.universalIdType !== undefined);
  if (hd !== undefined && hasAuthority) {
    system = ctx.namingSystem?.resolveAssigningAuthority(hd);
    if (system === undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED, "CX.4", "Identifier.system"),
      );
    }
  }

  // Identifier element order (FHIR): use, type, system, value, period, assigner.
  const identifier = object([
    ["type", buildType(cx.identifierTypeCode)],
    ["system", text(system)],
    ["value", text(cx.idNumber)],
  ]);

  // CX.7 / CX.8 (effective / expiration date) map to Identifier.period in the IG, but a faithful
  // period needs the dateTime timezone policy: deferred to a later phase and flagged, not silent.
  if (cx.effectiveDate !== undefined && cx.effectiveDate !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.7", "Identifier.period"));
  }
  if (cx.expirationDate !== undefined && cx.expirationDate !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.8", "Identifier.period"));
  }
  // CX.9 / CX.10 (jurisdiction / agency) have no place on Identifier: flag the loss (§2 non-goals).
  if (cx.assigningJurisdiction !== undefined && cx.assigningJurisdiction !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.9"));
  }
  if (cx.assigningAgencyOrDepartment !== undefined && cx.assigningAgencyOrDepartment !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.10"));
  }

  return { value: identifier, issues };
}

/**
 * Public entry point for `@cosyte/transform` — the HL7 v2 → FHIR R4 transformation library.
 *
 * `@cosyte/transform` is **not** a parser; it is a **consumer** one tier above the parser suite. It
 * takes already-parsed `@cosyte/hl7` composites and produces validated `@cosyte/fhir` model nodes,
 * grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`,
 * STU Edition 1). Its whole promise is narrow and honest: **IG-grounded, fail-safe transformation
 * with typed, value-free diagnostics — never a confident wrong FHIR value.**
 *
 * This module ships **Phase 1**: the six safety-critical datatype converters, the immutable
 * `OperationOutcome`-shaped diagnostic channel, and the NamingSystem resolver they consult. Message-
 * level assembly (`toFhir(msg)`), terminology depth, profiles, and the reverse direction land in
 * later phases (see `operations/roadmaps/transform.md` in the umbrella).
 *
 * @packageDocumentation
 */

/** The library version string, synced with `package.json#version` by the release tooling. */
export const VERSION = "0.0.0";

// ── The diagnostic channel (the fail-safe rule, materialized) ──────────────────────────────────
export { ISSUE_CODES, FATAL_CODES } from "./diagnostics/codes.js";
export type { IssueCode, FatalCode } from "./diagnostics/codes.js";
export { issue, fhirIssueTypeFor, ISSUE_REGISTRY } from "./diagnostics/issue.js";
export type { TransformIssue, TransformSeverity } from "./diagnostics/issue.js";
export type { ConvertResult } from "./diagnostics/result.js";
export { toOperationOutcome, TRANSFORM_ISSUE_SYSTEM } from "./diagnostics/operation-outcome.js";

// ── The transform context + the NamingSystem resolver ──────────────────────────────────────────
export type { TransformContext, TransformOptions } from "./terminology/context.js";
export {
  createNamingSystem,
  DEFAULT_V2_CODE_SYSTEMS,
  V2_0203_SYSTEM,
} from "./terminology/naming-system.js";
export type { NamingSystemRegistry, NamingSystemSeed } from "./terminology/naming-system.js";

// ── The six safety-critical datatype converters ────────────────────────────────────────────────
export { toFhirDateTime } from "./datatypes/datetime.js";
export { toFhirIdentifier } from "./datatypes/identifier.js";
export { toFhirCodeableConcept } from "./datatypes/codeable-concept.js";
export type { CodedElement } from "./datatypes/codeable-concept.js";
export { toFhirHumanName, NAME_USE_MAP } from "./datatypes/human-name.js";
export { toFhirAddress, ADDRESS_USE_MAP, ADDRESS_TYPE_MAP } from "./datatypes/address.js";
export { toFhirQuantity } from "./datatypes/quantity.js";

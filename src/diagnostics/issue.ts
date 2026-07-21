/**
 * The value-free {@link TransformIssue} — the single diagnostic shape the whole library emits.
 *
 * Every issue is **`OperationOutcome`-shaped and PHI-safe by construction**: it carries the *v2
 * location* (segment / field / component index — never a value) and the *FHIR path* it concerns,
 * plus a **static, per-code** severity and human-readable message drawn from {@link ISSUE_REGISTRY}.
 * Nothing in an issue is interpolated from patient data — the factory takes only positional metadata,
 * so there is no code path by which a name, DOB, MRN, or result value can reach a log line (the
 * discipline `@cosyte/fhir` already proved with its value-free `OperationOutcome`).
 *
 * @packageDocumentation
 */

import { ISSUE_CODES, type IssueCode } from "./codes.js";

/** The severity a {@link TransformIssue} carries — an `OperationOutcome.issue.severity` value. */
export type TransformSeverity = "error" | "warning" | "information";

/**
 * A single value-free diagnostic.
 *
 * @example
 * ```ts
 * import { ISSUE_CODES } from "@cosyte/transform";
 * // issue.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE
 * // issue.v2Location === "TS.1"; issue.fhirPath === "dateTime"
 * ```
 */
export interface TransformIssue {
  /** The stable code. One of {@link ISSUE_CODES}. */
  readonly code: IssueCode;
  /** The `OperationOutcome`-style severity, fixed per code. */
  readonly severity: TransformSeverity;
  /** The v2 source location — a segment / field / component **index**, never a value. */
  readonly v2Location: string;
  /** The FHIR path this issue concerns (e.g. `Identifier.system`), when applicable. */
  readonly fhirPath?: string;
  /** A static, value-free description drawn from {@link ISSUE_REGISTRY}. */
  readonly message: string;
}

/** The fixed metadata for a code: its severity, its FHIR `issue-type` code, and a static message. */
interface IssueMeta {
  readonly severity: TransformSeverity;
  /** The FHIR `OperationOutcome.issue.code` (R4 `issue-type` value set) this maps to. */
  readonly fhirIssueType: string;
  /** A static, value-free message. Contains no interpolated data — safe to log verbatim. */
  readonly message: string;
}

/**
 * The per-code registry: severity, FHIR `issue-type`, and a static message. Frozen and exhaustive
 * over {@link ISSUE_CODES} (enforced by the `Record<IssueCode, …>` type — a new code will not
 * compile until it has an entry).
 */
export const ISSUE_REGISTRY: Readonly<Record<IssueCode, IssueMeta>> = Object.freeze({
  [ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE]: {
    severity: "warning",
    fhirIssueType: "value",
    message:
      "v2 timestamp carried a time-of-day but no timezone offset; reduced to date precision (FHIR forbids time without a zone).",
  },
  [ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID]: {
    severity: "warning",
    fhirIssueType: "value",
    message: "v2 timestamp could not be parsed into a valid FHIR date/time; no value emitted.",
  },
  [ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED]: {
    severity: "warning",
    fhirIssueType: "not-found",
    message:
      "assigning authority could not be resolved to an Identifier.system; identifier emitted with value and no system (never synthesized from a bare namespace).",
  },
  [ISSUE_CODES.TRANSFORM_CODE_UNMAPPED]: {
    severity: "warning",
    fhirIssueType: "code-invalid",
    message: "coded value carried no coding system; original code preserved, never coerced.",
  },
  [ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED]: {
    severity: "warning",
    fhirIssueType: "code-invalid",
    message: "coding-system mnemonic not recognized; code preserved, no system URI invented.",
  },
  [ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM]: {
    severity: "warning",
    fhirIssueType: "value",
    message:
      "unit is not a valid UCUM code; preserved verbatim in Quantity.unit, code/system absent, magnitude never converted.",
  },
  [ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID]: {
    severity: "warning",
    fhirIssueType: "value",
    message:
      "numeric value is not a valid FHIR decimal literal (e.g. leading sign/zero or trailing dot); no Quantity value emitted rather than altering the magnitude.",
  },
  [ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED]: {
    severity: "information",
    fhirIssueType: "informational",
    message:
      "populated source component has no defined FHIR target in the IG datatype map; dropped.",
  },
  [ISSUE_CODES.TRANSFORM_NAME_USE_UNMAPPED]: {
    severity: "information",
    fhirIssueType: "value",
    message: "name-type code has no equivalent in the HL70200 to name-use map; use left absent.",
  },
  [ISSUE_CODES.TRANSFORM_ADDRESS_USE_UNMAPPED]: {
    severity: "information",
    fhirIssueType: "value",
    message:
      "address-type code has no equivalent in the HL70190 to address-use/type maps; use/type left absent.",
  },
});

/**
 * Construct a value-free {@link TransformIssue}. The severity and message come from
 * {@link ISSUE_REGISTRY}; the caller supplies only positional metadata, so an issue can carry no PHI.
 *
 * @param code - The stable {@link IssueCode}.
 * @param v2Location - The v2 source location (segment / field / component index) — never a value.
 * @param fhirPath - The FHIR path the issue concerns, when applicable.
 * @example
 * ```ts
 * import { issue, ISSUE_CODES } from "@cosyte/transform";
 * const i = issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime");
 * void i.severity; // "warning"
 * ```
 */
export function issue(code: IssueCode, v2Location: string, fhirPath?: string): TransformIssue {
  const meta = ISSUE_REGISTRY[code];
  const base = {
    code,
    severity: meta.severity,
    v2Location,
    message: meta.message,
  };
  return fhirPath === undefined ? base : { ...base, fhirPath };
}

/**
 * The FHIR `issue-type` code for an {@link IssueCode} — used by the `OperationOutcome` renderer.
 *
 * @param code - The stable {@link IssueCode}.
 * @example
 * ```ts
 * import { fhirIssueTypeFor, ISSUE_CODES } from "@cosyte/transform";
 * fhirIssueTypeFor(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED); // "not-found"
 * ```
 */
export function fhirIssueTypeFor(code: IssueCode): string {
  return ISSUE_REGISTRY[code].fhirIssueType;
}

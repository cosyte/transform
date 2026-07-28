/**
 * The stable code registries for the `@cosyte/transform` diagnostic channel.
 *
 * Two registries, both `key === value` so they survive `Object.values(...)` into a snapshot
 * tripwire, and both **part of the public contract**: consumers branch on these codes, so renaming
 * or removing one is a **breaking change** (mirrors the parser archetype's stable-warning-code rule).
 * New codes are **additions only**.
 *
 * - {@link ISSUE_CODES} — non-fatal, typed diagnostics carried on a {@link TransformResult}. Every
 *   fail-safe decision the transform makes (a naked timestamp, an unresolvable assigning authority,
 *   an unmapped code, a non-UCUM unit, a dropped element) surfaces as one of these — **never** a
 *   silently-defaulted or fabricated FHIR value.
 * - {@link FATAL_CODES} — the small set of unrecoverable conditions reserved for message-level
 *   entry points. **Nothing in this library throws one today**: the datatype converters and
 *   `toFhir` alike fail safe to a value-free issue instead.
 *
 * @packageDocumentation
 */

/**
 * Stable **non-fatal issue codes** — the typed diagnostics the fail-safe rule emits.
 *
 * @example
 * ```ts
 * import { ISSUE_CODES } from "@cosyte/transform";
 * if (issue.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE) {
 *   // a v2 timestamp had a time-of-day but no timezone offset — reduced to date precision
 * }
 * ```
 */
export const ISSUE_CODES = {
  /** A v2 DTM/TS carried a time-of-day but no timezone offset. FHIR forbids time-without-zone, so
   * the value was reduced to date precision (or an explicit sender offset applied via options) —
   * **never** a guessed UTC. */
  TRANSFORM_TIMESTAMP_NO_TIMEZONE: "TRANSFORM_TIMESTAMP_NO_TIMEZONE",
  /** A v2 DTM/TS could not be parsed into a valid FHIR date/time; no value was emitted. */
  TRANSFORM_TIMESTAMP_INVALID: "TRANSFORM_TIMESTAMP_INVALID",
  /** The assigning authority (HD) could not be resolved to a FHIR `Identifier.system` URI via the
   * NamingSystem registry. The identifier is emitted with its value and **no** system — a system URI
   * is **never** synthesized from HD.1 alone. */
  TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED: "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED",
  /** A coded value could not be mapped to a FHIR concept — either it carried no coding-system context
   * (CWE.3 absent), or it is a table code the IG ConceptMap has **no target** for (e.g. an OBX-11/
   * OBR-25 result status the HL70085/HL70123 map does not carry, or an OBX-8 abnormal flag absent from
   * HL70078). The original code is preserved / the FHIR value left absent; **never** coerced to a
   * neighbor and **never** guessed to `final`/`normal`. */
  TRANSFORM_CODE_UNMAPPED: "TRANSFORM_CODE_UNMAPPED",
  /** A coding-system mnemonic (CWE.3 / CWE.6) was not recognized, so no canonical system URI could
   * be emitted. The code is preserved; a URI is **never** invented. */
  TRANSFORM_CODE_SYSTEM_UNRESOLVED: "TRANSFORM_CODE_SYSTEM_UNRESOLVED",
  /** A unit was not a valid UCUM code (or was not declared UCUM). It is preserved verbatim in
   * `Quantity.unit`; `Quantity.code`/`.system` are left absent — a UCUM code is **never** fabricated
   * and a magnitude is **never** converted. */
  TRANSFORM_UNIT_NOT_UCUM: "TRANSFORM_UNIT_NOT_UCUM",
  /** A v2 numeric value (NM) could not be represented as a FHIR `decimal` without altering it — e.g.
   * a leading `+`, a leading zero, or a trailing dot, which FHIR's `decimal` lexical form forbids. No
   * `Quantity` value is emitted rather than a canonicalized (and therefore altered) magnitude. */
  TRANSFORM_QUANTITY_VALUE_INVALID: "TRANSFORM_QUANTITY_VALUE_INVALID",
  /** A populated source element was not carried to its FHIR target and was dropped — either because
   * the IG map defines no target, or because that target's conversion is **not implemented**
   * (e.g. XTN→ContactPoint telecom, PV1 participants). Surfaced here rather than silently discarded,
   * never a fabricated value. */
  TRANSFORM_ELEMENT_DROPPED: "TRANSFORM_ELEMENT_DROPPED",
  /** An XPN.7 name-type code has no equivalent in the IG's HL70200 → name-use ConceptMap;
   * `HumanName.use` is left absent rather than guessed. */
  TRANSFORM_NAME_USE_UNMAPPED: "TRANSFORM_NAME_USE_UNMAPPED",
  /** An XAD.7 address-type code has no equivalent in the IG's HL70190 → address-use/type
   * ConceptMaps; `Address.use`/`.type` are left absent rather than guessed. */
  TRANSFORM_ADDRESS_USE_UNMAPPED: "TRANSFORM_ADDRESS_USE_UNMAPPED",
  /** The message's trigger event has no IG *message* map, so its resource graph was assembled from
   * the reusable IG *segment* maps rather than a message map. The graph is best-effort and flagged
   * as such — never a fabricated message map. */
  TRANSFORM_SEGMENT_ASSEMBLED: "TRANSFORM_SEGMENT_ASSEMBLED",
  /** A produced FHIR resource failed `@cosyte/fhir` R4 structural validation and was **withheld**
   * from the bundle rather than emitted as a silently-invalid resource — the conservative-emit gate. */
  TRANSFORM_RESOURCE_INVALID: "TRANSFORM_RESOURCE_INVALID",
  /** A FHIR-required element's value could not be faithfully derived from the source, so it was
   * emitted with a `data-absent-reason` extension (value `unknown`) rather than fabricated — e.g.
   * `MessageHeader.source.endpoint` from an MSH-3 application namespace that is not a URL. */
  TRANSFORM_REQUIRED_ELEMENT_UNKNOWN: "TRANSFORM_REQUIRED_ELEMENT_UNKNOWN",
} as const;

/** A value from {@link ISSUE_CODES} — the type consumers narrow `issue.code` against. */
export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];

/**
 * Stable **fatal codes** — the reserved names for unrecoverable input conditions. **Nothing in this
 * library throws one today**; every path, datatype and message level alike, fails safe to a
 * value-free issue instead. They are declared so that a future one is an addition rather than a
 * rename.
 *
 * @example
 * ```ts
 * import { FATAL_CODES } from "@cosyte/transform";
 * void FATAL_CODES.EMPTY_INPUT;
 * ```
 */
export const FATAL_CODES = {
  /** The input carried nothing to transform. */
  EMPTY_INPUT: "EMPTY_INPUT",
  /** The input was not a shape this transform accepts. */
  TRANSFORM_UNSUPPORTED_INPUT: "TRANSFORM_UNSUPPORTED_INPUT",
} as const;

/** A value from {@link FATAL_CODES} — the type carried by a thrown fatal error. */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];

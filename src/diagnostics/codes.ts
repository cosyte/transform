/**
 * The stable code registries for the `@cosyte/transform` diagnostic channel.
 *
 * Two registries, both `key === value` so they survive `Object.values(...)` into a snapshot
 * tripwire, and both **part of the public contract**: consumers branch on these codes, so renaming
 * or removing one is a **breaking change** (mirrors the parser archetype's stable-warning-code rule).
 * New codes are **additions only**.
 *
 * - {@link ISSUE_CODES}: non-fatal, typed diagnostics carried on a {@link TransformResult}. Every
 *   fail-safe decision the transform makes (a naked timestamp, an unresolvable assigning authority,
 *   an unmapped code, a non-UCUM unit, a dropped element) surfaces as one of these, **never** a
 *   silently-defaulted or fabricated FHIR value.
 * - {@link FATAL_CODES}: the small set of unrecoverable conditions reserved for message-level
 *   entry points. **Nothing in this library throws one today**: the datatype converters and
 *   `toFhir` alike fail safe to a value-free issue instead.
 *
 * **The line between the two registries is structural, and it decides where a new code goes.** A
 * `FatalCode` is the type carried by a *thrown* error; a `TransformIssue.code` is typed `IssueCode`
 * and {@link ISSUE_REGISTRY} is exhaustive over {@link ISSUE_CODES} alone. So a condition that is
 * *returned* on the non-throwing `{ value, issues }` channel is an {@link ISSUE_CODES} entry by
 * construction, however severe it is: the missing-trigger refusal on the reverse
 * (FHIR to v2) entry points is returned, never thrown, so it is
 * {@link ISSUE_CODES.TRANSFORM_MISSING_TRIGGER} rather than a fatal code. Adding it to
 * {@link FATAL_CODES} instead would have required widening `TransformIssue.code` to
 * `IssueCode | FatalCode` and blurring exactly that split.
 *
 * @packageDocumentation
 */

/**
 * Stable **non-fatal issue codes**: the typed diagnostics the fail-safe rule emits.
 *
 * @example
 * ```ts
 * import { ISSUE_CODES } from "@cosyte/transform";
 * if (issue.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE) {
 *   // a v2 timestamp had a time-of-day but no timezone offset: reduced to date precision
 * }
 * ```
 */
export const ISSUE_CODES = {
  /** A v2 DTM/TS carried a time-of-day but no timezone offset. FHIR forbids time-without-zone, so
   * the value was reduced to date precision (or an explicit sender offset applied via options),
   * **never** a guessed UTC. */
  TRANSFORM_TIMESTAMP_NO_TIMEZONE: "TRANSFORM_TIMESTAMP_NO_TIMEZONE",
  /** A v2 DTM/TS could not be parsed into a valid FHIR date/time; no value was emitted. */
  TRANSFORM_TIMESTAMP_INVALID: "TRANSFORM_TIMESTAMP_INVALID",
  /** The assigning authority (HD) could not be resolved to a FHIR `Identifier.system` URI via the
   * NamingSystem registry. The identifier is emitted with its value and **no** system: a system URI
   * is **never** synthesized from HD.1 alone. */
  TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED: "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED",
  /** A coded value could not be mapped to a FHIR concept: either it carried no coding-system context
   * (CWE.3 absent), or it is a table code the IG ConceptMap has **no target** for (e.g. an OBX-11/
   * OBR-25 result status the HL70085/HL70123 map does not carry, or an OBX-8 abnormal flag absent from
   * HL70078). The original code is preserved / the FHIR value left absent; **never** coerced to a
   * neighbor and **never** guessed to `final`/`normal`. */
  TRANSFORM_CODE_UNMAPPED: "TRANSFORM_CODE_UNMAPPED",
  /** A coding-system mnemonic (CWE.3 / CWE.6) was not recognized, so no canonical system URI could
   * be emitted. The code is preserved; a URI is **never** invented. */
  TRANSFORM_CODE_SYSTEM_UNRESOLVED: "TRANSFORM_CODE_SYSTEM_UNRESOLVED",
  /** A unit was not a valid UCUM code (or was not declared UCUM). It is preserved verbatim in
   * `Quantity.unit`; `Quantity.code`/`.system` are left absent: a UCUM code is **never** fabricated
   * and a magnitude is **never** converted. */
  TRANSFORM_UNIT_NOT_UCUM: "TRANSFORM_UNIT_NOT_UCUM",
  /** A v2 numeric value (NM) could not be represented as a FHIR `decimal` without altering it, e.g.
   * a leading `+`, a leading zero, or a trailing dot, which FHIR's `decimal` lexical form forbids. No
   * `Quantity` value is emitted rather than a canonicalized (and therefore altered) magnitude. */
  TRANSFORM_QUANTITY_VALUE_INVALID: "TRANSFORM_QUANTITY_VALUE_INVALID",
  /** A populated source element was not carried to its FHIR target and was dropped, either because
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
   * as such, never a fabricated message map. */
  TRANSFORM_SEGMENT_ASSEMBLED: "TRANSFORM_SEGMENT_ASSEMBLED",
  /** A produced FHIR resource failed `@cosyte/fhir` R4 structural validation and was **withheld**
   * from the bundle rather than emitted as a silently-invalid resource: the conservative-emit gate. */
  TRANSFORM_RESOURCE_INVALID: "TRANSFORM_RESOURCE_INVALID",
  /** A FHIR-required element's value could not be faithfully derived from the source, so it was
   * emitted with a `data-absent-reason` extension (value `unknown`) rather than fabricated, e.g.
   * `MessageHeader.source.endpoint` from an MSH-3 application namespace that is not a URL. */
  TRANSFORM_REQUIRED_ELEMENT_UNKNOWN: "TRANSFORM_REQUIRED_ELEMENT_UNKNOWN",
  /** A reverse (FHIR to v2) conversion was called without the explicit message trigger it requires.
   * No FHIR resource carries a v2 trigger, so it is never inferred from resource content and never
   * defaulted: no message is built and no builder is called. */
  TRANSFORM_MISSING_TRIGGER: "TRANSFORM_MISSING_TRIGGER",
  /** A reverse (FHIR to v2) conversion was handed a resource outside the narrow set of shapes it
   * supports. No v2 message is emitted and no segment layout is guessed. */
  TRANSFORM_UNSUPPORTED_RESOURCE: "TRANSFORM_UNSUPPORTED_RESOURCE",
  /** A resource handed to a reverse (FHIR to v2) conversion is not structurally a FHIR resource of
   * its expected type (not an object, no `resourceType`, or an element carrying the wrong node
   * kind). Nothing is emitted and nothing is thrown. */
  TRANSFORM_RESOURCE_MALFORMED: "TRANSFORM_RESOURCE_MALFORMED",
  /** A populated FHIR element has no v2 field in the narrow reverse map that covers this shape
   * (the IG map defines no source for it, or its inverse is not implemented here). The element is
   * surfaced and left out, never approximated into a neighbouring v2 field. */
  TRANSFORM_NO_V2_TARGET: "TRANSFORM_NO_V2_TARGET",
  /** A FHIR value cannot be carried into its v2 target without altering it (a lexical form v2 has
   * no representation for, or content that exceeds the target's component structure). The v2 field
   * is left absent rather than truncated, rounded, or coerced. */
  TRANSFORM_VALUE_NOT_REPRESENTABLE: "TRANSFORM_VALUE_NOT_REPRESENTABLE",
  /** A FHIR code has no usable inverse in the IG ConceptMap that governs its field: either several
   * v2 source codes map onto it (so the inverse is ambiguous) or the map has no row for it at all.
   * The v2 field is left absent, never resolved to one arbitrary member of the ambiguous set. */
  TRANSFORM_CODE_NOT_INVERTIBLE: "TRANSFORM_CODE_NOT_INVERTIBLE",
  /** A `Coding.system` is not a system this library can name with a v2 coding-system mnemonic, so
   * the coding cannot be written into a v2 coded field. It is flagged rather than emitted with no
   * table context or with a code from an unrelated table. */
  TRANSFORM_CODE_SYSTEM_NOT_V2: "TRANSFORM_CODE_SYSTEM_NOT_V2",
  /** A v2 field the segment's own attribute table marks **required** (usage `R`) is absent from an
   * emitted segment, because the FHIR resource carried no source this reverse map could ground it
   * from, or the source it carried had no faithful v2 form. The field is left absent per v2
   * optionality rules and **declared here**: a placeholder is never written to satisfy v2 structure,
   * and the receiver is never left to discover the gap. Distinct from
   * {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}, which is the forward direction's
   * FHIR-required element. */
  TRANSFORM_V2_REQUIRED_FIELD_ABSENT: "TRANSFORM_V2_REQUIRED_FIELD_ABSENT",
  /** A reverse (FHIR to v2) conversion produced **no message at all**: nothing in the resource
   * grounded a single field of the target segment, and an empty segment is never emitted. Raised so
   * that an empty-handed conversion is never indistinguishable from a successful one, and separate
   * from the refusals that name their own cause (an absent trigger, an unsupported resource type, a
   * structurally malformed resource). */
  TRANSFORM_NO_V2_MESSAGE_EMITTED: "TRANSFORM_NO_V2_MESSAGE_EMITTED",
  /** A segment the message carried did **not** reach any resource in the returned bundle, and the IG
   * *does* publish a segment map for its name: a **library gap**, fixable here. Raised once per
   * occurrence, located `NAME[k]` with `k` counted 1-based among the occurrences of that name
   * (`DG1[1]`, `DG1[2]`), so a consumer can tell how much of the message the bundle represents
   * without diffing the two by hand. The occurrence may have been read and refused rather than never
   * read: being counted, or already named by another issue, is not the same as reaching a resource. */
  TRANSFORM_SEGMENT_NOT_EMITTED: "TRANSFORM_SEGMENT_NOT_EMITTED",
  /** A segment the message carried did **not** reach any resource in the returned bundle, and its
   * name is **not** one the IG publishes a segment map for: a **standard gap**, not fixable here.
   * Custom Z-segments and `RXE` land on this code, and so does a name this library could not
   * classify at all, because a damaged segment identifier is never re-derived from the line: an
   * `AL1` whose identifier arrived as `AL11` reads as unclassifiable, not as an IG omission. Such an
   * occurrence is located `[#n]` by its 1-based position among the segments of the message, with no
   * name part at all. */
  TRANSFORM_SEGMENT_NO_IG_MAP: "TRANSFORM_SEGMENT_NO_IG_MAP",
} as const;

/** A value from {@link ISSUE_CODES}: the type consumers narrow `issue.code` against. */
export type IssueCode = (typeof ISSUE_CODES)[keyof typeof ISSUE_CODES];

/**
 * Stable **fatal codes**: the reserved names for unrecoverable input conditions. **Nothing in this
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

/** A value from {@link FATAL_CODES}: the type carried by a thrown fatal error. */
export type FatalCode = (typeof FATAL_CODES)[keyof typeof FATAL_CODES];

/**
 * Public entry point for `@cosyte/transform`: the HL7 v2 → FHIR R4 transformation library.
 *
 * `@cosyte/transform` is **not** a parser; it is a **consumer** one tier above the parser suite. It
 * takes already-parsed `@cosyte/hl7` composites and produces validated `@cosyte/fhir` model nodes,
 * grounded on the official **HL7 Version 2 to FHIR** Implementation Guide (`hl7.fhir.uv.v2mappings`,
 * STU Edition 1). Its whole promise is narrow and honest: **IG-grounded, fail-safe transformation
 * with typed, value-free diagnostics, never a confident wrong FHIR value.**
 *
 * This module ships the six safety-critical datatype converters, the immutable
 * `OperationOutcome`-shaped diagnostic channel and the NamingSystem resolver they consult,
 * the message-level assembly (HL7 v2 **ADT → FHIR Patient + Encounter**, the
 * **ORU^R01 → DiagnosticReport + Observation** results graph, the order-entry graph
 * (**ORM_O01 / OML_O21 → ServiceRequest** and **RXO → MedicationRequest**), and the thin IG
 * singles (**VXU_V04 → Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference**),
 * all through `toFhir(msg)`), and the **terminology value-translation** layer: a
 * `$translate`-shaped {@link toFhirCodeableConceptVia} engine applying the license-clean IG value
 * ConceptMaps to the previously structural-only coded fields (route/site, appointment type, order
 * priority, substitution).
 *
 * It also ships a **narrow reverse path**, FHIR → v2: {@link toV2Patient} and
 * {@link toV2Observation} emit a complete v2 message carrying a `PID` or an `OBX` built from the
 * subset of the IG segment maps whose inverse is defensible. Each requires the caller to supply the
 * v2 trigger, because no FHIR resource carries one. It is **lossy by design and not a round-trip**:
 * a value the inverse of the IG map cannot ground is flagged and left absent, never guessed.
 * Terminology **depth beyond these maps**, profiles, and any wider FHIR → v2 conversion are not
 * implemented.
 *
 * @packageDocumentation
 */

/**
 * Package version marker exported from the `@cosyte/transform` root.
 *
 * Kept in lockstep with `package.json` by `scripts/sync-version.mjs`, which the `version` script
 * runs immediately after `changeset version`. The `: string` annotation is deliberate: without it
 * TypeScript infers the *literal* type (`declare const VERSION = "0.0.0"`), which leaks the current
 * release into consumers' types and makes an equality check against any other version a compile
 * error.
 *
 * @example
 * ```typescript
 * import { VERSION } from "@cosyte/transform";
 * console.log(VERSION);
 * ```
 */
export const VERSION: string = "0.0.9";

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

// ── Message-level assembly: HL7 v2 ADT → FHIR Patient + Encounter graph (Phase 2) ────────────────
export {
  toFhir,
  IG_MAPPED_ADT_TRIGGERS,
  IG_MAPPED_ORU_TRIGGERS,
  IG_MAPPED_ORDER_TRIGGERS,
} from "./messages/to-fhir.js";
export type { TransformResult } from "./messages/to-fhir.js";
export { ADMINISTRATIVE_GENDER_MAP } from "./messages/patient.js";
export { ENCOUNTER_CLASS_V3_MAP, ENCOUNTER_STATUS_MAP } from "./messages/encounter.js";

// ── Message-level assembly: HL7 v2 ORU^R01 → FHIR DiagnosticReport + Observation graph (Phase 3) ──
export {
  OBSERVATION_STATUS_MAP,
  HL70078_INTERPRETATION_CODES,
  V3_OBSERVATION_INTERPRETATION_SYSTEM,
} from "./messages/observation.js";
export { DIAGNOSTIC_REPORT_STATUS_MAP } from "./messages/diagnostic-report.js";

// ── Message-level assembly: HL7 v2 ORM/OML → ServiceRequest, RXO → MedicationRequest (Phase 4) ────
export { REQUEST_STATUS_MAP } from "./messages/service-request.js";

// ── Message-level completeness: which segments did not reach the returned bundle ─────────────────
export {
  SEGMENT_IDENTIFIER_SHAPE,
  SegmentReachLedger,
  enumerateSegmentOccurrences,
  isWellFormedSegmentName,
  segmentOccurrenceLocation,
} from "./messages/segment-completeness.js";
export type { SegmentOccurrence } from "./messages/segment-completeness.js";
export {
  IG_MAPPED_SEGMENT_NAMES,
  IG_SEGMENT_MAPS_PUBLISHED,
  IG_SEGMENT_MAPS_RETRIEVED,
  IG_SEGMENT_MAPS_SOURCE,
  IG_SEGMENT_MAPS_VERSION,
  isIgMappedSegmentName,
} from "./messages/ig-segment-maps.js";

// ── Message-level assembly: the thin IG singles, VXU/SIU/MDM (Phase 5) ──────────────────────────
export {
  IG_MAPPED_IMMUNIZATION_TRIGGERS,
  IG_MAPPED_APPOINTMENT_TRIGGERS,
  IG_MAPPED_DOCUMENT_TRIGGERS,
} from "./messages/to-fhir.js";
export { IMMUNIZATION_STATUS_MAP } from "./messages/immunization.js";
export { APPOINTMENT_STATUS_MAP } from "./messages/appointment.js";

// ── Terminology value translation: the $translate-shaped ConceptMap engine + maps (Phase 6) ──────
export {
  toFhirCodeableConceptVia,
  translateBound,
  codeableConceptFromTarget,
  ROUTE_VALUE_MAP,
  SITE_VALUE_MAP,
  APPOINTMENT_TYPE_VALUE_MAP,
  SUBSTITUTION_VALUE_MAP,
  V2_0162_SYSTEM,
  V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
  V2_0550_SYSTEM,
  V2_0277_SYSTEM,
  V2_0161_SYSTEM,
} from "./terminology/concept-map.js";
export type { CodedTarget, CodedValueMap } from "./terminology/concept-map.js";
export { SERVICE_REQUEST_PRIORITY_MAP } from "./messages/service-request.js";

// ── The reverse direction: FHIR → a narrow, explicitly-scoped v2 message subset (Phase 7) ────────
export { toV2Patient, GENDER_TO_V2, NAME_USE_TO_V2, ADDRESS_USE_TO_V2 } from "./reverse/patient.js";
export { toV2Observation, OBSERVATION_STATUS_TO_V2 } from "./reverse/observation.js";
export { invertCodeMap } from "./reverse/v2.js";
export type { ReverseOptions } from "./reverse/coding.js";
export type { ReverseResult } from "./reverse/message.js";

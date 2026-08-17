/**
 * The scaffolding every reverse (FHIR to v2) entry point shares: the required trigger, the resource
 * gate, and the message the mapped segment is carried in.
 *
 * **The trigger is always the caller's.** No FHIR resource carries an HL7 v2 message trigger: not
 * `Patient`, not `Observation`, not `Encounter`. So it is a required argument, and a missing, empty
 * or non-string one stops the conversion **before** any builder call, with
 * {@link ISSUE_CODES.TRANSFORM_MISSING_TRIGGER} on the ordinary `{ value, issues }` channel. It is
 * never defaulted, never derived from resource content, and never substituted with a placeholder.
 *
 * **What is emitted is a message, never a bare segment.** A segment on its own is not parseable HL7
 * (a v2 parser fatally rejects any input whose first segment is not `MSH`), so each shape builds a
 * complete message through `buildMessage` and appends its mapped segment to it. The trigger is used
 * verbatim as the trailing component of the fixed message code the shape itself owns.
 *
 * **What is missing is declared, not merely missing.** A FHIR resource carrying no source for a v2
 * field the segment's own attribute table marks *required* leaves that field absent, because the
 * alternative is inventing content for a clinical reader. Absent is the right wire; **silent** is
 * not, so each shape names its required fields ({@link ReverseShape.required}) and every one of them
 * that ends up unsourced raises {@link ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT}. When nothing
 * at all grounded a field, there is no segment to be missing from and no message is built:
 * {@link ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED} declares that outcome on its own, so an
 * empty-handed conversion never looks like a successful one.
 *
 * @packageDocumentation
 */

import { buildMessage, type Hl7Message, type RawField } from "@cosyte/hl7";
import { isComplex, resourceType, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { ReverseContext } from "./coding.js";
import { segmentFields } from "./v2.js";

/**
 * What a reverse conversion returns: the complete `@cosyte/hl7` message it could faithfully build
 * (or `undefined` when it could not), plus the value-free diagnostics it raised. The same fail-safe
 * envelope the forward converters return, in the other direction.
 *
 * @example
 * ```ts
 * import { toV2Patient } from "@cosyte/transform";
 * // const { value, issues } = toV2Patient(patientNode, "A28");
 * // value?.toString() -> "MSH|^~\\&|...|ADT^A28|...\rPID|||MRN1\r"
 * void toV2Patient;
 * ```
 */
export type ReverseResult = ConvertResult<Hl7Message>;

/**
 * The resource types this library names in a diagnostic. It is **library-owned vocabulary**: the
 * resource types the forward direction produces, plus the reverse shapes' own inputs. An observed
 * `resourceType` outside it is reported as the generic `Resource`, so no string taken from input
 * content can reach a diagnostic through the unsupported-resource path.
 */
const NAMED_RESOURCES: ReadonlySet<string> = new Set([
  "Appointment",
  "Bundle",
  "DiagnosticReport",
  "DocumentReference",
  "Encounter",
  "Immunization",
  "MedicationRequest",
  "MessageHeader",
  "Observation",
  "OperationOutcome",
  "Patient",
  "RelatedPerson",
  "ServiceRequest",
]);

/** Whether a caller actually supplied a trigger at all (the parameter is typed, callers may not be). */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** A bare MSH-9.2 trigger: one token, no whitespace and none of the HL7 delimiter characters. */
const BARE_TRIGGER = /^[^\s|^~\\&\r\n]+$/;

/**
 * Check the caller-supplied trigger. A `false` return means **no builder call may be made**, and one
 * of two value-free issues has been raised:
 *
 * - {@link ISSUE_CODES.TRANSFORM_MISSING_TRIGGER} when it is missing, empty, or not a string. There
 *   is nothing to fall back to: no resource carries a trigger, so none is inferred or defaulted.
 * - {@link ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE} when it is a string but not a *bare*
 *   trigger. A value carrying a component separator or whitespace cannot be written into MSH-9.2
 *   verbatim (`^` would split it into further MSH-9 components, and padding does not survive a
 *   parse), so it is refused rather than trimmed or escaped into something the caller did not ask
 *   for.
 *
 * @param trigger - The caller's bare v2 trigger (e.g. `"A28"`).
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // hasTrigger("A28", issues) -> true;  hasTrigger("", issues) -> false + one issue
 * ```
 */
export function hasTrigger(trigger: string, issues: TransformIssue[]): boolean {
  if (!isNonEmptyString(trigger)) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_MISSING_TRIGGER, "MSH.9.2", "trigger"));
    return false;
  }
  if (!BARE_TRIGGER.test(trigger)) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "MSH.9.2", "trigger"));
    return false;
  }
  return true;
}

/**
 * Gate an input node into the resource a shape accepts: a complex node carrying the expected
 * `resourceType`. Anything else raises {@link ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED} (not a
 * resource) or {@link ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE} (a resource this converter does
 * not map), and reads as nothing to convert.
 *
 * @param input - The FHIR node handed to the converter.
 * @param expected - The `resourceType` this shape converts.
 * @param location - The v2 target segment, for value-free issues.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // readResource(node, "Patient", "PID", issues) -> the Patient node, or undefined + one issue
 * ```
 */
export function readResource(
  input: FhirNode,
  expected: string,
  location: string,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (!isComplex(input)) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, location, "Resource"));
    return undefined;
  }
  const type = resourceType(input);
  if (type === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, location, "Resource.resourceType"));
    return undefined;
  }
  if (type !== expected) {
    const named = NAMED_RESOURCES.has(type) ? type : "Resource";
    issues.push(issue(ISSUE_CODES.TRANSFORM_UNSUPPORTED_RESOURCE, location, named));
    return undefined;
  }
  return input;
}

/**
 * Flag every populated element of a resource that this reverse map does not carry into v2, one
 * value-free issue each. Element **names** are reported only from the supplied table, which is
 * library-owned vocabulary; an element outside it is reported against the resource itself, so no
 * name taken from input content reaches a diagnostic.
 *
 * @param resource - The gated resource node.
 * @param mapped - The element names this shape does convert.
 * @param targets - The known-but-unconverted element names, each with the v2 location it would take.
 * @param resourceName - The resource type, for the FHIR path.
 * @param segment - The v2 segment, used when an element has no location of its own.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // flagUnmapped(patient, PATIENT_MAPPED, PATIENT_UNMAPPED, "Patient", "PID", issues)
 * // -> one TRANSFORM_NO_V2_TARGET per populated element outside PATIENT_MAPPED
 * ```
 */
export function flagUnmapped(
  resource: FhirComplex,
  mapped: ReadonlySet<string>,
  targets: Readonly<Record<string, string>>,
  resourceName: string,
  segment: string,
  issues: TransformIssue[],
): void {
  for (const property of resource.properties) {
    if (mapped.has(property.name)) continue;
    const known = Object.hasOwn(targets, property.name);
    issues.push(
      issue(
        ISSUE_CODES.TRANSFORM_NO_V2_TARGET,
        known ? (targets[property.name] ?? segment) : segment,
        known ? `${resourceName}.${property.name}` : resourceName,
      ),
    );
  }
}

// ▶ EVERY `RequiredV2Field` ROW A SHAPE DECLARES CLAIMS ONE CELL OF A PUBLISHED HL7
// v2.5.1 SEGMENT ATTRIBUTE TABLE: the OPT (usage) column reading `R`. The tables
// are Chapter 3 §3.4.2 (PID) and Chapter 7 §7.4.2 (OBX), the same standard text
// and the same second, version-pinned publication that `scripts/phi-scan.ts` cites
// for its field numbers, and the VERSION IS LOAD-BEARING here for the same reason
// it is there: a later v2 reads some of these cells differently, so grounding
// against the wrong version's table yields a confident wrong answer, not an error.
//
// ▶ AND THE USAGE CELL WAS NOT EXTRACTED BY THE PASS THAT WROTE THESE ROWS, WHICH
// IS SAID HERE RATHER THAN LEFT TO BE DISCOVERED. That pass ran with no network
// egress and could not open either publication, so the four rows below are
// ASSERTED from the attribute tables rather than read out of them. This repository
// has already measured what that costs once: a `PV1-7` item number written from
// recall, right by luck, and invisible either way. So the rule that work left
// behind is kept literally here too: AN ITEM NUMBER IS WRITTEN ONLY WHERE THIS
// REPOSITORY HAS ALREADY EXTRACTED ONE. `PID-3` (`00106`) and `PID-5` (`00108`)
// carry theirs, from the Chapter 3 extraction dated 2026-08-08 in
// `test/scripts/phi-scan.test.ts`; the OBX rows carry NONE, because nothing here
// has ever extracted one.
//
// ▶ RE-EXTRACT BEFORE ADDING A ROW, AND RE-EXTRACT THESE FOUR THE NEXT TIME A
// READER HAS THE TABLES OPEN. A wrong usage cell is a FALSE DIAGNOSTIC ON A
// CLINICAL FIELD, the same harm class the field-number corroboration exists for,
// and unlike a wrong field number it fires on every conversion rather than once.

/**
 * One v2 field the segment's own attribute table marks **required**, paired with the FHIR element
 * this reverse map would have sourced it from. A required field with no source is left absent (v2
 * optionality is a receiver-side contract, and a placeholder would be a fabricated clinical value),
 * and declared: absence is the right wire, silence is not.
 *
 * @example
 * ```ts
 * // { position: 3, location: "PID.3", fhirPath: "Patient.identifier" }
 * ```
 */
export interface RequiredV2Field {
  /** The 1-based HL7 field position within the segment (`3` is the third field). */
  readonly position: number;
  /** The v2 location the issue reports (`"PID.3"`), never a value. */
  readonly location: string;
  /** The FHIR path this map sources the field from (`"Patient.identifier"`). */
  readonly fhirPath: string;
}

/**
 * A reverse shape's fixed identity: the message code it emits under, the segment it carries, the
 * resource it converts, and that segment's required fields. All four are library-owned constants;
 * none is derived from input content, so none can carry a value into a diagnostic.
 *
 * @example
 * ```ts
 * // { messageCode: "ADT", segment: "PID", resourceName: "Patient", required: PID_REQUIRED }
 * ```
 */
export interface ReverseShape {
  /** The fixed MSH-9.1 message code (`"ADT"`, `"ORU"`). */
  readonly messageCode: string;
  /** The segment this shape appends (`"PID"`, `"OBX"`). */
  readonly segment: string;
  /** The resource type this shape converts, for the FHIR path of a whole-message diagnostic. */
  readonly resourceName: string;
  /** The segment's v2-required fields, in field order. */
  readonly required: readonly RequiredV2Field[];
}

/**
 * Build the complete message for a shape: `buildMessage` with the shape's fixed message code and the
 * caller's trigger, then the mapped segment appended to it, and finally the honest account of what
 * the resource could not supply.
 *
 * Two outcomes, and each is declared:
 *
 * - **Nothing grounded a field.** No message is built (an empty segment is never emitted) and
 *   {@link ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED} is raised, so `{ value: undefined }` can
 *   never be read as a successful empty conversion. The required-field rows are *not* also raised
 *   here: there is no emitted segment for a field to be absent from, and restating it per field
 *   would add noise, not information.
 * - **A message is built.** Every one of the shape's required fields that no mapped content reached
 *   raises {@link ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT}. The wire is untouched by this:
 *   the issue reports the field's absence, it never fills it.
 *
 * @param shape - The shape's fixed identity and its segment's required fields.
 * @param trigger - The caller's bare trigger, used verbatim as MSH-9.2.
 * @param byPosition - The mapped fields, keyed by 1-based HL7 field position.
 * @param ctx - The resolved reverse context (its `envelope` supplies the MSH fields).
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // emitMessage(PATIENT_SHAPE, "A28", fields, ctx, issues)?.toString()
 * // -> "MSH|^~\\&|...|ADT^A28|...\rPID|||MRN1||Public^Jane\r"
 * ```
 */
export function emitMessage(
  shape: ReverseShape,
  trigger: string,
  byPosition: ReadonlyMap<number, RawField>,
  ctx: ReverseContext,
  issues: TransformIssue[],
): Hl7Message | undefined {
  if (byPosition.size === 0) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED, shape.segment, shape.resourceName),
    );
    return undefined;
  }
  for (const field of shape.required) {
    if (byPosition.has(field.position)) continue;
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT, field.location, field.fhirPath),
    );
  }
  return buildMessage({ ...ctx.envelope, type: `${shape.messageCode}^${trigger}` }).addSegment(
    shape.segment,
    segmentFields(byPosition),
  );
}

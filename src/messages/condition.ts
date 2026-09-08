/**
 * DG1 to FHIR `Condition`: the diagnoses an admit states, carried into the bundle instead of lost
 * between the v2 feed and the FHIR record. Grounded firsthand on the IG **DG1 to Condition** segment
 * map and the **ADT_A01 to Bundle** message map (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-dg1-to-condition.html`, `ConceptMap-message-adt-a01-to-bundle.html`), which
 * wires `Condition[1].subject.reference` to the bundle's Patient, creates one Condition per DG1, and
 * references it back from `Encounter[1].diagnosis`.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | DG1-3 Diagnosis Code (CWE) | `code` | {@link toFhirCodeableConcept} (structural, no IG value map) |
 * | DG1-4 Diagnosis Description (ST) | `code.text` | verbatim, overriding the coded field's own text |
 * | DG1-5 Diagnosis Date/Time (DTM) | `onsetDateTime` | {@link toFhirDateTime} |
 * | DG1-19 Attestation Date/Time (DTM) | `recordedDate` | {@link toFhirDateTime} |
 * | DG1-20 Diagnosis Identifier (EI) | `identifier` | {@link toFhirEntityIdentifier} |
 * | DG1-21 Diagnosis Action Code (ID) | `verificationStatus` | the map's fixed assignment for `D` |
 * | (message-map wiring) | `subject` (required 1..1) | the bundle's Patient |
 *
 * **Fail-safes (never a confident wrong diagnosis).**
 * - **One action code is mapped, and only one.** The DG1-21 row assigns the fixed value
 *   `entered-in-error` and names no source code; its own comment reads "Other values (A and U) don't
 *   map to anything", and Table 0206 publishes `A`, `D`, `S`, `U` and `X`. `D` (Delete) is therefore
 *   the code the assignment covers: every other published action code leaves `verificationStatus`
 *   absent and raises {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}, never a neighbouring status.
 * - **A diagnosis with no code and no text is visible, not silent.** Such a DG1 still becomes a
 *   Condition (the message stated a diagnosis), and the empty `code` is declared
 *   {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} rather than read as an intentionally empty one.
 * - **`clinicalStatus` is absent because no row grounds it.** The map has no `Condition.clinicalStatus`
 *   row and no DG1 component states one, so it is never filled. R4's `con-3` invariant expects it
 *   wherever `verificationStatus` is not `entered-in-error`, so a Condition built here can fail that
 *   invariant under a full profile validator: that is a declared gap, and filling the element from
 *   nothing is the fabrication this library refuses.
 *
 * Deferred and flagged, never silently mapped: `DG1-16` (`asserter`, a Practitioner resource this
 * library does not build), `DG1-22` (the `condition-dueTo` extension, whose reference resolves by
 * identifier rather than by bundle position) and the map's `EpisodeOfCare` target, so a diagnosis
 * ties to an Encounter or to nothing.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference, toFhirEntityIdentifier, withCodeableText } from "./reference.js";

/**
 * The code system of the `verificationStatus` the DG1-21 row assigns, transcribed from the segment
 * map's own `Condition.verificationStatus.coding.system` assignment.
 *
 * @example
 * ```ts
 * import { CONDITION_VERIFICATION_STATUS_SYSTEM } from "@cosyte/transform";
 * CONDITION_VERIFICATION_STATUS_SYSTEM.endsWith("condition-ver-status"); // true
 * ```
 */
export const CONDITION_VERIFICATION_STATUS_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/**
 * The `verificationStatus` code the DG1-21 row assigns, transcribed from the segment map's own
 * `Condition.verificationStatus.coding.code` assignment.
 *
 * @example
 * ```ts
 * import { CONDITION_ENTERED_IN_ERROR } from "@cosyte/transform";
 * CONDITION_ENTERED_IN_ERROR; // "entered-in-error"
 * ```
 */
export const CONDITION_ENTERED_IN_ERROR = "entered-in-error";

/**
 * The Table 0206 (Segment Action Code) code the DG1-21 assignment covers. The row assigns a
 * retraction and names no source code; `D` is Delete, and the row's own comment excludes the rest.
 *
 * @example
 * ```ts
 * import { DG1_RETRACTION_ACTION_CODE } from "@cosyte/transform";
 * DG1_RETRACTION_ACTION_CODE; // "D"
 * ```
 */
export const DG1_RETRACTION_ACTION_CODE = "D";

/**
 * Every `DG1` occurrence a message carries, in message order. One Condition is created per
 * occurrence, per the IG message map's `0..-1` cardinality on the DG1 row.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // collectDiagnoses(parseHL7(raw)).length; // one entry per DG1 in the message
 * ```
 */
export function collectDiagnoses(msg: Hl7Message): readonly Segment[] {
  return msg.allSegments().filter((seg) => seg.type === "DG1");
}

/**
 * The value-free diagnostics for the DG1 rows this library reads and deliberately does not build:
 * the diagnosing clinician (a Practitioner resource), and the parent diagnosis (a reference resolved
 * by identifier rather than by bundle position).
 *
 * Raised for the occurrence whether or not the Condition itself is emitted, so a deferred row a
 * message actually valued is in the issues list rather than silently absent.
 *
 * @param dg1 - The `DG1` `@cosyte/hl7` `Segment`.
 * @example
 * ```ts
 * // deferredDiagnosisIssues(dg1).length; // one per valued deferred row
 * ```
 */
export function deferredDiagnosisIssues(dg1: Segment): readonly TransformIssue[] {
  const issues: TransformIssue[] = [];
  if (dg1.field(16).value !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "DG1.16", "Condition.asserter"));
  }
  if (dg1.field(22).value !== "") {
    issues.push(
      issue(
        ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
        "DG1.22",
        "Condition.extension[condition-dueTo].valueReference",
      ),
    );
  }
  return issues;
}

/** Build `Condition.verificationStatus` from DG1-21, or `undefined` when no row covers the code. */
function buildVerificationStatus(dg1: Segment, issues: TransformIssue[]): FhirComplex | undefined {
  const action = dg1.field(21).value;
  if (action === "") return undefined;
  if (action !== DG1_RETRACTION_ACTION_CODE) {
    // Every other published action code: the map has no target, so the element stays absent rather
    // than borrowing the retraction the one mapped code assigns.
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "DG1.21", "Condition.verificationStatus"),
    );
    return undefined;
  }
  return complex([
    {
      name: "coding",
      value: list([
        complex([
          { name: "system", value: primitive(CONDITION_VERIFICATION_STATUS_SYSTEM) },
          { name: "code", value: primitive(CONDITION_ENTERED_IN_ERROR) },
        ]),
      ]),
    },
  ]);
}

/** Build `Condition.code` from DG1-3, with DG1-4 overriding its text when that row is valued. */
function buildCode(
  dg1: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const description = dg1.field(4).value;
  const coded = toFhirCodeableConcept(dg1.field(3).asCwe(), ctx);
  issues.push(...coded.issues);
  if (coded.value === undefined) {
    // An empty CWE grounds no coding at all, so DG1-4 alone carries the concept, if anything does.
    return description === ""
      ? undefined
      : complex([{ name: "text", value: primitive(description) }]);
  }
  return description === "" ? coded.value : withCodeableText(coded.value, description);
}

/** Build a `dateTime` element from a DTM field, or `undefined` when the field carries nothing. */
function buildDateTime(
  dg1: Segment,
  field: number,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  if (dg1.field(field).value === "") return undefined;
  const converted = toFhirDateTime(dg1.field(field).asTs(), ctx.options);
  issues.push(...converted.issues);
  return converted.value === undefined ? undefined : primitive(converted.value);
}

/**
 * Build a FHIR `Condition` resource node from one `DG1` occurrence, wired to the bundle's Patient.
 * Always produces a Condition: a DG1 states a diagnosis, so an occurrence that grounds neither a
 * code nor a description is emitted with its empty `code` declared rather than withheld.
 *
 * @param dg1 - The `DG1` `@cosyte/hl7` `Segment`.
 * @param patientFullUrl - The bundle's Patient fullUrl, for `subject` (required 1..1).
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @param v2Location - The occurrence's v2 location, for the codeless diagnostic (e.g. `DG1[0]`).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const dg1 = parseHL7(raw).segments("DG1")[0];
 * // const { value } = buildCondition(dg1!, "urn:uuid:pat", {}, "DG1[0]");
 * ```
 */
export function buildCondition(
  dg1: Segment,
  patientFullUrl: string,
  ctx: TransformContext,
  v2Location: string,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Condition") },
  ];

  // DG1-20 EI -> identifier. The assigning authority is never turned into a system URI.
  const entity = toFhirEntityIdentifier(dg1.field(20));
  if (entity.identifier !== undefined) {
    props.push({ name: "identifier", value: list([entity.identifier]) });
  }
  if (entity.authorityValued) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "DG1.20", "Condition.identifier.system"),
    );
  }

  // DG1-21 -> verificationStatus, for the one action code the map's assignment covers.
  const verification = buildVerificationStatus(dg1, issues);
  if (verification !== undefined) props.push({ name: "verificationStatus", value: verification });

  // DG1-3 -> code, DG1-4 -> code.text. Neither valued is a diagnosis that names nothing: declared.
  const code = buildCode(dg1, ctx, issues);
  if (code === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, v2Location, "Condition.code"));
  } else {
    props.push({ name: "code", value: code });
  }

  // The message map's wiring: Condition[1].subject.reference = Patient[1].id.
  props.push({ name: "subject", value: reference(patientFullUrl) });

  // DG1-5 -> onsetDateTime, DG1-19 -> recordedDate.
  const onset = buildDateTime(dg1, 5, ctx, issues);
  if (onset !== undefined) props.push({ name: "onsetDateTime", value: onset });
  const recorded = buildDateTime(dg1, 19, ctx, issues);
  if (recorded !== undefined) props.push({ name: "recordedDate", value: recorded });

  return { value: complex(props), issues };
}

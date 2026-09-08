/**
 * IN1 to FHIR `Coverage`: the insurance an admit states, carried into the bundle instead of lost
 * between the v2 feed and the FHIR record. Grounded firsthand on the IG **IN1 to Coverage** segment
 * map and the **ADT_A01 to Bundle** message map (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-in1-to-coverage.html`, `ConceptMap-message-adt-a01-to-bundle.html`), which
 * wires `Coverage.beneficiary.reference` to the bundle's Patient and creates one Coverage per IN1.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | IN1-2 Health Plan ID (CWE) | `identifier` | CWE.1 as the identifier value |
 * | IN1-4 Insurance Company Name (XON) | `payor` (required 1..*) | a reference carrying the name as `display` only |
 * | IN1-10 Insured's Group Emp ID (CX) | the subscriber-id extension, `IF CX.5 IS "SN"` | {@link toFhirIdentifier} |
 * | IN1-12 Plan Effective Date (DT) | `period.start` | {@link toFhirDateTime} |
 * | IN1-13 Plan Expiration Date (DT) | `period.end` | {@link toFhirDateTime} |
 * | IN1-15 Plan Type (CWE) | `type` | {@link toFhirCodeableConcept} |
 * | IN1-49 Insured's ID Number (CX) | the subscriber-id extension | {@link toFhirIdentifier} |
 * | (no row at all) | `status` (required 1..1) | a value-absent element, `data-absent-reason` `unknown` |
 * | (message-map wiring) | `beneficiary` (required 1..1) | the bundle's Patient |
 *
 * **Fail-safes (never a confident wrong coverage).**
 * - **The status is never asserted.** `Coverage.status` occurs nowhere in the segment map, and R4
 *   makes the element required under a required binding whose members are all positive claims about
 *   a policy. So it ships as a value-absent element carrying `data-absent-reason` `unknown`, plus
 *   {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}: a consumer must read the status as
 *   unknown, and `active` is never the answer this library gives to a message that did not say so.
 * - **A coverage names who pays.** `payor` is required 1..1 and IN1-4 is the only row that grounds
 *   it, so an IN1 whose insurance company name is absent is **withheld** and declared
 *   {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} rather than emitted naming no payer.
 * - **The payer is named, not resolved.** No Organization resource is built here, so `payor` carries
 *   the company name as a `display` and no literal reference, and the missing resource is declared
 *   rather than left to look like a resolvable link.
 * - **A health plan id keeps its value, never a synthesized system.** IN1-2 is a coded element whose
 *   coding system is a table mnemonic, not an identifier namespace, so only CWE.1 is carried as
 *   `Identifier.value`; a valued CWE.3 is declared dropped rather than turned into an
 *   `Identifier.system` this library would be inventing.
 *
 * Deferred and flagged, never silently mapped: `IN1-5` (the payer address, an Organization this
 * library does not build), `IN1-10` and `IN1-11` (`policyHolder`, likewise an Organization),
 * `IN1-16` (`subscriber`, a Patient or RelatedPerson reference the guide conditions on IN1-17) and
 * `IN1-17` (`relationship`, whose value translation needs a Table 0063 to v3 RoleCode ConceptMap
 * this library does not carry).
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { toFhirIdentifier } from "../datatypes/identifier.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { dataAbsent, reference } from "./reference.js";

/**
 * The canonical URL of the subscriber-id extension the IN1-10 and IN1-49 rows assign, transcribed
 * from the segment map's own `Coverage.extension.url` assignment.
 *
 * @example
 * ```ts
 * import { COVERAGE_SUBSCRIBER_ID_EXTENSION_URL } from "@cosyte/transform";
 * COVERAGE_SUBSCRIBER_ID_EXTENSION_URL.endsWith("extension-subscriberId"); // true
 * ```
 */
export const COVERAGE_SUBSCRIBER_ID_EXTENSION_URL =
  "http://hl7.org/fhir/5.0/StructureDefinition/extension-subscriberId";

/**
 * The `data-absent-reason` code carried by `Coverage.status`, the one FHIR-required element of this
 * resource that no published row of the segment map grounds.
 *
 * @example
 * ```ts
 * import { COVERAGE_STATUS_UNKNOWN } from "@cosyte/transform";
 * COVERAGE_STATUS_UNKNOWN; // "unknown"
 * ```
 */
export const COVERAGE_STATUS_UNKNOWN = "unknown";

/**
 * The Table 0203 identifier-type code the IN1-10 row conditions its subscriber-id assignment on
 * (`IF CX.5 IS "SN"`, Subscriber Number). Any other identifier type leaves that row unapplied.
 *
 * @example
 * ```ts
 * import { IN1_SUBSCRIBER_NUMBER_TYPE } from "@cosyte/transform";
 * IN1_SUBSCRIBER_NUMBER_TYPE; // "SN"
 * ```
 */
export const IN1_SUBSCRIBER_NUMBER_TYPE = "SN";

/**
 * Every `IN1` occurrence a message carries, in message order. One Coverage is created per
 * occurrence, per the IG message map's INSURANCE group.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // collectCoverages(parseHL7(raw)).length; // one entry per IN1 in the message
 * ```
 */
export function collectCoverages(msg: Hl7Message): readonly Segment[] {
  return msg.allSegments().filter((seg) => seg.type === "IN1");
}

/**
 * The insurance company name an IN1 carries, read from XON.1 of IN1-4, or `""` when that component
 * carries nothing. The only row of the segment map that grounds the required `payor`.
 *
 * @param in1 - The `IN1` `@cosyte/hl7` `Segment`.
 * @example
 * ```ts
 * // insuranceCompanyName(in1); // the XON.1 organization name, verbatim
 * ```
 */
export function insuranceCompanyName(in1: Segment): string {
  return in1.field(4).repetitions[0]?.components[0]?.subcomponents[0] ?? "";
}

/**
 * The value-free diagnostics for the IN1 rows this library reads and deliberately does not build:
 * the payer address and the two policy-holder rows (each an Organization resource), the subscriber
 * (a Patient or RelatedPerson reference), and the relationship, whose value translation needs a
 * table this library does not carry.
 *
 * Raised for the occurrence whether or not the Coverage itself is emitted, so a deferred row a
 * message actually valued is in the issues list rather than silently absent.
 *
 * @param in1 - The `IN1` `@cosyte/hl7` `Segment`.
 * @example
 * ```ts
 * // deferredCoverageIssues(in1).length; // one per valued deferred row
 * ```
 */
export function deferredCoverageIssues(in1: Segment): readonly TransformIssue[] {
  const deferred: readonly (readonly [number, string])[] = [
    [5, "Coverage.payer"],
    [10, "Coverage.policyHolder"],
    [11, "Coverage.policyHolder"],
    [16, "Coverage.subscriber"],
    [17, "Coverage.relationship"],
  ];
  const issues: TransformIssue[] = [];
  for (const [field, path] of deferred) {
    if (in1.field(field).value !== "") {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `IN1.${String(field)}`, path));
    }
  }
  return issues;
}

/** Build `Coverage.identifier` from IN1-2, carrying CWE.1 and declaring a coding system it drops. */
function buildIdentifier(in1: Segment, issues: TransformIssue[]): FhirComplex | undefined {
  const cwe = in1.field(2).asCwe();
  const planId = cwe.identifier;
  if (planId === undefined || planId === "") return undefined;
  if (cwe.nameOfCodingSystem !== undefined && cwe.nameOfCodingSystem !== "") {
    // A coding-system mnemonic names a table, not an identifier namespace: never an Identifier.system.
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "IN1.2", "Coverage.identifier.system"),
    );
  }
  return complex([{ name: "value", value: primitive(planId) }]);
}

/** One subscriber-id extension carrying a CX field as its `valueIdentifier`, or `undefined`. */
function subscriberIdExtension(
  in1: Segment,
  field: number,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const identifier = toFhirIdentifier(in1.field(field).asCx(), ctx);
  issues.push(...identifier.issues);
  if (identifier.value === undefined) return undefined;
  return complex([
    { name: "url", value: primitive(COVERAGE_SUBSCRIBER_ID_EXTENSION_URL) },
    { name: "valueIdentifier", value: identifier.value },
  ]);
}

/** Build `Coverage.period` from IN1-12 / IN1-13, or `undefined` when neither is valued. */
function buildPeriod(
  in1: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];
  for (const [field, name] of [
    [12, "start"],
    [13, "end"],
  ] as const) {
    if (in1.field(field).value === "") continue;
    const converted = toFhirDateTime(in1.field(field).asTs(), ctx.options);
    issues.push(...converted.issues);
    if (converted.value !== undefined) props.push({ name, value: primitive(converted.value) });
  }
  return props.length === 0 ? undefined : complex(props);
}

/**
 * Build a FHIR `Coverage` resource node from one `IN1` occurrence, wired to the bundle's Patient.
 * Returns `{ value: undefined }` when IN1-4 names no insurance company, because `payor` is required
 * by R4 and no other row of the segment map grounds it.
 *
 * @param in1 - The `IN1` `@cosyte/hl7` `Segment`.
 * @param patientFullUrl - The bundle's Patient fullUrl, for `beneficiary` (required 1..1).
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @param v2Location - The occurrence's v2 location, for the withholding diagnostic (e.g. `IN1[0]`).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const in1 = parseHL7(raw).segments("IN1")[0];
 * // const { value } = buildCoverage(in1!, "urn:uuid:pat", {}, "IN1[0]");
 * ```
 */
export function buildCoverage(
  in1: Segment,
  patientFullUrl: string,
  ctx: TransformContext,
  v2Location: string,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // payor is required 1..1 and IN1-4 is its only source: no name, no coverage.
  const payerName = insuranceCompanyName(in1);
  if (payerName === "") {
    return {
      value: undefined,
      issues: [issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, v2Location, "Coverage.payor")],
    };
  }

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Coverage") },
  ];

  // IN1-10 (IF CX.5 IS "SN") and IN1-49 -> the subscriber-id extension, in map sort order.
  const extensions: FhirComplex[] = [];
  if (in1.field(10).asCx().identifierTypeCode === IN1_SUBSCRIBER_NUMBER_TYPE) {
    const groupId = subscriberIdExtension(in1, 10, ctx, issues);
    if (groupId !== undefined) extensions.push(groupId);
  }
  if (in1.field(49).value !== "") {
    const insuredId = subscriberIdExtension(in1, 49, ctx, issues);
    if (insuredId !== undefined) extensions.push(insuredId);
  }
  if (extensions.length > 0) props.push({ name: "extension", value: list(extensions) });

  // IN1-2 -> identifier.
  const identifier = buildIdentifier(in1, issues);
  if (identifier !== undefined) props.push({ name: "identifier", value: list([identifier]) });

  // No row grounds a coverage status: value-absent, declared, never asserted.
  issues.push(issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, v2Location, "Coverage.status"));
  props.push({ name: "status", value: dataAbsent(COVERAGE_STATUS_UNKNOWN) });

  // IN1-15 -> type.
  const type = toFhirCodeableConcept(in1.field(15).asCwe(), ctx);
  issues.push(...type.issues);
  if (type.value !== undefined) props.push({ name: "type", value: type.value });

  // The message map's wiring: Coverage.beneficiary.reference = Patient[1].id.
  props.push({ name: "beneficiary", value: reference(patientFullUrl) });

  // IN1-12 / IN1-13 -> period.
  const period = buildPeriod(in1, ctx, issues);
  if (period !== undefined) props.push({ name: "period", value: period });

  // IN1-4 -> payor. The insurer is named, and the Organization it would resolve to is declared.
  props.push({
    name: "payor",
    value: list([complex([{ name: "display", value: primitive(payerName) }])]),
  });
  issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "IN1.4", "Coverage.payor"));

  return { value: complex(props), issues };
}

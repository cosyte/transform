/**
 * SPM → FHIR `Specimen`: the sample a result was taken from, carried into the bundle instead of
 * lost between the lab feed and the FHIR record. Grounded firsthand on the IG **Segment SPM to
 * Specimen** ConceptMap and the **ORU_R01 to Bundle** message map (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-spm-to-specimen.html`, `ConceptMap-message-oru-r01-to-bundle.html`), whose
 * row 4.2.7.1 creates one Specimen per SPM of an ORDER_OBSERVATION's SPECIMEN group and wires
 * `DiagnosticReport[1].specimen.reference` to it.
 *
 * | SPM field | FHIR target | via |
 * |---|---|---|
 * | SPM-2 Specimen ID (EIP) | `identifier` (placer, then filler) | EI.1 → `Identifier.value` |
 * | SPM-4 Specimen Type (CWE) | `Specimen.type` | {@link toFhirCodeableConcept} |
 * | SPM-6 Specimen Additives (CWE) | `container.additiveCodeableConcept` | {@link toFhirCodeableConcept} |
 * | SPM-7 Collection Method (CWE) | `collection.method` | {@link toFhirCodeableConcept} |
 * | SPM-8 Source Site (CWE) | `collection.bodySite` | {@link toFhirCodeableConcept} |
 * | SPM-14 Specimen Description (ST) | `note` (`Annotation.text`) | one annotation per repetition |
 * | SPM-17 Collection Date/Time (DR) | `collection.collectedPeriod` / `collectedDateTime` | `IF SPM-17.2 VALUED` |
 * | SPM-18 Received Date/Time (DTM) | `Specimen.receivedTime` | {@link toFhirDateTime} |
 * | SPM-24 Specimen Condition (CWE) | `Specimen.condition` | {@link toFhirCodeableConcept} |
 * | SPM-27 Container Type (CWE) | `container.type` | {@link toFhirCodeableConcept} |
 * | SPM-30 Accession ID (CX) | `Specimen.accessionIdentifier` | {@link toFhirIdentifier} |
 * | SPM-31 Other Specimen ID (CX) | `identifier` | {@link toFhirIdentifier} |
 * | SPM-32 Shipment ID (EI) | `identifier` (type `SHIP`, v2-0203) | the row's own fixed assignment |
 * | (message-map wiring) | referenced from `DiagnosticReport.specimen` | the assembler |
 *
 * **Fail-safes (never a confident wrong specimen).**
 * - **The status is never asserted.** `SPM-20` is the only row that targets `Specimen.status`, and
 *   it reaches it through a **Table 0136 to specimen-status** value ConceptMap this library does not
 *   carry. R4 binds that element `required`, and every member of the binding is a positive claim
 *   about a sample a clinician may act on, so the element stays absent and the row is declared
 *   {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}. Unlike `Coverage.status`, `Specimen.status` is
 *   `0..1`, so absence is the spec-clean shape and no `data-absent-reason` is needed to hold a slot.
 * - **A specimen never points at a specimen that is not there.** `SPM-3 Specimen Parent IDs` targets
 *   `Specimen.parent`, a reference to another Specimen resource; none is built for a parent, so the
 *   row is declared rather than emitted as a link that resolves to nothing.
 * - **A collection amount is not rebuilt from parts.** `SPM-12` reaches `collection.quantity`
 *   through the `CQ[Quantity]` datatype map, which this library does not carry; assembling one from
 *   CQ.1 and CQ.2 by hand would be a unit gate written twice, so the row is declared instead.
 * - **An unresolvable coding system costs the system URI, never the code**, and every date/time goes
 *   through the one timezone-safe converter: the datatype converters own both rules and this module
 *   only routes fields to them.
 *
 * @packageDocumentation
 */

import { parseDtm, type Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { toFhirIdentifier } from "../datatypes/identifier.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { orderIdentifier } from "./reference.js";

/**
 * The Table 0203 identifier-type code the SPM-32 row **assigns** to the shipment identifier
 * (`Specimen.identifier[3].type.coding.code = "SHIP"`, with the v2-0203 system beside it).
 *
 * @example
 * ```ts
 * import { SPM_SHIPMENT_IDENTIFIER_TYPE } from "@cosyte/transform";
 * SPM_SHIPMENT_IDENTIFIER_TYPE; // "SHIP"
 * ```
 */
export const SPM_SHIPMENT_IDENTIFIER_TYPE = "SHIP";

/**
 * The SPM rows this library reads and deliberately does not build, each with the target it would
 * have reached. Raised for the occurrence whether or not the Specimen itself is emitted, so a
 * deferred row a message actually valued is in the issues list rather than silently absent.
 */
const DEFERRED_SPECIMEN_ROWS: readonly (readonly [field: number, path: string])[] = Object.freeze([
  [3, "Specimen.parent"],
  [12, "Specimen.collection.quantity"],
  [20, "Specimen.status"],
]);

/** The 1-based subcomponent of a 1-based component of a field's first repetition, or `""`. */
function subcomponent(spm: Segment, field: number, component: number, sub: number): string {
  return spm.field(field).repetitions[0]?.components[component - 1]?.subcomponents[sub - 1] ?? "";
}

/** A CWE field read as a `CodeableConcept`, or `undefined` when the field carries no coded value. */
function codeable(
  spm: Segment,
  field: number,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const converted = toFhirCodeableConcept(spm.field(field).asCwe(), ctx);
  issues.push(...converted.issues);
  return converted.value;
}

/** A CX field read as an `Identifier`, or `undefined` when it keys nothing. */
function identifierFrom(
  spm: Segment,
  field: number,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const converted = toFhirIdentifier(spm.field(field).asCx(), ctx);
  issues.push(...converted.issues);
  return converted.value;
}

/**
 * `Specimen.identifier`: the placer and filler halves of SPM-2's EIP, then SPM-31's other specimen
 * id, then SPM-32's shipment id under the type the row assigns. Each entity identifier carries its
 * EI.1 as `Identifier.value` and **no system**: a namespace is never turned into a system URI,
 * because two senders reusing one namespace would otherwise collide.
 */
function buildIdentifiers(
  spm: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex[] {
  const identifiers: FhirComplex[] = [];
  for (const component of [1, 2]) {
    const entityId = subcomponent(spm, 2, component, 1);
    if (entityId !== "") {
      identifiers.push(complex([{ name: "value", value: primitive(entityId) }]));
    }
  }
  const other = identifierFrom(spm, 31, ctx, issues);
  if (other !== undefined) identifiers.push(other);
  const shipment = orderIdentifier(spm.field(32).value, SPM_SHIPMENT_IDENTIFIER_TYPE);
  if (shipment !== undefined) identifiers.push(shipment);
  return identifiers;
}

/**
 * `Specimen.collection`: the method, the body site, and the collection time. SPM-17 is a `DR`, and
 * the map's own condition decides the shape: `IF SPM-17.2 VALUED` it is a `collectedPeriod` (via
 * `DR[Period]`), otherwise the start alone is a `collectedDateTime` (via `DR[dateTime]`). Neither
 * bound is ever substituted for the other.
 */
function buildCollection(
  spm: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];

  const method = codeable(spm, 7, ctx, issues);
  if (method !== undefined) props.push({ name: "method", value: method });
  const bodySite = codeable(spm, 8, ctx, issues);
  if (bodySite !== undefined) props.push({ name: "bodySite", value: bodySite });

  const start = subcomponent(spm, 17, 1, 1);
  const end = subcomponent(spm, 17, 2, 1);
  const bounds: { name: string; value: FhirNode }[] = [];
  for (const [raw, name] of [
    [start, "start"],
    [end, "end"],
  ] as const) {
    if (raw === "") continue;
    const converted = toFhirDateTime(parseDtm(raw), ctx.options);
    issues.push(...converted.issues);
    if (converted.value !== undefined) bounds.push({ name, value: primitive(converted.value) });
  }
  if (end !== "" && bounds.length > 0) {
    props.push({ name: "collectedPeriod", value: complex(bounds) });
  } else if (bounds[0] !== undefined) {
    props.push({ name: "collectedDateTime", value: bounds[0].value });
  }

  return props.length === 0 ? undefined : complex(props);
}

/** `Specimen.container`: the container type and the additive the sample sits in. */
function buildContainer(
  spm: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  const props: { name: string; value: FhirNode }[] = [];
  const type = codeable(spm, 27, ctx, issues);
  if (type !== undefined) props.push({ name: "type", value: type });
  const additive = codeable(spm, 6, ctx, issues);
  if (additive !== undefined) props.push({ name: "additiveCodeableConcept", value: additive });
  return props.length === 0 ? undefined : list([complex(props)]);
}

/** `Specimen.note`: one `Annotation` per valued SPM-14 repetition, its text carried verbatim. */
function buildDescriptionNotes(spm: Segment): FhirNode | undefined {
  const annotations: FhirComplex[] = [];
  for (const repetition of spm.field(14).repetitions) {
    const text = repetition.components[0]?.subcomponents[0] ?? "";
    if (text === "") continue;
    annotations.push(complex([{ name: "text", value: primitive(text) }]));
  }
  return annotations.length === 0 ? undefined : list(annotations);
}

/**
 * Build a FHIR `Specimen` resource node from one parsed HL7 v2 SPM segment. Returns
 * `{ value: undefined }` when the segment grounds no element of the map at all, because an empty
 * `Specimen` in a bundle is a claim that a sample was described when nothing about it was sent.
 *
 * @param spm - The SPM `@cosyte/hl7` `Segment`.
 * @param subjectFullUrl - The `urn:uuid:` fullUrl of the bundle's Patient → `Specimen.subject`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const spm = parseHL7(raw).segments("SPM")[0];
 * // const { value } = buildSpecimen(spm!, "urn:uuid:pat", {});
 * ```
 */
export function buildSpecimen(
  spm: Segment,
  subjectFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // The rows read and not built, declared for the occurrence before anything else is decided.
  for (const [field, path] of DEFERRED_SPECIMEN_ROWS) {
    if (spm.field(field).value !== "") {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `SPM.${String(field)}`, path));
    }
  }

  const props: { name: string; value: FhirNode }[] = [];

  const identifiers = buildIdentifiers(spm, ctx, issues);
  if (identifiers.length > 0) props.push({ name: "identifier", value: list(identifiers) });

  const accession = identifierFrom(spm, 30, ctx, issues);
  if (accession !== undefined) props.push({ name: "accessionIdentifier", value: accession });

  const type = codeable(spm, 4, ctx, issues);
  if (type !== undefined) props.push({ name: "type", value: type });

  // The message map's wiring: the specimen belongs to the bundle's patient, or to nobody named.
  if (subjectFullUrl !== undefined) {
    props.push({
      name: "subject",
      value: complex([{ name: "reference", value: primitive(subjectFullUrl) }]),
    });
  }

  // SPM-18 → receivedTime.
  if (spm.field(18).value !== "") {
    const received = toFhirDateTime(spm.field(18).asTs(), ctx.options);
    issues.push(...received.issues);
    if (received.value !== undefined) {
      props.push({ name: "receivedTime", value: primitive(received.value) });
    }
  }

  const collection = buildCollection(spm, ctx, issues);
  if (collection !== undefined) props.push({ name: "collection", value: collection });

  const container = buildContainer(spm, ctx, issues);
  if (container !== undefined) props.push({ name: "container", value: container });

  const condition = codeable(spm, 24, ctx, issues);
  if (condition !== undefined) props.push({ name: "condition", value: list([condition]) });

  const note = buildDescriptionNotes(spm);
  if (note !== undefined) props.push({ name: "note", value: note });

  // Nothing but the wiring: no row of the map was grounded, so there is no specimen to describe.
  if (props.every((p) => p.name === "subject")) return { value: undefined, issues };

  return {
    value: complex([{ name: "resourceType", value: primitive("Specimen") }, ...props]),
    issues,
  };
}

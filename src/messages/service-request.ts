/**
 * ORC + OBR → FHIR `ServiceRequest`: the order-entry request, grounded firsthand
 * on the IG **Segment ORC to ServiceRequest** and **Segment OBR to ServiceRequest** ConceptMaps and
 * the **Table HL70119 to Request Status** ConceptMap (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-orc-to-servicerequest.html`, `ConceptMap-segment-obr-to-servicerequest.html`,
 * `ConceptMap-table-hl70119-to-request-status.html`). Per the **ORM_O01 / OML_O21 message maps**,
 * `ORC` *creates* the `ServiceRequest` and `OBR` is *incorporated into that same* request, so one
 * builder consumes both:
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | ORC-1 Order Control | `ServiceRequest.status` | {@link REQUEST_STATUS_MAP} (HL70119), *only IF ORC-5 not valued* |
 * | ORC-2 / OBR-2 Placer Order Number | `identifier` (type `PLAC`) | {@link orderIdentifier} (EI.1, v2-0203) |
 * | ORC-3 / OBR-3 Filler Order Number | `identifier` (type `FILL`) | {@link orderIdentifier} |
 * | ORC-9 Date/Time of Order Event | `authoredOn` | {@link toFhirDateTime}, *IF ORC-1 = `NW`* |
 * | OBR-4 Universal Service Identifier (CWE) | `ServiceRequest.code` | {@link toFhirCodeableConcept} |
 * | OBR-5 Priority (v2-0485) | `ServiceRequest.priority` | {@link SERVICE_REQUEST_PRIORITY_MAP} (HL70485) |
 * | OBR-6 Requested Date/Time | `occurrenceDateTime` | {@link toFhirDateTime} |
 * | OBR-31 Reason for Study (CWE) | `reasonCode` | {@link toFhirCodeableConcept} |
 * | (order message context) | `intent` = `order` | see below |
 * | (message-map wiring) | `subject` / `encounter` | the bundle's Patient / Encounter |
 *
 * **Fail-safes (never a confident wrong request).**
 * - **`status` (required 1..1).** ORC-1 → HL70119 carries a target for only the 19 codes in
 *   {@link REQUEST_STATUS_MAP}; the many codes the IG leaves in its `(unmapped)` group (CH, CP, PA,
 *   RE, RF, RP, SC, the U* "unable to …" family, …) have **no** target and leave `status` absent +
 *   flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}. When **ORC-5** (Order Status) is valued the
 *   IG routes status through ORC-5 via an *unspecified* mapping (no code table), so we cannot derive
 *   it, flag ORC-5 unmapped, and leave `status` absent rather than mis-applying the ORC-1 table
 *   against the IG's own condition. The required-`status` emit gate then **withholds** the request,
 *   never guessed, never coerced.
 * - **`intent` (required 1..1) = `order`.** The IG maps ORC-1/OBR → `intent` as `equivalent` but ships
 *   **no value ConceptMap** for it; the ORM_O01/OML_O21 families are, by definition, *order* messages
 *   (their message maps create a `ServiceRequest`/`MedicationRequest` per order), so `intent` is fixed
 *   to the `request-intent` code `order` from that message context. This is a resource-level constant
 *   grounded in the message family, **not** a fabricated per-code translation row. The finer
 *   OBR-11-conditioned intent refinement is deferred.
 * - **`subject` (required 1..1).** Wired to the bundle's Patient; a request with no resolvable Patient
 *   is withheld rather than emitted with a dangling/absent subject.
 *
 * - **`priority` (0..1), value-translated.** OBR-5 → `ServiceRequest.priority` via the IG
 *   **Table HL70485 to Request Priority** ConceptMap ({@link SERVICE_REQUEST_PRIORITY_MAP}): only
 *   `S→stat`, `A→asap`, `R→routine` carry a target (each `equivalent`, and all three are valid
 *   `request-priority` members). Every other v2-0485 code (`P`, `C`, `T`, the
 *   `T{S,M,H,D,W,L}<integer>` timing-critical family, `PRN`) sits in the IG map's `(unmapped)` group, so a valued OBR-5 the map
 *   has no target for leaves `priority` absent + flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED},
 *   never guessed. (`priority` is 0..1, so an unmapped value simply omits it: the request still emits.)
 *
 * Deferred and flagged elsewhere, not silently mapped: ORC-7/OBR-27 timing (`$this`), ORC-12/OBR-16
 * requester + ORC-21..24 ordering facility/provider (need Practitioner/PractitionerRole/Organization
 * resources), OBR-29 basedOn, specimen, and the ORC-1/ORC-9/OBR-13 order-control/supporting-info
 * extensions.
 *
 * @packageDocumentation
 */

import type { Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { orderIdentifier, reference } from "./reference.js";

/**
 * HL7 v2 Table 0119 (Order Control Codes) → FHIR `request-status` (`ServiceRequest.status`), per the
 * IG **Table HL70119 to Request Status** ConceptMap (each `is equivalent to`). Only these **19** source
 * codes carry a target; every other v2-0119 code sits in the IG's explicit `(unmapped)` group
 * (verified firsthand against the published v1.0.0 ConceptMap: CH/CN/CP/DE/LI/NA/OE/OF/OP/OR/PA/RE/
 * RF/RP/RR/RU/SC/SN/SR/SS/UA/UC/UD/UF/UH/UM/UN/UR/UX/XO/XR/XX/MC are all `unmatched`, and the map
 * declares no `unmapped` default), so an ORC-1 with one of them leaves `status` absent + flagged and
 * the request is withheld. `request-status` has no `cancelled`; the cancel/discontinue codes map to
 * `revoked` and the hold codes to `on-hold`, exactly as the IG table specifies.
 */
export const REQUEST_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  AF: "active",
  CA: "active",
  CR: "revoked",
  DC: "revoked",
  DF: "revoked",
  DR: "revoked",
  FU: "completed",
  HD: "active",
  HR: "on-hold",
  NW: "active",
  OC: "revoked",
  OD: "revoked",
  OH: "on-hold",
  OK: "active",
  PR: "active",
  PY: "active",
  RL: "active",
  RO: "active",
  RQ: "active",
});

/**
 * HL7 v2 Table 0485 (Extended Priority Codes) → FHIR `request-priority` (`ServiceRequest.priority`),
 * per the IG **Table HL70485 to Request Priority** ConceptMap (each `is equivalent to`; verified
 * firsthand against the published v1.0.0 ConceptMap). Only these **three** source codes carry a
 * target; every other v2-0485 code, namely `P` (Preop), `C` (Callback), `T` (Timing critical), the
 * `T{S,M,H,D,W,L}<integer>` timing-critical family, and `PRN` (As needed), sits in the IG's
 * `(unmapped)` group with no target, so an OBR-5 carrying one leaves `priority` absent + flagged.
 * All three targets (`stat`/`asap`/`routine`) are valid `request-priority` members.
 */
export const SERVICE_REQUEST_PRIORITY_MAP: Readonly<Record<string, string>> = Object.freeze({
  S: "stat",
  A: "asap",
  R: "routine",
});

/** The `request-intent` code fixed for order-message requests (see the module fail-safe note). */
const ORDER_INTENT = "order";

/** The decoded value of a field on an optional segment (empty string when the segment is absent). */
function fieldValue(seg: Segment | undefined, index: number): string {
  return seg === undefined ? "" : seg.field(index).value;
}

/**
 * Build a FHIR `ServiceRequest` resource node from an order group's `ORC` and/or `OBR` segments.
 * Returns `{ value: undefined }` only when both segments are absent (nothing to build).
 * `ServiceRequest.status` is left absent (and the request withheld by the emit gate) when it cannot be
 * grounded via HL70119, never guessed.
 *
 * @param orc - The `ORC` `@cosyte/hl7` `Segment`, when the order carries one.
 * @param obr - The `OBR` `@cosyte/hl7` `Segment`, when the order carries one.
 * @param subjectFullUrl - The bundle's Patient fullUrl → `ServiceRequest.subject` (required 1..1).
 * @param encounterFullUrl - The bundle's Encounter fullUrl → `ServiceRequest.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const orc = parseHL7(raw).segments("ORC")[0];
 * // const obr = parseHL7(raw).segments("OBR")[0];
 * // const { value } = buildServiceRequest(orc, obr, "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildServiceRequest(
  orc: Segment | undefined,
  obr: Segment | undefined,
  subjectFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  if (orc === undefined && obr === undefined) return { value: undefined, issues };

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("ServiceRequest") },
  ];

  // ORC-1 → status (HL70119), only when ORC-5 is not valued; else the IG routes status through ORC-5
  // via an unspecified mapping (no code table) → cannot derive → flag, leave absent, withhold.
  const orc1 = fieldValue(orc, 1);
  const orc5 = fieldValue(orc, 5);
  if (orc5 !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "ORC.5", "ServiceRequest.status"));
  } else if (orc1 !== "") {
    const status = Object.hasOwn(REQUEST_STATUS_MAP, orc1) ? REQUEST_STATUS_MAP[orc1] : undefined;
    if (status === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "ORC.1", "ServiceRequest.status"));
    } else {
      props.push({ name: "status", value: primitive(status) });
    }
  }

  // intent (required) = order: the order-message context, not a per-code translation (see module note).
  props.push({ name: "intent", value: primitive(ORDER_INTENT) });

  // ORC-2/OBR-2 (placer) + ORC-3/OBR-3 (filler) → identifier. The IG conditions each on the other
  // ("OBR-2 IF ORC-2 NOT VALUED" and vice-versa); prefer OBR, fall back to ORC; either way, one each.
  const placer = fieldValue(obr, 2) !== "" ? fieldValue(obr, 2) : fieldValue(orc, 2);
  const filler = fieldValue(obr, 3) !== "" ? fieldValue(obr, 3) : fieldValue(orc, 3);
  const identifiers = [orderIdentifier(placer, "PLAC"), orderIdentifier(filler, "FILL")].filter(
    (i): i is FhirComplex => i !== undefined,
  );
  if (identifiers.length > 0) props.push({ name: "identifier", value: list(identifiers) });

  // OBR-4 → ServiceRequest.code (0..1).
  if (obr !== undefined && obr.field(4).value !== "") {
    const code = toFhirCodeableConcept(obr.field(4).asCwe(), ctx);
    issues.push(...code.issues);
    if (code.value !== undefined) props.push({ name: "code", value: code.value });
  }

  // OBR-5 → priority (HL70485 → request-priority; value-translated). Applied only when OBR-5 is a
  // v2-0485 code (CWE.3 absent or names HL70485); a code from a foreign coding system, or one the IG
  // leaves in its (unmapped) group, is flagged and priority left absent (0..1), never guessed.
  const obr5cwe = obr?.field(5).asCwe();
  const obr5 = obr5cwe?.identifier ?? "";
  if (obr5 !== "") {
    const mnemonic = obr5cwe?.nameOfCodingSystem;
    const fromTable =
      mnemonic === undefined || mnemonic === "" || mnemonic === "HL70485" || mnemonic === "0485";
    const priority =
      fromTable && Object.hasOwn(SERVICE_REQUEST_PRIORITY_MAP, obr5)
        ? SERVICE_REQUEST_PRIORITY_MAP[obr5]
        : undefined;
    if (priority === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBR.5", "ServiceRequest.priority"));
    } else {
      props.push({ name: "priority", value: primitive(priority) });
    }
  }

  // subject / encounter → the bundle's Patient / Encounter (message-map reference wiring).
  if (subjectFullUrl !== undefined)
    props.push({ name: "subject", value: reference(subjectFullUrl) });
  if (encounterFullUrl !== undefined)
    props.push({ name: "encounter", value: reference(encounterFullUrl) });

  // ORC-9 → authoredOn, only for a new order (ORC-1 = NW), per the IG condition. authoredOn is a
  // `dateTime`, so a date-only value is valid (unlike the `instant` fields), no timezone gate needed.
  if (orc1 === "NW" && fieldValue(orc, 9) !== "" && orc !== undefined) {
    const authored = toFhirDateTime(orc.field(9).asTs(), ctx.options);
    issues.push(...authored.issues);
    if (authored.value !== undefined)
      props.push({ name: "authoredOn", value: primitive(authored.value) });
  }

  // OBR-6 → occurrenceDateTime (Requested Date/Time).
  if (obr !== undefined && obr.field(6).value !== "") {
    const occurrence = toFhirDateTime(obr.field(6).asTs(), ctx.options);
    issues.push(...occurrence.issues);
    if (occurrence.value !== undefined)
      props.push({ name: "occurrenceDateTime", value: primitive(occurrence.value) });
  }

  // OBR-31 → reasonCode (Reason for Study).
  if (obr !== undefined && obr.field(31).value !== "") {
    const reason = toFhirCodeableConcept(obr.field(31).asCwe(), ctx);
    issues.push(...reason.issues);
    if (reason.value !== undefined) props.push({ name: "reasonCode", value: list([reason.value]) });
  }

  return { value: complex(props), issues };
}

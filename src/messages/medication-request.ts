/**
 * RXO (+ RXR route) → FHIR `MedicationRequest` — the pharmacy-order request (roadmap §Phase 4),
 * grounded firsthand on the IG **Segment RXO to MedicationRequest** and **Segment RXR to
 * MedicationRequest** ConceptMaps (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-rxo-to-medicationrequest.html`, `ConceptMap-segment-rxr-to-medicationrequest.html`).
 * Per the **ORM_O01 message map**, an `RXO` in the order-detail is a `MedicationRequest`; the `ORC`
 * that opened the order supplies `authoredOn`.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | RXO-1 Requested Give Code (CWE) | `medicationCodeableConcept` | {@link toFhirCodeableConcept} |
 * | RXO-2 / RXO-3 Give Amount Min/Max (NM) | `dosageInstruction.doseAndRate.doseRange.low`/`.high` | {@link quantityFromRawMagnitude} + RXO-4 units |
 * | RXO-11 / RXO-12 Requested Dispense Amount / Units | `dispenseRequest.quantity` | {@link quantityFromRawMagnitude} |
 * | RXO-13 Number of Refills (NM) | `dispenseRequest.numberOfRepeatsAllowed` (unsignedInt) | integer-valued `decimal` |
 * | RXR-1 Route / RXR-2 Site / RXR-4 Method (CWE) | `dosageInstruction.route`/`.site`/`.method` | {@link toFhirCodeableConcept} |
 * | ORC-9 Date/Time of Order Event | `authoredOn` | {@link toFhirDateTime}, *IF ORC-1 = `NW`* |
 * | (order message context) | `intent` = `order` | see below |
 * | (message-map wiring) | `subject` / `encounter` | the bundle's Patient / Encounter |
 *
 * **Fail-safes (never a confident wrong medication order).**
 * - **`medication[x]` (required 1..1).** Emitted as `medicationCodeableConcept` from RXO-1 only; a
 *   pharmacy order with no give code has nothing to prescribe and is not built (`{ value: undefined }`).
 *   The ingredient/strength paths (RXO-5/18/19/25/26 → a *contained* `Medication` with `ingredient`)
 *   and `medicationReference` are deferred, not fabricated.
 * - **`status` (required 1..1) = `unknown` + flag.** Unlike `ServiceRequest`, the IG ships **no**
 *   status source for `MedicationRequest` at all — there is no RXO→status row and no orc-to-
 *   medicationrequest map, and the `request-status` codes HL70119 yields (`revoked`, …) are **not**
 *   valid `medicationrequest-status` codes, so borrowing that table would emit invalid FHIR. Rather
 *   than guess a clinical state, `status` is set to the value-set's own `unknown` (an honest
 *   "not known", asserting nothing) and flagged {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}.
 * - **`intent` (required 1..1) = `order`.** The IG maps RXO → `intent` `equivalent` with no value
 *   ConceptMap; the ORM_O01 family is an *order* message, so `intent` is fixed to `order` from that
 *   message context — a resource-level constant, not a fabricated per-code row (as for `ServiceRequest`).
 * - **Dose/dispense units.** Carried through {@link quantityFromRawMagnitude}: a magnitude is
 *   precision-exact (string-backed `decimal`, never rescaled), and a non-UCUM unit is preserved
 *   verbatim in `.unit` with `.code`/`.system` absent + flagged — a UCUM code is never fabricated.
 *
 * **`RXE` is out of scope by grounding, not omission.** The STU1 IG ships no `RXE` segment map and no
 * `RDE`/`RGV` message map; the assembler flags any `RXE` rather than mapping it here (an RXE layout is
 * never guessed from the RXO map — the field positions differ).
 *
 * @packageDocumentation
 */

import type { CWE, Segment } from "@cosyte/hl7";
import { complex, decimal, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { quantityFromRawMagnitude } from "../datatypes/quantity.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";

/** The `medicationrequest-status` code emitted when the IG grounds no status (an honest "not known"). */
const STATUS_UNKNOWN = "unknown";
/** The `medicationrequest Intent` code fixed for order-message requests (see the module fail-safe note). */
const ORDER_INTENT = "order";
/** A FHIR `unsignedInt` lexical form: `0` or a leading-non-zero positive integer (no sign, no leading zero). */
const UNSIGNED_INT = /^(0|[1-9][0-9]*)$/;

/** Build a `dosageInstruction.route`/`.site`/`.method` CodeableConcept from an RXR CWE field. */
function codeableFrom(
  seg: Segment,
  index: number,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (seg.field(index).value === "") return undefined;
  const cc = toFhirCodeableConcept(seg.field(index).asCwe(), ctx);
  issues.push(...cc.issues);
  return cc.value;
}

/** Build a dose-range endpoint `Quantity` from an RXO amount field (NM) sharing the RXO-4 units. */
function doseEndpoint(
  rxo: Segment,
  amountIndex: number,
  units: CWE,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const raw = rxo.field(amountIndex).asNm().raw;
  if (raw === "") return undefined;
  const q = quantityFromRawMagnitude(
    raw,
    units,
    ctx,
    undefined,
    `RXO.${String(amountIndex)}`,
    "RXO.4",
  );
  issues.push(...q.issues);
  return q.value;
}

/** Build the single `dosageInstruction` (route/site/method + dose range), or `undefined` when empty. */
function buildDosageInstruction(
  rxo: Segment | undefined,
  rxr: Segment | undefined,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];

  if (rxr !== undefined) {
    const route = codeableFrom(rxr, 1, ctx, issues);
    if (route !== undefined) props.push({ name: "route", value: route });
    const site = codeableFrom(rxr, 2, ctx, issues);
    if (site !== undefined) props.push({ name: "site", value: site });
    const method = codeableFrom(rxr, 4, ctx, issues);
    if (method !== undefined) props.push({ name: "method", value: method });
  }

  if (rxo !== undefined) {
    const units = rxo.field(4).asCwe();
    const low = doseEndpoint(rxo, 2, units, ctx, issues);
    const high = doseEndpoint(rxo, 3, units, ctx, issues);
    const rangeProps: { name: string; value: FhirNode }[] = [];
    if (low !== undefined) rangeProps.push({ name: "low", value: low });
    if (high !== undefined) rangeProps.push({ name: "high", value: high });
    if (rangeProps.length > 0) {
      props.push({
        name: "doseAndRate",
        value: list([complex([{ name: "doseRange", value: complex(rangeProps) }])]),
      });
    }
  }

  return props.length === 0 ? undefined : complex(props);
}

/** Build `dispenseRequest` (RXO-11/12 quantity + RXO-13 refills), or `undefined` when empty. */
function buildDispenseRequest(
  rxo: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];

  const amount = rxo.field(11).asNm().raw;
  if (amount !== "") {
    const q = quantityFromRawMagnitude(
      amount,
      rxo.field(12).asCwe(),
      ctx,
      undefined,
      "RXO.11",
      "RXO.12",
    );
    issues.push(...q.issues);
    if (q.value !== undefined) props.push({ name: "quantity", value: q.value });
  }

  const refills = rxo.field(13).value;
  if (refills !== "") {
    if (UNSIGNED_INT.test(refills)) {
      props.push({ name: "numberOfRepeatsAllowed", value: primitive(decimal(refills)) });
    } else {
      // A non-unsignedInt refill count is dropped rather than emitted as an invalid primitive.
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
          "RXO.13",
          "dispenseRequest.numberOfRepeatsAllowed",
        ),
      );
    }
  }

  return props.length === 0 ? undefined : complex(props);
}

/**
 * Build a FHIR `MedicationRequest` resource node from an order group's `RXO` and `RXR` segments and
 * its opening `ORC`. Returns `{ value: undefined }` when RXO-1 (the give code) is absent — a
 * medication request with no `medication[x]` cannot be emitted.
 *
 * @param rxo - The `RXO` `@cosyte/hl7` `Segment` (the pharmacy order detail).
 * @param rxr - The first `RXR` route `Segment` beneath the order, when present.
 * @param orc - The `ORC` `Segment` that opened the order, when present (supplies `authoredOn`).
 * @param subjectFullUrl - The bundle's Patient fullUrl → `MedicationRequest.subject` (required 1..1).
 * @param encounterFullUrl - The bundle's Encounter fullUrl → `MedicationRequest.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const rxo = parseHL7(raw).segments("RXO")[0];
 * // const { value } = buildMedicationRequest(rxo, undefined, undefined, "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildMedicationRequest(
  rxo: Segment | undefined,
  rxr: Segment | undefined,
  orc: Segment | undefined,
  subjectFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // RXO-1 → medicationCodeableConcept (required 1..1). Absent → nothing emittable.
  if (rxo === undefined || rxo.field(1).value === "") return { value: undefined, issues };
  const medication = toFhirCodeableConcept(rxo.field(1).asCwe(), ctx);
  issues.push(...medication.issues);
  if (medication.value === undefined) return { value: undefined, issues };

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("MedicationRequest") },
  ];

  // status (required) = unknown — the IG grounds no MedicationRequest status; an honest "not known".
  props.push({ name: "status", value: primitive(STATUS_UNKNOWN) });
  issues.push(
    issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "RXO", "MedicationRequest.status"),
  );

  // intent (required) = order — the order-message context, not a per-code translation.
  props.push({ name: "intent", value: primitive(ORDER_INTENT) });

  props.push({ name: "medicationCodeableConcept", value: medication.value });

  // subject / encounter → the bundle's Patient / Encounter (message-map reference wiring).
  if (subjectFullUrl !== undefined)
    props.push({ name: "subject", value: reference(subjectFullUrl) });
  if (encounterFullUrl !== undefined)
    props.push({ name: "encounter", value: reference(encounterFullUrl) });

  // ORC-9 → authoredOn, only for a new order (ORC-1 = NW). authoredOn is a `dateTime` (date-only ok).
  if (orc !== undefined && orc.field(1).value === "NW" && orc.field(9).value !== "") {
    const authored = toFhirDateTime(orc.field(9).asTs(), ctx.options);
    issues.push(...authored.issues);
    if (authored.value !== undefined)
      props.push({ name: "authoredOn", value: primitive(authored.value) });
  }

  const dosage = buildDosageInstruction(rxo, rxr, ctx, issues);
  if (dosage !== undefined) props.push({ name: "dosageInstruction", value: list([dosage]) });

  const dispense = buildDispenseRequest(rxo, ctx, issues);
  if (dispense !== undefined) props.push({ name: "dispenseRequest", value: dispense });

  return { value: complex(props), issues };
}

/**
 * RXO (+ RXR route) → FHIR `MedicationRequest`: the pharmacy-order request,
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
 * | RXR-1 Route (CWE) | `dosageInstruction.route` | {@link ROUTE_VALUE_MAP} (HL70162, value-translated) |
 * | RXR-2 Site (CWE) | `dosageInstruction.site` | {@link SITE_VALUE_MAP} (HL70550, value-translated) |
 * | RXR-4 Method (CWE) | `dosageInstruction.method` | {@link toFhirCodeableConcept} (structural: SNOMED target, BYO) |
 * | RXO-9 Allow Substitutions (CWE) | `substitution.allowedCodeableConcept` | {@link SUBSTITUTION_VALUE_MAP} (HL70161) |
 * | ORC-9 Date/Time of Order Event | `authoredOn` | {@link toFhirDateTime}, *IF ORC-1 = `NW`* |
 * | TQ1-3 Repeat Pattern (RPT) | `dosageInstruction.timing` | {@link readTq1} (RPT[Timing], all-or-nothing) |
 * | TQ1-7 / TQ1-8 Start / End date-time | `dosageInstruction.timing.repeat.boundsPeriod.start`/`.end` | {@link readTq1} |
 * | TQ1-10 Condition text (TX) | `dosageInstruction.additionalInstruction.text` | verbatim |
 * | TQ1-11 Text instruction (TX) | `text` (a `Narrative`, `status` `additional`) | verbatim, XML-escaped |
 * | (order message context) | `intent` = `order` | see below |
 * | (message-map wiring) | `subject` / `encounter` | the bundle's Patient / Encounter |
 *
 * **Fail-safes (never a confident wrong medication order).**
 * - **`medication[x]` (required 1..1).** Emitted as `medicationCodeableConcept` from RXO-1 only; a
 *   pharmacy order with no give code has nothing to prescribe and is not built (`{ value: undefined }`).
 *   The ingredient/strength paths (RXO-5/18/19/25/26 → a *contained* `Medication` with `ingredient`)
 *   and `medicationReference` are deferred, not fabricated.
 * - **`status` (required 1..1) = `unknown` + flag.** Unlike `ServiceRequest`, the IG ships **no**
 *   status source for `MedicationRequest` at all: there is no RXO→status row and no orc-to-
 *   medicationrequest map, and the `request-status` codes HL70119 yields (`revoked`, …) are **not**
 *   valid `medicationrequest-status` codes, so borrowing that table would emit invalid FHIR. Rather
 *   than guess a clinical state, `status` is set to the value-set's own `unknown` (an honest
 *   "not known", asserting nothing) and flagged {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}.
 * - **`intent` (required 1..1) = `order`.** The IG maps RXO → `intent` `equivalent` with no value
 *   ConceptMap; the ORM_O01 family is an *order* message, so `intent` is fixed to `order` from that
 *   message context: a resource-level constant, not a fabricated per-code row (as for `ServiceRequest`).
 * - **Dose/dispense units.** Carried through {@link quantityFromRawMagnitude}: a magnitude is
 *   precision-exact (string-backed `decimal`, never rescaled), and a non-UCUM unit is preserved
 *   verbatim in `.unit` with `.code`/`.system` absent + flagged, and a UCUM code is never fabricated.
 * - **Route/site value translation.** RXR-1 route → {@link ROUTE_VALUE_MAP} (HL70162: a
 *   41-code identity group into `v2-0162` plus a 6-code remap into `v3-RouteOfAdministration`,
 *   namely `IM→IM`, `SC→SQ`, …) and RXR-2 site → {@link SITE_VALUE_MAP} (HL70550: 443-code identity into
 *   `v2-0550`). Both are additive: the derived target coding is added and the raw coding preserved; a
 *   code outside the table is preserved + flagged, never coerced. RXR-4 method's IG target is SNOMED CT
 *   (encumbered, **not bundled**), so method stays structurally carried (BYO), never SNOMED-translated.
 * - **The schedule is fully grounded or absent and flagged.** TQ1-3 becomes at most **one**
 *   `dosageInstruction.timing`, and only over the RPT components {@link readTq1} can ground; any
 *   component, schedule-narrowing TQ1 field, unresolvable bound, inverted period, or second TQ1
 *   withholds the whole `Timing` and raises a value-free issue naming what caused it. A partially
 *   built timing is the one failure mode that matters here: it reads to the receiving system as a
 *   complete dosing instruction, and a wrong frequency is a dosing error no re-run undoes.
 * - **The two free-text rows go to two different places, and neither is `dosageInstruction.text`.**
 *   The IG maps TQ1-10 to `dosageInstruction.additionalInstruction.text` and TQ1-11 to the
 *   resource's own `text` narrative; it targets `dosageInstruction.text` from nothing at all, so
 *   nothing is written there. Both carry the sender's words verbatim and both survive a refused
 *   timing: a "with food" that arrived is still true when the frequency could not be grounded.
 *   Verbatim is the whole field including a trailing delimiter, and **only a valued field is
 *   written**: a row the wire says carries nothing (absent, or the HL7 explicit null `""`) puts no
 *   text on the resource and no marker in its place.
 * - **Substitution.** RXO-9 → `substitution.allowedCodeableConcept` via
 *   {@link SUBSTITUTION_VALUE_MAP} (HL70161 `N`/`G`/`T` identity into `v2-0161`). A valued RXO-9 the map
 *   has no target for is flagged and the **substitution backbone is withheld**: a substitution
 *   permission (whether the pharmacist may swap the drug) is never emitted from an unrecognized code.
 *
 * **`RXE` is out of scope by grounding, not omission.** The STU1 IG ships no `RXE` segment map and no
 * `RDE`/`RGV` message map; the assembler flags any `RXE` rather than mapping it here (an RXE layout is
 * never guessed from the RXO map: the field positions differ).
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
import {
  codeableConceptFromTarget,
  toFhirCodeableConceptVia,
  translateBound,
  ROUTE_VALUE_MAP,
  SITE_VALUE_MAP,
  SUBSTITUTION_VALUE_MAP,
  type CodedValueMap,
} from "../terminology/concept-map.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";
import { narrative, type Tq1Reading } from "./tq1-timing.js";

/** The `medicationrequest-status` code emitted when the IG grounds no status (an honest "not known"). */
const STATUS_UNKNOWN = "unknown";
/** The `medicationrequest Intent` code fixed for order-message requests (see the module fail-safe note). */
const ORDER_INTENT = "order";
/** A FHIR `unsignedInt` lexical form: `0` or a leading-non-zero positive integer (no sign, no leading zero). */
const UNSIGNED_INT = /^(0|[1-9][0-9]*)$/;

/**
 * Build a `dosageInstruction.method` CodeableConcept from RXR-4 **structurally** (no value translation).
 * The IG maps RXR-4 → method via `table-hl70165-to-sct`, whose target is **SNOMED CT**: license-
 * encumbered and **not bundled**. So the code is carried structurally (system recognized if the
 * CWE declares one, else flagged) and the SNOMED translation is left BYO, never fabricated here.
 */
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

/** Value-translate an RXR CWE field to a CodeableConcept via a license-clean {@link CodedValueMap}. */
function translatedFrom(
  seg: Segment,
  index: number,
  map: CodedValueMap,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (seg.field(index).value === "") return undefined;
  const cc = toFhirCodeableConceptVia(seg.field(index).asCwe(), map, ctx);
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

/**
 * Build the single `dosageInstruction` (TQ1 additional instruction + timing, then route/site/method
 * and the dose range), or `undefined` when nothing grounds one. The TQ1 parts lead because that is
 * the R4 `Dosage` element order; when the order carries no TQ1 they are simply absent and the
 * remaining elements keep exactly the shape and order the RXO/RXR path has always produced.
 */
function buildDosageInstruction(
  rxo: Segment | undefined,
  rxr: Segment | undefined,
  tq1: Tq1Reading | undefined,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const props: { name: string; value: FhirNode }[] = [];

  if (tq1?.conditionText !== undefined) {
    // TQ1-10 → additionalInstruction[0].text, verbatim. Emitted whether or not a timing was.
    props.push({
      name: "additionalInstruction",
      value: list([complex([{ name: "text", value: primitive(tq1.conditionText) }])]),
    });
  }
  if (tq1?.timing !== undefined) {
    props.push({ name: "timing", value: tq1.timing });
  }

  if (rxr !== undefined) {
    // RXR-1 route / RXR-2 site are value-translated via the license-clean HL70162 / HL70550 maps.
    const route = translatedFrom(rxr, 1, ROUTE_VALUE_MAP, ctx, issues);
    if (route !== undefined) props.push({ name: "route", value: route });
    const site = translatedFrom(rxr, 2, SITE_VALUE_MAP, ctx, issues);
    if (site !== undefined) props.push({ name: "site", value: site });
    // RXR-4 method stays structural (its IG target is SNOMED CT: encumbered, BYO; see codeableFrom).
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
 * its opening `ORC`. Returns `{ value: undefined }` when RXO-1 (the give code) is absent: a
 * medication request with no `medication[x]` cannot be emitted.
 *
 * @param rxo - The `RXO` `@cosyte/hl7` `Segment` (the pharmacy order detail).
 * @param rxr - The first `RXR` route `Segment` beneath the order, when present.
 * @param orc - The `ORC` `Segment` that opened the order, when present (supplies `authoredOn`).
 * @param tq1 - What the order's `TQ1` occurrences grounded ({@link readTq1}), when it carries any.
 * @param subjectFullUrl - The bundle's Patient fullUrl → `MedicationRequest.subject` (required 1..1).
 * @param encounterFullUrl - The bundle's Encounter fullUrl → `MedicationRequest.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const rxo = parseHL7(raw).segments("RXO")[0];
 * // const { value } = buildMedicationRequest(rxo, undefined, undefined, undefined, "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildMedicationRequest(
  rxo: Segment | undefined,
  rxr: Segment | undefined,
  orc: Segment | undefined,
  tq1: Tq1Reading | undefined,
  subjectFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // The TQ1 diagnostics are raised whatever becomes of the request: a refused schedule is news even
  // when the order turns out to have no give code to prescribe.
  if (tq1 !== undefined) issues.push(...tq1.issues);

  // RXO-1 → medicationCodeableConcept (required 1..1). Absent → nothing emittable.
  if (rxo === undefined || rxo.field(1).value === "") return { value: undefined, issues };
  const medication = toFhirCodeableConcept(rxo.field(1).asCwe(), ctx);
  issues.push(...medication.issues);
  if (medication.value === undefined) return { value: undefined, issues };

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("MedicationRequest") },
  ];

  // TQ1-11 → text (DomainResource.text, which precedes the resource's own elements in R4). The
  // sender's instruction verbatim inside an XHTML div, never placed in dosageInstruction.text.
  if (tq1?.instructionText !== undefined) {
    props.push({ name: "text", value: narrative(tq1.instructionText) });
  }

  // status (required) = unknown: the IG grounds no MedicationRequest status; an honest "not known".
  props.push({ name: "status", value: primitive(STATUS_UNKNOWN) });
  issues.push(
    issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "RXO", "MedicationRequest.status"),
  );

  // intent (required) = order: the order-message context, not a per-code translation.
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

  const dosage = buildDosageInstruction(rxo, rxr, tq1, ctx, issues);
  if (dosage !== undefined) props.push({ name: "dosageInstruction", value: list([dosage]) });

  const dispense = buildDispenseRequest(rxo, ctx, issues);
  if (dispense !== undefined) props.push({ name: "dispenseRequest", value: dispense });

  // RXO-9 → substitution.allowedCodeableConcept (HL70161 → v2-0161; value-translated, translate-or-
  // withhold). Only N/G/T carry a target; a valued RXO-9 the map has no target for is flagged and the
  // substitution backbone is withheld rather than emitted with a fabricated substitution permission.
  const cwe9 = rxo.field(9).asCwe();
  if (cwe9.identifier !== undefined && cwe9.identifier !== "") {
    // translateBound withholds a translation for a foreign coding system (CWE.3 ≠ HL70161) too, not
    // just an unmapped code: a substitution permission is never asserted from a non-v2-0161 code.
    const target = translateBound(cwe9, SUBSTITUTION_VALUE_MAP);
    if (target === undefined) {
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_CODE_UNMAPPED,
          "RXO.9",
          "MedicationRequest.substitution.allowedCodeableConcept",
        ),
      );
    } else {
      props.push({
        name: "substitution",
        value: complex([
          {
            name: "allowedCodeableConcept",
            value: codeableConceptFromTarget(target, cwe9.originalText),
          },
        ]),
      });
    }
  }

  return { value: complex(props), issues };
}

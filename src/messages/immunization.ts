/**
 * VXU_V04 → FHIR `Immunization`: the thin IG single for immunization administration,
 * grounded firsthand on the IG **VXU_V04 message map** and the **RXA/RXR/ORC → Immunization**
 * segment maps (`hl7.fhir.uv.v2mappings`, STU1; `ConceptMap-message-vxu-v04-to-bundle.json`,
 * `ConceptMap-segment-rxa-to-immunization.json`, `ConceptMap-segment-rxr-to-immunization.json`,
 * `ConceptMap-segment-orc-to-immunization.json`). Per the VXU message map, **each `ORC` creates an
 * `Immunization`** and the `RXA` (+ `RXR` route) in the same order group are *incorporated into it*, so
 * one builder consumes all three; the order-group `OBX`s become standalone patient `Observation`s
 * (`Observation[2]` in the IG bundle), handled by the assembler.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | RXA-5 Administered Code (CE) | `vaccineCode` (required 1..1) | {@link toFhirCodeableConcept} (structural, no IG value map) |
 * | RXA-3 Date/Time Start of Administration (DTM) | `occurrenceDateTime` (required, occurrence[x]) | {@link toFhirDateTime} |
 * | RXA-20 Completion Status + RXA-21 Action Code | `status` (required 1..1) | {@link buildStatus} (HL70322 + IG assignments) |
 * | RXA-6 Administered Amount + RXA-7 Units | `doseQuantity` | {@link quantityFromRawMagnitude} |
 * | RXA-15 Substance Lot Number (ST) | `lotNumber` | verbatim |
 * | RXA-16 Substance Expiration Date (DT) | `expirationDate` (a `date`) | {@link toFhirDateTime}, date-only |
 * | RXA-18 Substance/Treatment Refusal Reason (CWE) | `statusReason` | {@link toFhirCodeableConcept} |
 * | RXA-19 Indication (CWE) | `reasonCode` | {@link toFhirCodeableConcept} |
 * | RXA-22 System Entry Date/Time (DTM) | `recorded` | {@link toFhirDateTime} (ORC-9 fallback) |
 * | RXR-1 Route (CWE) | `route` | {@link ROUTE_VALUE_MAP} (HL70162, value-translated) |
 * | RXR-2 Administration Site (CWE) | `site` | {@link SITE_VALUE_MAP} (HL70550, value-translated) |
 * | ORC-2 / ORC-3 Placer/Filler Order Number | `identifier` (PLAC / FILL) | {@link orderIdentifier} |
 * | ORC-9 Date/Time of Order Event | `recorded` (fallback) | {@link toFhirDateTime} |
 * | (message-map wiring) | `patient` (required 1..1) / `encounter` | the bundle's Patient / Encounter |
 *
 * **Fail-safes (never a confident wrong immunization record).**
 * - **`status` (required 1..1).** The IG ships **three conditioned status rows** (verified firsthand
 *   against `ConceptMap-segment-rxa-to-immunization.json`): **RXA-21 = "D"** (delete) → the IG-assigned
 *   `entered-in-error`; **RXA-20 not valued and RXA-21 ≠ "D"** → the IG-assigned `completed`; **RXA-20
 *   valued and RXA-21 ≠ "D"** → translated via {@link IMMUNIZATION_STATUS_MAP} (the HL70322 →
 *   event-status ConceptMap, whose targets `completed`/`not-done` are all valid `immunization-status`
 *   members). A **valued** RXA-20 the HL70322 map has no target for is flagged
 *   {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}, `status` left absent, and the required-`status` emit gate
 *   **withholds** the Immunization, never guessed, never coerced.
 * - **`vaccineCode` (required 1..1) + `occurrence[x]` (required 1..1) + `patient` (required 1..1).** An
 *   absent RXA-5, RXA-3, or bundle Patient leaves the resource missing a required element, so it is
 *   withheld by the emit gate rather than emitted incomplete.
 * - **Dose.** RXA-6/RXA-7 → `doseQuantity` via {@link quantityFromRawMagnitude}: precision-exact magnitude,
 *   non-UCUM unit preserved verbatim with `.code`/`.system` absent + flagged, never a fabricated UCUM code.
 * - **Route/site value translation.** RXR-1 route → {@link ROUTE_VALUE_MAP} (HL70162) and
 *   RXR-2 site → {@link SITE_VALUE_MAP} (HL70550) are value-translated additively (derived target coding
 *   added, raw coding preserved); a code outside the table is preserved + flagged, never coerced.
 * - **`vaccineCode` is NOT value-translated: by grounding, not omission.** RXA-5 has **no** `mappedVia`
 *   value ConceptMap in the IG's RXA→Immunization segment map (verified firsthand), so the code (typically
 *   CVX) is carried **structurally** (system recognized, value preserved): a translation is never
 *   invented for it.
 *
 * Deferred and flagged elsewhere, not silently mapped: RXA-10 performer, RXA-17 manufacturer, RXA-27/28
 * location, ORC-12 performer (all need Practitioner/Organization/Location resources this library does not
 * build).
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { quantityFromRawMagnitude } from "../datatypes/quantity.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import type { ConvertResult } from "../diagnostics/result.js";
import {
  toFhirCodeableConceptVia,
  ROUTE_VALUE_MAP,
  SITE_VALUE_MAP,
  type CodedValueMap,
} from "../terminology/concept-map.js";
import type { TransformContext } from "../terminology/context.js";
import { orderIdentifier, reference } from "./reference.js";

/**
 * HL7 v2 Table 0322 (Completion Status) → FHIR `Immunization.status`, per the IG **Table HL70322 to
 * Event Status** ConceptMap (each `is equivalent to`). Table 0322 has exactly these **four** source
 * codes and every one carries a target; the two distinct targets (`completed`, `not-done`) are both
 * valid members of the `immunization-status` required binding, so applying this map to
 * `Immunization.status` is faithful. Consulted only for a **valued** RXA-20 when **RXA-21 ≠ "D"** (the
 * IG's `mappedVia` condition on that row); the two other IG status rows assign fixed values directly (a
 * delete → `entered-in-error`, an unvalued RXA-20 → `completed`) and do not consult this map. See
 * {@link buildStatus}.
 */
export const IMMUNIZATION_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  CP: "completed",
  PA: "completed",
  RE: "not-done",
  NA: "not-done",
});

/** One VXU order group: an optional `ORC` anchor, its `RXA` administration, and the first `RXR` route. */
export interface ImmunizationGroup {
  /** The `ORC` segment that opened the order (supplies identifiers + a fallback `recorded`), if any. */
  readonly orc: Segment | undefined;
  /** The `RXA` administration segment: the Immunization's clinical core (vaccine, dose, status). */
  readonly rxa: Segment;
  /** The first `RXR` route/site segment beneath the administration, when present. */
  readonly rxr: Segment | undefined;
}

interface MutableImmGroup {
  orc: Segment | undefined;
  rxa: Segment | undefined;
  rxr: Segment | undefined;
}

/**
 * Group a VXU message's `ORC`/`RXA`/`RXR` segments into immunization order groups. Per the VXU_V04
 * message map an `ORC` opens the order and the following `RXA` (+ `RXR`) is incorporated; an `RXA`
 * with no preceding open group anchors its own group (a bare administration). Only groups that carry
 * an `RXA` are returned: an `ORC` with no `RXA` has no vaccine to immunize and is dropped.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { groups } = collectImmunizationGroups(parseHL7(raw));
 * // groups[0]?.rxa; groups[0]?.rxr; groups[0]?.orc;
 * ```
 */
export function collectImmunizationGroups(msg: Hl7Message): readonly ImmunizationGroup[] {
  const groups: MutableImmGroup[] = [];
  let current: MutableImmGroup | undefined;

  const open = (): MutableImmGroup => {
    const g: MutableImmGroup = { orc: undefined, rxa: undefined, rxr: undefined };
    groups.push(g);
    current = g;
    return g;
  };

  for (const seg of msg.allSegments()) {
    switch (seg.type) {
      case "ORC":
        open().orc = seg;
        break;
      case "RXA":
        // Incorporate into the current ORC-opened group when it has no RXA yet; else open a bare group.
        if (current === undefined || current.rxa !== undefined) open();
        (current as MutableImmGroup).rxa = seg;
        break;
      case "RXR":
        // First route only (Immunization.route is 0..1); ignored if the group has no administration.
        if (current !== undefined && current.rxa !== undefined && current.rxr === undefined) {
          current.rxr = seg;
        }
        break;
      default:
        break;
    }
  }

  return groups
    .filter((g): g is MutableImmGroup & { rxa: Segment } => g.rxa !== undefined)
    .map((g) => ({ orc: g.orc, rxa: g.rxa, rxr: g.rxr }));
}

/** Build `Immunization.status` from RXA-20/RXA-21 per the IG's three conditioned status rows. */
function buildStatus(rxa: Segment, issues: TransformIssue[]): string | undefined {
  const actionCode = rxa.field(21).value;
  // RXA-21 = "D" (delete): the IG assigns `status = "entered-in-error"` (the FHIR retraction state).
  if (actionCode === "D") return "entered-in-error";
  const completion = rxa.field(20).value;
  // RXA-20 not valued (and not a delete): the IG assigns `status = "completed"`.
  if (completion === "") return "completed";
  // RXA-20 valued: translate via HL70322 → event-status; a code with no target is flagged (the
  // resource is then withheld by the required-status emit gate), never guessed.
  const mapped = Object.hasOwn(IMMUNIZATION_STATUS_MAP, completion)
    ? IMMUNIZATION_STATUS_MAP[completion]
    : undefined;
  if (mapped === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "RXA.20", "Immunization.status"));
  }
  return mapped;
}

/**
 * Value-translate an RXR CWE field (route/site) to a CodeableConcept via a license-clean
 * {@link CodedValueMap} (HL70162 route / HL70550 site), additive and fail-safe; `undefined` when empty.
 */
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

/**
 * Build a FHIR `Immunization` resource node from a VXU order group's `RXA` (+ `RXR`, `ORC`). Returns
 * `{ value: undefined }` when RXA-5 (the vaccine code, required 1..1) is absent. `status`,
 * `occurrenceDateTime`, and `patient` are all required 1..1; when any cannot be grounded the resource is
 * left incomplete and later **withheld** by the conservative-emit gate, never guessed.
 *
 * @param rxa - The `RXA` `@cosyte/hl7` `Segment` (the administration).
 * @param rxr - The first `RXR` route/site `Segment` beneath the administration, when present.
 * @param orc - The `ORC` `Segment` that opened the order, when present (identifiers + `recorded` fallback).
 * @param patientFullUrl - The bundle's Patient fullUrl → `Immunization.patient` (required 1..1).
 * @param encounterFullUrl - The bundle's Encounter fullUrl → `Immunization.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const rxa = parseHL7(raw).segments("RXA")[0];
 * // const { value } = buildImmunization(rxa!, undefined, undefined, "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildImmunization(
  rxa: Segment,
  rxr: Segment | undefined,
  orc: Segment | undefined,
  patientFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];

  // RXA-5 → vaccineCode (required 1..1). Absent → nothing emittable.
  if (rxa.field(5).value === "") return { value: undefined, issues };
  const vaccineCode = toFhirCodeableConcept(rxa.field(5).asCwe(), ctx);
  issues.push(...vaccineCode.issues);
  if (vaccineCode.value === undefined) return { value: undefined, issues };

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Immunization") },
  ];

  // ORC-2 / ORC-3 → identifier (PLAC / FILL, v2-0203 types).
  if (orc !== undefined) {
    const identifiers = [
      orderIdentifier(orc.field(2).value, "PLAC"),
      orderIdentifier(orc.field(3).value, "FILL"),
    ].filter((i): i is FhirComplex => i !== undefined);
    if (identifiers.length > 0) props.push({ name: "identifier", value: list(identifiers) });
  }

  // RXA-20/RXA-21 → status (required 1..1). Absent/unmapped → left absent (emit gate withholds).
  const status = buildStatus(rxa, issues);
  if (status !== undefined) props.push({ name: "status", value: primitive(status) });

  props.push({ name: "vaccineCode", value: vaccineCode.value });

  // patient / encounter → the bundle's Patient / Encounter (message-map reference wiring).
  if (patientFullUrl !== undefined)
    props.push({ name: "patient", value: reference(patientFullUrl) });
  if (encounterFullUrl !== undefined)
    props.push({ name: "encounter", value: reference(encounterFullUrl) });

  // RXA-3 → occurrenceDateTime (required, occurrence[x]). Absent → emit gate withholds.
  if (rxa.field(3).value !== "") {
    const occurrence = toFhirDateTime(rxa.field(3).asTs(), ctx.options);
    issues.push(...occurrence.issues);
    if (occurrence.value !== undefined)
      props.push({ name: "occurrenceDateTime", value: primitive(occurrence.value) });
  }

  // RXA-22 → recorded (a dateTime; date-only ok), falling back to ORC-9 when RXA-22 is unvalued.
  const recordedTs =
    rxa.field(22).value !== ""
      ? rxa.field(22).asTs()
      : orc !== undefined && orc.field(9).value !== ""
        ? orc.field(9).asTs()
        : undefined;
  if (recordedTs !== undefined) {
    const recorded = toFhirDateTime(recordedTs, ctx.options);
    issues.push(...recorded.issues);
    if (recorded.value !== undefined)
      props.push({ name: "recorded", value: primitive(recorded.value) });
  }

  // RXA-6 / RXA-7 → doseQuantity (magnitude precision-exact; non-UCUM unit preserved verbatim).
  const doseRaw = rxa.field(6).asNm().raw;
  if (doseRaw !== "") {
    const dose = quantityFromRawMagnitude(
      doseRaw,
      rxa.field(7).asCwe(),
      ctx,
      undefined,
      "RXA.6",
      "RXA.7",
    );
    issues.push(...dose.issues);
    if (dose.value !== undefined) props.push({ name: "doseQuantity", value: dose.value });
  }

  // RXA-15 → lotNumber (verbatim string).
  if (rxa.field(15).value !== "")
    props.push({ name: "lotNumber", value: primitive(rxa.field(15).value) });

  // RXA-16 → expirationDate (a FHIR `date`): emit only a date-precision value; a value carrying a
  // time-of-day is not a valid `date` and is dropped + flagged rather than truncated silently.
  if (rxa.field(16).value !== "") {
    const exp = toFhirDateTime(rxa.field(16).asTs(), ctx.options);
    issues.push(...exp.issues);
    if (exp.value !== undefined && !exp.value.includes("T")) {
      props.push({ name: "expirationDate", value: primitive(exp.value) });
    } else if (exp.value !== undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "RXA.16", "Immunization.expirationDate"),
      );
    }
  }

  // RXA-18 → statusReason; RXA-19 → reasonCode.
  if (rxa.field(18).value !== "") {
    const reason = toFhirCodeableConcept(rxa.field(18).asCwe(), ctx);
    issues.push(...reason.issues);
    if (reason.value !== undefined) props.push({ name: "statusReason", value: reason.value });
  }
  if (rxa.field(19).value !== "") {
    const indication = toFhirCodeableConcept(rxa.field(19).asCwe(), ctx);
    issues.push(...indication.issues);
    if (indication.value !== undefined)
      props.push({ name: "reasonCode", value: list([indication.value]) });
  }

  // RXR-1 → route (HL70162); RXR-2 → site (HL70550), both value-translated via their license-clean maps.
  if (rxr !== undefined) {
    const route = translatedFrom(rxr, 1, ROUTE_VALUE_MAP, ctx, issues);
    if (route !== undefined) props.push({ name: "route", value: route });
    const site = translatedFrom(rxr, 2, SITE_VALUE_MAP, ctx, issues);
    if (site !== undefined) props.push({ name: "site", value: site });
  }

  return { value: complex(props), issues };
}

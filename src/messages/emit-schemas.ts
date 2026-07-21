/**
 * Minimal R4 **required-cardinality** schemas for the resource types this phase emits, so the
 * conservative-emit gate ({@link ../messages/to-fhir.js}) actually catches a structurally-invalid
 * resource rather than waving it through.
 *
 * `@cosyte/fhir.validateResource` models only `Patient` out of the box; every other resource type
 * degrades to a base-elements schema and validates as `valid` regardless of its own required
 * elements. These schemas restore the R4 required (`min: 1`) elements for the types we produce, and
 * the gate applies them in **lenient** mode — so a *missing required* element is an error (the
 * resource is withheld), while the resource's other (unmodeled-here) elements are warnings, never a
 * false rejection. Grounded on the FHIR R4 resource definitions:
 *
 * - **Encounter**: `status` (1..1 code) and `class` (1..1 Coding) are both required.
 * - **MessageHeader**: `event[x]` (1..1) is required; we only ever emit the `eventCoding` form, so a
 *   header with no `eventCoding` (MSH-9 without a trigger event) is withheld rather than shipped
 *   without its mandatory event.
 * - **RelatedPerson**: `patient` (1..1 Reference) is required (defence-in-depth; the assembler only
 *   builds a RelatedPerson when a Patient exists to anchor it).
 * - **DiagnosticReport**: `status` (1..1 code) and `code` (1..1 CodeableConcept) are both required — so
 *   a report from an unmapped/absent OBR-25 result status (no `status`) is withheld, never guessed.
 * - **Observation**: `status` (1..1 code) and `code` (1..1 CodeableConcept) are both required — so a
 *   result from an unmapped/absent OBX-11 status (no `status`) is withheld, never emitted as `final`.
 * - **ServiceRequest**: `status` (1..1 code), `intent` (1..1 code), and `subject` (1..1 Reference) are
 *   all required — so an order whose `status` could not be grounded via HL70119 (or whose Patient was
 *   withheld) is withheld, never emitted with a guessed status or a dangling subject.
 * - **MedicationRequest**: `status` (1..1 code), `intent` (1..1 code), `subject` (1..1 Reference), and
 *   `medication[x]` (1..1) are all required; the assembler only ever emits the `medicationCodeableConcept`
 *   form, so it is required here — a pharmacy order with no give code (no `medication[x]`) is withheld.
 *
 * @packageDocumentation
 */

import { UNBOUNDED, type ResourceSchema } from "@cosyte/fhir";

/** The required-cardinality schemas the emit gate applies (lenient) to the non-`Patient` resources. */
export const EMIT_SCHEMAS: readonly ResourceSchema[] = Object.freeze([
  {
    type: "Encounter",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      class: { min: 1, max: 1, types: ["Coding"] },
    },
  },
  {
    type: "MessageHeader",
    elements: {
      eventCoding: { min: 1, max: 1, types: ["Coding"] },
    },
  },
  {
    type: "RelatedPerson",
    elements: {
      patient: { min: 1, max: 1, types: ["Reference"] },
    },
  },
  {
    type: "DiagnosticReport",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      code: { min: 1, max: 1, types: ["CodeableConcept"] },
    },
  },
  {
    type: "Observation",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      code: { min: 1, max: 1, types: ["CodeableConcept"] },
    },
  },
  {
    type: "ServiceRequest",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      intent: { min: 1, max: 1, types: ["code"] },
      subject: { min: 1, max: 1, types: ["Reference"] },
    },
  },
  {
    type: "MedicationRequest",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      intent: { min: 1, max: 1, types: ["code"] },
      subject: { min: 1, max: 1, types: ["Reference"] },
      medicationCodeableConcept: { min: 1, max: 1, types: ["CodeableConcept"] },
    },
  },
  {
    // Immunization: status (1..1 code), vaccineCode (1..1 CodeableConcept), patient (1..1 Reference), and
    // occurrence[x] (1..1) are all required — the assembler only ever emits the occurrenceDateTime form, so
    // it is required here. An RXA with no groundable status/vaccine/occurrence, or no bundle Patient, is
    // withheld rather than emitted incomplete.
    type: "Immunization",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      vaccineCode: { min: 1, max: 1, types: ["CodeableConcept"] },
      patient: { min: 1, max: 1, types: ["Reference"] },
      occurrenceDateTime: { min: 1, max: 1, types: ["dateTime"] },
    },
  },
  {
    // Appointment: status (1..1 code) and participant (1..* BackboneElement) are both required — an
    // Appointment whose SCH-25 status could not be grounded via HL70278, or that has no resolvable Patient
    // participant, is withheld rather than emitted with a guessed status or no participant.
    type: "Appointment",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      participant: { min: 1, max: UNBOUNDED, types: ["BackboneElement"] },
    },
  },
  {
    // DocumentReference: status (1..1 code) and content (1..* BackboneElement) are both required — a
    // reference whose TXA-19 is not "AV" (no groundable status), or that carries no document body from its
    // OBX segments, is withheld rather than emitted with a guessed status or referencing nothing.
    type: "DocumentReference",
    elements: {
      status: { min: 1, max: 1, types: ["code"] },
      content: { min: 1, max: UNBOUNDED, types: ["BackboneElement"] },
    },
  },
]);

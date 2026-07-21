/**
 * NK1 → FHIR `RelatedPerson` — grounded on the IG **Segment NK1 to RelatedPerson** ConceptMap
 * (`hl7.fhir.uv.v2mappings`, STU1), verified firsthand:
 *
 * | NK1 field | FHIR target | via |
 * |---|---|---|
 * | NK1-2 Name (XPN) | `RelatedPerson.name` | {@link toFhirHumanName} (§4.4) |
 * | NK1-3 Relationship (CWE) | `RelatedPerson.relationship` | {@link toFhirCodeableConcept} (§4.3) |
 * | NK1-4 Address (XAD) | `RelatedPerson.address` | {@link toFhirAddress} (§4.5) |
 *
 * `RelatedPerson.patient` is FHIR-required (1..1); the message structure supplies it — it is wired to
 * the bundle's Patient, so a RelatedPerson is produced only when a Patient was. Deferred and flagged,
 * not silently mapped: NK1-5/6 telecom (no XTN→ContactPoint converter yet), NK1-15 gender, NK1-16
 * birthDate, NK1-20 communication language (not surfaced by the `@cosyte/hl7` next-of-kin view).
 *
 * @packageDocumentation
 */

import type { NextOfKin } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirHumanName } from "../datatypes/human-name.js";
import { toFhirAddress } from "../datatypes/address.js";
import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";

/**
 * Build a FHIR `RelatedPerson` resource node from a parsed HL7 v2 NK1 view. Always carries the
 * required `patient` reference to the bundle's Patient. Returns `{ value: undefined }` when the NK1
 * carried nothing beyond the patient link.
 *
 * @param nk1 - The `@cosyte/hl7` `NextOfKin` view (NK1-derived).
 * @param patientFullUrl - The `urn:uuid:` fullUrl of the bundle's Patient (required by FHIR).
 * @param ctx - The transform context; `ctx.namingSystem` resolves the relationship coding system.
 * @param setIndex - The 0-based NK1 repetition index, for value-free issue locations.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { value } = buildRelatedPerson(parseHL7(raw).nextOfKin()[0], "urn:uuid:1-2-3", {}, 0);
 * ```
 */
export function buildRelatedPerson(
  nk1: NextOfKin,
  patientFullUrl: string,
  ctx: TransformContext,
  setIndex: number,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const loc = `NK1[${String(setIndex)}]`;
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("RelatedPerson") },
    { name: "patient", value: reference(patientFullUrl) },
  ];

  let hasContent = false;

  // NK1-3 → RelatedPerson.relationship.
  if (nk1.relationship !== undefined) {
    const rel = toFhirCodeableConcept(nk1.relationship, ctx);
    issues.push(...rel.issues);
    if (rel.value !== undefined) {
      props.push({ name: "relationship", value: list([rel.value]) });
      hasContent = true;
    }
  }

  // NK1-2 → RelatedPerson.name.
  if (nk1.name !== undefined) {
    const name = toFhirHumanName(nk1.name);
    issues.push(...name.issues);
    if (name.value !== undefined) {
      props.push({ name: "name", value: list([name.value]) });
      hasContent = true;
    }
  }

  // NK1-4 → RelatedPerson.address.
  if (nk1.address !== undefined) {
    const address = toFhirAddress(nk1.address);
    issues.push(...address.issues);
    if (address.value !== undefined) {
      props.push({ name: "address", value: list([address.value]) });
      hasContent = true;
    }
  }

  // NK1-5/6 → RelatedPerson.telecom is deferred (no XTN→ContactPoint converter yet); flag the drop.
  if (nk1.phone !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `${loc}.5`, "RelatedPerson.telecom"));
  }

  if (!hasContent) return { value: undefined, issues };
  return { value: complex(props), issues };
}

/**
 * PID → FHIR `Patient` — grounded on the IG **Segment PID to Patient** ConceptMap
 * (`hl7.fhir.uv.v2mappings`, STU1). The field→element rows used here, verified firsthand against the
 * published map:
 *
 * | PID field | FHIR target | via |
 * |---|---|---|
 * | PID-3 Patient Identifier List (CX) | `Patient.identifier` | {@link toFhirIdentifier} (§4.2) |
 * | PID-5 Patient Name (XPN) | `Patient.name` | {@link toFhirHumanName} (§4.4) |
 * | PID-7 Date/Time of Birth (DTM) | `Patient.birthDate` | {@link toFhirDateTime} reduced to a `date` |
 * | PID-8 Administrative Sex (CWE) | `Patient.gender` | {@link ADMINISTRATIVE_GENDER_MAP} (Table 0001) |
 * | PID-11 Patient Address (XAD) | `Patient.address` | {@link toFhirAddress} (§4.5) |
 *
 * Fail-safe throughout: each datatype conversion carries its own value-free issues, an unmapped
 * administrative-sex code leaves `gender` absent (never guessed), and a birth *time* (PID-7 with a
 * time-of-day) is dropped to `date` precision with a flag — the US Core `patient-birthTime` extension
 * is a profile concern (Phase 8). Deferred and flagged, not silently mapped: PID-13/14 telecom (no
 * XTN→ContactPoint converter until a later phase), and PID-10/15/22/29/30 (US Core race/ethnicity
 * extensions, communication language, deceased) — see the "last verified" note in the repo doc.
 *
 * @packageDocumentation
 */

import type { Patient } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirIdentifier } from "../datatypes/identifier.js";
import { toFhirHumanName } from "../datatypes/human-name.js";
import { toFhirAddress } from "../datatypes/address.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";

/**
 * HL7 v2 Table 0001 (Administrative Sex) → FHIR `administrative-gender`, exactly per the IG
 * **Table HL70001 to Administrative Gender** ConceptMap (every row "is equivalent to"). `A`
 * (Ambiguous) and `N` (Not applicable) both narrow to `other` — the map's stated equivalence, carried
 * as-is. A code absent here (the map defines no `unmapped` default) leaves `gender` absent and is
 * flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED} — never coerced to `unknown`.
 */
export const ADMINISTRATIVE_GENDER_MAP: Readonly<Record<string, string>> = Object.freeze({
  F: "female",
  M: "male",
  O: "other",
  U: "unknown",
  A: "other",
  N: "other",
});

/** Wrap present items as a FHIR list property value, or `undefined` when none are present. */
function listOrUndefined(items: readonly FhirComplex[]): FhirNode | undefined {
  return items.length === 0 ? undefined : list(items);
}

/**
 * Build a FHIR `Patient` resource node from a parsed HL7 v2 PID view. Returns `{ value: undefined }`
 * only when the PID carried nothing emittable at all.
 *
 * @param patient - The `@cosyte/hl7` `Patient` view (PID-derived).
 * @param ctx - The transform context; `ctx.namingSystem` resolves identifier assigning authorities.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { value } = buildPatient(parseHL7(raw).patient!, { namingSystem: createNamingSystem() });
 * ```
 */
export function buildPatient(patient: Patient, ctx: TransformContext): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Patient") },
  ];

  // PID-3 → Patient.identifier (each CX repetition, fail-safe on the assigning authority).
  const identifiers: FhirComplex[] = [];
  for (const cx of patient.identifiers) {
    const { value, issues: idIssues } = toFhirIdentifier(cx, ctx);
    issues.push(...idIssues);
    if (value !== undefined) identifiers.push(value);
  }
  const identifierList = listOrUndefined(identifiers);
  if (identifierList !== undefined) props.push({ name: "identifier", value: identifierList });

  // PID-5 → Patient.name (first repetition; additional repetitions are a later-phase concern).
  const name = toFhirHumanName(patient.name);
  issues.push(...name.issues);
  if (name.value !== undefined) props.push({ name: "name", value: list([name.value]) });

  // PID-8 → Patient.gender via Table 0001; unmapped → absent + flagged (never guessed).
  if (patient.sex !== undefined && patient.sex !== "") {
    const gender = Object.hasOwn(ADMINISTRATIVE_GENDER_MAP, patient.sex)
      ? ADMINISTRATIVE_GENDER_MAP[patient.sex]
      : undefined;
    if (gender === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "PID.8", "Patient.gender"));
    } else {
      props.push({ name: "gender", value: primitive(gender) });
    }
  }

  // PID-7 → Patient.birthDate. FHIR birthDate is a `date`; a birth time-of-day is dropped to date
  // precision (the birthTime extension is a Phase-8 profile concern) with a flag.
  if (patient.dateOfBirth !== undefined) {
    const dob = toFhirDateTime(patient.dateOfBirth, ctx.options);
    issues.push(...dob.issues);
    if (dob.value !== undefined) {
      const tIndex = dob.value.indexOf("T");
      if (tIndex === -1) {
        props.push({ name: "birthDate", value: primitive(dob.value) });
      } else {
        props.push({ name: "birthDate", value: primitive(dob.value.slice(0, tIndex)) });
        issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PID.7", "Patient.birthDate"));
      }
    }
  }

  // PID-11 → Patient.address (first repetition of the home address view).
  if (patient.address !== undefined) {
    const address = toFhirAddress(patient.address);
    issues.push(...address.issues);
    if (address.value !== undefined) props.push({ name: "address", value: list([address.value]) });
  }

  // PID-13/14 → Patient.telecom is deferred (no XTN→ContactPoint converter yet); flag the drop.
  if (patient.phoneNumbers.length > 0) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PID.13", "Patient.telecom"));
  }

  // Only `resourceType` present → nothing emittable.
  if (props.length === 1) return { value: undefined, issues };
  return { value: complex(props), issues };
}

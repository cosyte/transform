/**
 * PID → FHIR `Patient`, grounded on the IG **Segment PID to Patient** ConceptMap
 * (`hl7.fhir.uv.v2mappings`, STU1). The field→element rows used here, verified firsthand against the
 * published map:
 *
 * | PID field | FHIR target | via |
 * |---|---|---|
 * | PID-3 Patient Identifier List (CX) | `Patient.identifier` | {@link toFhirIdentifier} |
 * | PID-5 Patient Name (XPN) | `Patient.name` | {@link toFhirHumanName} |
 * | PID-7 Date/Time of Birth (DTM) | `Patient.birthDate` | {@link toFhirDateTime} reduced to a `date` |
 * | PID-8 Administrative Sex (CWE) | `Patient.gender` | {@link ADMINISTRATIVE_GENDER_MAP} (Table 0001) |
 * | PID-11 Patient Address (XAD) | `Patient.address` | {@link toFhirAddress} |
 *
 * Fail-safe throughout: each datatype conversion carries its own value-free issues, an unmapped
 * administrative-sex code leaves `gender` absent (never guessed), and a birth *time* (PID-7 with a
 * time-of-day) is dropped to `date` precision with a flag, because the US Core `patient-birthTime`
 * extension is a profile concern this library does not cover.
 *
 * Not mapped, and flagged: each of these fields that is valued raises one
 * {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} at `information` severity, located at its own
 * field: PID-10 race, PID-13 home and PID-14 business telecom (no XTN to ContactPoint converter),
 * PID-15 primary language, PID-19 SSN, PID-22 ethnic group, PID-29 death date and time and PID-30
 * death indicator. So a `Patient` built from a PID that records a death carries no `deceased[x]`
 * element, and the issues say that PID-29 or PID-30 was dropped. Read these fields from the parsed
 * message if you need them.
 *
 * Not mapped, and NOT flagged: every other PID field is dropped with no issue at all, and so are
 * repetitions of PID-5 and PID-11 after the first.
 *
 * @packageDocumentation
 */

import type { Field, Patient, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirIdentifier } from "../datatypes/identifier.js";
import { toFhirHumanName } from "../datatypes/human-name.js";
import { toFhirAddress } from "../datatypes/address.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { viewTimestampIssues } from "./view-timestamp.js";

/**
 * HL7 v2 Table 0001 (Administrative Sex) → FHIR `administrative-gender`, exactly per the IG
 * **Table HL70001 to Administrative Gender** ConceptMap (every row "is equivalent to"). `A`
 * (Ambiguous) and `N` (Not applicable) both narrow to `other`: the map's stated equivalence, carried
 * as-is. A code absent here (the map defines no `unmapped` default) leaves `gender` absent and is
 * flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}, never coerced to `unknown`.
 */
export const ADMINISTRATIVE_GENDER_MAP: Readonly<Record<string, string>> = Object.freeze({
  F: "female",
  M: "male",
  O: "other",
  U: "unknown",
  A: "other",
  N: "other",
});

/**
 * The PID fields `Patient` does not carry, each with the FHIR element the IG **Segment PID to
 * Patient** ConceptMap sends it to. PID-10 race and PID-22 ethnic group have no row in that map (the
 * US Core race and ethnicity extensions are a profile concern this library does not cover), so they
 * name no element. PID-13 and PID-14 wait on an XTN to ContactPoint converter, and PID-15, PID-19,
 * PID-29 and PID-30 on conversions not written yet. A valued field in this list raises one
 * {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} at its own location, never at a neighbour's.
 */
const PID_DROPPED_FIELDS: readonly {
  readonly field: number;
  readonly fhirPath?: string;
}[] = Object.freeze([
  { field: 10 },
  { field: 13, fhirPath: "Patient.telecom" },
  { field: 14, fhirPath: "Patient.telecom" },
  { field: 15, fhirPath: "Patient.communication.language" },
  { field: 19, fhirPath: "Patient.identifier" },
  { field: 22 },
  { field: 29, fhirPath: "Patient.deceasedDateTime" },
  { field: 30, fhirPath: "Patient.deceasedBoolean" },
]);

/**
 * Whether a field carries a value anywhere: in any repetition, component or subcomponent. An empty
 * field and the HL7 null `""` carry none.
 */
function isValued(field: Field): boolean {
  return (
    !field.isNull &&
    field.repetitions.some((rep) =>
      rep.components.some((component) => component.subcomponents.some((sub) => sub !== "")),
    )
  );
}

/** One {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} per valued field in {@link PID_DROPPED_FIELDS}. */
function droppedFieldIssues(pid: Segment): TransformIssue[] {
  return PID_DROPPED_FIELDS.filter(({ field }) => isValued(pid.field(field))).map(
    ({ field, fhirPath }) => issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `PID.${field}`, fhirPath),
  );
}

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
 * @param pid - The PID segment the view was read from, so a PID-7 the view could not read, and each
 *   valued field this map does not carry, is reported rather than lost; omit it and no such report
 *   is made.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { value } = buildPatient(parseHL7(raw).patient!, { namingSystem: createNamingSystem() });
 * ```
 */
export function buildPatient(
  patient: Patient,
  ctx: TransformContext,
  pid?: Segment,
): ConvertResult<FhirComplex> {
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
  issues.push(...viewTimestampIssues(patient.dateOfBirth, pid, 7, "PID.7", "Patient.birthDate"));

  // PID-11 → Patient.address (first repetition of the home address view).
  if (patient.address !== undefined) {
    const address = toFhirAddress(patient.address);
    issues.push(...address.issues);
    if (address.value !== undefined) props.push({ name: "address", value: list([address.value]) });
  }

  // The PID fields this map does not carry: each valued one is flagged at its own field.
  if (pid !== undefined) issues.push(...droppedFieldIssues(pid));

  // Only `resourceType` present → nothing emittable.
  if (props.length === 1) return { value: undefined, issues };
  return { value: complex(props), issues };
}

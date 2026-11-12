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
 * | PID-35 Species Code (CWE) | the `patient-animal` extension's `species` | {@link toFhirCodeableConcept} |
 * | PID-36 Breed Code (CWE) | the `patient-animal` extension's `breed` | {@link toFhirCodeableConcept} |
 *
 * The two animal rows are not read from the IG's map. They follow the FHIR R4 core definition of
 * the `patient-animal` extension (`http://hl7.org/fhir/StructureDefinition/patient-animal`), whose
 * own v2 mapping column names PID-35 for `species` and "PID-35 (where more detailed value is
 * present)" for `breed`; v2 itself gives breed its own field, PID-36 Breed Code, so breed is read
 * from PID-36. The extension requires `species` (1..1), so a breed with no species is not written.
 * Its third part, `genderStatus`, is never written: the core definition's v2 mapping gives it no
 * field (N/A), and PID-8 administrative sex does not say whether an animal is neutered.
 *
 * Fail-safe throughout: each datatype conversion carries its own value-free issues, an unmapped
 * administrative-sex code leaves `gender` absent (never guessed), and a birth *time* (PID-7 with a
 * time-of-day) is dropped to `date` precision with a flag, because the US Core `patient-birthTime`
 * extension is a profile concern this library does not cover.
 *
 * Not mapped, and flagged: each of these fields that is valued raises one
 * {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} at `information` severity, located at its own
 * field: PID-10 race, PID-13 home and PID-14 business telecom (no XTN to ContactPoint converter),
 * PID-15 primary language, PID-19 SSN, PID-22 ethnic group, PID-29 death date and time, PID-30
 * death indicator, and the animal fields PID-37 strain and PID-38 production class. So a `Patient`
 * built from a PID that records a death carries no `deceased[x]` element, and the issues say that
 * PID-29 or PID-30 was dropped; a veterinary PID likewise loses its strain and production class
 * with an issue for each. Read these fields from the parsed message if you need them.
 *
 * PID-35 species and PID-36 breed are flagged the same way, at their own field, only when a value
 * cannot be carried: a CWE with no code and no text, a breed with no species to sit beside, or a
 * repetition after the first (the extension holds one species and one breed).
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
import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
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
 * PID-29 and PID-30 on conversions not written yet. PID-37 strain and PID-38 production class name
 * no element either: FHIR R4 `Patient` has no element for an animal (it moved to an extension), and
 * that extension has no part for either. PID-35 and PID-36 are carried by {@link animalExtension}
 * instead. A valued field in this list raises one
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
  { field: 37 },
  { field: 38 },
]);

/**
 * Whether a field carries a value anywhere: in any repetition, component or subcomponent. An empty
 * field and the HL7 null `""` carry none.
 */
function isValued(field: Field): boolean {
  return !field.isNull && field.repetitions.some(isRepetitionValued);
}

/** Whether one repetition of a field carries a value in any component or subcomponent. */
function isRepetitionValued(rep: Field["repetitions"][number]): boolean {
  return rep.components.some((component) => component.subcomponents.some((sub) => sub !== ""));
}

/**
 * The canonical URL of the FHIR R4 core extension that carries an animal patient's species and
 * breed (STU3's `Patient.animal`, moved to an extension in R4).
 */
const PATIENT_ANIMAL_EXTENSION_URL = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/** The `fhirPath` a dropped PID-35 or PID-36 names: the part of the extension it would have filled. */
function animalPath(part: "species" | "breed"): string {
  return `Patient.extension[patient-animal].extension[${part}]`;
}

/**
 * One part of the `patient-animal` extension from a CWE field: the field's first repetition as a
 * `valueCodeableConcept`. A value it cannot carry is flagged at the field, never lost: a CWE with no
 * code and no text writes nothing, and a valued repetition after the first is not written.
 */
function animalPart(
  pid: Segment,
  field: 35 | 36,
  part: "species" | "breed",
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const raw = pid.field(field);
  if (!isValued(raw)) return undefined;
  const concept = toFhirCodeableConcept(raw.asCwe(), ctx);
  const laterRepetitionValued = raw.repetitions.slice(1).some(isRepetitionValued);
  if (concept.value === undefined || laterRepetitionValued) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, `PID.${field}`, animalPath(part)));
  }
  if (concept.value === undefined) return undefined;
  issues.push(...concept.issues);
  return complex([
    { name: "url", value: primitive(part) },
    { name: "valueCodeableConcept", value: concept.value },
  ]);
}

/**
 * The `patient-animal` extension from PID-35 species and PID-36 breed, or `undefined` when there is
 * no species to write. The extension requires `species`, so a breed is written only beside one; a
 * valued breed with no species is flagged at PID-36 and its CWE is not converted. `genderStatus` is
 * never written.
 */
function animalExtension(
  pid: Segment,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const species = animalPart(pid, 35, "species", ctx, issues);
  if (species === undefined) {
    if (isValued(pid.field(36))) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PID.36", animalPath("breed")));
    }
    return undefined;
  }
  const breed = animalPart(pid, 36, "breed", ctx, issues);
  return complex([
    { name: "url", value: primitive(PATIENT_ANIMAL_EXTENSION_URL) },
    { name: "extension", value: list(breed === undefined ? [species] : [species, breed]) },
  ]);
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

  // PID-35 species and PID-36 breed -> the patient-animal extension, written first as FHIR orders
  // `extension` ahead of a resource's own elements. genderStatus is never inferred from PID-8.
  const animal = pid === undefined ? undefined : animalExtension(pid, ctx, issues);
  if (animal !== undefined) props.splice(1, 0, { name: "extension", value: list([animal]) });

  // Only `resourceType` present → nothing emittable.
  if (props.length === 1) return { value: undefined, issues };
  return { value: complex(props), issues };
}

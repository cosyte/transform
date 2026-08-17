/**
 * FHIR `Patient` to a v2 message carrying a `PID` segment: the inverse of the IG **Segment PID to
 * Patient** ConceptMap, over the rows whose inverse is defensible.
 *
 * | FHIR element | PID field | inverse |
 * |---|---|---|
 * | `Patient.identifier` | PID-3 (CX) | value to CX.1, caller-vetted authority to CX.4, Table 0203 type to CX.5 |
 * | `Patient.name` | PID-5 (XPN) | family/given/prefix/suffix to XPN.1-XPN.5, `use` to XPN.7 where the HL70200 map inverts |
 * | `Patient.birthDate` | PID-7 (DTM) | lexical date, precision preserved |
 * | `Patient.gender` | PID-8 | Table 0001 where the map inverts (`female`/`male`/`unknown`) |
 * | `Patient.address` | PID-11 (XAD) | line/city/state/postalCode/country/district, `use` to XAD.7 where HL70190 inverts |
 *
 * **This is the lossy direction, and it says so rather than papering over it.** The published map is
 * v2 to FHIR; several of its rows are many-to-one, so the inverse is ambiguous and is refused:
 * `gender` `other` (Table 0001 `O`, `A` and `N` all mean it), name use `official` (`L` and `R`) and
 * `temp` (`NAV` and `TEMP`), address use `work` (`B` and `O`), and every `Address.type`
 * (`M` and `SH` both mean `postal`). Each leaves its v2 field absent and raises
 * {@link ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE}. Nothing here reconstructs a v2 message that was
 * transformed to FHIR: it writes what the FHIR resource itself supports, and flags the rest.
 *
 * @packageDocumentation
 */

import type { FhirComplex, FhirNode } from "@cosyte/fhir";
import type { RawField } from "@cosyte/hl7";

import { ADDRESS_USE_MAP } from "../datatypes/address.js";
import { NAME_USE_MAP } from "../datatypes/human-name.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import { ADMINISTRATIVE_GENDER_MAP } from "../messages/patient.js";
import { V2_0203_SYSTEM } from "../terminology/naming-system.js";
import {
  codeInSystem,
  reverseContext,
  type ReverseContext,
  type ReverseOptions,
} from "./coding.js";
import {
  emitMessage,
  flagUnmapped,
  hasTrigger,
  readResource,
  type RequiredV2Field,
  type ReverseResult,
  type ReverseShape,
} from "./message.js";
import { at, readComplexes, readString, readStrings } from "./read.js";
import { invertCodeMap, v2Date, v2Field, type V2Components } from "./v2.js";

/**
 * FHIR `administrative-gender` to HL7 v2 Table 0001, the invertible rows of the IG's **HL70001 to
 * Administrative Gender** map. `other` is absent on purpose: three source codes carry it.
 *
 * @example
 * ```ts
 * import { GENDER_TO_V2 } from "@cosyte/transform";
 * GENDER_TO_V2["female"]; // => "F"
 * GENDER_TO_V2["other"]; // => undefined (ambiguous inverse, flagged instead)
 * ```
 */
export const GENDER_TO_V2: Readonly<Record<string, string>> =
  invertCodeMap(ADMINISTRATIVE_GENDER_MAP);

/**
 * FHIR `name-use` to HL7 v2 Table 0200, the invertible rows of the IG's **HL70200 to name-use** map.
 * `official` and `temp` are absent on purpose: two source codes each.
 *
 * @example
 * ```ts
 * import { NAME_USE_TO_V2 } from "@cosyte/transform";
 * NAME_USE_TO_V2["maiden"]; // => "M"
 * ```
 */
export const NAME_USE_TO_V2: Readonly<Record<string, string>> = invertCodeMap(NAME_USE_MAP);

/**
 * FHIR `address-use` to HL7 v2 Table 0190, the invertible rows of the IG's **HL70190 to
 * address-use** map. `work` is absent on purpose (`B` and `O`), as is every `Address.type` row.
 *
 * @example
 * ```ts
 * import { ADDRESS_USE_TO_V2 } from "@cosyte/transform";
 * ADDRESS_USE_TO_V2["home"]; // => "H"
 * ```
 */
export const ADDRESS_USE_TO_V2: Readonly<Record<string, string>> = invertCodeMap(ADDRESS_USE_MAP);

/** The `Patient` elements this map carries into PID. */
const PATIENT_MAPPED: ReadonlySet<string> = new Set([
  "resourceType",
  "identifier",
  "name",
  "birthDate",
  "gender",
  "address",
]);

// The PID rows whose v2.5.1 usage is `R`, and ONLY those two. PID-1 is `O`, PID-2
// and PID-4 are `B` (retained for backward compatibility, not required), and
// PID-6, PID-7, PID-8 and PID-11 are `O`, so none of them is declared here even
// though this map writes three of them: declaring an optional field as required
// would be a false diagnostic on a clinical field. Read the grounding banner above
// `RequiredV2Field` in `message.ts` before adding a row to this list.
/** The PID fields v2.5.1 requires, with the `Patient` element this map sources each from. */
const PID_REQUIRED: readonly RequiredV2Field[] = [
  // PID-3 Patient Identifier List, v2.5.1 item 00106.
  { position: 3, location: "PID.3", fhirPath: "Patient.identifier" },
  // PID-5 Patient Name, v2.5.1 item 00108.
  { position: 5, location: "PID.5", fhirPath: "Patient.name" },
];

/** What `toV2Patient` emits: an `ADT` message carrying a `PID`, whose required fields are above. */
const PATIENT_SHAPE: ReverseShape = {
  messageCode: "ADT",
  segment: "PID",
  resourceName: "Patient",
  required: PID_REQUIRED,
};

/** `Patient` elements with a known PID home this narrow map does not implement. */
const PATIENT_UNMAPPED: Readonly<Record<string, string>> = Object.freeze({
  telecom: "PID.13",
  communication: "PID.15",
  maritalStatus: "PID.16",
  multipleBirthBoolean: "PID.24",
  multipleBirthInteger: "PID.25",
  deceasedDateTime: "PID.29",
  deceasedBoolean: "PID.30",
  contact: "NK1",
});

/** A code's inverse, or `undefined` plus a flag when the governing map does not invert it. */
function invertible(
  inverse: Readonly<Record<string, string>>,
  code: string,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): string | undefined {
  if (Object.hasOwn(inverse, code)) return inverse[code];
  issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE, location, fhirPath));
  return undefined;
}

/** One `Identifier` as CX components, or `undefined` when it carries no value to key on. */
function identifierComponents(
  identifier: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): V2Components | undefined {
  const value = readString(at(identifier, "value"), "CX.1", "Patient.identifier.value", issues);
  if (value === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_NO_V2_TARGET, "CX.1", "Patient.identifier"));
    return undefined;
  }
  // CX.4 is an assigning authority, and no algorithm turns a system URI into one: only a
  // caller-vetted namespace is written, and an unseeded system is flagged, never synthesized.
  const system = readString(at(identifier, "system"), "CX.4", "Patient.identifier.system", issues);
  let namespace: string | undefined;
  if (system !== undefined) {
    namespace = ctx.namespaceFor(system);
    if (namespace === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_NO_V2_TARGET, "CX.4", "Patient.identifier.system"));
    }
  }
  const typeConcept = readComplexes(
    at(identifier, "type"),
    "CX.5",
    "Patient.identifier.type",
    issues,
  )[0];
  const typeCode =
    typeConcept === undefined
      ? undefined
      : codeInSystem(typeConcept, V2_0203_SYSTEM, "CX.5", "Patient.identifier.type", issues);
  return [value, undefined, undefined, namespace, typeCode];
}

/** One `HumanName` as XPN components. */
function nameComponents(name: FhirComplex, issues: TransformIssue[]): V2Components {
  const family = readString(at(name, "family"), "XPN.1", "Patient.name.family", issues);
  const given = readStrings(at(name, "given"), "XPN.2", "Patient.name.given", issues);
  const prefix = readStrings(at(name, "prefix"), "XPN.5", "Patient.name.prefix", issues);
  const suffix = readStrings(at(name, "suffix"), "XPN.4", "Patient.name.suffix", issues);
  const use = readString(at(name, "use"), "XPN.7", "Patient.name.use", issues);

  // XPN carries one further-given component, one prefix and one suffix: extras would have to be
  // joined or dropped, and both alter the name, so they are flagged and left out.
  if (given.length > 2) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "XPN.3", "Patient.name.given"),
    );
  }
  if (prefix.length > 1) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "XPN.5", "Patient.name.prefix"),
    );
  }
  if (suffix.length > 1) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "XPN.4", "Patient.name.suffix"),
    );
  }
  const nameType =
    use === undefined
      ? undefined
      : invertible(NAME_USE_TO_V2, use, "XPN.7", "Patient.name.use", issues);
  return [family, given[0], given[1], suffix[0], prefix[0], undefined, nameType];
}

/** One `Address` as XAD components. */
function addressComponents(address: FhirComplex, issues: TransformIssue[]): V2Components {
  const line = readStrings(at(address, "line"), "XAD.1", "Patient.address.line", issues);
  const city = readString(at(address, "city"), "XAD.3", "Patient.address.city", issues);
  const state = readString(at(address, "state"), "XAD.4", "Patient.address.state", issues);
  const postal = readString(
    at(address, "postalCode"),
    "XAD.5",
    "Patient.address.postalCode",
    issues,
  );
  const country = readString(at(address, "country"), "XAD.6", "Patient.address.country", issues);
  const district = readString(at(address, "district"), "XAD.9", "Patient.address.district", issues);
  const use = readString(at(address, "use"), "XAD.7", "Patient.address.use", issues);
  const type = readString(at(address, "type"), "XAD.7", "Patient.address.type", issues);

  if (line.length > 2) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "XAD.2", "Patient.address.line"),
    );
  }
  const addressType =
    use === undefined
      ? undefined
      : invertible(ADDRESS_USE_TO_V2, use, "XAD.7", "Patient.address.use", issues);
  // FHIR splits use (home/work) from type (postal/physical); XAD.7 is one code, and the IG's
  // address-type rows are many-to-one, so a type is always flagged rather than merged into XAD.7.
  if (type !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_NOT_INVERTIBLE, "XAD.7", "Patient.address.type"));
  }
  return [line[0], line[1], city, state, postal, country, addressType, undefined, district];
}

/** Every PID field this map produces, keyed by HL7 field position. */
function pidFields(
  patient: FhirComplex,
  ctx: ReverseContext,
  issues: TransformIssue[],
): ReadonlyMap<number, RawField> {
  const fields = new Map<number, RawField>();

  const identifiers: V2Components[] = [];
  for (const identifier of readComplexes(
    at(patient, "identifier"),
    "PID.3",
    "Patient.identifier",
    issues,
  )) {
    const components = identifierComponents(identifier, ctx, issues);
    if (components !== undefined) identifiers.push(components);
  }
  const pid3 = v2Field(identifiers);
  if (pid3 !== undefined) fields.set(3, pid3);

  const names = readComplexes(at(patient, "name"), "PID.5", "Patient.name", issues).map((name) =>
    nameComponents(name, issues),
  );
  const pid5 = v2Field(names);
  if (pid5 !== undefined) fields.set(5, pid5);

  const birthDate = readString(at(patient, "birthDate"), "PID.7", "Patient.birthDate", issues);
  if (birthDate !== undefined) {
    const dtm = v2Date(birthDate);
    if (dtm === undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, "PID.7", "Patient.birthDate"),
      );
    } else {
      const pid7 = v2Field([[dtm]]);
      if (pid7 !== undefined) fields.set(7, pid7);
    }
  }

  const gender = readString(at(patient, "gender"), "PID.8", "Patient.gender", issues);
  const sex =
    gender === undefined
      ? undefined
      : invertible(GENDER_TO_V2, gender, "PID.8", "Patient.gender", issues);
  const pid8 = sex === undefined ? undefined : v2Field([[sex]]);
  if (pid8 !== undefined) fields.set(8, pid8);

  const addresses = readComplexes(at(patient, "address"), "PID.11", "Patient.address", issues).map(
    (address) => addressComponents(address, issues),
  );
  const pid11 = v2Field(addresses);
  if (pid11 !== undefined) fields.set(11, pid11);

  return fields;
}

/**
 * Convert a FHIR R4 `Patient` into a **complete** v2 message carrying a `PID` segment, for the
 * demographics-only trigger events (`A28`, `A31`, `A29`, ...) that carry a patient with no visit.
 *
 * The `trigger` argument is **required and never inferred**: no `Patient` element maps to a v2
 * message trigger, so the caller supplies it, and a missing, empty or non-string one returns
 * `{ value: undefined }` plus {@link ISSUE_CODES.TRANSFORM_MISSING_TRIGGER} without calling the
 * message builder at all. It is used verbatim as MSH-9.2 under the `ADT` message code this shape
 * fixes; the caller never supplies the code and it never varies per call.
 *
 * Lossy by design and never round-trip-safe: a value the inverse of the IG map cannot ground is
 * flagged and left absent, never guessed, and a resource of another type is refused outright.
 *
 * A `PID` field v2 requires (PID-3 Patient Identifier List, PID-5 Patient Name) that this resource
 * gives no source for stays absent and is declared with
 * {@link ISSUE_CODES.TRANSFORM_V2_REQUIRED_FIELD_ABSENT}: the emitted message is honest about what
 * it lacks rather than padded to look conformant. A `Patient` that grounds no `PID` field at all
 * yields no message and {@link ISSUE_CODES.TRANSFORM_NO_V2_MESSAGE_EMITTED}.
 *
 * @param resource - The FHIR `Patient` node (build one with `@cosyte/fhir`'s `parseResource`).
 * @param trigger - The bare v2 trigger, e.g. `"A28"`. Required; never derived from the resource.
 * @param options - Caller-vetted reverse context: assigning authorities, code systems, MSH envelope.
 * @example
 * ```ts
 * import { parseResource } from "@cosyte/fhir";
 * import { toV2Patient } from "@cosyte/transform";
 *
 * const { resource } = parseResource('{"resourceType":"Patient","gender":"female"}');
 * const { value, issues } = toV2Patient(resource, "A28");
 * // value.toString() starts "MSH|^~\\&|" and carries "ADT^A28" in MSH-9, then a PID segment
 * void value;
 * void issues;
 * ```
 */
export function toV2Patient(
  resource: FhirNode,
  trigger: string,
  options: ReverseOptions = {},
): ReverseResult {
  const issues: TransformIssue[] = [];
  const triggerOk = hasTrigger(trigger, issues);
  const patient = readResource(resource, "Patient", "PID", issues);
  if (!triggerOk || patient === undefined) return { value: undefined, issues };

  flagUnmapped(patient, PATIENT_MAPPED, PATIENT_UNMAPPED, "Patient", "PID", issues);
  const ctx = reverseContext(options);
  const fields = pidFields(patient, ctx, issues);
  const value = emitMessage(PATIENT_SHAPE, trigger, fields, ctx, issues);
  return { value, issues };
}

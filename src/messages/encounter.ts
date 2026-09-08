/**
 * PV1 → FHIR `Encounter`, grounded on the IG **Segment PV1 to Encounter** ConceptMap plus the two
 * **Table HL70004** ConceptMaps (to V3 ActCode, and to Encounter Status), all verified firsthand
 * against the published `hl7.fhir.uv.v2mappings` STU1 maps:
 *
 * | PV1 field | FHIR target | condition / via |
 * |---|---|---|
 * | PV1-2 Patient Class | `Encounter.class` (Coding) | Table 0004 → V3 ActCode ({@link ENCOUNTER_CLASS_V3_MAP}); the self-mapped classes stay in v2-0004 |
 * | PV1-2 Patient Class | `Encounter.status` (code) | Table 0004 → Encounter Status ({@link ENCOUNTER_STATUS_MAP}), *only IF PV1-45 not valued* |
 * | PV1-19 Visit Number | `Encounter.identifier` (type `VN`) | v2-0203 identifier-type system |
 * | PV1-44 Admit Date/Time | `Encounter.period.start` | {@link toFhirDateTime} |
 * | PV1-45 Discharge Date/Time | `Encounter.period.end` + `status = finished` | {@link toFhirDateTime} |
 *
 * Fail-safe: an unmapped patient class leaves `Encounter.class` absent and flags
 * {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED} (never coerced); `Encounter.subject` is wired to the
 * bundle's Patient (the identity anchor) and omitted only when no valid Patient was produced.
 * Deferred and flagged, not silently mapped: PV1-3 location (Reference(Location), no Location resource
 * is built), PV1-7/8 attending/referring doctor (Reference(Practitioner), no Practitioner resource
 * is built).
 *
 * @packageDocumentation
 */

import type { Visit } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { V2_0203_SYSTEM } from "../terminology/naming-system.js";
import { coding, reference } from "./reference.js";

/** The v3 ActCode canonical system (FHIR `Encounter.class` binding). */
const V3_ACTCODE_SYSTEM = "http://terminology.hl7.org/CodeSystem/v3-ActCode";
/** The HL7 v2 Table 0004 (Patient Class) canonical system, for classes with no v3 ActCode row. */
const V2_0004_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0004";

/**
 * HL7 v2 Table 0004 (Patient Class) → FHIR v3 ActCode (`Encounter.class`), per the IG **Table HL70004
 * to V3 ActCode** ConceptMap (each "is equivalent to"). Only these four v2 classes have a v3 ActCode
 * equivalent; the remaining classes (R/B/C/N/U) map to themselves and stay in the v2-0004 system
 * ({@link V2_0004_SYSTEM}) per the same map's V2→V2 rows.
 */
export const ENCOUNTER_CLASS_V3_MAP: Readonly<Record<string, { code: string; display: string }>> =
  Object.freeze({
    E: { code: "EMER", display: "emergency" },
    I: { code: "IMP", display: "inpatient encounter" },
    O: { code: "AMB", display: "ambulatory" },
    P: { code: "PRENC", display: "pre-admission" },
  });

/** The v2-0004 classes the IG maps to themselves (no v3 ActCode equivalent). */
const V2_SELF_CLASSES: ReadonlySet<string> = new Set(["R", "B", "C", "N", "U"]);

/**
 * HL7 v2 Table 0004 (Patient Class) → FHIR `Encounter.status`, per the IG **Table HL70004 to
 * Encounter Status** ConceptMap. Applied only when PV1-45 (discharge date) is *not* valued: a valued
 * discharge sets `status = finished` per the PV1→Encounter map.
 */
export const ENCOUNTER_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  E: "in-progress",
  I: "in-progress",
  O: "in-progress",
  R: "in-progress",
  B: "in-progress",
  C: "in-progress",
  N: "in-progress",
  P: "planned",
  U: "unknown",
});

/** Build `Encounter.class` from PV1-2, or `undefined` (+ push an issue) when it cannot be mapped. */
function buildClass(
  patientClass: string | undefined,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (patientClass === undefined || patientClass === "") return undefined;
  const v3 = ENCOUNTER_CLASS_V3_MAP[patientClass];
  if (v3 !== undefined) return coding(V3_ACTCODE_SYSTEM, v3.code, v3.display);
  if (V2_SELF_CLASSES.has(patientClass)) return coding(V2_0004_SYSTEM, patientClass);
  // Unknown patient-class code, never coerced to a neighbor; class left absent and flagged.
  issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "PV1.2", "Encounter.class"));
  return undefined;
}

/**
 * Build a FHIR `Encounter` resource node from a parsed HL7 v2 PV1 view.
 *
 * @param visit - The `@cosyte/hl7` `Visit` view (PV1-derived).
 * @param subjectFullUrl - The `urn:uuid:` fullUrl of the bundle's Patient, or `undefined` when none
 *   was produced (then `Encounter.subject` is omitted and flagged).
 * @param ctx - The transform context (carries the timezone policy for the period).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { value } = buildEncounter(parseHL7(raw).visit!, "urn:uuid:1-2-3", {});
 * ```
 */
export function buildEncounter(
  visit: Visit,
  subjectFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Encounter") },
  ];

  // PV1-19 → Encounter.identifier (type VN, v2-0203).
  if (visit.visitNumber !== undefined && visit.visitNumber !== "") {
    const vnCoding = complex([
      { name: "system", value: primitive(V2_0203_SYSTEM) },
      { name: "code", value: primitive("VN") },
    ]);
    const identifier = complex([
      { name: "type", value: complex([{ name: "coding", value: list([vnCoding]) }]) },
      { name: "value", value: primitive(visit.visitNumber) },
    ]);
    props.push({ name: "identifier", value: list([identifier]) });
  }

  // PV1-2 / PV1-45 → Encounter.status. A valued discharge means "finished"; else Table 0004 status.
  const discharged = visit.dischargeDateTime !== undefined;
  let status: string | undefined;
  if (discharged) {
    status = "finished";
  } else if (visit.patientClass !== undefined && visit.patientClass !== "") {
    status = Object.hasOwn(ENCOUNTER_STATUS_MAP, visit.patientClass)
      ? ENCOUNTER_STATUS_MAP[visit.patientClass]
      : undefined;
    if (status === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "PV1.2", "Encounter.status"));
    }
  }
  if (status !== undefined) props.push({ name: "status", value: primitive(status) });

  // PV1-2 → Encounter.class (Table 0004 → V3 ActCode; self-mapped classes stay in v2-0004).
  const encounterClass = buildClass(visit.patientClass, issues);
  if (encounterClass !== undefined) props.push({ name: "class", value: encounterClass });

  // Encounter.subject → the bundle's Patient (the message map's reference wiring).
  if (subjectFullUrl !== undefined) {
    props.push({ name: "subject", value: reference(subjectFullUrl) });
  } else {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PID", "Encounter.subject"));
  }

  // PV1-44 / PV1-45 → Encounter.period.start / .end.
  const periodProps: { name: string; value: FhirNode }[] = [];
  if (visit.admitDateTime !== undefined) {
    const start = toFhirDateTime(visit.admitDateTime, ctx.options);
    issues.push(...start.issues);
    if (start.value !== undefined)
      periodProps.push({ name: "start", value: primitive(start.value) });
  }
  if (visit.dischargeDateTime !== undefined) {
    const end = toFhirDateTime(visit.dischargeDateTime, ctx.options);
    issues.push(...end.issues);
    if (end.value !== undefined) periodProps.push({ name: "end", value: primitive(end.value) });
  }
  if (periodProps.length > 0) props.push({ name: "period", value: complex(periodProps) });

  // Deferred, flagged: PV1-3 location, PV1-7/8 doctors need Location/Practitioner resources.
  if (visit.location !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PV1.3", "Encounter.location"));
  }
  if (visit.attendingDoctor !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PV1.7", "Encounter.participant"));
  }
  if (visit.referringDoctor !== undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "PV1.8", "Encounter.participant"));
  }

  if (props.length === 1) return { value: undefined, issues };
  return { value: complex(props), issues };
}

/**
 * The same Encounter carrying one `diagnosis` entry per Condition the bundle holds, per the ADT_A01
 * message map's `Encounter[1].diagnosis.reference = Condition[1].id` row. Each entry's `condition`
 * points at that Condition's `fullUrl`, so the link resolves inside the bundle.
 *
 * Applied after the diagnoses are built, because the Encounter joins the bundle before them and the
 * produced nodes are immutable: this returns a new node rather than mutating the emitted one.
 *
 * @param encounter - The Encounter node already in the bundle.
 * @param conditionFullUrls - The fullUrls of the Conditions emitted for the same message, in order.
 * @example
 * ```ts
 * // withEncounterDiagnosis(encounter, ["urn:uuid:cond-1"]); // adds one diagnosis entry
 * ```
 */
export function withEncounterDiagnosis(
  encounter: FhirComplex,
  conditionFullUrls: readonly string[],
): FhirComplex {
  if (conditionFullUrls.length === 0) return encounter;
  const entries = conditionFullUrls.map((url) =>
    complex([{ name: "condition", value: reference(url) }]),
  );
  return complex([
    ...encounter.properties.filter((p) => p.name !== "diagnosis"),
    { name: "diagnosis", value: list(entries) },
  ]);
}

/**
 * The Encounter that should replace the emitted one once the message's diagnoses exist: the same
 * resource carrying the back-references, put through the conservative-emit gate first. When the
 * gate refuses the linked draft the ORIGINAL Encounter is returned unchanged and the link is
 * declared {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}, so a detail never costs the visit.
 *
 * The gate is a parameter rather than a call into the assembler, so what "the gate refuses this"
 * means stays in one place and the refusal branch is reachable from a test without a hand-built
 * invalid resource: the same shape the allergy emit path uses.
 *
 * @param encounter - The Encounter node already in the bundle.
 * @param conditionFullUrls - The fullUrls of the Conditions emitted for the same message, in order.
 * @param gate - The conservative-emit predicate: `true` when the linked Encounter may replace it.
 * @example
 * ```ts
 * // emitEncounterDiagnosis(encounter, ["urn:uuid:cond-1"], () => true).value; // the linked one
 * ```
 */
export function emitEncounterDiagnosis(
  encounter: FhirComplex,
  conditionFullUrls: readonly string[],
  gate: (resource: FhirComplex) => boolean,
): ConvertResult<FhirComplex> {
  const linked = withEncounterDiagnosis(encounter, conditionFullUrls);
  if (linked === encounter || gate(linked)) return { value: linked, issues: [] };
  return {
    value: encounter,
    issues: [issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "DG1", "Encounter.diagnosis")],
  };
}

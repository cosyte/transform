/**
 * AL1 to FHIR `AllergyIntolerance`: the allergy an ADT states, carried into the bundle instead of
 * lost between the v2 feed and the FHIR record. Grounded firsthand on the IG **AL1 to
 * AllergyIntolerance** segment map and the **ADT_A01 to Bundle** message map
 * (`hl7.fhir.uv.v2mappings`, STU1; `ConceptMap-segment-al1-to-allergyintolerance.html`,
 * `ConceptMap-message-adt-a01-to-bundle.html`), which wires
 * `AllergyIntolerance.patient.reference` to the bundle's Patient and creates one resource per AL1.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | AL1 (fixed) | `clinicalStatus` (`active`) | the IG's own assignment for constraint ait-1 |
 * | AL1-2 Allergen Type Code (CWE) | `category` (0..*) | {@link ALLERGY_CATEGORY_VALUE_MAP} (HL70127) |
 * | AL1-2 Allergen Type Code (CWE) | `category.extension` alternate-codes | {@link ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP} (v2-0127 identity) |
 * | AL1-2 Allergen Type Code (CWE) | `type` (0..1) | {@link ALLERGY_TYPE_VALUE_MAP} (HL70127) |
 * | AL1-3 Allergen Code (CWE) | `code` | {@link toFhirCodeableConcept} (structural, no IG value map) |
 * | AL1-4 Allergy Severity Code (CWE) | `criticality` (0..1) | {@link ALLERGY_CRITICALITY_VALUE_MAP} (HL70128) |
 * | AL1-4 Allergy Severity Code (CWE) | `criticality.extension` alternate-codes | {@link ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP} (v2-0128 identity) |
 * | AL1-5 Allergy Reaction Code (ST) | `reaction.manifestation.text` | verbatim, one manifestation per repetition |
 * | AL1-6 Identification Date (DT) | `onsetDateTime` | {@link toFhirDateTime}, legacy versions only |
 * | (message-map wiring) | `patient` (required 1..1) | the bundle's Patient |
 *
 * **Fail-safes (never a confident wrong allergy).**
 * - **Two maps over one component, resolved independently.** The guide publishes a separate Table
 *   0127 map for `category` and for `type`, with different unmapped sets, so `MA` yields a type and
 *   **no category**. Neither answer is ever borrowed from the other map or from a neighbouring code:
 *   the element the map has no target for is omitted and flagged
 *   {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}.
 * - **The original code survives whatever the map does.** The IG makes the `alternate-codes`
 *   extension `1..1` wherever AL1-2 or AL1-4 is valued, so the code the sender wrote is carried in
 *   its own v2 code system even when the translating map had no target for it. An unmapped category
 *   is therefore a `category` element with the extension and no code value, not an absent one.
 * - **`criticality` is the only severity target.** `AllergyIntolerance.reaction.severity` is a LOCAL
 *   VARIATION in the guide, conditioned on a severity that was not used equivalently to criticality,
 *   which no message states. It is never populated here, so a `MO` or `U` severity leaves criticality
 *   absent and flagged rather than reappearing as a reaction grading the source never asserted.
 * - **An allergy names what it is to.** AL1-3 is the allergen. An AL1 that grounds no allergen code
 *   and no allergen text asserts an allergy without saying to what, so the resource is withheld and
 *   flagged {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} rather than emitted naming nothing.
 * - **AL1-6 is legacy input, never a live element.** The IG's own comment on that row reads
 *   "Withdrawn as of 2.7", so `onsetDateTime` is carried only for a message whose MSH-12 is readable
 *   and earlier than 2.7. A valued AL1-6 on any later, absent or unreadable version is dropped and
 *   flagged, never read as an onset the sender may not have meant.
 * - **A rejected extension costs the extension, not the allergy.** If the alternate-codes extension
 *   would make the resource fail the conservative-emit gate, the same resource is emitted without it
 *   and the drop is flagged, so a consumer keeps the allergy rather than losing it to a detail.
 *
 * Deferred and flagged elsewhere, not silently mapped: `IAM` (the guide's other allergy segment),
 * AL1-1 (the guide states it does not warrant mapping), and `verificationStatus`, which no AL1
 * component grounds.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import {
  toFhirCodeableConceptVia,
  translateBound,
  ALLERGY_CATEGORY_VALUE_MAP,
  ALLERGY_CRITICALITY_VALUE_MAP,
  ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP,
  ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP,
  ALLERGY_TYPE_VALUE_MAP,
  type CodedValueMap,
} from "../terminology/concept-map.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";

/**
 * The code system of the fixed `clinicalStatus` the IG assigns to every AllergyIntolerance built
 * from an AL1, transcribed from the segment map's own sort-order 0 row.
 *
 * @example
 * ```ts
 * import { ALLERGY_CLINICAL_STATUS_SYSTEM } from "@cosyte/transform";
 * ALLERGY_CLINICAL_STATUS_SYSTEM.endsWith("allergyintolerance-clinical"); // true
 * ```
 */
export const ALLERGY_CLINICAL_STATUS_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical";

/**
 * The fixed `clinicalStatus` code the IG assigns. The guide's own note explains why it is fixed
 * rather than derived: constraint ait-1 requires a clinicalStatus unless the verificationStatus is
 * `entered-in-error`, and no AL1 component can ground that retraction.
 *
 * @example
 * ```ts
 * import { ALLERGY_CLINICAL_STATUS_CODE } from "@cosyte/transform";
 * ALLERGY_CLINICAL_STATUS_CODE; // "active"
 * ```
 */
export const ALLERGY_CLINICAL_STATUS_CODE = "active";

/**
 * The canonical URL of the FHIR `alternate-codes` extension, the IG's fixed assignment for the
 * `category.extension.url` and `criticality.extension.url` rows.
 *
 * @example
 * ```ts
 * import { ALTERNATE_CODES_EXTENSION_URL } from "@cosyte/transform";
 * ALTERNATE_CODES_EXTENSION_URL; // "http://hl7.org/fhir/StructureDefinition/alternate-codes"
 * ```
 */
export const ALTERNATE_CODES_EXTENSION_URL =
  "http://hl7.org/fhir/StructureDefinition/alternate-codes";

/**
 * The HL7 v2 version at which AL1-6 Identification Date was withdrawn, per the IG map's own comment
 * on that row ("Withdrawn as of 2.7, Refer to IAM-11 Onset or IAM-13 Reported Date"). A message at
 * this version or later carries no AL1-6 that this library will read as an onset.
 *
 * @example
 * ```ts
 * import { AL1_ONSET_WITHDRAWN_AT } from "@cosyte/transform";
 * AL1_ONSET_WITHDRAWN_AT; // [2, 7]
 * ```
 */
export const AL1_ONSET_WITHDRAWN_AT: readonly number[] = Object.freeze([2, 7]);

/** A v2 version identifier this library will compare: dotted, numeric, nothing else. */
const READABLE_VERSION = /^\d+(?:\.\d+)*$/;

/**
 * Whether a message's MSH-12 version identifier is readable **and** earlier than the version at
 * which AL1-6 was withdrawn ({@link AL1_ONSET_WITHDRAWN_AT}).
 *
 * Fails closed in both directions a version can be unusable: an absent MSH-12 and one this library
 * cannot compare (a vendor string, an empty component, anything outside the dotted-numeric shape)
 * both answer `false`, so a valued AL1-6 is dropped and flagged rather than read as an onset on a
 * message that may never have meant one.
 *
 * @param version - The MSH-12 version identifier exactly as the parser published it.
 * @example
 * ```ts
 * import { carriesLegacyOnsetDate } from "@cosyte/transform";
 * carriesLegacyOnsetDate("2.5.1"); // true
 * carriesLegacyOnsetDate("2.7"); // false
 * carriesLegacyOnsetDate(undefined); // false
 * ```
 */
export function carriesLegacyOnsetDate(version: string | undefined): boolean {
  if (version === undefined || !READABLE_VERSION.test(version)) return false;
  const parts = version.split(".").map(Number);
  for (let i = 0; i < AL1_ONSET_WITHDRAWN_AT.length; i++) {
    const part = parts[i] ?? 0;
    const bound = AL1_ONSET_WITHDRAWN_AT[i] ?? 0;
    if (part !== bound) return part < bound;
  }
  // Equal on every component of the bound: 2.7 itself, and 2.7.1 with it.
  return false;
}

/**
 * Every `AL1` occurrence a message carries, in message order. One AllergyIntolerance is created per
 * occurrence, per the IG message map's `0..-1` cardinality on the AL1 row.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // collectAllergies(parseHL7(raw)).length; // one entry per AL1 in the message
 * ```
 */
export function collectAllergies(msg: Hl7Message): readonly Segment[] {
  return msg.allSegments().filter((seg) => seg.type === "AL1");
}

/** How much of the IG's AL1 mapping to carry: the alternate-codes extension is the one variable. */
export interface AllergyBuildOptions {
  /**
   * Whether to carry the IG's `alternate-codes` extension on `category` / `criticality`. Defaults to
   * `true`; the emit path builds a second draft with it off only when the first draft fails the
   * conservative-emit gate.
   */
  readonly carryAlternateCodes?: boolean;
}

/**
 * Build the IG's `alternate-codes` extension for a coded AL1 component, carrying the original v2
 * code through its identity ConceptMap, or `undefined` when the component grounds no coding at all.
 */
function alternateCodesExtension(
  seg: Segment,
  field: number,
  map: CodedValueMap,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const original = toFhirCodeableConceptVia(seg.field(field).asCwe(), map, ctx);
  issues.push(...original.issues);
  if (original.value === undefined) return undefined;
  return complex([
    { name: "url", value: primitive(ALTERNATE_CODES_EXTENSION_URL) },
    { name: "valueCodeableConcept", value: original.value },
  ]);
}

/**
 * Translate one coded AL1 component to a FHIR `code` primitive, carrying the alternate-codes
 * extension the IG puts beside it. Returns `undefined` only when the component grounds neither a
 * translated code nor an original one; an untranslated code still yields the extension, so what the
 * message said is never lost to a map that had no target for it.
 */
function translatedCodeElement(
  seg: Segment,
  field: number,
  targetMap: CodedValueMap,
  originalMap: CodedValueMap,
  carryAlternateCodes: boolean,
  v2Location: string,
  fhirPath: string,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  const extension = carryAlternateCodes
    ? alternateCodesExtension(seg, field, originalMap, ctx, issues)
    : undefined;
  const target = translateBound(seg.field(field).asCwe(), targetMap);
  if (target === undefined) {
    // No target in the map being applied: this element is omitted and flagged, never coerced to a
    // neighbouring value, and never resolved from the other map over the same source table.
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, v2Location, fhirPath));
  }
  if (target === undefined && extension === undefined) return undefined;
  return extension === undefined
    ? primitive(target?.code)
    : primitive(target?.code, { extension: [extension] });
}

/** Build `AllergyIntolerance.reaction` from the AL1-5 repetitions, or `undefined` when none. */
function buildReaction(al1: Segment): FhirNode | undefined {
  const manifestations = al1
    .field(5)
    .repetitions.map((rep) => rep.components[0]?.subcomponents[0] ?? "")
    .filter((text) => text !== "")
    .map((text) => complex([{ name: "text", value: primitive(text) }]));
  if (manifestations.length === 0) return undefined;
  return list([complex([{ name: "manifestation", value: list(manifestations) }])]);
}

/** Build `AllergyIntolerance.onsetDateTime` from AL1-6, per the withdrawn-field rule. */
function buildOnset(
  al1: Segment,
  version: string | undefined,
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirNode | undefined {
  if (al1.field(6).value === "") return undefined;
  if (!carriesLegacyOnsetDate(version)) {
    // Valued on a message at or after the withdrawal, or on one whose version cannot be read: the
    // field is legacy input only, so it is dropped and declared rather than read as an onset.
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "AL1.6", "AllergyIntolerance.onsetDateTime"),
    );
    return undefined;
  }
  const onset = toFhirDateTime(al1.field(6).asTs(), ctx.options);
  issues.push(...onset.issues);
  return onset.value === undefined ? undefined : primitive(onset.value);
}

/**
 * Build a FHIR `AllergyIntolerance` resource node from one `AL1` occurrence, wired to the bundle's
 * Patient. Returns `{ value: undefined }` when AL1-3 grounds no allergen code and no allergen text,
 * because an allergy that names no substance asserts one without saying to what.
 *
 * @param al1 - The `AL1` `@cosyte/hl7` `Segment`.
 * @param patientFullUrl - The bundle's Patient fullUrl, for `patient` (required 1..1).
 * @param version - The message's MSH-12 version identifier, which decides AL1-6 (see
 *   {@link carriesLegacyOnsetDate}).
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @param options - Whether to carry the IG's alternate-codes extension (see
 *   {@link AllergyBuildOptions}).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const al1 = parseHL7(raw).segments("AL1")[0];
 * // const { value } = buildAllergyIntolerance(al1!, "urn:uuid:pat", "2.5.1", {});
 * ```
 */
export function buildAllergyIntolerance(
  al1: Segment,
  patientFullUrl: string,
  version: string | undefined,
  ctx: TransformContext,
  options: AllergyBuildOptions = {},
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const carryAlternateCodes = options.carryAlternateCodes ?? true;

  // AL1-3 → code, the allergen itself. Nothing groundable here means nothing safe to emit.
  const allergen = toFhirCodeableConcept(al1.field(3).asCwe(), ctx);
  if (allergen.value === undefined) {
    return {
      value: undefined,
      issues: [
        ...allergen.issues,
        issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "AL1.3", "AllergyIntolerance.code"),
      ],
    };
  }
  issues.push(...allergen.issues);

  // AL1-2 → type and category, resolved against their two separate IG maps, independently.
  const allergenTypeValued = al1.field(2).value !== "";
  const type = allergenTypeValued
    ? translatedCodeElement(
        al1,
        2,
        ALLERGY_TYPE_VALUE_MAP,
        ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP,
        false,
        "AL1.2",
        "AllergyIntolerance.type",
        ctx,
        issues,
      )
    : undefined;
  const category = allergenTypeValued
    ? translatedCodeElement(
        al1,
        2,
        ALLERGY_CATEGORY_VALUE_MAP,
        ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP,
        carryAlternateCodes,
        "AL1.2",
        "AllergyIntolerance.category",
        ctx,
        issues,
      )
    : undefined;

  // AL1-4 → criticality. The reaction.severity local variation is deliberately not populated.
  const criticality =
    al1.field(4).value !== ""
      ? translatedCodeElement(
          al1,
          4,
          ALLERGY_CRITICALITY_VALUE_MAP,
          ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP,
          carryAlternateCodes,
          "AL1.4",
          "AllergyIntolerance.criticality",
          ctx,
          issues,
        )
      : undefined;

  const onset = buildOnset(al1, version, ctx, issues);
  const reaction = buildReaction(al1);

  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("AllergyIntolerance") },
    // The IG's fixed assignment: not derived from the message, and the reason is on the row itself.
    {
      name: "clinicalStatus",
      value: complex([
        {
          name: "coding",
          value: list([
            complex([
              { name: "system", value: primitive(ALLERGY_CLINICAL_STATUS_SYSTEM) },
              { name: "code", value: primitive(ALLERGY_CLINICAL_STATUS_CODE) },
            ]),
          ]),
        },
      ]),
    },
  ];
  if (type !== undefined) props.push({ name: "type", value: type });
  if (category !== undefined) props.push({ name: "category", value: list([category]) });
  if (criticality !== undefined) props.push({ name: "criticality", value: criticality });
  props.push({ name: "code", value: allergen.value });
  props.push({ name: "patient", value: reference(patientFullUrl) });
  if (onset !== undefined) props.push({ name: "onsetDateTime", value: onset });
  if (reaction !== undefined) props.push({ name: "reaction", value: reaction });

  return { value: complex(props), issues };
}

/**
 * Build one AL1's `AllergyIntolerance` and put it through the conservative-emit `gate`, falling back
 * to the same resource without its alternate-codes extension when the extension is what the gate
 * refuses. Returns `{ value: undefined }` when the allergy is withheld, with the issue saying why
 * already raised: an ungrounded allergen (`TRANSFORM_ELEMENT_DROPPED`) or a draft the gate rejects
 * either way ({@link ISSUE_CODES.TRANSFORM_RESOURCE_INVALID}).
 *
 * The gate is a parameter rather than a call into the assembler, so the fallback is decided by one
 * predicate that a caller (and a test) can supply: what "the gate rejects this" means stays in one
 * place, and the branch is reachable without a hand-built invalid resource.
 *
 * @param al1 - The `AL1` `@cosyte/hl7` `Segment`.
 * @param patientFullUrl - The bundle's Patient fullUrl, for `patient` (required 1..1).
 * @param version - The message's MSH-12 version identifier (see {@link carriesLegacyOnsetDate}).
 * @param ctx - The transform context.
 * @param gate - The conservative-emit predicate: `true` when this resource may join the bundle.
 * @param v2Location - The occurrence's v2 location, for the withholding issue (e.g. `AL1[0]`).
 * @example
 * ```ts
 * // const emitted = emitAllergyIntolerance(al1, "urn:uuid:pat", "2.5.1", {}, () => true, "AL1[0]");
 * ```
 */
export function emitAllergyIntolerance(
  al1: Segment,
  patientFullUrl: string,
  version: string | undefined,
  ctx: TransformContext,
  gate: (resource: FhirComplex) => boolean,
  v2Location: string,
): ConvertResult<FhirComplex> {
  const built = buildAllergyIntolerance(al1, patientFullUrl, version, ctx);
  if (built.value === undefined) return built;
  if (gate(built.value)) return built;

  const issues = [...built.issues];

  // The extension is the one part of this resource the guide adds beside a value rather than as
  // one, so it is the one part that can be dropped without losing what the allergy says. The
  // second draft's own issues are the first draft's, already raised: only the drop is new.
  const withoutExtension = buildAllergyIntolerance(al1, patientFullUrl, version, ctx, {
    carryAlternateCodes: false,
  });
  if (withoutExtension.value !== undefined && gate(withoutExtension.value)) {
    if (al1.field(2).value !== "") {
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
          "AL1.2",
          "AllergyIntolerance.category.extension",
        ),
      );
    }
    if (al1.field(4).value !== "") {
      issues.push(
        issue(
          ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
          "AL1.4",
          "AllergyIntolerance.criticality.extension",
        ),
      );
    }
    return { value: withoutExtension.value, issues };
  }

  // Rejected with the extension and without it: withheld, never shipped as invalid FHIR.
  issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, v2Location, "AllergyIntolerance"));
  return { value: undefined, issues };
}

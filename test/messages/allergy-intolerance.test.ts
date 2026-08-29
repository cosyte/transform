/**
 * AL1 to `AllergyIntolerance`: the IG rows, one fixture per row, and every fail-safe path beside
 * them. An allergy is a field a downstream system acts on before prescribing, so the unhappy paths
 * here matter as much as the happy one: what the maps do not carry must be omitted and flagged, not
 * filled in from a neighbour.
 */

import { describe, expect, it } from "vitest";

import { parseHL7, type Segment } from "@cosyte/hl7";
import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  serializeResource,
  validateResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import {
  toFhir,
  ISSUE_CODES,
  ALLERGY_CATEGORY_VALUE_MAP,
  ALLERGY_CRITICALITY_VALUE_MAP,
  ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP,
  ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP,
  ALLERGY_TYPE_VALUE_MAP,
  ALLERGY_CLINICAL_STATUS_CODE,
  ALLERGY_CLINICAL_STATUS_SYSTEM,
  ALLERGY_INTOLERANCE_CATEGORY_SYSTEM,
  ALLERGY_INTOLERANCE_CRITICALITY_SYSTEM,
  ALLERGY_INTOLERANCE_TYPE_SYSTEM,
  ALTERNATE_CODES_EXTENSION_URL,
  IG_ALLERGY_VALUE_MAPS_PUBLISHED,
  IG_ALLERGY_VALUE_MAPS_RETRIEVED,
  IG_ALLERGY_VALUE_MAPS_SOURCE,
  IG_ALLERGY_VALUE_MAPS_VERSION,
  V2_0127_SYSTEM,
  V2_0128_SYSTEM,
  carriesLegacyOnsetDate,
  collectAllergies,
  translateBound,
  type TransformIssue,
  type TransformResult,
} from "../../src/index.js";
import {
  buildAllergyIntolerance,
  emitAllergyIntolerance,
} from "../../src/messages/allergy-intolerance.js";
import { EMIT_SCHEMAS } from "../../src/messages/emit-schemas.js";

// ── Fixtures ────────────────────────────────────────────────────────────────────────────────────

/** A deterministic urn:uuid generator so fullUrls and reference wiring can be asserted exactly. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function toFhirSeq(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), { generateId: seq() });
}

const MSH_251 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG1|P|2.5.1";
const MSH_27 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG1|P|2.7";
const MSH_NO_VERSION =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG1|P";
const PID = "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F";

/** An ADT carrying the given AL1 lines, a Patient, and nothing else. */
function adt(al1Lines: readonly string[], msh: string = MSH_251): TransformResult {
  return toFhirSeq([msh, PID, ...al1Lines]);
}

/** `AL1|1|<type>|<allergen>|<severity>|<reaction>|<onset>` with empty trailing fields trimmed. */
function al1(fields: Readonly<Record<number, string>>): string {
  const max = Math.max(0, ...Object.keys(fields).map(Number));
  const parts = ["AL1"];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

// ── Readers ─────────────────────────────────────────────────────────────────────────────────────

interface Entry {
  readonly fullUrl: string;
  readonly resource: FhirComplex;
}

function entries(result: TransformResult): readonly Entry[] {
  const entry = getProperty(result.bundle, "entry");
  if (entry === undefined || !isList(entry)) return [];
  const out: Entry[] = [];
  for (const e of entry.items) {
    if (!isComplex(e)) continue;
    const url = getProperty(e, "fullUrl");
    const resource = getProperty(e, "resource");
    if (url === undefined || !isPrimitive(url) || typeof url.value !== "string") continue;
    if (resource === undefined || !isComplex(resource)) continue;
    out.push({ fullUrl: url.value, resource });
  }
  return out;
}

function ofType(result: TransformResult, type: string): readonly Entry[] {
  return entries(result).filter((e) => stringAt(e.resource, "resourceType") === type);
}

/** The single AllergyIntolerance in a bundle, or `undefined` when there is none. */
function allergy(result: TransformResult): FhirComplex | undefined {
  return ofType(result, "AllergyIntolerance")[0]?.resource;
}

/** The value of a string primitive property, or `undefined` when absent or value-free. */
function stringAt(node: FhirComplex | undefined, name: string): string | undefined {
  if (node === undefined) return undefined;
  const found = getProperty(node, name);
  if (found === undefined || !isPrimitive(found)) return undefined;
  return typeof found.value === "string" ? found.value : undefined;
}

/** The first item of a list-valued property (or the property itself when it is not a list). */
function first(node: FhirComplex | undefined, name: string): FhirNode | undefined {
  if (node === undefined) return undefined;
  const found = getProperty(node, name);
  if (found === undefined) return undefined;
  return isList(found) ? found.items[0] : found;
}

/** `system|code` of the first coding of a CodeableConcept-valued property. */
function coding(node: FhirComplex | undefined, name: string): string | undefined {
  const cc = first(node, name);
  if (cc === undefined || !isComplex(cc)) return undefined;
  const one = first(cc, "coding");
  if (one === undefined || !isComplex(one)) return undefined;
  return `${stringAt(one, "system") ?? ""}|${stringAt(one, "code") ?? ""}`;
}

/** The `category` primitive (there is at most one AL1-2, so at most one category element). */
function categoryElement(node: FhirComplex | undefined): FhirNode | undefined {
  return first(node, "category");
}

/** The code value of a `code`-typed element that may be value-absent (extension only). */
function codeValue(element: FhirNode | undefined): string | undefined {
  if (element === undefined || !isPrimitive(element)) return undefined;
  return typeof element.value === "string" ? element.value : undefined;
}

/** `system|code` carried by the alternate-codes extension on a `code`-typed element. */
function alternateCode(element: FhirNode | undefined): string | undefined {
  if (element === undefined || !isPrimitive(element)) return undefined;
  const ext = element.extension?.[0];
  if (ext === undefined) return undefined;
  if (stringAt(ext, "url") !== ALTERNATE_CODES_EXTENSION_URL) return undefined;
  const value = getProperty(ext, "valueCodeableConcept");
  if (value === undefined || !isComplex(value)) return undefined;
  return coding(value, "coding") ?? codingOf(value);
}

/** `system|code` of a CodeableConcept node's first coding. */
function codingOf(cc: FhirComplex): string | undefined {
  const one = first(cc, "coding");
  if (one === undefined || !isComplex(one)) return undefined;
  return `${stringAt(one, "system") ?? ""}|${stringAt(one, "code") ?? ""}`;
}

function labels(result: TransformResult): string[] {
  return result.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`);
}

function issuesOf(result: TransformResult, code: string): readonly TransformIssue[] {
  return result.issues.filter((i) => i.code === code);
}

/** The conservative-emit gate exactly as the assembler applies it to a non-Patient resource. */
function emitGate(resource: FhirComplex): boolean {
  return validateResource(resource, { mode: "lenient", schemas: EMIT_SCHEMAS }).valid;
}

const PENICILLIN = "PEN^Penicillin^L";

// ── The transcription: every row of the five IG ConceptMaps ─────────────────────────────────────

describe("the five IG allergy value maps, transcribed row by row", () => {
  const translate = (map: typeof ALLERGY_CATEGORY_VALUE_MAP, code: string): string | undefined =>
    translateBound({ identifier: code }, map)?.code;

  it("carries the six HL70127 to category rows and leaves MA and MC unmapped", () => {
    const table = ["DA", "FA", "MA", "MC", "EA", "AA", "PA", "LA"].map((code) => [
      code,
      translate(ALLERGY_CATEGORY_VALUE_MAP, code),
    ]);
    expect(table).toEqual([
      ["DA", "medication"],
      ["FA", "food"],
      ["MA", undefined],
      ["MC", undefined],
      ["EA", "environment"],
      ["AA", "biologic"],
      ["PA", "environment"],
      ["LA", "environment"],
    ]);
    expect(translateBound({ identifier: "DA" }, ALLERGY_CATEGORY_VALUE_MAP)?.system).toBe(
      ALLERGY_INTOLERANCE_CATEGORY_SYSTEM,
    );
  });

  it("carries the seven HL70127 to type rows and leaves only MC unmapped", () => {
    const table = ["DA", "FA", "MA", "MC", "EA", "AA", "PA", "LA"].map((code) => [
      code,
      translate(ALLERGY_TYPE_VALUE_MAP, code),
    ]);
    expect(table).toEqual([
      ["DA", "allergy"],
      ["FA", "allergy"],
      ["MA", "allergy"],
      ["MC", undefined],
      ["EA", "allergy"],
      ["AA", "allergy"],
      ["PA", "allergy"],
      ["LA", "allergy"],
    ]);
    expect(translateBound({ identifier: "MA" }, ALLERGY_TYPE_VALUE_MAP)?.system).toBe(
      ALLERGY_INTOLERANCE_TYPE_SYSTEM,
    );
  });

  it("carries the two HL70128 to criticality rows and leaves MO and U unmapped", () => {
    const table = ["SV", "MO", "MI", "U"].map((code) => [
      code,
      translate(ALLERGY_CRITICALITY_VALUE_MAP, code),
    ]);
    expect(table).toEqual([
      ["SV", "high"],
      ["MO", undefined],
      ["MI", "low"],
      ["U", undefined],
    ]);
    expect(translateBound({ identifier: "SV" }, ALLERGY_CRITICALITY_VALUE_MAP)?.system).toBe(
      ALLERGY_INTOLERANCE_CRITICALITY_SYSTEM,
    );
  });

  it("carries both identity maps whole, each code to itself in its own v2 code system", () => {
    for (const code of ["DA", "FA", "MA", "MC", "EA", "AA", "PA", "LA"]) {
      expect([
        code,
        translateBound({ identifier: code }, ALLERGY_ORIGINAL_CATEGORY_VALUE_MAP),
      ]).toEqual([code, { system: V2_0127_SYSTEM, code }]);
    }
    for (const code of ["SV", "MO", "MI", "U"]) {
      expect([
        code,
        translateBound({ identifier: code }, ALLERGY_ORIGINAL_CRITICALITY_VALUE_MAP),
      ]).toEqual([code, { system: V2_0128_SYSTEM, code }]);
    }
  });

  it("records the guide version, publication and retrieval date the rows were read at", () => {
    expect(IG_ALLERGY_VALUE_MAPS_VERSION).toBe("1.0.0");
    expect(IG_ALLERGY_VALUE_MAPS_PUBLISHED).toBe("2025-10-07");
    expect(IG_ALLERGY_VALUE_MAPS_RETRIEVED).toBe("2026-08-28");
    expect(IG_ALLERGY_VALUE_MAPS_SOURCE).toContain("ConceptMap-segment-al1-to-allergyintolerance");
  });

  it("applies a map only to a code from its bound table, never to a foreign coding system", () => {
    // A local 99-table code that happens to collide with a Table 0127 mnemonic is not that concept.
    expect(
      translateBound(
        { identifier: "DA", nameOfCodingSystem: "99LOCAL" },
        ALLERGY_CATEGORY_VALUE_MAP,
      ),
    ).toBeUndefined();
    expect(
      translateBound(
        { identifier: "DA", nameOfCodingSystem: "HL70127" },
        ALLERGY_CATEGORY_VALUE_MAP,
      )?.code,
    ).toBe("medication");
  });
});

// ── AC1, AC2, AC6: the resource, its wiring, and the fixed clinicalStatus ───────────────────────

describe("an AL1 becomes an AllergyIntolerance wired to the bundle Patient (AC1, AC2)", () => {
  it("emits one AllergyIntolerance whose patient reference resolves inside the same bundle", () => {
    const result = adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })]);
    const ai = allergy(result);
    expect(ai).toBeDefined();

    const patientEntry = ofType(result, "Patient")[0];
    expect(patientEntry).toBeDefined();
    const patientRef = getProperty(ai as FhirComplex, "patient");
    expect(patientRef !== undefined && isComplex(patientRef)).toBe(true);
    expect(stringAt(patientRef as FhirComplex, "reference")).toBe(patientEntry?.fullUrl);

    // The reference resolves to an entry of this bundle, not to a bare urn nobody carries.
    const urls = new Set(entries(result).map((e) => e.fullUrl));
    expect(urls.has(patientEntry?.fullUrl ?? "")).toBe(true);
  });

  it("populates clinicalStatus with active from the allergyintolerance-clinical code system", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })]));
    expect(coding(ai, "clinicalStatus")).toBe(
      `${ALLERGY_CLINICAL_STATUS_SYSTEM}|${ALLERGY_CLINICAL_STATUS_CODE}`,
    );
    expect(ALLERGY_CLINICAL_STATUS_CODE).toBe("active");
  });

  it("is refused by the emit gate without that clinicalStatus, which is why the IG fixes it", () => {
    // Constraint ait-1 is enforced by @cosyte/fhir itself: the fixed assignment is load-bearing,
    // not decoration. Strip it and the same resource stops clearing the gate.
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })])) as FhirComplex;
    expect(emitGate(ai)).toBe(true);
    const stripped: FhirComplex = {
      kind: "complex",
      properties: ai.properties.filter((p) => p.name !== "clinicalStatus"),
    };
    expect(emitGate(stripped)).toBe(false);
  });

  it("carries AL1-5 to reaction.manifestation.text, one manifestation per repetition", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 5: "Hives~Nausea" })]));
    const reaction = first(ai, "reaction");
    expect(reaction !== undefined && isComplex(reaction)).toBe(true);
    const manifestation = getProperty(reaction as FhirComplex, "manifestation");
    expect(manifestation !== undefined && isList(manifestation)).toBe(true);
    const texts = (manifestation as { items: readonly FhirNode[] }).items.map((m) =>
      isComplex(m) ? stringAt(m, "text") : undefined,
    );
    expect(texts).toEqual(["Hives", "Nausea"]);
  });

  it("places one distinct entry per AL1 occurrence, each resolving to the one Patient (AC6)", () => {
    const result = adt([
      al1({ 1: "1", 2: "DA", 3: PENICILLIN }),
      al1({ 1: "2", 2: "FA", 3: "PNUT^Peanut^L" }),
      al1({ 1: "3", 2: "EA", 3: "DUST^Dust^L" }),
    ]);
    const emitted = ofType(result, "AllergyIntolerance");
    expect(emitted).toHaveLength(3);
    expect(new Set(emitted.map((e) => e.fullUrl)).size).toBe(3);

    const patientUrl = ofType(result, "Patient")[0]?.fullUrl;
    for (const e of emitted) {
      const ref = getProperty(e.resource, "patient");
      expect(stringAt(ref as FhirComplex, "reference")).toBe(patientUrl);
    }
    // Distinct allergens, so the three entries are three allergies rather than one repeated.
    expect(emitted.map((e) => coding(e.resource, "code"))).toEqual(["|PEN", "|PNUT", "|DUST"]);
  });

  it("clears the conservative-emit gate for every emitted allergy", () => {
    const result = adt([
      al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "SV", 5: "Hives" }),
      al1({ 1: "2", 2: "MA", 3: "MISC^Misc^L", 4: "MO" }),
    ]);
    for (const e of ofType(result, "AllergyIntolerance")) expect(emitGate(e.resource)).toBe(true);
  });
});

// ── AC3, AC4: two maps over one component, resolved independently ───────────────────────────────

describe("AL1-2 resolves category and type against two separate IG maps (AC3, AC4)", () => {
  const rows: readonly (readonly [string, string | undefined, string | undefined])[] = [
    ["DA", "medication", "allergy"],
    ["FA", "food", "allergy"],
    ["MA", undefined, "allergy"],
    ["MC", undefined, undefined],
    ["EA", "environment", "allergy"],
    ["AA", "biologic", "allergy"],
    ["PA", "environment", "allergy"],
    ["LA", "environment", "allergy"],
  ];

  it("answers each HL70127 code with the pair its two maps give, and never a neighbour", () => {
    for (const [code, category, type] of rows) {
      const ai = allergy(adt([al1({ 1: "1", 2: code, 3: PENICILLIN })]));
      expect([code, codeValue(categoryElement(ai)), stringAt(ai, "type")]).toEqual([
        code,
        category,
        type,
      ]);
    }
  });

  it("gives MA a type of allergy and no category, which is the guide's answer, not a gap", () => {
    const result = adt([al1({ 1: "1", 2: "MA", 3: PENICILLIN })]);
    const ai = allergy(result);
    expect(stringAt(ai, "type")).toBe("allergy");
    expect(codeValue(categoryElement(ai))).toBeUndefined();
    expect(labels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.2#AllergyIntolerance.category`,
    );
    // Exactly one unmapped issue: the type map had a target, so it raises nothing.
    expect(issuesOf(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED)).toHaveLength(1);
  });

  it("gives MC neither element and flags both maps, once each", () => {
    const result = adt([al1({ 1: "1", 2: "MC", 3: PENICILLIN })]);
    const ai = allergy(result);
    expect(stringAt(ai, "type")).toBeUndefined();
    expect(codeValue(categoryElement(ai))).toBeUndefined();
    expect(labels(result)).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.2#AllergyIntolerance.type`,
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.2#AllergyIntolerance.category`,
      ]),
    );
    expect(issuesOf(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED)).toHaveLength(2);
  });

  it("omits both elements for a code outside Table 0127 rather than assigning a neighbour", () => {
    const result = adt([al1({ 1: "1", 2: "ZZ", 3: PENICILLIN })]);
    const ai = allergy(result);
    expect(codeValue(categoryElement(ai))).toBeUndefined();
    expect(stringAt(ai, "type")).toBeUndefined();
    expect(issuesOf(result, ISSUE_CODES.TRANSFORM_CODE_UNMAPPED).length).toBeGreaterThanOrEqual(2);
  });

  it("leaves both elements absent when AL1-2 is not valued at all, and raises nothing for it", () => {
    const result = adt([al1({ 1: "1", 3: PENICILLIN })]);
    const ai = allergy(result);
    expect(getProperty(ai as FhirComplex, "category")).toBeUndefined();
    expect(getProperty(ai as FhirComplex, "type")).toBeUndefined();
    expect(result.issues.some((i) => i.v2Location === "AL1.2")).toBe(false);
  });
});

// ── AC7: the original code survives whatever the map did ────────────────────────────────────────

describe("the original v2 code is carried in the alternate-codes extension (AC7)", () => {
  it("carries a mapped AL1-2 code in v2-0127 beside the translated category", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })]));
    const category = categoryElement(ai);
    expect(codeValue(category)).toBe("medication");
    expect(alternateCode(category)).toBe(`${V2_0127_SYSTEM}|DA`);
  });

  it("carries an UNmapped AL1-2 code in v2-0127 although the category map had no target", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "MA", 3: PENICILLIN })]));
    const category = categoryElement(ai);
    expect(codeValue(category)).toBeUndefined();
    expect(alternateCode(category)).toBe(`${V2_0127_SYSTEM}|MA`);
  });

  it("carries a mapped and an unmapped AL1-4 code in v2-0128 on criticality", () => {
    const high = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "SV" })]));
    expect(codeValue(first(high, "criticality"))).toBe("high");
    expect(alternateCode(first(high, "criticality"))).toBe(`${V2_0128_SYSTEM}|SV`);

    const moderate = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "MO" })]));
    expect(codeValue(first(moderate, "criticality"))).toBeUndefined();
    expect(alternateCode(first(moderate, "criticality"))).toBe(`${V2_0128_SYSTEM}|MO`);
  });

  it("uses the IG's own extension url on both elements", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "SV" })])) as FhirComplex;
    const json = serializeResource(ai);
    expect(ALTERNATE_CODES_EXTENSION_URL).toBe(
      "http://hl7.org/fhir/StructureDefinition/alternate-codes",
    );
    expect(json.split(ALTERNATE_CODES_EXTENSION_URL)).toHaveLength(3); // once per element
  });

  it("carries no extension for a component that is not valued", () => {
    const ai = allergy(adt([al1({ 1: "1", 3: PENICILLIN })])) as FhirComplex;
    expect(serializeResource(ai)).not.toContain(ALTERNATE_CODES_EXTENSION_URL);
  });
});

// ── AC8: a rejected extension costs the extension, never the allergy ────────────────────────────

describe("the alternate-codes extension is dropped, not the allergy, when the gate refuses it (AC8)", () => {
  /** The first AL1 of a message built from `line`, as the assembler would hand it to the builder. */
  function al1SegmentOf(line: string): Segment {
    const found = collectAllergies(parseHL7([MSH_251, PID, line].join("\r")))[0];
    if (found === undefined) throw new Error("fixture carries no AL1");
    return found;
  }

  /** A gate that refuses exactly the drafts carrying the alternate-codes extension. */
  function refusesExtension(resource: FhirComplex): boolean {
    return !serializeResource(resource).includes(ALTERNATE_CODES_EXTENSION_URL);
  }

  const bothValued = al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "SV" });

  it("emits the resource without the extension and names both source fields", () => {
    const emitted = emitAllergyIntolerance(
      al1SegmentOf(bothValued),
      "urn:uuid:pat",
      "2.5.1",
      {},
      refusesExtension,
      "AL1[0]",
    );
    expect(emitted.value).toBeDefined();
    const json = serializeResource(emitted.value as FhirComplex);
    expect(json).not.toContain(ALTERNATE_CODES_EXTENSION_URL);
    // The allergy itself is intact: the translated values and the allergen are still there.
    expect(json).toContain('"medication"');
    expect(json).toContain('"high"');
    expect(json).toContain("PEN");
    expect(emitted.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`)).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.2#AllergyIntolerance.category.extension`,
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.4#AllergyIntolerance.criticality.extension`,
      ]),
    );
  });

  it("names only the field that carried one when only one component is valued", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      [al1({ 1: "1", 2: "DA", 3: PENICILLIN }), "AL1.2", "AllergyIntolerance.category.extension"],
      [
        al1({ 1: "1", 3: PENICILLIN, 4: "SV" }),
        "AL1.4",
        "AllergyIntolerance.criticality.extension",
      ],
    ];
    for (const [line, v2Location, fhirPath] of cases) {
      const emitted = emitAllergyIntolerance(
        al1SegmentOf(line),
        "urn:uuid:pat",
        "2.5.1",
        {},
        refusesExtension,
        "AL1[0]",
      );
      expect(emitted.value).toBeDefined();
      expect([
        v2Location,
        emitted.issues.filter((i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED),
      ]).toEqual([v2Location, [expect.objectContaining({ v2Location, fhirPath })]]);
    }
  });

  it("withholds the resource, never emits it invalid, when both drafts are refused", () => {
    const emitted = emitAllergyIntolerance(
      al1SegmentOf(bothValued),
      "urn:uuid:pat",
      "2.5.1",
      {},
      () => false,
      "AL1[0]",
    );
    expect(emitted.value).toBeUndefined();
    expect(emitted.issues.map((i) => `${i.code}@${i.v2Location}`)).toContain(
      `${ISSUE_CODES.TRANSFORM_RESOURCE_INVALID}@AL1[0]`,
    );
  });

  it("keeps the extension when the real gate accepts it, so the fallback stays inert in practice", () => {
    const al1Seg = al1SegmentOf(bothValued);
    const emitted = emitAllergyIntolerance(al1Seg, "urn:uuid:pat", "2.5.1", {}, emitGate, "AL1[0]");
    expect(emitted.value).toBeDefined();
    expect(serializeResource(emitted.value as FhirComplex)).toContain(
      ALTERNATE_CODES_EXTENSION_URL,
    );
    expect(emitted.issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED)).toBe(
      false,
    );
    // And the extension-free draft clears the real gate too, which is what makes taking it safe.
    const without = buildAllergyIntolerance(
      al1Seg,
      "urn:uuid:pat",
      "2.5.1",
      {},
      {
        carryAlternateCodes: false,
      },
    );
    expect(emitGate(without.value as FhirComplex)).toBe(true);
  });
});

// ── AC9: criticality, and the reaction.severity that is deliberately never populated ────────────

describe("an HL70128 code with no criticality target leaves criticality absent (AC9)", () => {
  for (const code of ["MO", "U"]) {
    it(`leaves criticality absent for ${code} and raises an unmapped-code issue`, () => {
      const result = adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: code })]);
      const ai = allergy(result);
      expect(codeValue(first(ai, "criticality"))).toBeUndefined();
      expect(labels(result)).toContain(
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.4#AllergyIntolerance.criticality`,
      );
      // The local variation the IG offers is never taken: no severity is asserted anywhere.
      expect(serializeResource(ai as FhirComplex)).not.toContain("severity");
    });
  }

  it("never populates reaction.severity even when a reaction and a mapped severity are present", () => {
    const ai = allergy(adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN, 4: "SV", 5: "Hives" })]));
    const json = serializeResource(ai as FhirComplex);
    expect(json).toContain('"criticality":"high"');
    expect(json).not.toContain("severity");
  });
});

// ── AC10: AL1-6, a legacy field only ────────────────────────────────────────────────────────────

describe("AL1-6 is carried only for a message earlier than the version that withdrew it (AC10)", () => {
  const onsetLine = al1({ 1: "1", 2: "DA", 3: PENICILLIN, 6: "20240115" });

  it("carries AL1-6 to onsetDateTime on a 2.5.1 message", () => {
    const result = adt([onsetLine]);
    expect(stringAt(allergy(result), "onsetDateTime")).toBe("2024-01-15");
    expect(result.issues.some((i) => i.v2Location === "AL1.6")).toBe(false);
  });

  it("drops it and flags it on a 2.7 message, where the field is withdrawn", () => {
    const result = adt([onsetLine], MSH_27);
    expect(stringAt(allergy(result), "onsetDateTime")).toBeUndefined();
    expect(labels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.6#AllergyIntolerance.onsetDateTime`,
    );
  });

  it("drops it and flags it when MSH-12 is absent or unreadable", () => {
    for (const msh of [MSH_NO_VERSION, MSH_251.replace("|2.5.1", "|V2.5.1")]) {
      const result = adt([onsetLine], msh);
      expect(stringAt(allergy(result), "onsetDateTime")).toBeUndefined();
      expect(labels(result)).toContain(
        `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.6#AllergyIntolerance.onsetDateTime`,
      );
    }
  });

  it("raises nothing about AL1-6 when the field is not valued, on any version", () => {
    for (const msh of [MSH_251, MSH_27, MSH_NO_VERSION]) {
      const result = adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })], msh);
      expect(result.issues.some((i) => i.v2Location === "AL1.6")).toBe(false);
    }
  });

  it("decides the version boundary numerically, never by string order", () => {
    const table: readonly (readonly [string | undefined, boolean])[] = [
      ["2", true],
      ["2.1", true],
      ["2.3.1", true],
      ["2.5.1", true],
      ["2.6", true],
      ["2.7", false],
      ["2.7.1", false],
      ["2.8", false],
      ["2.10", false],
      ["3.0", false],
      ["", false],
      ["2.x", false],
      ["V2.5", false],
      [undefined, false],
    ];
    for (const [version, expected] of table) {
      expect([version, carriesLegacyOnsetDate(version)]).toEqual([version, expected]);
    }
  });
});

// ── AC5, AC11: the two ways an allergy is withheld ──────────────────────────────────────────────

describe("an allergy with nothing to anchor it is withheld and declared (AC5, AC11)", () => {
  it("withholds every AllergyIntolerance and raises a dropped-element issue with no Patient", () => {
    const result = toFhirSeq([MSH_251, al1({ 1: "1", 2: "DA", 3: PENICILLIN })]);
    expect(ofType(result, "AllergyIntolerance")).toHaveLength(0);
    expect(ofType(result, "Patient")).toHaveLength(0);
    expect(labels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1[0]#AllergyIntolerance.patient`,
    );
    // No unresolvable reference reached the bundle.
    expect(serializeResource(result.bundle)).not.toContain("AllergyIntolerance");
  });

  it("declares one withholding per AL1 occurrence when there is no Patient", () => {
    const result = toFhirSeq([
      MSH_251,
      al1({ 1: "1", 2: "DA", 3: PENICILLIN }),
      al1({ 1: "2", 2: "FA", 3: "PNUT^Peanut^L" }),
    ]);
    const dropped = result.issues.filter(
      (i) =>
        i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED &&
        i.fhirPath === "AllergyIntolerance.patient",
    );
    expect(dropped.map((i) => i.v2Location)).toEqual(["AL1[0]", "AL1[1]"]);
  });

  it("withholds an allergy whose AL1-3 grounds no allergen code and no allergen text", () => {
    for (const line of [al1({ 1: "1", 2: "DA" }), al1({ 1: "1", 2: "DA", 3: "^^L" })]) {
      const result = adt([line]);
      expect([line, ofType(result, "AllergyIntolerance").length]).toEqual([line, 0]);
      expect([line, labels(result)]).toEqual([
        line,
        expect.arrayContaining([
          `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.3#AllergyIntolerance.code`,
        ]),
      ]);
    }
  });

  it("emits an allergy whose AL1-3 carries only text, because that still names the substance", () => {
    const result = adt([al1({ 1: "1", 2: "DA", 3: "^Penicillin" })]);
    const ai = allergy(result);
    expect(ai).toBeDefined();
    expect(serializeResource(ai as FhirComplex)).toContain("Penicillin");
  });

  it("withholds only the ungrounded occurrence, never its neighbours", () => {
    const result = adt([
      al1({ 1: "1", 2: "DA", 3: PENICILLIN }),
      al1({ 1: "2", 2: "FA" }),
      al1({ 1: "3", 2: "EA", 3: "DUST^Dust^L" }),
    ]);
    expect(ofType(result, "AllergyIntolerance").map((e) => coding(e.resource, "code"))).toEqual([
      "|PEN",
      "|DUST",
    ]);
  });
});

// ── AC12, AC13: what the completeness diagnostic says now ───────────────────────────────────────

describe("the completeness diagnostic follows the emission (AC12, AC13)", () => {
  const NOT_EMITTED = ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED;

  it("stops reporting an AL1 occurrence it now emits", () => {
    const result = adt([al1({ 1: "1", 2: "DA", 3: PENICILLIN })]);
    expect(
      result.issues.some((i) => i.code === NOT_EMITTED && i.v2Location.startsWith("AL1")),
    ).toBe(false);
  });

  it("still reports an occurrence withheld for want of a Patient, beside the withholding issue", () => {
    const result = toFhirSeq([MSH_251, al1({ 1: "1", 2: "DA", 3: PENICILLIN })]);
    expect(result.issues.filter((i) => i.code === NOT_EMITTED).map((i) => i.v2Location)).toContain(
      "AL1[1]",
    );
    expect(labels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1[0]#AllergyIntolerance.patient`,
    );
  });

  it("still reports an occurrence withheld for want of an allergen, beside its issue", () => {
    const result = adt([al1({ 1: "1", 2: "DA" })]);
    expect(result.issues.filter((i) => i.code === NOT_EMITTED).map((i) => i.v2Location)).toContain(
      "AL1[1]",
    );
    expect(labels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@AL1.3#AllergyIntolerance.code`,
    );
  });

  it("reports the withheld occurrence only, when a message carries one of each", () => {
    const result = adt([
      al1({ 1: "1", 2: "DA", 3: PENICILLIN }),
      al1({ 1: "2", 2: "FA" }),
      al1({ 1: "3", 2: "EA", 3: "DUST^Dust^L" }),
    ]);
    expect(
      result.issues
        .filter((i) => i.code === NOT_EMITTED && i.v2Location.startsWith("AL1"))
        .map((i) => i.v2Location),
    ).toEqual(["AL1[2]"]); // 1-based among the AL1 occurrences: the second one
  });

  it("emits no AllergyIntolerance and raises nothing new for a message with no AL1", () => {
    // The AL1-free issue list is exactly what it was: the PID identifier authority this fixture
    // never seeded, and nothing else. `test/messages/segment-completeness.test.ts` holds the
    // stronger form of this over the recorded corpus, comparing whole bundles to their baselines.
    const result = toFhirSeq([MSH_251, PID, "PV1|1|I"]);
    expect(ofType(result, "AllergyIntolerance")).toHaveLength(0);
    expect(serializeResource(result.bundle)).not.toContain("AllergyIntolerance");
    for (const i of result.issues) {
      expect(i.v2Location.startsWith("AL1")).toBe(false);
      expect(i.fhirPath?.startsWith("AllergyIntolerance") ?? false).toBe(false);
    }
    expect(labels(result)).toEqual([
      `${ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED}@CX.4#Identifier.system`,
      `${ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}@MSH.3#MessageHeader.source.endpoint`,
    ]);
  });
});

import { describe, expect, it } from "vitest";

import type { CWE } from "@cosyte/hl7";
import { getProperty, isList, isComplex, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import {
  toFhirCodeableConceptVia,
  translateBound,
  codeableConceptFromTarget,
  createNamingSystem,
  ROUTE_VALUE_MAP,
  SITE_VALUE_MAP,
  APPOINTMENT_TYPE_VALUE_MAP,
  SUBSTITUTION_VALUE_MAP,
  V2_0162_SYSTEM,
  V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
  V2_0550_SYSTEM,
  V2_0277_SYSTEM,
  V2_0161_SYSTEM,
  ISSUE_CODES,
} from "../../src/index.js";
import { embedAndValidate } from "../_support/fhir.js";

/** The `{system, code, display}` triples of a CodeableConcept node's `coding` list. */
function codings(
  cc: FhirComplex | undefined,
): { system: string | undefined; code: string | undefined; display: string | undefined }[] {
  if (cc === undefined) return [];
  const coding = getProperty(cc, "coding");
  if (coding === undefined || !isList(coding)) return [];
  const val = (node: FhirNode | undefined): string | undefined =>
    node !== undefined && "value" in node ? String((node as { value: unknown }).value) : undefined;
  return coding.items.filter(isComplex).map((c) => ({
    system: val(getProperty(c, "system")),
    code: val(getProperty(c, "code")),
    display: val(getProperty(c, "display")),
  }));
}
const cwe = (parts: Partial<CWE>): CWE => parts;

describe("CodedValueMap.translate: firsthand-grounded IG value maps", () => {
  it("ROUTE (HL70162): remaps the six common routes into v3-RouteOfAdministration", () => {
    expect(ROUTE_VALUE_MAP.translate("IM")).toEqual({
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "IM",
      display: "Injection, intramuscular",
    });
    expect(ROUTE_VALUE_MAP.translate("SC")).toEqual({
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "SQ",
      display: "Injection, subcutaneous",
    });
    expect(ROUTE_VALUE_MAP.translate("PO")?.code).toBe("PO");
  });

  it("ROUTE (HL70162): keeps the identity group in v2-0162", () => {
    expect(ROUTE_VALUE_MAP.translate("PR")).toEqual({ system: V2_0162_SYSTEM, code: "PR" });
    expect(ROUTE_VALUE_MAP.translate("OTH")).toEqual({ system: V2_0162_SYSTEM, code: "OTH" });
  });

  it("SITE (HL70550): 443-code identity into v2-0550; a non-member is unmapped", () => {
    expect(SITE_VALUE_MAP.translate("WRIST")).toEqual({ system: V2_0550_SYSTEM, code: "WRIST" });
    expect(SITE_VALUE_MAP.translate("LA")).toBeUndefined(); // HL70163 code, not in the IG's hl70550
  });

  it("APPOINTMENT TYPE (HL70277) + SUBSTITUTION (HL70161): identity maps", () => {
    expect(APPOINTMENT_TYPE_VALUE_MAP.translate("Normal")).toEqual({
      system: V2_0277_SYSTEM,
      code: "Normal",
    });
    expect(APPOINTMENT_TYPE_VALUE_MAP.translate("Walkin")).toBeUndefined();
    expect(SUBSTITUTION_VALUE_MAP.translate("G")).toEqual({ system: V2_0161_SYSTEM, code: "G" });
    expect(SUBSTITUTION_VALUE_MAP.translate("X")).toBeUndefined();
  });

  it("never translates an empty code", () => {
    expect(ROUTE_VALUE_MAP.translate("")).toBeUndefined();
  });
});

describe("toFhirCodeableConceptVia: additive, fail-safe application", () => {
  it("a remap preserves the raw source coding and ADDS the derived target coding", () => {
    const { value, issues } = toFhirCodeableConceptVia(cwe({ identifier: "IM" }), ROUTE_VALUE_MAP);
    expect(issues).toEqual([]);
    expect(codings(value)).toEqual([
      { system: V2_0162_SYSTEM, code: "IM", display: undefined },
      {
        system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
        code: "IM",
        display: "Injection, intramuscular",
      },
    ]);
  });

  it("an identity map emits a single coding in the target system, no issue", () => {
    const { value, issues } = toFhirCodeableConceptVia(cwe({ identifier: "PR" }), ROUTE_VALUE_MAP);
    expect(issues).toEqual([]);
    expect(codings(value)).toEqual([{ system: V2_0162_SYSTEM, code: "PR", display: undefined }]);
  });

  it("carries the source display and originalText, and does not fabricate an unmapped target", () => {
    const { value } = toFhirCodeableConceptVia(
      cwe({ identifier: "SC", text: "subcut", originalText: "left thigh" }),
      ROUTE_VALUE_MAP,
    );
    const cs = codings(value);
    expect(cs[0]).toEqual({ system: V2_0162_SYSTEM, code: "SC", display: "subcut" });
    expect(cs[1]?.code).toBe("SQ"); // the IG-asserted equivalent, never the raw "SC" in the v3 system
    expect(getProperty(value as FhirComplex, "text")).toBeDefined();
  });

  it("falls back to the structural carry (raw preserved + flagged) for a non-table code", () => {
    const { value, issues } = toFhirCodeableConceptVia(cwe({ identifier: "ZZZ" }), ROUTE_VALUE_MAP);
    expect(codings(value)).toEqual([{ system: undefined, code: "ZZZ", display: undefined }]);
    expect(issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_CODE_UNMAPPED)).toBe(true);
  });

  it("a translated route CodeableConcept validates through the emit gate", () => {
    const { value } = toFhirCodeableConceptVia(cwe({ identifier: "IM" }), ROUTE_VALUE_MAP);
    expect(embedAndValidate([["code", value as FhirNode]])).toEqual([]);
  });

  it("codeableConceptFromTarget builds a single-coding CodeableConcept", () => {
    const cc = codeableConceptFromTarget({ system: V2_0161_SYSTEM, code: "G" }, "generic ok");
    expect(codings(cc)).toEqual([{ system: V2_0161_SYSTEM, code: "G", display: undefined }]);
    expect(embedAndValidate([["code", cc]])).toEqual([]);
  });
});

describe("toFhirCodeableConceptVia: the bound-table (CWE.3) guard + additive preservation", () => {
  it("does NOT translate a code that declares a FOREIGN coding system (CWE.3): carries + flags it", () => {
    // `IM` in a local system is NOT the standard intramuscular route; never assert v3-RouteOfAdministration.
    const { value, issues } = toFhirCodeableConceptVia(
      cwe({ identifier: "IM", nameOfCodingSystem: "99LOCAL" }),
      ROUTE_VALUE_MAP,
    );
    expect(codings(value)).toEqual([{ system: undefined, code: "IM", display: undefined }]);
    expect(issues.some((i) => i.code === ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED)).toBe(true);
    // translateBound agrees: a foreign system yields no target.
    expect(
      translateBound(cwe({ identifier: "IM", nameOfCodingSystem: "99LOCAL" }), ROUTE_VALUE_MAP),
    ).toBeUndefined();
  });

  it("DOES translate when CWE.3 explicitly names the bound table (HL70162), no flag", () => {
    const { value, issues } = toFhirCodeableConceptVia(
      cwe({ identifier: "IM", nameOfCodingSystem: "HL70162" }),
      ROUTE_VALUE_MAP,
    );
    expect(issues).toEqual([]);
    expect(codings(value)).toEqual([
      { system: V2_0162_SYSTEM, code: "IM", display: undefined },
      {
        system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
        code: "IM",
        display: "Injection, intramuscular",
      },
    ]);
  });

  it("preserves the alternate triplet (CWE.4/5/6) alongside the translated primary + derived codings", () => {
    const { value } = toFhirCodeableConceptVia(
      cwe({
        identifier: "IM",
        alternateIdentifier: "78421000",
        alternateText: "Intramuscular route",
        nameOfAlternateCodingSystem: "SCT",
      }),
      ROUTE_VALUE_MAP,
      { namingSystem: createNamingSystem() },
    );
    expect(codings(value)).toEqual([
      { system: V2_0162_SYSTEM, code: "IM", display: undefined },
      {
        system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
        code: "IM",
        display: "Injection, intramuscular",
      },
      { system: "http://snomed.info/sct", code: "78421000", display: "Intramuscular route" },
    ]);
  });

  it("preserves the CWE.7 version on the recognized primary coding", () => {
    const { value } = toFhirCodeableConceptVia(
      cwe({ identifier: "WRIST", codingSystemVersionId: "2.9" }),
      SITE_VALUE_MAP,
    );
    const coding = getProperty(value as FhirComplex, "coding");
    const first = coding !== undefined && isList(coding) ? coding.items.find(isComplex) : undefined;
    const version = getProperty(first as FhirComplex, "version");
    expect(version !== undefined && "value" in version ? version.value : undefined).toBe("2.9");
  });
});

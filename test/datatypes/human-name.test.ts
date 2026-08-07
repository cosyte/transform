import { describe, expect, it } from "vitest";
import { getProperty, isList, isPrimitive } from "@cosyte/fhir";
import type { FhirComplex, FhirNode } from "@cosyte/fhir";

import { toFhirHumanName, NAME_USE_MAP, ISSUE_CODES } from "../../src/index.js";
import { embedAndValidate, one } from "../_support/fhir.js";

function propString(node: FhirComplex, name: string): string | undefined {
  const p = getProperty(node, name);
  if (p !== undefined && isPrimitive(p) && typeof p.value === "string") return p.value;
  return undefined;
}
function propStrings(node: FhirComplex, name: string): string[] {
  const p = getProperty(node, name);
  if (p === undefined || !isList(p)) return [];
  return p.items.map((i: FhirNode) =>
    isPrimitive(i) && typeof i.value === "string" ? i.value : "?",
  );
}

describe("toFhirHumanName: component mapping (IG XPN→HumanName)", () => {
  it("maps family, given[0], given[1], prefix, and the three suffix sources", () => {
    const { value, issues } = toFhirHumanName({
      familyName: "Public",
      givenName: "Jane",
      secondName: "Q",
      prefix: "Dr",
      suffix: "Jr",
      degree: "MD",
      professionalSuffix: "FACP",
      nameTypeCode: "L",
    });
    const hn = value as FhirComplex;
    expect(propString(hn, "family")).toBe("Public");
    expect(propStrings(hn, "given")).toEqual(["Jane", "Q"]);
    expect(propStrings(hn, "prefix")).toEqual(["Dr"]);
    expect(propStrings(hn, "suffix")).toEqual(["Jr", "MD", "FACP"]);
    expect(propString(hn, "use")).toBe("official");
    expect(issues).toEqual([]);
  });

  it("translates every mapped Table 0200 code exactly per the IG", () => {
    for (const [v2, use] of Object.entries(NAME_USE_MAP)) {
      const { value, issues } = toFhirHumanName({ familyName: "X", nameTypeCode: v2 });
      expect(propString(value as FhirComplex, "use")).toBe(use);
      expect(issues).toEqual([]);
    }
  });
});

describe("toFhirHumanName: fail-safe on unmapped name-use and dropped period", () => {
  it("leaves use absent and flags an unmapped name-type code (e.g. B = Birth name)", () => {
    const { value, issues } = toFhirHumanName({ familyName: "X", nameTypeCode: "B" });
    expect(propString(value as FhirComplex, "use")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_NAME_USE_UNMAPPED);
    expect(issues[0]?.v2Location).toBe("XPN.7");
  });

  it("flags XPN.12 / XPN.13 name-validity period as dropped (deferred)", () => {
    const { issues } = toFhirHumanName({
      familyName: "X",
      effectiveDate: "2020",
      expirationDate: "2021",
    });
    expect(issues.map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
  });

  it("emits nothing for an empty name", () => {
    const { value, issues } = toFhirHumanName({});
    expect(value).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("validates clean when embedded (emit gate)", () => {
    const { value } = toFhirHumanName({
      familyName: "Public",
      givenName: "Jane",
      nameTypeCode: "L",
    });
    expect(embedAndValidate([["name", one(value as FhirComplex)]])).toEqual([]);
  });
});

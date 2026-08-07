import { describe, expect, it } from "vitest";
import { getProperty, isList, isPrimitive } from "@cosyte/fhir";
import type { FhirComplex, FhirNode } from "@cosyte/fhir";

import { toFhirAddress, ADDRESS_USE_MAP, ADDRESS_TYPE_MAP, ISSUE_CODES } from "../../src/index.js";
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

describe("toFhirAddress: component mapping (IG XAD→Address)", () => {
  it("maps line, city, district, state, postalCode, country", () => {
    const { value, issues } = toFhirAddress({
      street: "1 Main St",
      otherDesignation: "Apt 4",
      city: "Boston",
      stateOrProvince: "MA",
      zipOrPostalCode: "02101",
      country: "USA",
      countyParishCode: "Suffolk",
      addressType: "H",
    });
    const a = value as FhirComplex;
    expect(propStrings(a, "line")).toEqual(["1 Main St", "Apt 4"]);
    expect(propString(a, "city")).toBe("Boston");
    expect(propString(a, "district")).toBe("Suffolk");
    expect(propString(a, "state")).toBe("MA");
    expect(propString(a, "postalCode")).toBe("02101");
    expect(propString(a, "country")).toBe("USA");
    expect(propString(a, "use")).toBe("home");
    expect(issues).toEqual([]);
  });

  it("splits XAD.7 across the use axis exactly per the IG HL70190→address-use map", () => {
    for (const [v2, use] of Object.entries(ADDRESS_USE_MAP)) {
      const { value, issues } = toFhirAddress({ city: "X", addressType: v2 });
      expect(propString(value as FhirComplex, "use")).toBe(use);
      expect(propString(value as FhirComplex, "type")).toBeUndefined();
      expect(issues).toEqual([]);
    }
  });

  it("splits XAD.7 across the type axis exactly per the IG HL70190→address-type map", () => {
    for (const [v2, type] of Object.entries(ADDRESS_TYPE_MAP)) {
      const { value, issues } = toFhirAddress({ city: "X", addressType: v2 });
      expect(propString(value as FhirComplex, "type")).toBe(type);
      expect(propString(value as FhirComplex, "use")).toBeUndefined();
      expect(issues).toEqual([]);
    }
  });
});

describe("toFhirAddress: fail-safe on unmapped type and dropped components", () => {
  it("flags an unmapped XAD.7 (e.g. HV vacation) with use and type absent", () => {
    const { value, issues } = toFhirAddress({ city: "X", addressType: "HV" });
    expect(propString(value as FhirComplex, "use")).toBeUndefined();
    expect(propString(value as FhirComplex, "type")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ADDRESS_USE_UNMAPPED);
    expect(issues[0]?.v2Location).toBe("XAD.7");
  });

  it("flags XAD.8 (other geographic designation) as dropped", () => {
    const { issues } = toFhirAddress({ city: "X", otherGeographicDesignation: "Region 9" });
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    expect(issues[0]?.v2Location).toBe("XAD.8");
  });

  it("emits nothing for an empty address", () => {
    const { value, issues } = toFhirAddress({});
    expect(value).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("validates clean when embedded (emit gate)", () => {
    const { value } = toFhirAddress({
      street: "1 Main St",
      city: "Boston",
      stateOrProvince: "MA",
      addressType: "M",
    });
    expect(embedAndValidate([["address", one(value as FhirComplex)]])).toEqual([]);
  });
});

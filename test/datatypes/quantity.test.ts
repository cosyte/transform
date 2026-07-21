import { describe, expect, it } from "vitest";
import { getProperty, isPrimitive, FhirDecimal } from "@cosyte/fhir";
import type { FhirComplex } from "@cosyte/fhir";

import { toFhirQuantity, createNamingSystem, ISSUE_CODES } from "../../src/index.js";
import { embedAndValidate } from "../_support/fhir.js";

function propString(node: FhirComplex, name: string): string | undefined {
  const p = getProperty(node, name);
  if (p !== undefined && isPrimitive(p) && typeof p.value === "string") return p.value;
  return undefined;
}
function valueText(node: FhirComplex): string | undefined {
  const p = getProperty(node, "value");
  if (p !== undefined && isPrimitive(p) && p.value instanceof FhirDecimal)
    return p.value.toString();
  return undefined;
}

describe("toFhirQuantity — precision-exact value, UCUM-shape-checked units", () => {
  it("carries the magnitude precision-exact and sets code/system for a valid UCUM unit", () => {
    const { value, issues } = toFhirQuantity(
      { raw: "5.40", value: 5.4 },
      { identifier: "mg/dL", nameOfCodingSystem: "UCUM" },
      { namingSystem: createNamingSystem() },
    );
    const q = value as FhirComplex;
    expect(valueText(q)).toBe("5.40"); // trailing zero preserved — never through a JS number
    expect(propString(q, "unit")).toBe("mg/dL");
    expect(propString(q, "system")).toBe("http://unitsofmeasure.org");
    expect(propString(q, "code")).toBe("mg/dL");
    expect(issues).toEqual([]);
  });

  it("recognizes UCUM via a resolved coding-system mnemonic too", () => {
    const { value, issues } = toFhirQuantity(
      { raw: "70", value: 70 },
      { identifier: "kg", nameOfCodingSystem: "UCUM" },
      { namingSystem: createNamingSystem() },
    );
    expect(propString(value as FhirComplex, "code")).toBe("kg");
    expect(issues).toEqual([]);
  });
});

describe("toFhirQuantity — the non-UCUM unit fail-safe", () => {
  it("preserves a non-UCUM unit verbatim with no code/system, never converting", () => {
    const { value, issues } = toFhirQuantity(
      { raw: "3", value: 3 },
      { identifier: "x10E3/uL", text: "Thousand/uL" }, // not declared UCUM
      { namingSystem: createNamingSystem() },
    );
    const q = value as FhirComplex;
    expect(propString(q, "unit")).toBe("Thousand/uL");
    expect(propString(q, "code")).toBeUndefined();
    expect(propString(q, "system")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM);
    expect(issues[0]?.v2Location).toBe("OBX.6");
  });

  it("flags a UCUM-declared unit that fails the shape check", () => {
    const { value, issues } = toFhirQuantity(
      { raw: "1", value: 1 },
      { identifier: "mg dL", nameOfCodingSystem: "UCUM" }, // whitespace → invalid UCUM shape
      { namingSystem: createNamingSystem() },
    );
    expect(propString(value as FhirComplex, "code")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_UNIT_NOT_UCUM);
  });

  it("emits a bare number Quantity when there are no units", () => {
    const { value, issues } = toFhirQuantity({ raw: "98.6", value: 98.6 }, {});
    expect(valueText(value as FhirComplex)).toBe("98.6");
    expect(propString(value as FhirComplex, "code")).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("emits nothing when the magnitude is non-numeric", () => {
    const { value, issues } = toFhirQuantity(
      { raw: "POSITIVE", value: undefined },
      { identifier: "mg" },
    );
    expect(value).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it.each(["+5", "05", "007", "5.", "+0.5"])(
    "fails safe (no throw, typed issue) on a v2-NM lexical form FHIR decimal forbids: %s",
    (raw) => {
      // `Number(raw)` is defined for all of these, but the FHIR decimal literal rejects a leading
      // sign / leading zero / trailing dot. The converter must NOT throw and must NOT alter the value.
      const { value, issues } = toFhirQuantity(
        { raw, value: Number(raw) },
        { identifier: "mg/dL", nameOfCodingSystem: "UCUM" },
        { namingSystem: createNamingSystem() },
      );
      expect(value).toBeUndefined();
      expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID);
      expect(issues[0]?.v2Location).toBe("OBX.5");
    },
  );

  it("validates clean when embedded (emit gate)", () => {
    const { value } = toFhirQuantity(
      { raw: "5.4", value: 5.4 },
      { identifier: "mg/dL", nameOfCodingSystem: "UCUM" },
      { namingSystem: createNamingSystem() },
    );
    expect(embedAndValidate([["valueQuantity", value as FhirComplex]])).toEqual([]);
  });
});

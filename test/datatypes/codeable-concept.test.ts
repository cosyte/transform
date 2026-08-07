import { describe, expect, it } from "vitest";
import { getProperty, isPrimitive } from "@cosyte/fhir";
import type { FhirComplex } from "@cosyte/fhir";

import { toFhirCodeableConcept, createNamingSystem, ISSUE_CODES } from "../../src/index.js";
import { embedAndValidate, itemAt } from "../_support/fhir.js";

function firstCoding(cc: FhirComplex): FhirComplex {
  return itemAt(getProperty(cc, "coding"), 0);
}
function propString(node: FhirComplex, name: string): string | undefined {
  const p = getProperty(node, name);
  if (p !== undefined && isPrimitive(p) && typeof p.value === "string") return p.value;
  return undefined;
}

describe("toFhirCodeableConcept: recognized systems", () => {
  it("resolves a LOINC mnemonic to its canonical URI", () => {
    const { value, issues } = toFhirCodeableConcept(
      {
        identifier: "789-8",
        text: "Erythrocytes",
        nameOfCodingSystem: "LN",
        codingSystemVersionId: "2.77",
      },
      { namingSystem: createNamingSystem() },
    );
    const c = firstCoding(value as FhirComplex);
    expect(propString(c, "system")).toBe("http://loinc.org");
    expect(propString(c, "code")).toBe("789-8");
    expect(propString(c, "display")).toBe("Erythrocytes");
    expect(propString(c, "version")).toBe("2.77");
    expect(issues).toEqual([]);
  });

  it("maps the alternate triplet to coding[1] and CWE.9 to text", () => {
    const { value } = toFhirCodeableConcept(
      {
        identifier: "A",
        nameOfCodingSystem: "LN",
        alternateIdentifier: "44054006",
        alternateText: "Diabetes",
        nameOfAlternateCodingSystem: "SCT",
        originalText: "diabetic",
      },
      { namingSystem: createNamingSystem() },
    );
    const alt = itemAt(getProperty(value as FhirComplex, "coding"), 1);
    expect(propString(alt, "system")).toBe("http://snomed.info/sct");
    expect(propString(alt, "code")).toBe("44054006");
    expect(propString(value as FhirComplex, "text")).toBe("diabetic");
  });
});

describe("toFhirCodeableConcept: the unmapped-code fail-safe (MANDATORY)", () => {
  it("preserves a bare local code with no coding system, never fabricating a FHIR code", () => {
    const { value, issues } = toFhirCodeableConcept(
      { identifier: "LOCAL42", text: "House glucose" }, // no nameOfCodingSystem
      { namingSystem: createNamingSystem() },
    );
    const c = firstCoding(value as FhirComplex);
    expect(propString(c, "code")).toBe("LOCAL42"); // preserved verbatim
    expect(propString(c, "system")).toBeUndefined(); // never invented
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
    expect(issues[0]?.v2Location).toBe("CWE.1");
  });

  it("preserves the code and flags an unrecognized coding-system mnemonic", () => {
    const { value, issues } = toFhirCodeableConcept(
      { identifier: "99123", nameOfCodingSystem: "99LOCAL" },
      { namingSystem: createNamingSystem() },
    );
    const c = firstCoding(value as FhirComplex);
    expect(propString(c, "code")).toBe("99123");
    expect(propString(c, "system")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED);
    expect(issues[0]?.v2Location).toBe("CWE.3");
  });

  it("emits nothing for an empty element", () => {
    const { value, issues } = toFhirCodeableConcept({}, { namingSystem: createNamingSystem() });
    expect(value).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("works with no context (no namingSystem): system unresolved, code preserved", () => {
    const { value, issues } = toFhirCodeableConcept({
      identifier: "789-8",
      nameOfCodingSystem: "LN",
    });
    expect(propString(firstCoding(value as FhirComplex), "code")).toBe("789-8");
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED);
  });

  it("validates clean when embedded as a code (emit gate)", () => {
    const { value } = toFhirCodeableConcept(
      { identifier: "789-8", nameOfCodingSystem: "LN" },
      { namingSystem: createNamingSystem() },
    );
    expect(embedAndValidate([["code", value as FhirComplex]])).toEqual([]);
  });
});

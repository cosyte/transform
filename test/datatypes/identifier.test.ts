import { describe, expect, it } from "vitest";
import { getProperty, isComplex, isPrimitive } from "@cosyte/fhir";
import type { FhirComplex } from "@cosyte/fhir";

import {
  toFhirIdentifier,
  createNamingSystem,
  ISSUE_CODES,
  V2_0203_SYSTEM,
} from "../../src/index.js";
import { embedAndValidate, itemAt, one } from "../_support/fhir.js";

function propString(node: FhirComplex, name: string): string | undefined {
  const p = getProperty(node, name);
  if (p !== undefined && isPrimitive(p) && typeof p.value === "string") return p.value;
  return undefined;
}

describe("toFhirIdentifier: CX.1 → value, CX.4 → system via registry", () => {
  it("resolves an OID assigning authority (HD.2=OID, HD.3=ISO) to urn:oid:", () => {
    const { value, issues } = toFhirIdentifier(
      {
        idNumber: "12345",
        assigningAuthority: { universalId: "1.2.840.114350", universalIdType: "ISO" },
      },
      { namingSystem: createNamingSystem() },
    );
    expect(value).toBeDefined();
    expect(propString(value as FhirComplex, "system")).toBe("urn:oid:1.2.840.114350");
    expect(propString(value as FhirComplex, "value")).toBe("12345");
    expect(issues).toEqual([]);
  });

  it("resolves a UUID authority to a lower-cased urn:uuid:", () => {
    const { value } = toFhirIdentifier(
      {
        idNumber: "X",
        assigningAuthority: {
          universalId: "AB2FdF76-9A4B-1234-5678-90ABCDEF1234",
          universalIdType: "UUID",
        },
      },
      { namingSystem: createNamingSystem() },
    );
    expect(propString(value as FhirComplex, "system")).toBe(
      "urn:uuid:ab2fdf76-9a4b-1234-5678-90abcdef1234",
    );
  });

  it("resolves an explicitly-registered namespace mnemonic", () => {
    const registry = createNamingSystem({
      authorities: { HOSPMRN: "https://hospital.example/mrn" },
    });
    const { value, issues } = toFhirIdentifier(
      { idNumber: "42", assigningAuthority: { namespaceId: "HOSPMRN" } },
      { namingSystem: registry },
    );
    expect(propString(value as FhirComplex, "system")).toBe("https://hospital.example/mrn");
    expect(issues).toEqual([]);
  });

  it("maps CX.5 to Identifier.type over the v2-0203 system", () => {
    const { value } = toFhirIdentifier(
      { idNumber: "42", identifierTypeCode: "MR" },
      { namingSystem: createNamingSystem() },
    );
    const type = getProperty(value as FhirComplex, "type");
    expect(type !== undefined && isComplex(type)).toBe(true);
    const first = itemAt(getProperty(type as FhirComplex, "coding"), 0);
    expect(propString(first, "system")).toBe(V2_0203_SYSTEM);
    expect(propString(first, "code")).toBe("MR");
  });
});

describe("toFhirIdentifier: the HD.1-only fail-safe (MANDATORY)", () => {
  it("NEVER synthesizes a system URI from a bare namespace mnemonic", () => {
    const { value, issues } = toFhirIdentifier(
      { idNumber: "999", assigningAuthority: { namespaceId: "HOSPMRN" } },
      { namingSystem: createNamingSystem() }, // no registry entry for HOSPMRN
    );
    expect(value).toBeDefined();
    // value preserved, system absent, never guessed.
    expect(propString(value as FhirComplex, "value")).toBe("999");
    expect(propString(value as FhirComplex, "system")).toBeUndefined();
    expect(issues).toHaveLength(1);
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED);
    expect(issues[0]?.v2Location).toBe("CX.4");
  });

  it("does not synthesize from an OID that lacks the ISO type", () => {
    const { value, issues } = toFhirIdentifier(
      { idNumber: "1", assigningAuthority: { universalId: "1.2.3.4" } }, // no universalIdType
      { namingSystem: createNamingSystem() },
    );
    expect(propString(value as FhirComplex, "system")).toBeUndefined();
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED);
  });

  it("flags an unresolved authority even with no registry at all", () => {
    const { issues } = toFhirIdentifier({
      idNumber: "1",
      assigningAuthority: { namespaceId: "X" },
    });
    expect(issues[0]?.code).toBe(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED);
  });
});

describe("toFhirIdentifier: empties and dropped components", () => {
  it("emits nothing for a CX with no id number", () => {
    const { value, issues } = toFhirIdentifier({ checkDigit: "7" });
    expect(value).toBeUndefined();
    expect(issues).toEqual([]);
  });

  it("emits a bare identifier with no authority and no issue", () => {
    const { value, issues } = toFhirIdentifier({ idNumber: "77" });
    expect(propString(value as FhirComplex, "value")).toBe("77");
    expect(issues).toEqual([]);
  });

  it("flags CX.7 / CX.8 (period) as dropped (deferred)", () => {
    const { issues } = toFhirIdentifier({
      idNumber: "1",
      effectiveDate: "20200101",
      expirationDate: "20250101",
    });
    expect(issues.map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
    expect(issues.map((i) => i.v2Location)).toEqual(["CX.7", "CX.8"]);
  });

  it("flags CX.9 / CX.10 as dropped", () => {
    const { issues } = toFhirIdentifier({
      idNumber: "1",
      assigningJurisdiction: "US",
      assigningAgencyOrDepartment: "DEPT",
    });
    expect(issues.map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
    expect(issues.map((i) => i.v2Location)).toEqual(["CX.9", "CX.10"]);
  });

  it("validates clean when embedded in a resource (emit gate)", () => {
    const { value } = toFhirIdentifier(
      {
        idNumber: "12345",
        assigningAuthority: { universalId: "1.2.3", universalIdType: "ISO" },
        identifierTypeCode: "MR",
      },
      { namingSystem: createNamingSystem() },
    );
    expect(embedAndValidate([["identifier", one(value as FhirComplex)]])).toEqual([]);
  });
});

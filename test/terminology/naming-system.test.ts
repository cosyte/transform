import { describe, expect, it } from "vitest";

import { createNamingSystem, DEFAULT_V2_CODE_SYSTEMS } from "../../src/index.js";

describe("createNamingSystem — code-system resolution", () => {
  const registry = createNamingSystem();

  it("resolves the seeded FHIR-core mnemonics to their canonical URIs", () => {
    expect(registry.resolveCodeSystem("LN")).toBe("http://loinc.org");
    expect(registry.resolveCodeSystem("SCT")).toBe("http://snomed.info/sct");
    expect(registry.resolveCodeSystem("UCUM")).toBe("http://unitsofmeasure.org");
    expect(registry.resolveCodeSystem("RXNORM")).toBe(
      "http://www.nlm.nih.gov/research/umls/rxnorm",
    );
    expect(registry.resolveCodeSystem("CVX")).toBe("http://hl7.org/fhir/sid/cvx");
  });

  it("returns undefined for an unrecognized or empty mnemonic (never invents a URI)", () => {
    expect(registry.resolveCodeSystem("99LOCAL")).toBeUndefined();
    expect(registry.resolveCodeSystem("")).toBeUndefined();
  });

  it("merges caller-supplied code systems over the defaults", () => {
    const extended = createNamingSystem({ codeSystems: { LOCALSYS: "https://x.example/cs" } });
    expect(extended.resolveCodeSystem("LOCALSYS")).toBe("https://x.example/cs");
    expect(extended.resolveCodeSystem("LN")).toBe("http://loinc.org");
  });

  it("the default table is frozen", () => {
    expect(Object.isFrozen(DEFAULT_V2_CODE_SYSTEMS)).toBe(true);
  });
});

describe("createNamingSystem — assigning-authority (HD) resolution", () => {
  const registry = createNamingSystem();

  it("auto-derives urn:oid: only for a valid OID with universalIdType ISO", () => {
    expect(
      registry.resolveAssigningAuthority({ universalId: "1.2.840.114350", universalIdType: "ISO" }),
    ).toBe("urn:oid:1.2.840.114350");
  });

  it("rejects an OID without the ISO type, and a malformed OID", () => {
    expect(registry.resolveAssigningAuthority({ universalId: "1.2.3" })).toBeUndefined();
    expect(
      registry.resolveAssigningAuthority({ universalId: "9.abc", universalIdType: "ISO" }),
    ).toBeUndefined();
  });

  it("auto-derives a lower-cased urn:uuid: for a valid UUID", () => {
    expect(
      registry.resolveAssigningAuthority({
        universalId: "AB2FDF76-9A4B-1234-5678-90ABCDEF1234",
        universalIdType: "UUID",
      }),
    ).toBe("urn:uuid:ab2fdf76-9a4b-1234-5678-90abcdef1234");
  });

  it("NEVER derives a system from a bare HD.1 namespace mnemonic", () => {
    expect(registry.resolveAssigningAuthority({ namespaceId: "HOSPMRN" })).toBeUndefined();
    expect(registry.resolveAssigningAuthority({})).toBeUndefined();
  });

  it("resolves an explicitly-registered namespace or OID", () => {
    const seeded = createNamingSystem({
      authorities: {
        HOSPMRN: "https://h.example/mrn",
        "2.16.840.1.113883.4.1": "http://hl7.org/fhir/sid/us-ssn",
      },
    });
    expect(seeded.resolveAssigningAuthority({ namespaceId: "HOSPMRN" })).toBe(
      "https://h.example/mrn",
    );
    expect(seeded.resolveAssigningAuthority({ universalId: "2.16.840.1.113883.4.1" })).toBe(
      "http://hl7.org/fhir/sid/us-ssn",
    );
  });

  it("prefers an explicit registry entry over auto-derivation", () => {
    const seeded = createNamingSystem({ authorities: { "1.2.3": "https://override.example" } });
    // "1.2.3" would not auto-derive (no ISO type) but the registry entry resolves it.
    expect(seeded.resolveAssigningAuthority({ universalId: "1.2.3", universalIdType: "ISO" })).toBe(
      "https://override.example",
    );
  });
});

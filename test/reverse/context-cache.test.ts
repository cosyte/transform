/**
 * The reverse path inverts the code-system registry (the default seed plus the caller's entries) to
 * turn a canonical system URI back into its v2 mnemonic. It used to invert it on every conversion; it
 * is now inverted once for the default seed, and once per caller `codeSystems` object for as long as
 * that object's entries stay the same. These tests count the inversions, and check that a cached
 * answer is never a stale one.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type * as V2 from "../../src/reverse/v2.js";

const inversions = vi.hoisted(() => ({ count: 0 }));

vi.mock("../../src/reverse/v2.js", async (importOriginal) => {
  const original = await importOriginal<typeof V2>();
  return {
    ...original,
    invertCodeMap: (forward: Readonly<Record<string, string>>) => {
      inversions.count++;
      return original.invertCodeMap(forward);
    },
  };
});

const { reverseContext } = await import("../../src/reverse/coding.js");

beforeEach(() => {
  inversions.count = 0;
});

describe("reverseContext: the inverted registry is built once", () => {
  it("inverts the default registry at most once across conversions", () => {
    for (let i = 0; i < 5; i++) {
      expect(reverseContext().mnemonicFor("http://loinc.org")).toBe("LN");
      expect(reverseContext({}).mnemonicFor("http://snomed.info/sct")).toBe("SCT");
    }
    expect(inversions.count).toBeLessThanOrEqual(1);
  });

  it("inverts a caller's codeSystems object once while its entries stay the same", () => {
    const codeSystems = { LOCAL: "http://example.org/cs" };
    for (let i = 0; i < 5; i++) {
      expect(reverseContext({ codeSystems }).mnemonicFor("http://example.org/cs")).toBe("LOCAL");
    }
    expect(inversions.count).toBe(1);
  });

  it("inverts again when the caller changed the object's entries, never answering from the old ones", () => {
    const codeSystems: Record<string, string> = { LOCAL: "http://example.org/cs" };
    expect(reverseContext({ codeSystems }).mnemonicFor("http://example.org/cs")).toBe("LOCAL");
    codeSystems["LOCAL"] = "http://example.org/other";
    const changed = reverseContext({ codeSystems });
    expect(changed.mnemonicFor("http://example.org/cs")).toBeUndefined();
    expect(changed.mnemonicFor("http://example.org/other")).toBe("LOCAL");
    codeSystems["EXTRA"] = "http://example.org/extra";
    expect(reverseContext({ codeSystems }).mnemonicFor("http://example.org/extra")).toBe("EXTRA");
    expect(inversions.count).toBe(3);
  });

  it("keeps an ambiguity a caller entry creates, as the per-call inversion did", () => {
    const codeSystems = { LOINC: "http://loinc.org" };
    expect(reverseContext({ codeSystems }).mnemonicFor("http://loinc.org")).toBeUndefined();
    expect(reverseContext({ codeSystems }).mnemonicFor("http://loinc.org")).toBeUndefined();
  });

  it("reads a null codeSystems from untyped code as no entries, on every call", () => {
    const options = { codeSystems: null } as unknown as Parameters<typeof reverseContext>[0];
    expect(reverseContext(options).mnemonicFor("http://loinc.org")).toBe("LN");
    expect(reverseContext(options).mnemonicFor("http://loinc.org")).toBe("LN");
    expect(inversions.count).toBe(2);
  });
});

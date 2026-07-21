import { describe, expect, it } from "vitest";

import {
  ISSUE_CODES,
  FATAL_CODES,
  ISSUE_REGISTRY,
  issue,
  fhirIssueTypeFor,
  type IssueCode,
} from "../../src/index.js";

describe("stable code registries", () => {
  it("every issue code is its own value (survives Object.values into a tripwire)", () => {
    for (const [key, value] of Object.entries(ISSUE_CODES)) expect(key).toBe(value);
    for (const [key, value] of Object.entries(FATAL_CODES)) expect(key).toBe(value);
  });

  it("pins the issue-code set through Phase 2 (a rename/removal is a breaking change)", () => {
    expect(Object.values(ISSUE_CODES).sort()).toEqual(
      [
        // Phase 1 — datatype + diagnostic foundation.
        "TRANSFORM_ADDRESS_USE_UNMAPPED",
        "TRANSFORM_CODE_SYSTEM_UNRESOLVED",
        "TRANSFORM_CODE_UNMAPPED",
        "TRANSFORM_ELEMENT_DROPPED",
        "TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED",
        "TRANSFORM_NAME_USE_UNMAPPED",
        "TRANSFORM_QUANTITY_VALUE_INVALID",
        "TRANSFORM_TIMESTAMP_INVALID",
        "TRANSFORM_TIMESTAMP_NO_TIMEZONE",
        "TRANSFORM_UNIT_NOT_UCUM",
        // Phase 2 — message-level assembly (additions only).
        "TRANSFORM_REQUIRED_ELEMENT_UNKNOWN",
        "TRANSFORM_RESOURCE_INVALID",
        "TRANSFORM_SEGMENT_ASSEMBLED",
      ].sort(),
    );
  });

  it("has a registry entry for every issue code, with a valid severity", () => {
    for (const code of Object.values(ISSUE_CODES)) {
      const meta = ISSUE_REGISTRY[code];
      expect(meta).toBeDefined();
      expect(["error", "warning", "information"]).toContain(meta.severity);
      expect(meta.fhirIssueType.length).toBeGreaterThan(0);
      expect(meta.message.length).toBeGreaterThan(0);
    }
  });
});

describe("issue factory", () => {
  it("draws severity + message from the registry and carries only positional metadata", () => {
    const i = issue(ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE, "TS.1", "dateTime");
    expect(i.severity).toBe("warning");
    expect(i.v2Location).toBe("TS.1");
    expect(i.fhirPath).toBe("dateTime");
    expect(i.message).toBe(ISSUE_REGISTRY[ISSUE_CODES.TRANSFORM_TIMESTAMP_NO_TIMEZONE].message);
  });

  it("omits fhirPath when not supplied", () => {
    const i = issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.9");
    expect(i.fhirPath).toBeUndefined();
  });

  it("messages are static and value-free (no interpolation surface)", () => {
    for (const code of Object.values(ISSUE_CODES) as IssueCode[]) {
      const a = issue(code, "SEG.1");
      const b = issue(code, "OTHER.9", "Some.path");
      expect(a.message).toBe(b.message); // message never depends on the location args
    }
  });

  it("exposes the FHIR issue-type for a code", () => {
    expect(fhirIssueTypeFor(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED)).toBe("not-found");
  });
});

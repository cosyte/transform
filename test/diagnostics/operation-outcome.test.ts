import { describe, expect, it } from "vitest";
import {
  getProperty,
  isList,
  isPrimitive,
  resourceType,
  serializeResource,
  validateResource,
} from "@cosyte/fhir";
import type { FhirComplex } from "@cosyte/fhir";

import { toOperationOutcome, issue, ISSUE_CODES, TRANSFORM_ISSUE_SYSTEM } from "../../src/index.js";
import { itemAt } from "../_support/fhir.js";

function issuesList(oo: FhirComplex): FhirComplex[] {
  const node = getProperty(oo, "issue");
  if (node === undefined || !isList(node)) throw new Error("no issue list");
  return node.items.map((_, i) => itemAt(node, i));
}
function propString(node: FhirComplex, name: string): string | undefined {
  const p = getProperty(node, name);
  if (p !== undefined && isPrimitive(p) && typeof p.value === "string") return p.value;
  return undefined;
}
function hasProp(node: FhirComplex, name: string): boolean {
  return getProperty(node, name) !== undefined;
}

describe("toOperationOutcome", () => {
  it("renders a value-free OperationOutcome resource from issues", () => {
    const oo = toOperationOutcome([
      issue(ISSUE_CODES.TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED, "CX.4", "Identifier.system"),
    ]);
    expect(resourceType(oo)).toBe("OperationOutcome");
    const issues = issuesList(oo);
    expect(issues).toHaveLength(1);
    const i = issues[0] as FhirComplex;
    expect(propString(i, "severity")).toBe("warning");
    expect(propString(i, "code")).toBe("not-found");
    // v2 location travels in diagnostics (metadata), the FHIR path in expression.
    expect(propString(i, "diagnostics")).toBe("CX.4");
    const details = getProperty(i, "details") as FhirComplex;
    const firstCoding = itemAt(getProperty(details, "coding"), 0);
    expect(propString(firstCoding, "system")).toBe(TRANSFORM_ISSUE_SYSTEM);
    expect(propString(firstCoding, "code")).toBe("TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED");
  });

  it("omits expression for an issue with no FHIR path", () => {
    const oo = toOperationOutcome([issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "CX.9")]);
    const i = issuesList(oo)[0] as FhirComplex;
    expect(hasProp(i, "expression")).toBe(false);
    expect(propString(i, "diagnostics")).toBe("CX.9");
  });

  it("produces a non-empty, all-clear OperationOutcome for zero issues", () => {
    const oo = toOperationOutcome([]);
    const issues = issuesList(oo);
    expect(issues).toHaveLength(1);
    expect(propString(issues[0] as FhirComplex, "severity")).toBe("information");
  });

  it("is a serializable, structurally-valid resource", () => {
    const oo = toOperationOutcome([
      issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "CWE.1", "Coding.code"),
    ]);
    expect(() => serializeResource(oo)).not.toThrow();
    expect(validateResource(oo).valid).toBe(true);
  });
});

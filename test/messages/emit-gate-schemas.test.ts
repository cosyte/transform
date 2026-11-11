/**
 * The emit gate validates each produced resource with `@cosyte/fhir`'s `validateResource`. The
 * validator looks a schema up for the root resource type alone, and merges every schema it is handed
 * into a new registry on each call, so the gate hands it only the resource's own emit schema, or none
 * for a type that has none. These tests record every call the gate makes over messages that produce
 * most of the gated types, and check what it handed over. That the decisions themselves did not move is
 * `test/output-equivalence.test.ts`'s proof.
 */

import { describe, expect, it, vi } from "vitest";
import type * as Fhir from "@cosyte/fhir";
import type { FhirComplex, ValidateOptions } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

const calls = vi.hoisted(() => [] as { type: unknown; options: ValidateOptions | undefined }[]);

vi.mock("@cosyte/fhir", async (importOriginal) => {
  const original = await importOriginal<typeof Fhir>();
  return {
    ...original,
    validateResource: (resource: FhirComplex, options?: ValidateOptions) => {
      calls.push({ type: original.resourceType(resource), options });
      return original.validateResource(resource, options);
    },
  };
});

const { toFhir, createNamingSystem } = await import("../../src/index.js");
const { EMIT_SCHEMAS } = await import("../../src/messages/emit-schemas.js");
const { admission, labResult, longNote } = await import("../../bench/shapes.mjs");
const { COMPLETENESS_FIXTURES } = await import("../_support/completeness-fixtures.js");
const { NO_TQ1_ORDER } = await import("../_support/tq1-fixtures.js");

function runAll(): void {
  const texts = [
    admission(1),
    labResult(1, 3),
    longNote(1, 3),
    NO_TQ1_ORDER.join("\r"),
    ...COMPLETENESS_FIXTURES.map((f) => f.raw),
  ];
  for (const raw of texts) toFhir(parseHL7(raw), { namingSystem: createNamingSystem() });
}

describe("the emit gate hands the validator only the schema it is checked against", () => {
  calls.length = 0;
  runAll();
  const byType = new Map(EMIT_SCHEMAS.map((s) => [s.type, s]));

  it("validates a Patient strict, with no schemas", () => {
    const patients = calls.filter((c) => c.type === "Patient");
    expect(patients.length).toBeGreaterThan(0);
    for (const c of patients) expect(c.options).toEqual({ mode: "strict" });
  });

  it("hands every other type its own emit schema alone, or none when it has none", () => {
    const others = calls.filter((c) => c.type !== "Patient");
    const seen = new Set(others.map((c) => c.type));
    // The messages above reach types that carry an emit schema.
    expect([...seen].some((t) => byType.has(String(t)))).toBe(true);
    for (const c of others) {
      const own = byType.get(String(c.type));
      if (own === undefined) expect(c.options).toEqual({ mode: "lenient" });
      else expect(c.options).toEqual({ mode: "lenient", schemas: [own] });
    }
  });
});

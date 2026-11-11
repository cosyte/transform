/**
 * The emit gate validates each produced resource with `@cosyte/fhir`'s `validateResource`. The
 * validator looks a schema up for the root resource type alone, and merges every schema it is handed
 * as `schemas` into a new registry on each call, so the gate builds one registry per emit schema, at
 * the first resource of its type, and hands that registry over on every call; a type with no emit
 * schema is handed none. These tests record every call the gate makes, and every registry it builds,
 * over two passes of messages that produce most of the gated types, and check what it handed over.
 * That the decisions themselves did not move is `test/output-equivalence.test.ts`'s proof.
 */

import { describe, expect, it, vi } from "vitest";
import type * as Fhir from "@cosyte/fhir";
import type { FhirComplex, ResourceSchema, ValidateOptions } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

const calls = vi.hoisted(() => [] as { type: unknown; options: ValidateOptions | undefined }[]);
const built = vi.hoisted(() => [] as (readonly ResourceSchema[] | undefined)[]);

vi.mock("@cosyte/fhir", async (importOriginal) => {
  const original = await importOriginal<typeof Fhir>();
  return {
    ...original,
    buildRegistry: (extra?: readonly ResourceSchema[]) => {
      built.push(extra);
      return original.buildRegistry(extra);
    },
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

describe("the emit gate builds each emit schema's registry once and hands it over", () => {
  calls.length = 0;
  built.length = 0;
  runAll();
  runAll();
  const byType = new Map(EMIT_SCHEMAS.map((s) => [s.type, s]));

  it("validates a Patient strict, with no schemas and no registry", () => {
    const patients = calls.filter((c) => c.type === "Patient");
    expect(patients.length).toBeGreaterThan(0);
    for (const c of patients) expect(c.options).toEqual({ mode: "strict" });
  });

  it("hands every other type its own registry, and a type with no emit schema none", () => {
    const others = calls.filter((c) => c.type !== "Patient");
    // The messages above reach types that carry an emit schema.
    expect(others.some((c) => byType.has(String(c.type)))).toBe(true);
    for (const c of others) {
      const own = byType.get(String(c.type));
      if (own === undefined) {
        expect(c.options).toEqual({ mode: "lenient" });
        continue;
      }
      expect(Object.keys(c.options ?? {}).sort()).toEqual(["mode", "registry", "schemas"]);
      expect(c.options?.mode).toBe("lenient");
      // The schema alone rides along for a release that does not read `registry`.
      expect(c.options?.schemas).toEqual([own]);
      // The registry reads the type's own emit schema, base elements merged in.
      const schema = c.options?.registry?.(own.type);
      expect(schema?.type).toBe(own.type);
      for (const [name, element] of Object.entries(own.elements)) {
        expect(schema?.elements[name]).toEqual(element);
      }
    }
  });

  it("hands every call for a type the same registry, built once from that type's schema alone", () => {
    const gated = calls.filter((c) => byType.has(String(c.type)));
    const registries = new Map<unknown, Set<unknown>>();
    for (const c of gated) {
      const seen = registries.get(c.type) ?? new Set();
      seen.add(c.options?.registry);
      registries.set(c.type, seen);
    }
    for (const seen of registries.values()) expect(seen.size).toBe(1);
    // The options themselves are made once per type, not per call.
    expect(new Set(gated.map((c) => c.options)).size).toBe(registries.size);
    // Two passes over the messages, yet one registry per gated type, each built from its own schema.
    expect(gated.length).toBeGreaterThan(registries.size);
    const builtForEmit = built.filter(
      (extra) => extra !== undefined && extra.some((s) => byType.get(s.type) === s),
    );
    expect(builtForEmit.length).toBe(registries.size);
    for (const extra of builtForEmit) expect(extra).toHaveLength(1);
    const builtTypes = builtForEmit.map((extra) => extra?.[0]?.type);
    expect(new Set(builtTypes).size).toBe(builtTypes.length);
  });
});

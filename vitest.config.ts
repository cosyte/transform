import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/transform from the shared @cosyte/vitest-config standard.
 *
 * Per-directory >= 90 coverage gates on the core dirs. `@cosyte/transform` is a transformation
 * library (a consumer of `@cosyte/hl7` + `@cosyte/fhir`), not a byte parser, so the covered dirs are
 * the datatype converters, the diagnostic channel, and the terminology resolver — the Phase-1
 * foundation. Add directories here (e.g. "messages", "profiles") as later phases land.
 */
export default cosyteVitest({
  coverageDirs: ["datatypes", "diagnostics", "terminology"],
  test: {
    globals: false,
    environment: "node",
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});

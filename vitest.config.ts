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
  coverageDirs: ["datatypes", "diagnostics", "terminology", "messages"],
  test: {
    globals: false,
    environment: "node",
    // ▶ THIS GLOB IS WHAT SELECTS THE SUITES, AND NO BRANCH RULESET CAN SEE IT.
    // `main` is protected by ruleset `ci-required-checks` (19914044), which requires the
    // `ci / verify (22|24, ubuntu-latest)` contexts. That pins the fact that `pnpm test` and
    // `pnpm test:coverage` RUN. It does not pin what they run: the shared @cosyte/vitest-config
    // sets no `test.include` of its own, so this line decides today. It is NOT the only lever --
    // the `test`/`test:coverage` script bodies in package.json are plain `vitest run` invocations
    // and a path argument or `--exclude` added there drops suites without touching this glob,
    // equally unobserved by the ruleset. Narrow either and the property
    // + fuzz suites that carry this package's real correctness claims
    // (`test/messages/property.test.ts` -- never-throw, only registered value-free issue codes,
    // no dangling `urn:uuid:` reference, only structurally-valid focal resources; and
    // `test/datatypes/boundary.property.test.ts`) stop running, with the job still green and the
    // ruleset still satisfied.
    //
    // Coverage is a THIN and INCIDENTAL backstop, not a real one. Measured 2026-07-28 on
    // `dfc7739`: excluding `test/messages/property.test.ts` alone takes `src/messages/**` branch
    // coverage from 90.11% to 88.82%, which does breach the per-directory >= 90 gate, so today
    // the deletion would be caught. That is a 1.29-point margin over an incidental fact -- the
    // property run happens to be the only thing reaching some branches. Any example test that
    // covers them restores the margin and the backstop goes quiet, and coverage could never see
    // the loss of the PROPERTIES themselves (never-throw, no unregistered issue code, no value
    // in a diagnostic, no dangling reference) since a trivial test hitting the same lines
    // satisfies it. Do not treat the gate as protecting this line. Change it only deliberately.
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});

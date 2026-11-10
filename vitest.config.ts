import { cosyteVitest } from "@cosyte/vitest-config";

/**
 * Vitest config for @cosyte/transform from the shared @cosyte/vitest-config standard, which owns the
 * coverage provider, reporters, and include and exclude sets. What follows is only what this
 * repository adds.
 *
 * Coverage is gated at 100% for lines, branches, functions and statements across every file in
 * `src/` (barrels excepted, per the shared standard), and `coverageDirs` holds each listed `src/`
 * directory to the same 100% on its own, so a well-covered directory cannot carry a poorly covered
 * one. This is a transformation library (a consumer of `@cosyte/hl7` and `@cosyte/fhir`), not a byte
 * parser, so the gated directories are the datatype converters, the diagnostic channel, the
 * terminology resolver, the message assemblers and the FHIR to v2 path. Add a directory here when one
 * lands. A threshold only rises: a line that truly cannot be reached carries an inline `v8 ignore`
 * comment naming its reason, never a lowered number here.
 */
const COVERAGE_DIRS = ["datatypes", "diagnostics", "terminology", "messages", "reverse"];

/** Every metric at 100. */
const FULL = { lines: 100, branches: 100, functions: 100, statements: 100 };

export default cosyteVitest({
  coverageDirs: COVERAGE_DIRS,
  coverageThresholds: {
    ...FULL,
    ...Object.fromEntries(COVERAGE_DIRS.map((dir) => [`src/${dir}/**`, FULL])),
  },
  test: {
    // ▶ THIS GLOB IS WHAT SELECTS THE SUITES, AND NO BRANCH RULESET CAN SEE IT.
    // `main` is protected by ruleset `ci-required-checks` (19914044), which requires the
    // `ci / verify (22|24, ubuntu-latest)` contexts. That pins the fact that `pnpm test` and
    // `pnpm test:coverage` RUN. It does not pin what they run: the shared @cosyte/vitest-config
    // sets no `test.include` of its own, so this line decides today. The `test`/`test:coverage`
    // script bodies are no longer a second lever: they are exactly `cosyte-process test` and
    // `cosyte-process test --coverage`, and `pnpm check:process` (CI's required `standards` job)
    // fails on any other body. A `test` entry in cosyte-process.config.json could still add a path
    // or an `--exclude`, unobserved by the ruleset. Narrow either and the property
    // + fuzz suites that carry this package's real correctness claims
    // (`test/messages/property.test.ts` -- never-throw, only registered value-free issue codes,
    // no dangling `urn:uuid:` reference, only structurally-valid focal resources; and
    // `test/datatypes/boundary.property.test.ts`) stop running, with the job still green and the
    // ruleset still satisfied.
    //
    // Coverage is a THIN and INCIDENTAL backstop, not a real one. Measured 2026-07-28 on
    // `dfc7739`, under the 90% gate of the time: excluding `test/messages/property.test.ts`
    // alone took `src/messages/**` branch coverage from 90.11% to 88.82%, a 1.29-point margin.
    // Measured again 2026-11-10 under the 100% gate: the same exclusion takes overall branch
    // coverage from 100% to 98.99%, so today the deletion would be caught. Both rest on an
    // incidental fact -- the property run happens to be the only thing reaching some branches.
    // Any example test that covers them silences the backstop, and coverage could never see
    // the loss of the PROPERTIES themselves (never-throw, no unregistered issue code, no value
    // in a diagnostic, no dangling reference) since a trivial test hitting the same lines
    // satisfies it. Do not treat the gate as protecting this line. Change it only deliberately.
    include: ["test/**/*.test.ts", "src/**/*.test.ts"],
    // Twice vitest's 5 s default for a test: the property and fuzz suites and the cases that build
    // the package or spawn tsx run whole message corpora per case and need the room on a busy CI
    // runner. The hook timeout is left at vitest's own default, which is already 10 s.
    testTimeout: 10_000,
  },
});

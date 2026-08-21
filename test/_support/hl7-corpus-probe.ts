/**
 * A vitest setup file that records every raw HL7 v2 string the suite hands to `parseHL7`.
 *
 * This is the DERIVATION of `test/_support/hl7-baseline-corpus.json`. The corpus is collected by
 * running the existing suites through this probe rather than transcribed by hand, so "every HL7 v2
 * fixture already present in the repository" is a measurement rather than a claim, and a fixture
 * assembled by a test helper (`pv1({...})`) is captured in its final wire form rather than in the
 * form its source happens to be written in.
 *
 * It is NOT part of `pnpm test`: it is opted into explicitly and
 * `scripts/hl7-refresh-collect-corpus.ts` is its only caller. Property and fuzz suites GENERATE
 * their inputs, so that caller leaves them out of the file list it passes: a generated message is
 * not a fixture.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { vi } from "vitest";

import type * as Hl7 from "@cosyte/hl7";

/**
 * Where the probe appends. Under `node_modules/` because it is transient derivation exhaust, never
 * a committed artifact; the collector truncates it before each run and reads it after.
 */
export const CORPUS_PROBE_LOG = join(
  process.cwd(),
  "node_modules",
  ".cache",
  "hl7-refresh",
  "parse-calls.jsonl",
);

/**
 * The wrapper takes ONE argument on purpose. `parseHL7` is overloaded on its optional second
 * parameter (a `Profile` or a `ParseOptions`), and every call site in this repository passes the
 * raw message alone; a wrapper that forwarded a union of the two would need a cast to pick an
 * overload, which would be a cast written to satisfy a derivation tool rather than a caller. If a
 * call site ever grows a second argument, the typecheck reds here rather than the probe quietly
 * dropping it.
 */
vi.mock("@cosyte/hl7", async (importOriginal) => {
  const actual = await importOriginal<typeof Hl7>();
  return {
    ...actual,
    parseHL7: (raw: string) => {
      mkdirSync(dirname(CORPUS_PROBE_LOG), { recursive: true });
      appendFileSync(CORPUS_PROBE_LOG, `${JSON.stringify(raw)}\n`);
      return actual.parseHL7(raw);
    },
  };
});

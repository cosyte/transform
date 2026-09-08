#!/usr/bin/env tsx
/**
 * `pnpm run conformance`: regenerate the published result, or check it without writing.
 *
 * Two modes, and the default is the one that writes:
 *
 * - `pnpm run conformance` regenerates `documentation/conformance/result.json` and
 *   `documentation/conformance/report.md` from a live run.
 * - `pnpm run conformance --check` runs the same measurement, compares it against the committed
 *   artifacts and the reviewed claims register, writes nothing, and exits non-zero on any
 *   difference. It is the same code path the suite grades, so a green suite and a green `--check`
 *   cannot disagree.
 *
 * ▶ EVERY FAILURE PATH EXITS NON-ZERO AND SAYS WHICH PAIR MOVED. An unobtainable package, an empty
 * corpus, a message that will not parse, a claim that broke, a claim that went stale, a published
 * result that drifted: each is a refusal naming the thing, never a quiet pass.
 *
 * ▶ THIS FILE IS A COMMAND AND NOTHING IMPORTS IT, AND THAT IS A MEASURED RULE RATHER THAN A STYLE
 * PREFERENCE. Importing it RUNS it, and its default mode WRITES the published artifacts. When the
 * suite imported it merely to learn a path, every suite that read the committed result was
 * regenerating that result first, which made the drift check structurally incapable of failing: the
 * committed artifact was mutated on purpose and the whole suite stayed green. The paths, the
 * serializer and the reader now live in `artifacts.ts`, which has no side effect, and `main()` runs
 * only when this file is the process entry point.
 */

import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

import { REPORT_PATH, RESULT_PATH, readPublishedResult, serializeResult } from "./artifacts.js";
import {
  checkAgainstPublished,
  checkClaims,
  checkRunIntegrity,
  formatFailures,
  type CheckFailure,
} from "./check.js";
import { loadRunInputs, runConformance, type ConformanceResult } from "./harness.js";
import { renderReport } from "./report.js";

function write(repoRoot: string, relative: string, contents: string): void {
  const path = join(repoRoot, relative);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, "utf8");
}

/**
 * The repository root to run against.
 *
 * ▶ `--repo-root` IS NOT A BYPASS, AND THE DIFFERENCE FROM ONE IS STRUCTURAL. It cannot make a
 * failing run pass: a swapped corpus still has to yield all seven published messages or
 * `checkRunIntegrity` refuses; a swapped vendor directory still has to hash to the committed pins;
 * and in `--check` mode the observed result still has to equal the committed published result. What
 * it buys is that the unobtainable-input suite can exercise the REAL exit codes of the REAL entry
 * point against an absent package, a corrupted one, an empty corpus and an unparseable message,
 * rather than asserting against a function and hoping the process agrees.
 *
 * @param argv - The process arguments.
 * @returns The repository root.
 */
function repoRootFrom(argv: readonly string[]): string {
  const index = argv.indexOf("--repo-root");
  const value = index < 0 ? undefined : argv[index + 1];
  return value ?? process.cwd();
}

function main(): void {
  const repoRoot = repoRootFrom(process.argv);
  const check = process.argv.includes("--check");

  let result: ConformanceResult;
  let register;
  try {
    const inputs = loadRunInputs(repoRoot);
    register = inputs.register;
    result = runConformance(inputs);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const failures: CheckFailure[] = [...checkRunIntegrity(result), ...checkClaims(result, register)];

  if (check) {
    const published = readPublishedResult(repoRoot);
    failures.push(...checkAgainstPublished(result, published));
    const publishedJson = readFileSync(join(repoRoot, RESULT_PATH), "utf8");
    if (publishedJson !== serializeResult(result)) {
      failures.push({
        kind: "drift",
        pair: RESULT_PATH,
        detail:
          "the committed result is not what a live run now produces. Run `pnpm run conformance`.",
      });
    }
    const publishedReport = readFileSync(join(repoRoot, REPORT_PATH), "utf8");
    if (publishedReport !== renderReport(result)) {
      failures.push({
        kind: "drift",
        pair: REPORT_PATH,
        detail:
          "the committed report is not what a live run now renders. Run `pnpm run conformance`.",
      });
    }
  } else {
    write(repoRoot, RESULT_PATH, serializeResult(result));
    write(repoRoot, REPORT_PATH, renderReport(result));
    console.log(`wrote ${RESULT_PATH} and ${REPORT_PATH}`);
  }

  console.log(
    `${String(result.summary.messagesWithZeroErrors)} of ${String(result.corpus.messageCount)} messages ` +
      `produced a Bundle with zero error-severity results; ` +
      `${String(result.summary.resourcesValidated)} resources validated, ` +
      `${String(result.summary.errorFindings)} error-severity results.`,
  );

  if (failures.length > 0) {
    console.error(`\nrefusing the run: ${String(failures.length)} check(s) failed:`);
    console.error(formatFailures(failures));
    process.exit(1);
  }
}

// Defence in depth behind the module split above: even if something imports this file again, the
// command only runs when it IS the command.
const invokedDirectly =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) main();

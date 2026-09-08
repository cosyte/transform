/**
 * The committed artifacts: where they live, how the machine-readable one is serialized, and how to
 * read it back.
 *
 * ▶ THIS MODULE EXISTS BECAUSE `run.ts` HAS A SIDE EFFECT AND THIS ONE MUST NOT. `run.ts` is a
 * command: importing it runs it. The paths and the serializer are needed by the suite, and a suite
 * that imported the command in order to learn a path would REGENERATE the published result before
 * comparing anything to it, which makes the drift check structurally incapable of failing. That was
 * not a hypothetical: it happened, and it was caught only by mutating the committed artifact and
 * watching the suite stay green. Everything importable lives here; `run.ts` imports it and adds the
 * side effect on top.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ConformanceResult } from "./harness.js";

/** The generated machine-readable result, relative to the repository root. */
export const RESULT_PATH = join("documentation", "conformance", "result.json");

/** The generated human-readable result, relative to the repository root. */
export const REPORT_PATH = join("documentation", "conformance", "report.md");

/**
 * Serialize a measurement exactly as the committed artifact carries it.
 *
 * @param result - The measurement.
 * @returns The artifact text, ending in a newline.
 */
export function serializeResult(result: ConformanceResult): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

/**
 * Read the committed published result.
 *
 * @param repoRoot - The repository root.
 * @returns The published measurement.
 */
export function readPublishedResult(repoRoot: string): ConformanceResult {
  return JSON.parse(readFileSync(join(repoRoot, RESULT_PATH), "utf8")) as ConformanceResult;
}

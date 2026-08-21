#!/usr/bin/env tsx
/**
 * Derive `test/_support/hl7-baseline-corpus.json`: every fixed HL7 v2 message this repository's
 * suites hand to `parseHL7`.
 *
 * ===========================================================================
 * WHY THIS EXISTS, AND WHY IT MEASURES RATHER THAN TRANSCRIBES
 * ===========================================================================
 *
 * The regression evidence for a `@cosyte/hl7` refresh has to run the SAME corpus before and after
 * the bump. This package ships no standalone `.hl7` fixture file: every message in its corpus is an
 * inline `.ts` literal, several are assembled by a test helper (`pv1({ 2: "I", 44: "..." })`), and
 * a few are produced by the reverse path and parsed back. Transcribing that by hand would be a
 * claim about completeness that nothing checks. So the corpus is COLLECTED: the suites run once
 * through `test/_support/hl7-corpus-probe.ts`, which records every raw string handed to `parseHL7`,
 * and the result is frozen into a committed JSON file.
 *
 * ▶ THE FROZEN FILE IS THE POINT. It is captured once, BEFORE the dependency is bumped, and both
 *   the pre-refresh and the post-refresh capture read it. Re-deriving it after the bump would let
 *   the corpus itself move (some members are messages the reverse path SERIALIZED, so a serializer
 *   change would rewrite the input as well as the output) and the comparison would no longer be
 *   like for like.
 *
 * ▶ PROPERTY AND FUZZ SUITES ARE EXCLUDED, by name, in `isFixtureSuite`. They GENERATE their
 *   inputs from `fast-check`, so what they parse is not a fixture and is not stable run to run.
 *
 * Usage: `pnpm exec tsx scripts/hl7-refresh-collect-corpus.ts`
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const REPO_ROOT = process.cwd();
const CACHE_DIR = join(REPO_ROOT, "node_modules", ".cache", "hl7-refresh");
const PROBE_LOG = join(CACHE_DIR, "parse-calls.jsonl");
const TMP_CONFIG = join(CACHE_DIR, "vitest.corpus.config.ts");
const OUT_PATH = join(REPO_ROOT, "test", "_support", "hl7-baseline-corpus.json");

/**
 * A suite whose HL7 v2 inputs are FIXTURES rather than generated. The exclusion is by filename and
 * it is deliberately literal: a generated message is not a fixture, and a fuzz suite would put a
 * different corpus in the file on every run.
 */
function isFixtureSuite(rel: string): boolean {
  return rel.endsWith(".test.ts") && !rel.includes("property");
}

function trackedTestFiles(): string[] {
  const out = execFileSync("git", ["ls-files", "test"], { cwd: REPO_ROOT, encoding: "utf8" });
  return out.split("\n").filter(isFixtureSuite).sort();
}

function main(): void {
  mkdirSync(CACHE_DIR, { recursive: true });
  rmSync(PROBE_LOG, { force: true });

  writeFileSync(
    TMP_CONFIG,
    [
      'import { defineConfig } from "vitest/config";',
      "",
      "export default defineConfig({",
      "  test: {",
      "    globals: false,",
      '    environment: "node",',
      '    setupFiles: ["test/_support/hl7-corpus-probe.ts"],',
      "    testTimeout: 30_000,",
      "    hookTimeout: 30_000,",
      "  },",
      "});",
      "",
    ].join("\n"),
    "utf8",
  );

  const files = trackedTestFiles();
  console.log(`[hl7-refresh] collecting from ${String(files.length)} fixture suites`);
  execFileSync(
    "pnpm",
    ["exec", "vitest", "run", "--root", REPO_ROOT, "--config", TMP_CONFIG, ...files],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );

  if (!existsSync(PROBE_LOG)) {
    throw new Error(`the probe wrote nothing to ${PROBE_LOG}: the corpus would be empty`);
  }
  const seen = new Set<string>();
  for (const line of readFileSync(PROBE_LOG, "utf8").split("\n")) {
    if (line.trim() === "") continue;
    const raw: unknown = JSON.parse(line);
    if (typeof raw !== "string") throw new Error("probe log carried a non-string entry");
    seen.add(raw);
  }
  if (seen.size === 0) throw new Error("the probe recorded zero parseHL7 calls");

  // Sorted, so the file is byte-stable whatever order the suites happen to run in.
  const messages = [...seen].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify({ suites: files, messages }, null, 2)}\n`, "utf8");
  console.log(`[hl7-refresh] wrote ${String(messages.length)} distinct fixtures to ${OUT_PATH}`);
}

main();

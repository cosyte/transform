/**
 * Shared plumbing for the conformance suites: one memoized load of the pinned packages per worker,
 * the committed artifacts, and a scratch repository root the unobtainable-input suite mutates.
 *
 * ▶ THE SCRATCH ROOT IS A COPY, NEVER THE REAL TREE. Every suite that has to break an input builds a
 * throwaway root under `os.tmpdir()` and breaks it there, so no test can leave this repository
 * carrying a corrupted package, a truncated corpus, or a violator value.
 */

import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { readClaimsRegister, type ClaimsRegister } from "../../scripts/conformance/claims.js";
import { readCorpus, type Corpus } from "../../scripts/conformance/corpus.js";
import {
  loadDefinitions,
  runConformance,
  type ConformanceResult,
  type HarnessDefinitions,
} from "../../scripts/conformance/harness.js";
import {
  REPORT_PATH,
  RESULT_PATH,
  readPublishedResult,
} from "../../scripts/conformance/artifacts.js";
import { VENDOR_DIR } from "../../scripts/conformance/pinned-packages.js";
import { CORPUS_DIR, CORPUS_FILE } from "../../scripts/conformance/corpus.js";
import { CLAIMS_PATH } from "../../scripts/conformance/claims.js";

/** The repository root the suites run against. */
export const REPO_ROOT = process.cwd();

/**
 * A deeply mutable view of a published shape.
 *
 * ▶ THIS EXISTS FOR THE MUTATION CASES AND FOR NOTHING ELSE. The result types are readonly because
 * nothing in the harness may edit a measurement. A suite that proves a check REFUSES has to produce
 * the thing it refuses, which means editing a deep copy: `JSON.parse(JSON.stringify(...))` is a fresh
 * object that shares no structure with the run, so relaxing its type cannot reach anything real.
 */
export type Mutable<T> = { -readonly [K in keyof T]: Mutable<T[K]> };

let cachedDefs: HarnessDefinitions | undefined;
let cachedResult: ConformanceResult | undefined;

/** The pinned definitions, loaded once per worker. */
export function definitions(): HarnessDefinitions {
  cachedDefs ??= loadDefinitions(REPO_ROOT);
  return cachedDefs;
}

/** The committed corpus. */
export function corpus(): Corpus {
  return readCorpus(REPO_ROOT);
}

/** The reviewed claims register. */
export function register(): ClaimsRegister {
  return readClaimsRegister(REPO_ROOT);
}

/** A live measurement, computed once per worker. */
export function liveResult(): ConformanceResult {
  cachedResult ??= runConformance({ corpus: corpus(), defs: definitions(), register: register() });
  return cachedResult;
}

/** The committed `documentation/conformance/result.json`. */
export function publishedResult(): ConformanceResult {
  return readPublishedResult(REPO_ROOT);
}

/** The committed `documentation/conformance/report.md`, as text. */
export function publishedReport(): string {
  return readFileSync(join(REPO_ROOT, REPORT_PATH), "utf8");
}

/** The committed README, as text. */
export function readme(): string {
  return readFileSync(join(REPO_ROOT, "README.md"), "utf8");
}

/** What a spawned run of the conformance entry point produced. */
export interface RunOutcome {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Run the real conformance entry point against a repository root, as a process.
 *
 * @param root - The repository root to run against.
 * @param extra - Extra arguments (for example `--check`).
 * @returns The exit code and output.
 */
export function runConformanceCli(root: string, extra: readonly string[] = []): RunOutcome {
  const result = spawnSync(
    join(REPO_ROOT, "node_modules", ".bin", "tsx"),
    [join(REPO_ROOT, "scripts", "conformance", "run.ts"), "--repo-root", root, ...extra],
    { cwd: REPO_ROOT, encoding: "utf8", shell: false },
  );
  return { code: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** A throwaway repository root carrying copies of every pinned input. */
export interface ScratchRoot {
  readonly path: string;
  /** Overwrite a file inside the scratch root, relative to it. */
  write(relative: string, contents: string): void;
  /** Remove a file inside the scratch root, relative to it. */
  remove(relative: string): void;
  /** Put every file a test broke back the way the repository has it. */
  reset(): void;
  dispose(): void;
}

/** Every pinned input the scratch root mirrors, relative to the repository root. */
function managedPaths(): string[] {
  const pins = JSON.parse(readFileSync(join(REPO_ROOT, VENDOR_DIR, "provenance.json"), "utf8")) as {
    packages: { file: string }[];
  };
  return [
    join(VENDOR_DIR, "provenance.json"),
    ...pins.packages.map((p) => join(VENDOR_DIR, p.file)),
    join(CORPUS_DIR, CORPUS_FILE),
    CLAIMS_PATH,
    RESULT_PATH,
    REPORT_PATH,
  ];
}

/**
 * Build a throwaway repository root mirroring the vendored packages, the corpus, the claims register
 * and the committed artifacts.
 *
 * ▶ ONE ROOT PER SUITE, RESET BETWEEN TESTS, NOT ONE ROOT PER TEST. The two package tarballs are
 * several megabytes each and the temp filesystem is small and shared with every other worker on the
 * machine, so a fresh root per test churns tens of megabytes for no benefit.
 *
 * ▶ EVERY FILE IS A COPY. HARD LINKS WERE TRIED AND THEY ARE A TRAP, AND IT TOOK CI TO SHOW IT. A
 * link costs no space, and this suite's own `write()` unlinked before writing, so it looked safe.
 * What it missed is that the thing under test WRITES: `pnpm run conformance` in its default mode
 * writes `result.json` and `report.md` into the root it is given, with a plain `writeFileSync` this
 * suite does not control. Linked, that wrote THROUGH into the repository's own committed artifacts
 * and corrupted them for every later test in the run. It never reproduced locally, because there
 * `os.tmpdir()` is a different filesystem and `linkSync` fails with `EXDEV` so the copy fallback
 * took over; on the CI runner the two share a filesystem, the link succeeded, and the suite went
 * red. A copy cannot write through to anything, whatever the code under test does with it.
 *
 * @returns The scratch root.
 */
export function scratchRoot(): ScratchRoot {
  const path = mkdtempSync(join(tmpdir(), "conformance-"));

  const materialize = (relative: string): void => {
    const from = join(REPO_ROOT, relative);
    const to = join(path, relative);
    mkdirSync(dirname(to), { recursive: true });
    rmSync(to, { force: true });
    cpSync(from, to);
  };

  for (const relative of managedPaths()) materialize(relative);

  return {
    path,
    write(relative, contents) {
      const target = join(path, relative);
      mkdirSync(dirname(target), { recursive: true });
      rmSync(target, { force: true });
      writeFileSync(target, contents, "utf8");
    },
    remove(relative) {
      rmSync(join(path, relative), { force: true });
    },
    reset() {
      for (const relative of managedPaths()) materialize(relative);
    },
    dispose() {
      rmSync(path, { recursive: true, force: true });
    },
  };
}

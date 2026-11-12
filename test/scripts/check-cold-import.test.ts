import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  BUDGET_MS,
  RUNS,
  median,
  readColdImport,
  verdict,
} from "../../scripts/check-cold-import.mjs";

/**
 * The cold import gate (`pnpm check:cold-import`): a new Node.js process imports the built
 * `dist/index.mjs`, peers included, twenty times, and the gate fails when the median is over 15 ms.
 * The reading itself is taken on a CI runner, where it means something; these cases hold the gate's
 * arithmetic, its wiring into CI and the peer floor that makes the budget reachable.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("the cold import gate", () => {
  it("holds the import to 15 ms, the median of 20 fresh processes", () => {
    expect(BUDGET_MS).toBe(15);
    expect(RUNS).toBe(20);
  });

  it("takes the median of odd and even counts", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([7])).toBe(7);
    expect(() => median([])).toThrow(/no values/);
  });

  it("fails only a median over the budget", () => {
    const within = verdict({ medianMs: 15, emptyMedianMs: 0.4, runs: 20 });
    expect(within.over).toBe(false);
    expect(within.line).toBe(
      "cold import of dist/index.mjs: median 15.00 ms over 20 runs (an empty module: 0.40 ms); " +
        "budget 15 ms: within",
    );
    const over = verdict({ medianMs: 15.01, emptyMedianMs: 0.4, runs: 20 });
    expect(over.over).toBe(true);
    expect(over.line.endsWith("budget 15 ms: over")).toBe(true);
  });

  it("reads a module in fresh processes, interleaved with an empty one", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cold-import-test-"));
    try {
      const target = path.join(dir, "target.mjs");
      writeFileSync(target, "export const x = 1;\n");
      const reading = readColdImport(target, 2);
      expect(reading.runs).toBe(2);
      expect(reading.medianMs).toBeGreaterThanOrEqual(0);
      expect(reading.emptyMedianMs).toBeGreaterThanOrEqual(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is run by CI after the build, on every run", () => {
    const ci = readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");
    const build = ci.indexOf("run: pnpm build\n      - name: Cold import budget");
    expect(build).toBeGreaterThan(-1);
    expect(ci).toContain("run: pnpm check:cold-import");
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(pkg.scripts["check:cold-import"]).toBe("node scripts/check-cold-import.mjs");
  });

  it("asks for an @cosyte/hl7 release that imports without node:crypto", () => {
    const pkg = JSON.parse(readFileSync(path.join(ROOT, "package.json"), "utf8")) as {
      peerDependencies: Record<string, string>;
      devDependencies: Record<string, string>;
    };
    // 0.1.12 is the first release that loads in about half the time it did.
    expect(pkg.peerDependencies["@cosyte/hl7"]).toBe("^0.1.12");
    expect(pkg.devDependencies["@cosyte/hl7"]).toBe("^0.1.12");
  });
});

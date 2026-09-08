/**
 * The corpus is INSIDE the PHI gate, not beside it.
 *
 * ▶ THE CLAIM IS MEASURED, NOT ASSERTED, AND THAT MATTERS MORE HERE THAN ANYWHERE. Landing a corpus
 * full of names, dates of birth, addresses and identifiers means adding allow-list entries, and every
 * entry is route-blind and (for every tag but `EMAIL`) file-blind: a permanent subtraction from this
 * repository's whole commit gate. The only thing that makes that trade honest is proof that the
 * scanner still bites INSIDE the corpus directory afterwards. So this suite plants a violator there
 * and watches the gate refuse.
 *
 * ▶ NO VIOLATOR IS EVER WRITTEN AS A LITERAL IN THIS FILE, and none is left on disk. Every payload is
 * assembled at runtime from parts, exactly as `test/scripts/phi-scan.test.ts` does, because this file
 * is itself inside the scan corpus. The planted file is removed in a `finally`, and again in an
 * `afterEach`, so a failing assertion cannot leave one behind.
 */

import { spawnSync } from "node:child_process";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { CORPUS_DIR, CORPUS_FILE } from "../../scripts/conformance/corpus.js";
import { VENDOR_DIR } from "../../scripts/conformance/pinned-packages.js";

const REPO_ROOT = process.cwd();
const SCANNER = join(REPO_ROOT, "scripts", "phi-scan.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

/** A dashed SSN shape no allow-list entry covers. Never one literal in this file. */
const UNCOVERED_SSN = ["321", "54", "9876"].join("-");
/** An email at a domain no allow-list entry covers. */
const UNCOVERED_EMAIL = ["a.patient", "clinic-example.invalid"].join("@");
/** One of the corpus's own mailboxes, which is allow-listed for ONE path and no other. */
const CORPUS_EMAIL = ["eve", "test.test"].join("@");

/** The planted file, inside the corpus directory the walk must be reaching. */
const PLANTED = join(REPO_ROOT, CORPUS_DIR, "planted-by-the-phi-gate-suite.txt");

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function scan(args: readonly string[]): RunResult {
  const r = spawnSync(TSX_BIN, [SCANNER, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Plant a file inside the corpus directory, run the scanner, and always remove it again. */
function withPlanted(contents: string, run: () => RunResult): RunResult {
  writeFileSync(PLANTED, contents, "utf8");
  try {
    return run();
  } finally {
    rmSync(PLANTED, { force: true });
  }
}

afterEach(() => {
  rmSync(PLANTED, { force: true });
});

describe("G1: the corpus is committed and the gate is green over it", () => {
  it("`pnpm phi-scan` exits 0 on the tree as committed", () => {
    const r = scan([]);
    expect(r.code, r.stderr).toBe(0);
    expect(r.stdout).toContain("OK: no hits");
  });

  it("the corpus fixture is really there, so the clean run above is not a clean run over nothing", () => {
    expect(existsSync(join(REPO_ROOT, CORPUS_DIR, CORPUS_FILE))).toBe(true);
    const r = scan([join(CORPUS_DIR, CORPUS_FILE)]);
    expect(r.code, r.stderr).toBe(0);
  });

  it("the pinned package cells are 0, which is what the widened walk root rests on", () => {
    for (const file of [
      "hl7.fhir.r4.core-4.0.1.tgz",
      "hl7.fhir.us.core-9.0.0.tgz",
      "provenance.json",
    ]) {
      const r = scan([join(VENDOR_DIR, file)]);
      expect(r.code, `${file}: ${r.stderr}`).toBe(0);
    }
  });
});

describe("G2: a violator inside the corpus directory fails the gate", () => {
  it("a dashed SSN no entry covers exits non-zero on the ALL route", () => {
    const r = withPlanted(`patient record ${UNCOVERED_SSN}\n`, () => scan([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("dashed SSN");
    expect(r.stderr).toContain(CORPUS_DIR);
  });

  it("an email at an uncovered domain exits non-zero on the ALL route", () => {
    const r = withPlanted(`contact ${UNCOVERED_EMAIL}\n`, () => scan([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("email with non-test domain");
    expect(r.stderr).toContain(CORPUS_DIR);
  });

  it("the same violators exit non-zero on the path route too, so no route is blind to them", () => {
    const ssn = withPlanted(`patient record ${UNCOVERED_SSN}\n`, () =>
      scan([join(CORPUS_DIR, "planted-by-the-phi-gate-suite.txt")]),
    );
    expect(ssn.code).toBe(1);
    const email = withPlanted(`contact ${UNCOVERED_EMAIL}\n`, () =>
      scan([join(CORPUS_DIR, "planted-by-the-phi-gate-suite.txt")]),
    );
    expect(email.code).toBe(1);
  });

  it("the corpus's own mailbox is cleared for its OWN file and for no other file beside it", () => {
    // The narrowness of the path-scoped EMAIL tag, measured rather than assumed: the same address
    // that is allow-listed in the corpus fixture still reports in a different file in the same
    // directory.
    const r = withPlanted(`contact ${CORPUS_EMAIL}\n`, () => scan([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("email with non-test domain");
  });

  it("the structured HL7 pass bites inside the corpus directory too, not just the floor", () => {
    // A PID carrying a name, a date of birth and an identifier none of which any entry covers.
    const family = ["QUIB", "BLE"].join("");
    const given = ["ROSA", "LIND"].join("");
    const dob = ["1962", "11", "05"].join("");
    const mrn = ["MRN", "40921"].join("");
    const pid = ["PID", "1", "", `${mrn}^^^HOSP^MR`, "", `${family}^${given}`, "", dob, "F"].join(
      "|",
    );
    const r = withPlanted(`${pid}\n`, () => scan([]));
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("person name not declared synthetic");
    expect(r.stderr).toContain("date of birth not declared synthetic");
  });

  it("removing the planted file restores the clean run, so the gate is not left red", () => {
    expect(existsSync(PLANTED)).toBe(false);
    expect(scan([]).code).toBe(0);
  });
});

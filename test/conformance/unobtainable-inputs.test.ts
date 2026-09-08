/**
 * The fail-safe half: an unobtainable package, an unobtainable corpus, an empty run and a message
 * that will not parse. Each must fail the check EXPLICITLY, naming the thing, and none may report a
 * pass.
 *
 * ▶ EVERY CASE IS EXERCISED AGAINST THE REAL ENTRY POINT AS A PROCESS, not just against a function.
 * The criteria say "exit non-zero", and a function that throws in a test proves nothing about what
 * the command does with the throw. The scratch root makes that affordable: a throwaway copy of every
 * pinned input, broken one way at a time, under `os.tmpdir()` and never in this repository.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  readCorpus,
  CorpusError,
  CORPUS_DIR,
  CORPUS_FILE,
} from "../../scripts/conformance/corpus.js";
import {
  PinnedPackageError,
  VENDOR_DIR,
  loadPinnedPackages,
  readPins,
} from "../../scripts/conformance/pinned-packages.js";
import {
  REPO_ROOT,
  runConformanceCli,
  scratchRoot,
  type ScratchRoot,
} from "../_support/conformance.js";

const US_CORE = "hl7.fhir.us.core";

let scratch: ScratchRoot;

beforeAll(() => {
  scratch = scratchRoot();
});

// One root for the file, put back the way the repository has it after every test. `reset()` is
// itself under test: the first case below runs the real entry point against the untouched root and
// requires a clean exit, so a reset that stopped working would red the suite rather than hide a
// break that leaked into the next test.
afterEach(() => {
  scratch.reset();
});

afterAll(() => {
  scratch.dispose();
});

describe("C1 + C2: a package that cannot be obtained fails the check explicitly", () => {
  it("the scratch root is a faithful copy: it passes before anything is broken", () => {
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code, outcome.stderr).toBe(0);
  });

  it("refuses an ABSENT package, naming the id, the version and the expected sha256", () => {
    const pin = readPins(REPO_ROOT).find((p) => p.id === US_CORE);
    if (pin === undefined) throw new Error("no us.core pin");
    scratch.remove(`${VENDOR_DIR}/${pin.file}`);

    expect(() => loadPinnedPackages(scratch.path)).toThrow(PinnedPackageError);
    try {
      loadPinnedPackages(scratch.path);
    } catch (err) {
      const e = err as PinnedPackageError;
      expect(e.packageId).toBe(pin.id);
      expect(e.packageVersion).toBe(pin.version);
      expect(e.expectedSha256).toBe(pin.sha256);
      expect(e.message).toContain(pin.sha256);
      expect(e.message).toContain(`${pin.id}#${pin.version}`);
    }

    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(`${pin.id}#${pin.version}`);
    expect(outcome.stderr).toContain(pin.sha256);
    expect(outcome.stdout).not.toContain("messages produced a Bundle");
  });

  it("refuses a HASH-MISMATCHED package, and does not fall back to any other copy", () => {
    const pin = readPins(REPO_ROOT).find((p) => p.id === US_CORE);
    if (pin === undefined) throw new Error("no us.core pin");
    scratch.write(
      `${VENDOR_DIR}/${pin.file}`,
      // Deliberately not gzip at all: the hash check must refuse BEFORE anything is unpacked.
      "this is not the pinned package",
    );

    try {
      loadPinnedPackages(scratch.path);
      throw new Error("expected a refusal");
    } catch (err) {
      expect(err).toBeInstanceOf(PinnedPackageError);
      const e = err as PinnedPackageError;
      expect(e.expectedSha256).toBe(pin.sha256);
      expect(e.message).toContain("does not match its pin");
      expect(e.message).toContain(pin.sha256);
      // No fallback: the real copy is one directory away in the real repository and is not used.
      expect(e.message).toContain("never a fallback");
    }

    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain(pin.sha256);
  });

  it("refuses when the provenance record itself is gone, so nothing is verified against nothing", () => {
    scratch.remove(`${VENDOR_DIR}/provenance.json`);
    expect(() => readPins(scratch.path)).toThrow(PinnedPackageError);
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("provenance.json");
  });

  it("the real packages DO match their pins, so the refusals above are not vacuous", () => {
    const { base, profiles } = loadPinnedPackages(REPO_ROOT);
    expect(base.pin.id).toBe("hl7.fhir.r4.core");
    expect(base.pin.version).toBe("4.0.1");
    expect(profiles.pin.id).toBe(US_CORE);
    expect(profiles.pin.version).toBe("9.0.0");
    expect(base.resources.size).toBeGreaterThan(0);
    expect(profiles.resources.size).toBeGreaterThan(0);
  });
});

describe("C1 + C3: a corpus that cannot be obtained, or yields nothing, fails the check", () => {
  it("refuses an ABSENT corpus", () => {
    scratch.remove(`${CORPUS_DIR}/${CORPUS_FILE}`);
    expect(() => readCorpus(scratch.path)).toThrow(CorpusError);
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("could not be obtained");
    expect(outcome.stdout).not.toContain("messages produced a Bundle");
  });

  it("refuses an UNPARSEABLE corpus", () => {
    scratch.write(`${CORPUS_DIR}/${CORPUS_FILE}`, "{ this is not json");
    expect(() => readCorpus(scratch.path)).toThrow(/not valid JSON/);
    expect(runConformanceCli(scratch.path, ["--check"]).code).not.toBe(0);
  });

  it("refuses a corpus that yields ZERO messages, rather than reporting an empty pass", () => {
    scratch.write(
      `${CORPUS_DIR}/${CORPUS_FILE}`,
      JSON.stringify({ source: { url: "x", sha256: "y" }, messages: [] }),
    );
    expect(() => readCorpus(scratch.path)).toThrow(/zero messages/);
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("zero messages");
  });

  it("refuses a corpus whose message yields no segments", () => {
    const corpus = JSON.parse(
      JSON.stringify({
        source: { url: "x", sha256: "y", retrievedAt: "z", note: "" },
        additionalEscaping: { reason: "", entries: [] },
        messages: [
          { name: "ADT_A01", heading: "h", publishedLines: ["<br />"], publishedMangled: [] },
        ],
      }),
    ) as unknown;
    scratch.write(`${CORPUS_DIR}/${CORPUS_FILE}`, JSON.stringify(corpus));
    expect(() => readCorpus(scratch.path)).toThrow(/yields no segments/);
  });
});

describe("C4: a message that cannot be parsed or transformed is a named run failure", () => {
  /** Replace one message's lines with content `@cosyte/hl7` cannot read as a message. */
  function breakOneMessage(): void {
    const corpus = JSON.parse(
      readFileSync(join(scratch.path, CORPUS_DIR, CORPUS_FILE), "utf8"),
    ) as { messages: { name: string; publishedLines: string[] }[] };
    const target = corpus.messages.find((m) => m.name === "ORU_R01");
    if (target === undefined) throw new Error("no ORU_R01");
    // No MSH, so there is no message to transform: the parser refuses it.
    target.publishedLines = ["ZZZ|this is not an HL7 v2 message"];
    scratch.write(`${CORPUS_DIR}/${CORPUS_FILE}`, JSON.stringify(corpus, null, 2));
  }

  it("records the message as a run failure NAMING it, and exits non-zero", () => {
    breakOneMessage();
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr).toContain("ORU_R01");
    expect(outcome.stderr).toMatch(/run-failure|drift|claim/);
  });

  it("keeps the failing message IN the generated result rather than omitting it", () => {
    breakOneMessage();
    // Regenerate into the scratch root (write mode), then read what it published.
    const outcome = runConformanceCli(scratch.path);
    expect(outcome.code).not.toBe(0);
    const published = JSON.parse(
      readFileSync(join(scratch.path, "documentation", "conformance", "result.json"), "utf8"),
    ) as { messages: { message: string; status: string; failure: { stage: string } | null }[] };
    const failed = published.messages.find((m) => m.message === "ORU_R01");
    expect(failed).toBeDefined();
    expect(failed?.status).toBe("run-failure");
    expect(failed?.failure?.stage.length).toBeGreaterThan(0);
    expect(published.messages).toHaveLength(7);
  });
});

describe("the scratch root is restored between cases, so no refusal above leaked into another", () => {
  it("runs clean once more after every break in this file", () => {
    const outcome = runConformanceCli(scratch.path, ["--check"]);
    expect(outcome.code, outcome.stderr).toBe(0);
  });

  it("never wrote through a hard link into this repository's own pinned packages", () => {
    // The repository's copies still match their pins, which is the property `write()` unlinks first
    // to protect.
    const { base, profiles } = loadPinnedPackages(REPO_ROOT);
    expect(base.resources.size).toBeGreaterThan(0);
    expect(profiles.resources.size).toBeGreaterThan(0);
  });
});

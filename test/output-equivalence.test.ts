/**
 * Output equivalence: every input of the synthetic corpus in `test/_support/equivalence-corpus.ts`
 * maps to exactly what it mapped to on the tree the digests were captured from.
 *
 * For each input the digest covers everything a caller can observe: on the forward path, each
 * message's Bundle model (every property, value, id and extension), every issue and the issues as an
 * OperationOutcome, under two option sets; on the reverse path, the v2 message written (its wire text
 * and its JSON form) and every issue, for two triggers and three option sets; and whatever any of it
 * threw. `test/_support/output-digests.json` holds the digests, taken from the base tree by
 * `scripts/capture-output-digests.ts`, and the file says which commit and which peer releases.
 *
 * A change that means to move an output names the input and the reason in `DELIBERATE` below; none
 * does today.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  corpusDigests,
  forwardCorpus,
  observeForward,
  reverseCorpus,
} from "./_support/equivalence-corpus.js";

interface Captured {
  readonly capturedFrom: string;
  readonly peers: string;
  readonly inputs: number;
  readonly digests: Readonly<Record<string, string>>;
}

const captured = JSON.parse(
  readFileSync(join(import.meta.dirname, "_support", "output-digests.json"), "utf8"),
) as Captured;

/** Inputs whose output a change moved on purpose, with the reason. Empty: nothing moved. */
const DELIBERATE: Readonly<Record<string, string>> = {};

describe("output equivalence against the base tree", () => {
  const head = corpusDigests();

  it("builds the same corpus the digests were captured from", () => {
    expect(Object.keys(head)).toEqual(Object.keys(captured.digests));
    expect(Object.keys(head)).toHaveLength(captured.inputs);
  });

  it("maps every input to exactly what the base tree mapped it to", () => {
    const moved = Object.keys(captured.digests).filter(
      (id) => head[id] !== captured.digests[id] && !(id in DELIBERATE),
    );
    expect(moved).toEqual([]);
  });

  it("covers both paths with inputs that reach the transform", () => {
    const forward = forwardCorpus();
    const reached = forward.filter((input) => {
      const seen = observeForward(input);
      return Array.isArray(seen) && seen.length > 0;
    });
    // Most edited messages still parse, so the corpus exercises the mapping, not the parser.
    expect(reached.length).toBeGreaterThan(forward.length * 0.9);
    expect(reverseCorpus().length).toBeGreaterThan(500);
  });
});

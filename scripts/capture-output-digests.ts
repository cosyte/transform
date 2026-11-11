#!/usr/bin/env tsx
/**
 * Capture one SHA-256 per input of the output-equivalence corpus, taken from the tree a change starts
 * from, into `test/_support/output-digests.json`.
 *
 * THIS SCRIPT IS A RECORD, NOT A REGENERATOR. `test/output-equivalence.test.ts` holds the tree under
 * test to these digests, so they mean something only when they were taken from a tree without the
 * change. Run on the changed tree, it would write down whatever that tree produces and the test would
 * prove nothing.
 *
 * Run it once on the base tree: copy `test/_support/equivalence-corpus.ts` and this script into a
 * checkout of the base commit with its own dependencies installed, run it there, and bring only the
 * JSON back:
 *
 * ```
 * pnpm tsx scripts/capture-output-digests.ts <base commit> <peers it ran against>
 * ```
 *
 * The two arguments are written into the file as given, so a reader knows which tree and which
 * versions of `@cosyte/hl7` and `@cosyte/fhir` produced the digests.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { corpusDigests } from "../test/_support/equivalence-corpus.js";

const OUT = join(import.meta.dirname, "..", "test", "_support", "output-digests.json");

const [commit, peers] = process.argv.slice(2);
if (commit === undefined || peers === undefined) {
  process.stderr.write(
    "usage: tsx scripts/capture-output-digests.ts <base commit> <peers it ran against>\n",
  );
  process.exit(2);
}

const digests = corpusDigests();
writeFileSync(
  OUT,
  `${JSON.stringify({ capturedFrom: commit, peers, inputs: Object.keys(digests).length, digests }, null, 2)}\n`,
);
process.stdout.write(`wrote ${String(Object.keys(digests).length)} digests to ${OUT}\n`);

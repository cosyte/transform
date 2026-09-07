#!/usr/bin/env tsx
/**
 * Capture the Bundle and issues list that an order message carrying **no TQ1** produced on the tree
 * BEFORE any TQ1 reached a resource, into `test/_support/tq1-baseline.json`.
 *
 * ▶ THIS SCRIPT IS A RECORD, NOT A REGENERATOR, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * The baseline it writes is what the TQ1 suite compares against: an order with no timing segment
 * must still come back byte for byte, with the same issues in the same order, as it did before the
 * timing existed. Re-running this against a tree that already carries the TQ1 work would overwrite
 * the baseline with whatever that tree currently produces, and the assertion would become a
 * tautology. The captured file therefore records the commit it was captured at, and the suite reads
 * the file rather than calling this script.
 *
 * Run it once, on a tree that does not carry the TQ1 work, and commit the output:
 *
 * ```
 * pnpm tsx scripts/capture-tq1-baseline.ts
 * ```
 *
 * On such a tree `test/_support/tq1-fixtures.ts` does not exist either, so bring the fixture across
 * with it, capture, and bring only the JSON back. There is no shortcut: a baseline taken from the
 * changed tree measures nothing.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { serializeResource } from "@cosyte/fhir";

import { NO_TQ1_ORDER, runOrderFixture } from "../test/_support/tq1-fixtures.js";

const OUT = join(import.meta.dirname, "..", "test", "_support", "tq1-baseline.json");

function head(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

const result = runOrderFixture(NO_TQ1_ORDER);

const payload = {
  capturedAtCommit: head(),
  capturedFrom: "the transform tree as it stood before any TQ1 reached a resource",
  note: "Do not regenerate from a tree that carries the TQ1 work: see the banner in scripts/capture-tq1-baseline.ts.",
  bundle: serializeResource(result.bundle),
  issues: result.issues.map((i) => {
    const base = { code: i.code, severity: i.severity, v2Location: i.v2Location };
    return i.fhirPath === undefined ? base : { ...base, fhirPath: i.fhirPath };
  }),
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
process.stdout.write(`captured the no-TQ1 baseline at ${payload.capturedAtCommit} into ${OUT}\n`);

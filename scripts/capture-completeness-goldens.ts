#!/usr/bin/env tsx
/**
 * Capture the baseline Bundle and issues list that each completeness fixture produced BEFORE the
 * message-level completeness diagnostic existed, into `test/_support/completeness-goldens.json`.
 *
 * ▶ THIS SCRIPT IS A RECORD, NOT A REGENERATOR, AND THE DIFFERENCE IS THE WHOLE POINT.
 *
 * The baselines it writes are what the completeness suite compares against: the Bundle must come
 * back byte for byte, and every issue the library already raised must still be there, first, in the
 * order it was raised. Re-running this against a tree that already carries the diagnostic would
 * overwrite each baseline with whatever that tree currently produces, and both assertions would then
 * be a tautology. The captured file therefore records the commit it was captured at, and the suite
 * reads the file rather than calling this script.
 *
 * Run it once, on a tree that does not have the diagnostic, and commit the output:
 *
 * ```
 * pnpm tsx scripts/capture-completeness-goldens.ts
 * ```
 *
 * A NEW fixture added later needs its own baseline, captured the same way: check the fixture out
 * onto a tree without the diagnostic, capture, and bring both across. There is no shortcut, because
 * a baseline taken from the changed tree measures nothing.
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { serializeResource } from "@cosyte/fhir";

import {
  COMPLETENESS_FIXTURES,
  runCompletenessFixture,
} from "../test/_support/completeness-fixtures.js";

const OUT = join(import.meta.dirname, "..", "test", "_support", "completeness-goldens.json");

function head(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
}

interface GoldenIssue {
  readonly code: string;
  readonly severity: string;
  readonly v2Location: string;
  readonly fhirPath?: string;
}

interface Golden {
  readonly what: string;
  readonly bundle: string;
  readonly issues: readonly GoldenIssue[];
}

function capture(): Record<string, Golden> {
  const out: Record<string, Golden> = {};
  for (const fixture of COMPLETENESS_FIXTURES) {
    const result = runCompletenessFixture(fixture.raw);
    out[fixture.id] = {
      what: fixture.what,
      bundle: serializeResource(result.bundle),
      issues: result.issues.map((i) => {
        const base = { code: i.code, severity: i.severity, v2Location: i.v2Location };
        return i.fhirPath === undefined ? base : { ...base, fhirPath: i.fhirPath };
      }),
    };
  }
  return out;
}

const payload = {
  capturedAtCommit: head(),
  capturedFrom:
    "the transform tree as it stood before the message-level completeness diagnostic existed",
  note: "Do not regenerate from a tree that carries the diagnostic: see the banner in scripts/capture-completeness-goldens.ts.",
  fixtures: capture(),
};

writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n");
process.stdout.write(
  `captured ${String(COMPLETENESS_FIXTURES.length)} baselines at ${payload.capturedAtCommit} into ${OUT}\n`,
);

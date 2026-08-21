#!/usr/bin/env tsx
/**
 * Capture the COMPARED SURFACE of the whole baseline corpus: the FHIR output every member
 * transforms to, plus the diagnostics emitted alongside it, in emission order.
 *
 * ===========================================================================
 * WHAT IT CAPTURES, AND WHY EXACTLY THAT
 * ===========================================================================
 *
 * For each corpus member, in corpus order:
 *   - `parse`   - `ok`, or the constructor name and message of what `parseHL7` threw. A parse
 *                 refusal IS part of the surface: it is the whole observable behaviour for an
 *                 input the parser will not accept.
 *   - `bundle`  - the FHIR message Bundle, serialized by `@cosyte/fhir.serializeResource` and
 *                 re-parsed so the file diffs line by line rather than as one long string. Absent
 *                 when the parse refused.
 *   - `issues`  - every `TransformIssue`, in emission order, with its code, severity, v2 location
 *                 and FHIR path. The `message` is NOT recorded: it is static per code
 *                 (`ISSUE_REGISTRY`), so recording it would duplicate the code and nothing else.
 *   - `threw`   - set when `toFhir` itself throws, which the fail-safe rule says it never does.
 *
 * ▶ THE TWO NORMALIZATIONS, AND THEY ARE APPLIED IDENTICALLY ON BOTH SIDES:
 *   1. `generateId` is a per-message counter, so `fullUrl` and every reference inside a bundle are
 *      reproducible rather than random. Without it every capture would differ from every other one
 *      and the comparison would be worthless.
 *   2. The NamingSystem registry is fixed: the one authority the repository's own fixtures register
 *      (`HOSP`), and nothing else, so an identifier system either resolves the same way on both
 *      sides or is flagged the same way on both sides.
 *   Nothing else is normalized. There is no timestamp, no path and no environment value in the
 *   output: `Bundle.timestamp` comes from MSH-7, which is fixture data.
 *
 * Usage: `pnpm exec tsx scripts/hl7-refresh-capture.ts <label>`
 *   writes `documentation/hl7-refresh/surface-<label>.json`
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { serializeResource } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

import { MALFORMED_CLASS_INPUTS } from "../test/_support/hl7-malformed-classes.js";
import { toFhir, createNamingSystem } from "../src/index.js";

const REPO_ROOT = process.cwd();
const CORPUS_PATH = join(REPO_ROOT, "test", "_support", "hl7-baseline-corpus.json");
const OUT_DIR = join(REPO_ROOT, "documentation", "hl7-refresh");

interface CorpusFile {
  readonly suites: readonly string[];
  readonly messages: readonly string[];
}

interface CapturedMember {
  readonly id: string;
  readonly parse: string;
  readonly parseError?: { readonly name: string; readonly message: string };
  readonly threw?: { readonly name: string; readonly message: string };
  readonly bundle?: unknown;
  readonly issues?: readonly (readonly (string | undefined)[])[];
}

/** A deterministic urn:uuid allocator, restarted for every member. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) return { name: err.constructor.name, message: err.message };
  return { name: "unknown", message: String(err) };
}

function capture(id: string, raw: string): CapturedMember {
  let msg;
  try {
    msg = parseHL7(raw);
  } catch (err) {
    return { id, parse: "refused", parseError: describeError(err) };
  }
  try {
    const result = toFhir(msg, {
      namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
      generateId: seq(),
    });
    return {
      id,
      parse: "ok",
      bundle: JSON.parse(serializeResource(result.bundle)),
      issues: result.issues.map((i) => [i.code, i.severity, i.v2Location, i.fhirPath]),
    };
  } catch (err) {
    return { id, parse: "ok", threw: describeError(err) };
  }
}

function main(): void {
  const label = process.argv[2];
  if (label === undefined || label === "") {
    throw new Error("usage: tsx scripts/hl7-refresh-capture.ts <label>");
  }

  const corpus = JSON.parse(readFileSync(CORPUS_PATH, "utf8")) as CorpusFile;
  const members: CapturedMember[] = [];
  corpus.messages.forEach((raw, i) => {
    members.push(capture(`fixture-${String(i).padStart(3, "0")}`, raw));
  });
  for (const input of MALFORMED_CLASS_INPUTS) {
    members.push(capture(`class-${input.id}`, input.raw));
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const out = join(OUT_DIR, `surface-${label}.json`);
  writeFileSync(out, `${JSON.stringify({ label, members }, null, 2)}\n`, "utf8");
  console.log(`[hl7-refresh] captured ${String(members.length)} members to ${out}`);
}

main();

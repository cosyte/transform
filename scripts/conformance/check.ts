/**
 * The three checks that turn a measurement into a gate: run integrity, the reviewed claims, and
 * drift against the committed published result.
 *
 * ▶ EVERY CHECK IS BIDIRECTIONAL, AND THAT IS WHAT STOPS THE REGISTER ROTTING. A declared
 * conformance that starts failing is a regression; a declared NON-conformance that stops reproducing
 * is a stale excuse, and both fail the run and name the pair. A register that could only be wrong in
 * one direction would fill up with lines nobody ever has to remove.
 *
 * ▶ AND AN EMPTY RUN IS NEVER A PASS. Fewer than the seven published messages, a Bundle with no
 * resources, a message that could not be parsed or transformed: each is a failure naming the message,
 * never an omission from the published result.
 */

import { PUBLISHED_MESSAGE_NAMES } from "./corpus.js";
import { pairKey, type ClaimsRegister } from "./claims.js";
import type { ConformanceResult, MessageResult } from "./harness.js";

/** One reason a run fails. */
export interface CheckFailure {
  /** What kind of failure: which criterion it belongs to. */
  readonly kind:
    | "missing-message"
    | "unexpected-message"
    | "run-failure"
    | "empty-bundle"
    | "empty-run"
    | "claim-broken"
    | "claim-stale"
    | "claim-missing"
    | "claim-unobserved"
    | "drift";
  /** The (message, resource type, profile) pair, where the failure has one. */
  readonly pair: string;
  readonly detail: string;
}

/** Every (message, resource type, profile) pair the run observed, and whether it was clean. */
export interface ObservedPair {
  readonly key: string;
  readonly message: string;
  readonly resourceType: string;
  readonly profile: string | null;
  readonly conformant: boolean;
  readonly errorCount: number;
}

/**
 * Collapse a run into its (message, resource type, profile) pairs.
 *
 * A message can carry several resources of one type; a pair is conformant only when EVERY resource
 * of that type in that message validated clean, which is the stricter of the two readings and the
 * only one under which a claim covers what it appears to cover.
 *
 * @param result - The measurement.
 * @returns One entry per pair, sorted by key.
 */
export function observedPairs(result: ConformanceResult): ObservedPair[] {
  const byKey = new Map<string, ObservedPair>();
  for (const message of result.messages) {
    for (const resource of message.resources) {
      for (const verdict of resource.profileVerdicts) {
        const key = pairKey(message.message, resource.resourceType, verdict.profile);
        const previous = byKey.get(key);
        const errorCount = (previous?.errorCount ?? 0) + verdict.errorCount;
        byKey.set(key, {
          key,
          message: message.message,
          resourceType: resource.resourceType,
          profile: verdict.profile,
          conformant: errorCount === 0,
          errorCount,
        });
      }
    }
  }
  return [...byKey.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/**
 * Run integrity: the seven published messages, each validated, each with a non-empty Bundle.
 *
 * @param result - The measurement.
 * @returns Every integrity failure. Empty when the run is sound.
 */
export function checkRunIntegrity(result: ConformanceResult): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const seen = new Map<string, MessageResult>();
  for (const message of result.messages) seen.set(message.message, message);

  for (const name of PUBLISHED_MESSAGE_NAMES) {
    const message = seen.get(name);
    if (message === undefined) {
      failures.push({
        kind: "missing-message",
        pair: name,
        detail: `no Bundle reached the validator for the published message ${name}.`,
      });
      continue;
    }
    if (message.status === "run-failure") {
      failures.push({
        kind: "run-failure",
        pair: name,
        detail:
          `${name} could not be ${message.failure?.stage ?? "run"}d: ${message.failure?.reason ?? "unknown"}. ` +
          `The message is named here rather than omitted from the published result.`,
      });
      continue;
    }
    if (message.resourceCount === 0) {
      failures.push({
        kind: "empty-bundle",
        pair: name,
        detail: `${name} produced a Bundle with no resources, so nothing reached the validator.`,
      });
    }
  }
  for (const name of seen.keys()) {
    if (!(PUBLISHED_MESSAGE_NAMES as readonly string[]).includes(name)) {
      failures.push({
        kind: "unexpected-message",
        pair: name,
        detail: `${name} is not one of the seven messages the guide publishes.`,
      });
    }
  }
  if (result.summary.resourcesValidated === 0) {
    failures.push({
      kind: "empty-run",
      pair: "(run)",
      detail: "the run validated zero documents, which is a failure and never a pass.",
    });
  }
  return failures;
}

/**
 * The reviewed claims: observation must equal declaration, in both directions, for every pair.
 *
 * @param result - The measurement.
 * @param register - The reviewed register.
 * @returns Every claim failure. Empty when the register and the run agree exactly.
 */
export function checkClaims(result: ConformanceResult, register: ClaimsRegister): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const observed = new Map(observedPairs(result).map((p) => [p.key, p]));
  const declared = new Map(
    register.claims.map((c) => [pairKey(c.message, c.resourceType, c.profile), c]),
  );

  for (const [key, pair] of observed) {
    const claim = declared.get(key);
    if (claim === undefined) {
      failures.push({
        kind: "claim-missing",
        pair: key,
        detail:
          `the run validated this pair and the register declares nothing about it. Every pair the ` +
          `harness measures is a reviewed line or the run fails.`,
      });
      continue;
    }
    if (claim.conformant && !pair.conformant) {
      failures.push({
        kind: "claim-broken",
        pair: key,
        detail:
          `the register declares this pair conformant and the run found ` +
          `${String(pair.errorCount)} error-severity result(s).`,
      });
    }
    if (!claim.conformant && pair.conformant) {
      failures.push({
        kind: "claim-stale",
        pair: key,
        detail:
          `the register declares this pair NON-conformant and the run found no error-severity ` +
          `result. A declared failure that stops reproducing is a stale excuse, so it fails the run ` +
          `until the register is updated.`,
      });
    }
  }
  for (const key of declared.keys()) {
    if (!observed.has(key)) {
      failures.push({
        kind: "claim-unobserved",
        pair: key,
        detail: `the register declares this pair and the run never produced it.`,
      });
    }
  }
  return failures.sort((a, b) => a.pair.localeCompare(b.pair));
}

/** A pair's committed shape, for the drift comparison. */
function fingerprint(result: ConformanceResult): Map<string, string> {
  const out = new Map<string, string>();
  for (const message of result.messages) {
    out.set(
      `${message.message} / (status)`,
      `${message.status}:${String(message.resourceCount)}:${message.failure?.stage ?? "-"}`,
    );
    message.resources.forEach((resource, index) => {
      for (const verdict of resource.profileVerdicts) {
        const key = `${message.message} / ${resource.resourceType}#${String(index)} / ${verdict.profile ?? "base-R4-only"}`;
        const findings = verdict.findings
          .map(
            (f) =>
              `${f.severity} ${f.code}@${f.path}${f.constraint === undefined ? "" : `[${f.constraint}]`}`,
          )
          .join("; ");
        out.set(key, findings);
      }
    });
  }
  return out;
}

/**
 * Drift against the committed published result, in either direction.
 *
 * @param observed - The measurement this run produced.
 * @param published - The measurement `documentation/conformance/result.json` carries.
 * @returns Every pair that moved. Empty when the two agree exactly.
 */
export function checkAgainstPublished(
  observed: ConformanceResult,
  published: ConformanceResult,
): CheckFailure[] {
  const failures: CheckFailure[] = [];
  const now = fingerprint(observed);
  const then = fingerprint(published);

  for (const [key, value] of now) {
    const before = then.get(key);
    if (before === undefined) {
      failures.push({
        kind: "drift",
        pair: key,
        detail: `the run produced this pair and the committed published result does not carry it.`,
      });
    } else if (before !== value) {
      failures.push({
        kind: "drift",
        pair: key,
        detail:
          `this pair moved. Published: ${before.length === 0 ? "(no findings)" : before}. ` +
          `Observed: ${value.length === 0 ? "(no findings)" : value}.`,
      });
    }
  }
  for (const [key] of then) {
    if (!now.has(key)) {
      failures.push({
        kind: "drift",
        pair: key,
        detail: `the committed published result carries this pair and the run no longer produces it.`,
      });
    }
  }

  const headline = (r: ConformanceResult): string =>
    `${String(r.summary.messagesValidated)}/${String(r.summary.messagesWithZeroErrors)}/${String(r.summary.errorFindings)}`;
  if (headline(observed) !== headline(published)) {
    failures.push({
      kind: "drift",
      pair: "(summary)",
      detail:
        `the headline moved. Published validated/clean/errors ${headline(published)}, observed ` +
        `${headline(observed)}.`,
    });
  }
  return failures.sort((a, b) => a.pair.localeCompare(b.pair));
}

/**
 * Render failures as the lines a failing run prints.
 *
 * @param failures - The failures.
 * @returns One line per failure, each naming its pair.
 */
export function formatFailures(failures: readonly CheckFailure[]): string {
  return failures.map((f) => `  [${f.kind}] ${f.pair}: ${f.detail}`).join("\n");
}

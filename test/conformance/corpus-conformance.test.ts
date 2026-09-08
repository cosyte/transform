/**
 * The conformance run itself: every published message validated against the pinned base R4
 * definitions and the pinned profile package, held to the reviewed claims register and to the
 * committed published result, in both directions.
 *
 * ▶ EVERY CHECK HERE IS SHOWN TO FAIL BEFORE IT IS TRUSTED. A gate that has never been observed
 * refusing is indistinguishable from one that cannot, so each assertion below is paired with a
 * mutation that breaks exactly the property it claims to hold, and the suite asserts the mutation is
 * caught and NAMED.
 */

import { describe, expect, it } from "vitest";

import {
  checkAgainstPublished,
  checkClaims,
  checkRunIntegrity,
  observedPairs,
} from "../../scripts/conformance/check.js";
import { PUBLISHED_MESSAGE_NAMES } from "../../scripts/conformance/corpus.js";
import type { ConformanceResult, Finding } from "../../scripts/conformance/harness.js";
import { liveResult, publishedResult, register, type Mutable } from "../_support/conformance.js";

/** A deep, structurally-shared-nothing copy, so a mutation cannot reach the memoized run. */
function clone(result: ConformanceResult): Mutable<ConformanceResult> {
  return JSON.parse(JSON.stringify(result)) as Mutable<ConformanceResult>;
}

const ERROR_FINDING: Finding = {
  code: "CARDINALITY_MIN",
  severity: "error",
  path: "Injected.byThisSuite",
  message: "Injected by the conformance suite to prove the check refuses.",
};

/** Add an error-severity finding to the first verdict of a named (message, resource type) pair. */
function injectError(
  result: Mutable<ConformanceResult>,
  message: string,
  resourceType: string,
): void {
  const target = result.messages.find((m) => m.message === message);
  const resource = target?.resources.find((r) => r.resourceType === resourceType);
  const verdict = resource?.profileVerdicts[0];
  if (target === undefined || resource === undefined || verdict === undefined) {
    throw new Error(`no ${message} / ${resourceType} pair to inject into`);
  }
  verdict.findings.push(ERROR_FINDING);
  verdict.errorCount += 1;
  resource.errorCount += 1;
  target.errorCount += 1;
  result.summary.errorFindings += 1;
}

/** Remove every error-severity finding from a named pair, so a declared failure stops reproducing. */
function clearErrors(
  result: Mutable<ConformanceResult>,
  message: string,
  resourceType: string,
): void {
  const target = result.messages.find((m) => m.message === message);
  const resource = target?.resources.find((r) => r.resourceType === resourceType);
  if (target === undefined || resource === undefined) {
    throw new Error(`no ${message} / ${resourceType} pair to clear`);
  }
  for (const verdict of resource.profileVerdicts) {
    verdict.findings = verdict.findings.filter(
      (f) => f.severity !== "error" && f.severity !== "fatal",
    );
    verdict.errorCount = 0;
  }
  resource.errorCount = 0;
}

describe("A1: every Bundle is validated against FHIR R4 and a named, versioned profile package", () => {
  it("validates every published message against base R4 4.0.1 and against hl7.fhir.us.core 9.0.0", () => {
    const result = liveResult();
    expect(result.messages.map((m) => m.message)).toEqual([...PUBLISHED_MESSAGE_NAMES]);

    for (const message of result.messages) {
      expect(message.status).toBe("validated");
      expect(message.resources.length).toBeGreaterThan(0);
      for (const resource of message.resources) {
        // The base half: named and versioned on every single resource.
        expect(resource.baseR4.packageId).toBe("hl7.fhir.r4.core");
        expect(resource.baseR4.packageVersion).toBe("4.0.1");
        // The profile half: a verdict per resource, always naming the package and its version, even
        // when the package publishes no profile for the type (which is recorded as base-R4-only).
        expect(resource.profileVerdicts.length).toBeGreaterThan(0);
        for (const verdict of resource.profileVerdicts) {
          expect(verdict.packageId).toBe("hl7.fhir.us.core");
          expect(verdict.packageVersion).toBe("9.0.0");
        }
      }
    }
  });

  it("passes every check as committed", () => {
    const result = liveResult();
    expect(checkRunIntegrity(result)).toEqual([]);
    expect(checkClaims(result, register())).toEqual([]);
    expect(checkAgainstPublished(result, publishedResult())).toEqual([]);
  });

  it("MUTATION: an error-severity result on a pair declared conformant fails the run and names it", () => {
    const mutated = clone(liveResult());
    injectError(mutated, "ADT_A01", "AllergyIntolerance");
    const failures = checkClaims(mutated, register());
    expect(failures.length).toBeGreaterThan(0);
    expect(failures.some((f) => f.kind === "claim-broken")).toBe(true);
    expect(failures.map((f) => f.pair).join("\n")).toContain("ADT_A01 / AllergyIntolerance /");
  });
});

describe("A2: seven messages, none of them empty", () => {
  it("validates a Bundle for each of the seven published messages, with resources in each", () => {
    const result = liveResult();
    expect(result.summary.messagesValidated).toBe(7);
    expect(result.corpus.messageCount).toBe(7);
    expect(result.summary.resourcesValidated).toBeGreaterThan(0);
    for (const message of result.messages) expect(message.resourceCount).toBeGreaterThan(0);
    expect(checkRunIntegrity(result)).toEqual([]);
  });

  it("MUTATION: a missing message fails the run and names it", () => {
    const mutated = clone(liveResult());
    mutated.messages = mutated.messages.filter((m) => m.message !== "VXU_V04");
    const failures = checkRunIntegrity(mutated);
    expect(failures.some((f) => f.kind === "missing-message" && f.pair === "VXU_V04")).toBe(true);
  });

  it("MUTATION: a Bundle with zero resources fails the run and names it", () => {
    const mutated = clone(liveResult());
    const target = mutated.messages.find((m) => m.message === "ORU_R01");
    if (target === undefined) throw new Error("no ORU_R01");
    target.resourceCount = 0;
    target.resources = [];
    const failures = checkRunIntegrity(mutated);
    expect(failures.some((f) => f.kind === "empty-bundle" && f.pair === "ORU_R01")).toBe(true);
  });

  it("MUTATION: a run that validated zero documents fails, and is never reported as a pass", () => {
    const mutated = clone(liveResult());
    mutated.summary.resourcesValidated = 0;
    expect(checkRunIntegrity(mutated).some((f) => f.kind === "empty-run")).toBe(true);
  });
});

describe("A3: a declared-conformant pair that produces an error fails the run and names the pair", () => {
  it("holds for every pair the register declares conformant", () => {
    const conformant = register().claims.filter((c) => c.conformant);
    expect(conformant.length).toBeGreaterThan(0);
    const observed = new Map(observedPairs(liveResult()).map((p) => [p.key, p]));
    for (const claim of conformant) {
      const key = `${claim.message} / ${claim.resourceType} / ${claim.profile ?? "base-R4-only"}`;
      expect(observed.get(key)?.errorCount, key).toBe(0);
    }
  });

  it("MUTATION: each declared-conformant pair, broken in turn, is caught and named", () => {
    for (const claim of register().claims.filter((c) => c.conformant)) {
      const mutated = clone(liveResult());
      injectError(mutated, claim.message, claim.resourceType);
      const failures = checkClaims(mutated, register());
      const key = `${claim.message} / ${claim.resourceType} / ${claim.profile ?? "base-R4-only"}`;
      expect(
        failures.some((f) => f.kind === "claim-broken" && f.pair === key),
        key,
      ).toBe(true);
    }
  });
});

describe("A4: drift in either direction fails the run and names the pair that moved", () => {
  it("MUTATION: a new error-severity result is drift against the committed published result", () => {
    const mutated = clone(liveResult());
    injectError(mutated, "VXU_V04", "Immunization");
    const failures = checkAgainstPublished(mutated, publishedResult());
    expect(failures.some((f) => f.kind === "drift")).toBe(true);
    expect(failures.map((f) => f.pair).join("\n")).toContain("VXU_V04 / Immunization");
  });

  it("MUTATION: a declared failure that stops reproducing fails the run as a stale excuse", () => {
    const mutated = clone(liveResult());
    clearErrors(mutated, "MDM_T02", "DocumentReference");
    const claimFailures = checkClaims(mutated, register());
    expect(
      claimFailures.some(
        (f) => f.kind === "claim-stale" && f.pair.startsWith("MDM_T02 / DocumentReference"),
      ),
    ).toBe(true);
    const driftFailures = checkAgainstPublished(mutated, publishedResult());
    expect(driftFailures.map((f) => f.pair).join("\n")).toContain("MDM_T02 / DocumentReference");
  });

  it("MUTATION: a pair the register declares but the run never produces fails the run", () => {
    const mutated = clone(liveResult());
    mutated.messages = mutated.messages.filter((m) => m.message !== "SIU_S12");
    const failures = checkClaims(mutated, register());
    expect(
      failures.some((f) => f.kind === "claim-unobserved" && f.pair.startsWith("SIU_S12 /")),
    ).toBe(true);
  });

  it("MUTATION: a pair the run produces and the register does not declare fails the run", () => {
    const trimmed = {
      ...register(),
      claims: register().claims.filter(
        (c) => !(c.message === "ORU_R01" && c.resourceType === "Observation"),
      ),
    };
    const failures = checkClaims(liveResult(), trimmed);
    expect(
      failures.some(
        (f) => f.kind === "claim-missing" && f.pair.startsWith("ORU_R01 / Observation"),
      ),
    ).toBe(true);
  });
});

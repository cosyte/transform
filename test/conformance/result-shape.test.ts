/**
 * The shape of the published result: what a failure names, what a resource records, and whether the
 * artifact can be read as a stronger claim than the checks behind it.
 *
 * ▶ THE POINT OF EVERY ASSERTION HERE IS REPRODUCIBILITY. A finding that does not name the profile
 * and the version it came from is reproducible only against whatever the reader happens to have; a
 * result that does not say which checks it skipped reads as a full validator's. Both are ways of
 * publishing a number that means less than it looks like it means.
 */

import { describe, expect, it } from "vitest";

import { CHECK_CLASSES, type ConformanceResult } from "../../scripts/conformance/harness.js";
import { renderReport } from "../../scripts/conformance/report.js";
import { serializeResult } from "../../scripts/conformance/artifacts.js";
import {
  definitions,
  liveResult,
  publishedReport,
  publishedResult,
  type Mutable,
} from "../_support/conformance.js";

const SEVERITIES = new Set(["fatal", "error", "warning", "information"]);

describe("B1: a profile failure names the profile and its version", () => {
  it("records the profile canonical, the profile version and the package pin on every verdict", () => {
    const result = liveResult();
    let profileFailures = 0;
    for (const message of result.messages) {
      for (const resource of message.resources) {
        for (const verdict of resource.profileVerdicts) {
          if (verdict.basis !== "profile") continue;
          expect(verdict.profile).toMatch(
            /^http:\/\/hl7\.org\/fhir\/us\/core\/StructureDefinition\//,
          );
          expect(verdict.profileVersion).toBe("9.0.0");
          expect(verdict.packageId).toBe("hl7.fhir.us.core");
          expect(verdict.packageVersion).toBe("9.0.0");
          if (verdict.errorCount > 0) profileFailures += 1;
        }
      }
    }
    // The assertion above is vacuous unless the corpus actually produces profile failures.
    expect(profileFailures).toBeGreaterThan(0);
  });

  it("names the profile and version in the human-readable report, beside the finding", () => {
    const report = publishedReport();
    expect(report).toContain("`us-core-encounter` 9.0.0");
    expect(report).toContain("`Encounter.type`");
    expect(report).toContain("`hl7.fhir.us.core` | 9.0.0 |");
  });

  it("MUTATION: a verdict that lost its profile version is visible in the rendered report", () => {
    const mutated = JSON.parse(JSON.stringify(publishedResult())) as Mutable<ConformanceResult>;
    for (const message of mutated.messages) {
      for (const resource of message.resources) {
        for (const verdict of resource.profileVerdicts) {
          verdict.profileVersion = null;
        }
      }
    }
    expect(renderReport(mutated)).not.toContain("`us-core-encounter` 9.0.0");
  });
});

describe("B2: every recorded resource carries its package, its profile and every element path", () => {
  it("records the package pin, the profile applied and a path on every finding", () => {
    const result = liveResult();
    let findings = 0;
    for (const message of result.messages) {
      for (const resource of message.resources) {
        expect(resource.baseR4.packageId).toBe("hl7.fhir.r4.core");
        expect(resource.baseR4.packageVersion).toBe("4.0.1");
        for (const verdict of resource.profileVerdicts) {
          expect(verdict.packageId).toBe("hl7.fhir.us.core");
          expect(verdict.packageVersion).toBe("9.0.0");
          for (const finding of verdict.findings) {
            expect(finding.path.length).toBeGreaterThan(0);
            expect(finding.path.startsWith(resource.resourceType)).toBe(true);
            expect(SEVERITIES.has(finding.severity)).toBe(true);
            expect(finding.code.length).toBeGreaterThan(0);
            expect(finding.message.length).toBeGreaterThan(0);
            findings += 1;
          }
        }
      }
    }
    expect(findings).toBeGreaterThan(0);
  });

  it("records a type the package does not profile as base R4 only, never as profile-conformant", () => {
    const result = liveResult();
    const defs = definitions();
    const unprofiled = new Set<string>();
    for (const message of result.messages) {
      for (const resource of message.resources) {
        const published = defs.profilesForType.get(resource.resourceType) ?? [];
        for (const verdict of resource.profileVerdicts) {
          if (verdict.basis !== "base-R4-only") continue;
          unprofiled.add(resource.resourceType);
          expect(verdict.profile).toBeNull();
          expect(verdict.profileVersion).toBeNull();
        }
        if (published.length === 0) {
          // Nothing in the package applies, so nothing may claim profile conformance for it.
          expect(resource.profileVerdicts.every((v) => v.basis === "base-R4-only")).toBe(true);
        }
      }
    }
    // Measured: US Core 9.0.0 publishes no Bundle, MessageHeader or Appointment profile.
    expect([...unprofiled].sort()).toEqual(["Appointment", "Bundle", "MessageHeader"]);
    for (const type of unprofiled) {
      expect(defs.profilesForType.get(type) ?? []).toHaveLength(0);
    }
  });

  it("publishes the denominator: how many profiles the package has for a type, not just the applied", () => {
    const result = liveResult();
    const observation = result.profileScope.find((s) => s.resourceType === "Observation");
    expect(observation).toBeDefined();
    expect(observation?.publishedByPackage.length).toBeGreaterThan(1);
    expect(observation?.applied).toHaveLength(1);
    expect(observation?.reason.length).toBeGreaterThan(0);
    for (const scope of result.profileScope) {
      expect(scope.publishedByPackage.length).toBe(
        (definitions().profilesForType.get(scope.resourceType) ?? []).length,
      );
      for (const applied of scope.applied) expect(scope.publishedByPackage).toContain(applied);
      for (const override of scope.perMessage) {
        for (const applied of override.applied) expect(scope.publishedByPackage).toContain(applied);
      }
    }
  });
});

describe("E1: the artifact declares which classes of check it performed, and both halves agree", () => {
  it("carries the check classes, including the ones that were NOT performed", () => {
    const result = liveResult();
    expect(result.checkClasses).toEqual(CHECK_CLASSES);
    const notPerformed = result.checkClasses.filter((c) => !c.performed);
    expect(notPerformed.length).toBeGreaterThan(0);
    expect(notPerformed.map((c) => c.name)).toContain("external terminology resolution");
    expect(notPerformed.map((c) => c.name)).toContain("mapping correctness");
    for (const c of result.checkClasses) expect(c.detail.length).toBeGreaterThan(0);
  });

  it("publishes the required-binding coverage rather than implying it is complete", () => {
    const result = liveResult();
    expect(result.requiredBindings.enforced).toBeGreaterThan(0);
    expect(result.requiredBindings.notEvaluated).toBeGreaterThan(0);
    expect(result.requiredBindings.enforced).toBe(definitions().schemas.bindingsEnforced.length);
    expect(result.requiredBindings.notEvaluated).toBe(
      definitions().schemas.bindingsNotEvaluated.length,
    );
    for (const skipped of result.requiredBindings.notEvaluatedSample) {
      expect(skipped.reason.length).toBeGreaterThan(0);
    }
  });

  it("the machine-readable and human-readable artifacts agree, byte for byte on a re-render", () => {
    const result = liveResult();
    expect(serializeResult(result)).toBe(serializeResult(publishedResult()));
    expect(renderReport(result)).toBe(publishedReport());
  });

  it("states every check class in the report, with the same performed flag as the result", () => {
    const report = publishedReport();
    for (const c of publishedResult().checkClasses) {
      expect(report).toContain(`| ${c.name} | ${c.performed ? "yes" : "**no**"} |`);
    }
  });

  it("MUTATION: a check class silently flipped to performed changes the rendered report", () => {
    const mutated = JSON.parse(JSON.stringify(publishedResult())) as Mutable<ConformanceResult>;
    const terminology = mutated.checkClasses.find(
      (c) => c.name === "external terminology resolution",
    );
    if (terminology === undefined) throw new Error("no terminology check class");
    terminology.performed = true;
    expect(renderReport(mutated)).not.toBe(publishedReport());
    expect(renderReport(mutated)).not.toContain("| external terminology resolution | **no** |");
  });

  it("MUTATION: a headline that disagrees with the result is not the committed report", () => {
    const mutated = JSON.parse(JSON.stringify(publishedResult())) as Mutable<ConformanceResult>;
    mutated.summary.messagesWithZeroErrors = 7;
    mutated.summary.messagesWithZeroErrorNames = mutated.messages.map((m) => m.message);
    expect(renderReport(mutated)).not.toBe(publishedReport());
  });
});

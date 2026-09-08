/**
 * The public claim: what a consumer reads in the README must be what the measurement says.
 *
 * ▶ THIS IS THE CRITERION THE WHOLE PHASE EXISTS FOR. The README used to say every emitted resource
 * was "validated against `@cosyte/fhir` before it ships", which a reader meets as a conformance
 * claim and which was in fact a minimal internal schema this repository wrote for itself. The
 * sentence is gone, and the number that replaced it is held to the generated result rather than
 * typed once and left to rot.
 */

import { describe, expect, it } from "vitest";

import { REPORT_PATH, RESULT_PATH } from "../../scripts/conformance/artifacts.js";
import { publishedResult, readme } from "../_support/conformance.js";

/** Spell out a small integer the way the README's prose does. */
const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven"] as const;

describe("F1: the README's validation claim points at the published result and matches it", () => {
  it("points the reader at both published artifacts", () => {
    const text = readme();
    expect(text).toContain(REPORT_PATH);
    expect(text).toContain(RESULT_PATH);
    expect(text).toContain("pnpm run conformance");
  });

  it("names the same package and version the generated result was measured against", () => {
    const text = readme();
    const result = publishedResult();
    const profiles = result.packages.find((p) => p.role === "profiles");
    const base = result.packages.find((p) => p.role === "base-definitions");
    expect(profiles).toBeDefined();
    expect(base).toBeDefined();
    expect(text).toContain(`\`${profiles?.id ?? ""}\` version ${profiles?.version ?? ""}`);
    expect(text).toContain(`FHIR R4 ${base?.version ?? ""}`);
  });

  it("states the same passing-message set as the generated result carries", () => {
    const text = readme();
    const result = publishedResult();
    const clean = result.summary.messagesWithZeroErrors;
    const total = result.corpus.messageCount;

    // The headline count, spelled the way the README spells it, and every clean message named.
    expect(text).toContain(
      `${WORDS[clean] ?? String(clean)} of the ${WORDS[total] ?? String(total)} messages`,
    );
    for (const name of result.summary.messagesWithZeroErrorNames) {
      expect(text, `${name} is clean and the README must name it`).toContain(`\`${name}\``);
    }

    // And the base-R4-only figure the README also publishes, derived the same way the report does.
    const baseClean = result.messages.filter(
      (m) => m.status === "validated" && m.resources.every((r) => r.baseR4.errorCount === 0),
    );
    expect(text).toContain(
      `${WORDS[baseClean.length] ?? String(baseClean.length)} of the seven are clean`,
    );
    // The one message that is NOT clean against base R4 is named, with the invariant it breaks.
    const notClean = result.messages.filter((m) => !baseClean.includes(m));
    expect(notClean).toHaveLength(1);
    expect(text).toContain(`\`${notClean[0]?.message ?? ""}\``);
    const constraints = notClean[0]?.resources.flatMap((r) =>
      r.baseR4.findings.filter((f) => f.severity === "error").map((f) => f.constraint ?? ""),
    );
    expect(constraints?.length).toBeGreaterThan(0);
    for (const constraint of constraints ?? []) expect(text).toContain(`\`${constraint}\``);
  });

  it("names profile-required elements the result actually reports as missing", () => {
    const text = readme();
    const result = publishedResult();
    const missing = new Set<string>();
    for (const message of result.messages) {
      for (const resource of message.resources) {
        for (const verdict of resource.profileVerdicts) {
          for (const finding of verdict.findings) {
            if (finding.severity === "error" && finding.code === "CARDINALITY_MIN") {
              missing.add(finding.path);
            }
          }
        }
      }
    }
    // Every element path the README names as an example must be one the result really reports.
    for (const named of [
      "Encounter.type",
      "Coverage.relationship",
      "Observation.category",
      "DocumentReference.category",
    ]) {
      expect(text).toContain(`\`${named}\``);
      expect(missing, `${named} is named in the README`).toContain(named);
    }
  });

  it("leaves no sentence reading the internal emit gate as a conformance claim", () => {
    const text = readme();
    expect(text).not.toContain("validated against `@cosyte/fhir` before it ships");
    // The replacement says what the gate actually is, and says it is not a conformance claim.
    expect(text).toContain("not a statement about FHIR conformance");
    // And the limits of the measurement travel with the number.
    expect(text).toContain("mapping correctness");
    expect(text).toContain("external terminology resolution");
  });
});

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

/**
 * A paragraph that tells a reader this library's output is "validated".
 *
 * ▶ THE WORD IS THE CLAIM, WHEREVER IT APPEARS. Grading this by the one sentence that was deleted
 * checks that a string is gone, not that the property holds: the README's opening paragraph carried
 * the identical claim, in the place a consumer meets first, and a single-literal tripwire over a
 * deleted sentence could not see it. `validator` is deliberately not matched: "not a full
 * implementation-guide validator run" is a disclaimer, not a claim.
 */
const VALIDATION_CLAIM = /\bvalidat(?:ed|es|ing)\b/i;

/**
 * Text that tells the reader what that word does and does not mean.
 *
 * Either half satisfies it: saying outright that the internal check is not a conformance claim, or
 * naming the published measurement so the reader can go and read what conformance was reached.
 */
const QUALIFIED =
  /not a statement about FHIR conformance|not a conformance claim|documentation\/conformance\/report\.md/;

/** The README split into paragraphs, in document order. */
function paragraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
}

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

  it("qualifies every paragraph that calls the output validated, in that paragraph or the next", () => {
    const paras = paragraphs(readme());
    const claims = paras.filter((p) => VALIDATION_CLAIM.test(p));
    // The assertion below is vacuous unless the README makes the claim somewhere.
    expect(claims.length).toBeGreaterThan(0);
    paras.forEach((paragraph, index) => {
      if (!VALIDATION_CLAIM.test(paragraph)) return;
      const withNeighbour = `${paragraph}\n\n${paras[index + 1] ?? ""}`;
      expect(
        QUALIFIED.test(withNeighbour),
        `a paragraph calls the output validated and neither it nor the next paragraph says what ` +
          `that means or where the measurement is:\n\n${paragraph}`,
      ).toBe(true);
    });
  });

  it("qualifies the claim in the opening section, where a consumer meets it first", () => {
    // Everything before the first `##` heading: the lede a reader gets without scrolling.
    const opening = readme().split(/\n## /)[0] ?? "";
    expect(VALIDATION_CLAIM.test(opening), "the README makes its validation claim up front").toBe(
      true,
    );
    expect(
      QUALIFIED.test(opening),
      "the claim a consumer meets first is qualified where they meet it, not 130 lines later",
    ).toBe(true);
  });
});

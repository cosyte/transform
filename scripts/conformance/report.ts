/**
 * Rendering the human-readable half of the published result.
 *
 * ▶ THE REPORT IS DERIVED FROM THE RESULT, NEVER WRITTEN BESIDE IT. Both artifacts come out of one
 * function over one measurement, so the two cannot disagree, and the suite re-renders the committed
 * `result.json` and compares byte for byte to prove they still do not.
 *
 * ▶ THE HEADLINE IS WHAT THE READER MEETS FIRST, AND IT IS THE HONEST ONE. The count of messages
 * that produce a Bundle with zero error-severity results comes before anything that softens it, the
 * profile package is named and versioned in the same sentence, and the classes of check that were
 * NOT performed sit in the same document rather than in a footnote somewhere else.
 */

import { observedPairs } from "./check.js";
import type { ConformanceResult } from "./harness.js";

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/** The short profile name a canonical URL ends with, for a table cell. */
function shortProfile(canonical: string | null): string {
  if (canonical === null) return "(base R4 only)";
  const slash = canonical.lastIndexOf("/");
  return slash < 0 ? canonical : canonical.slice(slash + 1);
}

/**
 * Render `documentation/conformance/report.md` from a measurement.
 *
 * @param result - The measurement.
 * @returns The whole report, ending in a newline.
 */
export function renderReport(result: ConformanceResult): string {
  const base = result.packages.find((p) => p.role === "base-definitions");
  const profilePkg = result.packages.find((p) => p.role === "profiles");
  const lines: string[] = [];

  const clean = result.summary.messagesWithZeroErrors;
  const total = result.corpus.messageCount;

  lines.push("# Output conformance: measured, not asserted");
  lines.push("");
  lines.push(
    "This file is generated. Run `pnpm run conformance` to regenerate it and " +
      "`documentation/conformance/result.json` beside it; the test suite fails the build when either " +
      "drifts from what the harness now measures.",
  );
  lines.push("");
  lines.push("## The result");
  lines.push("");
  lines.push(
    `**${String(clean)} of the ${String(total)} v2 test messages the implementation guide publishes ` +
      `produce a FHIR Bundle with zero error-severity results** against FHIR R4 ` +
      `${base?.version ?? "unknown"} plus the profiles named below from ` +
      `\`${profilePkg?.id ?? "unknown"}\` version ${profilePkg?.version ?? "unknown"}.`,
  );
  lines.push("");
  if (clean === 0) {
    lines.push(
      "No message is clean on that measure. Every message and every finding is listed below.",
    );
  } else {
    lines.push(
      `Clean: ${result.summary.messagesWithZeroErrorNames.map((n) => `\`${n}\``).join(", ")}.`,
    );
  }
  lines.push("");

  const baseOnlyClean = result.messages.filter(
    (m) => m.status === "validated" && m.resources.every((r) => r.baseR4.errorCount === 0),
  );
  lines.push(
    `Against the base R4 ${base?.version ?? "unknown"} definitions alone, without any profile, ` +
      `${String(baseOnlyClean.length)} of ${String(total)} are clean` +
      (baseOnlyClean.length === 0
        ? "."
        : `: ${baseOnlyClean.map((m) => `\`${m.message}\``).join(", ")}.`),
  );
  lines.push("");
  lines.push(
    `${String(result.summary.resourcesValidated)} ${plural(result.summary.resourcesValidated, "resource was", "resources were")} ` +
      `validated in total, producing ${String(result.summary.errorFindings)} error-severity ` +
      `${plural(result.summary.errorFindings, "result", "results")}.`,
  );
  lines.push("");
  lines.push(
    "**This says nothing about mapping correctness.** A message with zero findings carries FHIR that " +
      "is well formed and conforms to the profiles named here. It does not say the right v2 field " +
      "reached the right FHIR element; no published artifact settles that, and this measurement does " +
      "not try to.",
  );
  lines.push("");

  lines.push("## What was measured against");
  lines.push("");
  lines.push("| package | version | role | sha256 | source |");
  lines.push("|---|---|---|---|---|");
  for (const p of result.packages) {
    lines.push(`| \`${p.id}\` | ${p.version} | ${p.role} | \`${p.sha256}\` | ${p.sourceUrl} |`);
  }
  lines.push("");
  lines.push(
    `The corpus is the guide's own published test messages, taken from ${result.corpus.url} ` +
      `(retrieved ${result.corpus.retrievedAt}, sha256 \`${result.corpus.sha256}\`). Both packages are ` +
      "carried in this repository and verified by sha256 on every run: an absent, unreadable or " +
      "hash-mismatched package fails the run explicitly, and nothing is fetched over the network.",
  );
  lines.push("");

  lines.push("## Which checks were performed, and which were not");
  lines.push("");
  lines.push(
    "A result is only as strong as the checks behind it, so they are listed here rather than left to " +
      "be assumed.",
  );
  lines.push("");
  lines.push("| check | performed | detail |");
  lines.push("|---|---|---|");
  for (const c of result.checkClasses) {
    lines.push(`| ${c.name} | ${c.performed ? "yes" : "**no**"} | ${c.detail} |`);
  }
  lines.push("");
  lines.push(
    `Required-binding membership is enforced on ${String(result.requiredBindings.enforced)} ` +
      `${plural(result.requiredBindings.enforced, "element", "elements")} whose value set expands ` +
      `from the pinned packages alone, and is **not evaluated** on ` +
      `${String(result.requiredBindings.notEvaluated)}, each of which needs a code system or a ` +
      "filter the packages do not resolve offline.",
  );
  lines.push("");

  lines.push("## Which profile was applied to what");
  lines.push("");
  lines.push(
    "The profile package publishes several profiles for some resource types and none for others, and " +
      "no resource can satisfy two topic-scoped profiles of the same type at once. The applied " +
      "selection is reviewed by hand in `test/_support/conformance-claims.json`; the count the package " +
      "publishes is read off the package itself, so the denominator is always visible.",
  );
  lines.push("");
  lines.push("| resource type | published by the package | applied here | why |");
  lines.push("|---|---|---|---|");
  for (const scope of result.profileScope) {
    const applied =
      scope.applied.length === 0
        ? "none (base R4 only)"
        : scope.applied.map((p) => `\`${shortProfile(p)}\``).join(", ");
    lines.push(
      `| ${scope.resourceType} | ${String(scope.publishedByPackage.length)} | ${applied} | ${scope.reason} |`,
    );
    for (const override of scope.perMessage) {
      lines.push(
        `| ${scope.resourceType} in \`${override.message}\` | | ` +
          `${override.applied.map((p) => `\`${shortProfile(p)}\``).join(", ")} | ${override.reason} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Every message, every finding");
  lines.push("");
  for (const message of result.messages) {
    lines.push(`### ${message.message}`);
    lines.push("");
    if (message.status === "run-failure") {
      lines.push(
        `**Run failure at the ${message.failure?.stage ?? "unknown"} stage:** ` +
          `${message.failure?.reason ?? "unknown"}`,
      );
      lines.push("");
      continue;
    }
    lines.push(
      `${String(message.resourceCount)} ${plural(message.resourceCount, "resource", "resources")} ` +
        `validated, ${String(message.errorCount)} error-severity ` +
        `${plural(message.errorCount, "result", "results")}.`,
    );
    lines.push("");
    const findings: string[] = [];
    message.resources.forEach((resource) => {
      for (const verdict of resource.profileVerdicts) {
        for (const finding of verdict.findings) {
          if (finding.severity !== "error" && finding.severity !== "fatal") continue;
          findings.push(
            `| ${resource.resourceType} | ${verdict.profile === null ? `base R4 ${base?.version ?? ""}` : `\`${shortProfile(verdict.profile)}\` ${verdict.profileVersion ?? ""}`} | ` +
              `\`${finding.path}\` | ${finding.code}${finding.constraint === undefined ? "" : ` (${finding.constraint})`} | ${finding.message} |`,
          );
        }
      }
    });
    if (findings.length === 0) {
      lines.push("No error-severity result.");
    } else {
      lines.push("| resource | validated against | element | finding | what it means |");
      lines.push("|---|---|---|---|---|");
      lines.push(...[...new Set(findings)]);
    }
    lines.push("");
  }

  lines.push("## The reviewed claims");
  lines.push("");
  lines.push(
    "Every pair below is a line somebody wrote on purpose. A pair declared conformant that starts " +
      "failing breaks the build; so does a pair declared non-conformant that stops failing, so the " +
      "register cannot rot into a list of stale excuses.",
  );
  lines.push("");
  lines.push("| message | resource | validated against | conformant |");
  lines.push("|---|---|---|---|");
  for (const pair of observedPairs(result)) {
    lines.push(
      `| ${pair.message} | ${pair.resourceType} | ` +
        `${pair.profile === null ? `base R4 ${base?.version ?? ""} only` : `\`${shortProfile(pair.profile)}\``} | ` +
        `${pair.conformant ? "yes" : `no (${String(pair.errorCount)})`} |`,
    );
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

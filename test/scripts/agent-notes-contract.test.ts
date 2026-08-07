/**
 * Unit tests for scripts/check-agent-notes.ts: the agent-instruction contract gate.
 *
 * WHAT THIS SUITE IS FOR. A contract gate over prose is the exact shape that prints green
 * over a corpus it never opened, so "it exits 0 on this repo" is worth almost nothing on
 * its own. Every rule below is therefore proved by MUTATION: a throwaway repo that the
 * gate must refuse, and, for the rule most likely to rot silently, the same corpus
 * repaired, which the gate must then accept. Red before, green after, one edit apart.
 *
 * Fixtures are built into throwaway git repos under `os.tmpdir()` and the gate is spawned
 * with `cwd` pointing at them, because the gate roots everything at `process.cwd()`. NEVER
 * write a fixture into the committed corpus to test this: the same rule the PHI-scanner
 * suite works under, for the same reason.
 *
 * The gate is invoked via spawnSync (array args, no shell) so the full CLI path (argv,
 * exit code, stderr) is exercised rather than an exported function that CI never calls.
 *
 * SECURITY: every subprocess call here uses spawnSync with array args. No exec, no
 * shell-form.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync, mkdirSync, rmSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const GATE_PATH = join(REPO_ROOT, "scripts", "check-agent-notes.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

interface RunResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

function runGate(cwd: string): RunResult {
  const r = spawnSync(TSX_BIN, [GATE_PATH], { cwd, encoding: "utf8" });
  return { status: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if ((r.status ?? -1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cosyte-agent-notes-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "t@example.test"]);
  git(dir, ["config", "user.name", "t"]);
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** Write a file into the fixture repo and stage it, so `git ls-files` reports it. */
function put(rel: string, body: string): void {
  const abs = join(dir, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
  git(dir, ["add", "--", rel]);
}

const PKG = `{ "name": "@cosyte/transform", "version": "0.0.0" }\n`;

/**
 * The minimum corpus that SATISFIES the contract. Every mutation below starts here, so a
 * red result is attributable to the one thing that changed and to nothing else.
 */
function healthy(): void {
  put("package.json", PKG);
  put(
    "CLAUDE.md",
    [
      "# @cosyte/transform: Project Guide for Claude",
      "",
      "The long form lives in [`documentation/agent-notes.md`](documentation/agent-notes.md).",
      "",
      "## Status",
      "",
      "Shipped. Why: `documentation/agent-notes.md#the-first-guardrail-in-full`.",
      "",
      "## Guardrails",
      "",
      "Never do the thing. Why: documentation/agent-notes.md#the-second-guardrail",
      "",
      "The build config is `package.json` and the sources are in `src/`.",
      "",
    ].join("\n"),
  );
  put(
    "documentation/agent-notes.md",
    [
      "# @cosyte/transform: agent notes",
      "",
      "The long-form narrative.",
      "",
      "## The `first` guardrail, in full",
      "",
      "It was measured on a Tuesday.",
      "",
      "## The second guardrail",
      "",
      "It was measured on a Wednesday.",
      "",
    ].join("\n"),
  );
  put("src/index.ts", "export const x = 1;\n");
}

describe("scripts/check-agent-notes.ts: the healthy corpus", () => {
  it("accepts a corpus that satisfies the contract", () => {
    healthy();
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("reports how many files it OPENED, not how many exist", () => {
    healthy();
    const r = runGate(dir);
    // CLAUDE.md + documentation/agent-notes.md + package.json. `src/index.ts` is tracked and
    // is deliberately NOT opened, so a count of "tracked" would read 4 and mean nothing.
    expect(r.stdout).toContain("3 file(s) opened and reconciled");
  });
});

describe("R1: existence", () => {
  it("REFUSES (exit 2) when documentation/agent-notes.md is absent", () => {
    healthy();
    rmSync(join(dir, "documentation", "agent-notes.md"));
    git(dir, ["rm", "-q", "--cached", "--", "documentation/agent-notes.md"]);
    const r = runGate(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("GATE COULD NOT COMPLETE");
    expect(r.stderr).toContain("cannot read documentation/agent-notes.md");
  });

  it("REFUSES (exit 2) when agent-notes.md exists on disk but git does not track it", () => {
    healthy();
    git(dir, ["rm", "-q", "--cached", "--", "documentation/agent-notes.md"]);
    // The file is still on disk and reads perfectly well. Resolution is against the INDEX on
    // purpose: a pointer only this worker's clone can follow is a broken pointer. This is the
    // reconciliation branch that fires today, not a pre-check.
    expect(readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8")).toContain(
      "agent notes",
    );
    const r = runGate(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("git does not track");
  });

  it("reports an empty contract file as a violation", () => {
    healthy();
    put("documentation/agent-notes.md", "");
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R1]");
    expect(r.stderr).toContain("the file is empty");
  });
});

describe("R2: the negative control against the WRONG package", () => {
  it("refuses instructions whose title names a different package", () => {
    healthy();
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/astm: agent notes",
        "",
        "The long-form narrative.",
        "",
        "## The `first` guardrail, in full",
        "",
        "It was measured on a Tuesday.",
        "",
        "## The second guardrail",
        "",
        "It was measured on a Wednesday.",
        "",
      ].join("\n"),
    );
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R2]");
    expect(r.stderr).toContain("does not name @cosyte/transform");
  });

  it("refuses an always-read CLAUDE.md retitled to another package", () => {
    healthy();
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8").replace(
      "# @cosyte/transform: Project Guide for Claude",
      "# @cosyte/ncpdp: Project Guide for Claude",
    );
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R2]");
  });

  it("keys the identity on package.json, so it cannot drift from what is published", () => {
    healthy();
    put("package.json", `{ "name": "@cosyte/somethingelse", "version": "0.0.0" }\n`);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("does not name @cosyte/somethingelse");
  });
});

describe("R3: a declared section is empty", () => {
  it("refuses a heading in agent-notes.md with no body", () => {
    healthy();
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/transform: agent notes",
        "",
        "The long-form narrative.",
        "",
        "## The `first` guardrail, in full",
        "",
        "## The second guardrail",
        "",
        "It was measured on a Wednesday.",
        "",
      ].join("\n"),
    );
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R3]");
    expect(r.stderr).toContain("has no body");
  });

  it("refuses an empty section in the always-read CLAUDE.md too", () => {
    healthy();
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8").replace(
      "## Guardrails\n\nNever do the thing.",
      "## Guardrails\n\n## Guardrails again\n\nNever do the thing.",
    );
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R3]");
  });

  it("does NOT read a `#` line inside a fenced code block as an empty heading", () => {
    healthy();
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/transform: agent notes",
        "",
        "The long-form narrative.",
        "",
        "## The `first` guardrail, in full",
        "",
        "```bash",
        "# derive it, never recall it",
        "npm view @cosyte/transform version",
        "```",
        "",
        "## The second guardrail",
        "",
        "It was measured on a Wednesday.",
        "",
      ].join("\n"),
    );
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("R4: a pointer names an anchor that does not resolve", () => {
  it("is RED BEFORE and GREEN AFTER a one-line repair", () => {
    healthy();

    // BEFORE: the section is reworded, exactly as a real edit would do it. Every pointer
    // still LOOKS fine and the file still exists; only the anchor stopped resolving.
    const reworded = readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8").replace(
      "## The `first` guardrail, in full",
      "## The `first` guardrail, in detail",
    );
    put("documentation/agent-notes.md", reworded);

    const before = runGate(dir);
    expect(before.status).toBe(1);
    expect(before.stderr).toContain("[R4]");
    expect(before.stderr).toContain("the-first-guardrail-in-full");

    // AFTER: repair the pointer in CLAUDE.md to match the new heading. Nothing else changes.
    const repaired = readFileSync(join(dir, "CLAUDE.md"), "utf8").replace(
      "documentation/agent-notes.md#the-first-guardrail-in-full",
      "documentation/agent-notes.md#the-first-guardrail-in-detail",
    );
    put("CLAUDE.md", repaired);

    const after = runGate(dir);
    expect(after.stderr).toBe("");
    expect(after.status).toBe(0);
  });

  it("catches a bare (un-backticked) pointer in prose, not only a markdown link", () => {
    healthy();
    const reworded = readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8").replace(
      "## The second guardrail",
      "## The second guardrail, revised",
    );
    put("documentation/agent-notes.md", reworded);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("the-second-guardrail");
  });

  it("refuses a pointer into a markdown file that is not tracked here", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`documentation/nope.md#anything\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("names a file that is not tracked here");
  });

  it("slugs a heading the way GitHub does: backticks, commas, parens and EN DASH dropped", () => {
    healthy();
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/transform: agent notes",
        "",
        "The long-form narrative.",
        "",
        "## Shipped-phase history (Phases 1–6)",
        "",
        "Phases 1 to 6 shipped.",
        "",
        "## The second guardrail",
        "",
        "It was measured on a Wednesday.",
        "",
      ].join("\n"),
    );
    const claude = readFileSync(join(dir, "CLAUDE.md"), "utf8").replace(
      "documentation/agent-notes.md#the-first-guardrail-in-full",
      "documentation/agent-notes.md#shipped-phase-history-phases-16",
    );
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("R5: an orphan section in the archive", () => {
  it("refuses narrative that nothing in CLAUDE.md points at", () => {
    healthy();
    const notes = `${readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8")}\n## A third guardrail\n\nRelocated here, with nothing left pointing at it.\n`;
    put("documentation/agent-notes.md", notes);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R5]");
    expect(r.stderr).toContain("ORPHAN");
  });

  it("goes green once an imperative in CLAUDE.md points at it", () => {
    healthy();
    const notes = `${readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8")}\n## A third guardrail\n\nRelocated here.\n`;
    put("documentation/agent-notes.md", notes);
    expect(runGate(dir).status).toBe(1);

    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nNever do the third thing: \`documentation/agent-notes.md#a-third-guardrail\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("R6: a file pointer that resolves to nothing", () => {
  it("refuses a pointer into a directory that does not exist AT ALL", () => {
    // This fixture repo tracks no `scripts/` at all, which is the case a recogniser learned
    // purely from `git ls-files` cannot see: the deletion empties the very index the
    // recogniser learns from, so the pointer becomes invisible instead of broken. Found by
    // this fixture, not by reading the code. The index-independent extension arm covers it.
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nThe wrapper is \`scripts/attw.mjs\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R6]");
    expect(r.stderr).toContain("scripts/attw.mjs");
  });

  it("refuses a pointer at a missing file inside a directory that DOES exist", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`src/gone.ts\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("src/gone.ts");
  });

  it("does NOT red on illustrative paths inside agent-notes.md: R6 is CLAUDE.md-only", () => {
    healthy();
    // These three are written into throwaway repos by the PHI-scanner suite and must never
    // exist in the committed corpus. A gate that demanded they resolve would push a worker
    // to create them, which is the opposite of what the narrative says.
    const notes = readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8").replace(
      "It was measured on a Tuesday.",
      "It was measured on a Tuesday, writing `src/leak.ts`, `src/linkdir/payload.txt` and `test/fixtures/`.",
    );
    put("documentation/agent-notes.md", notes);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("does not mistake this ecosystem's own vocabulary for paths", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`cosyte/.github@main\`, \`cosyte/.github/.github/workflows/ci.yml@main\`, \`@arethetypeswrong/cli@0.18.4\`, \`node_modules/@cosyte/fhir\`, \`@cosyte/fhir.validateResource\`, \`changeset-release/main\`, \`dist/*.map\`, \`src/**.ts\`, \`file:vendor/*.tgz\`, \`release / release\`, \`@cosyte/hl7\`, \`urn:uuid:\`, \`getExitCode.js\`, \`.prettierignore\` and \`https://cosyte.com/x\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("accepts a directory and a unique filename prefix, not only an exact file", () => {
    healthy();
    put("documentation/decisions/0001-a-real-decision.md", "# A decision\n\nBody.\n");
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`documentation/decisions/0001\` and \`src/\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });
});

describe("R4: GitHub's slug, measured against the punctuation this repo actually writes", () => {
  // A first version of slug() collapsed runs of spaces to ONE hyphen. GitHub does not: each
  // space becomes its own hyphen, so a heading whose dropped mark has a space on either side
  // produces a DOUBLE hyphen. A refuter measured both harms against GitHub's own renderer, a
  // dead pointer passing and a working pointer reddening.
  //
  // THE MARK HERE IS AN EN DASH, AND THE SWAP DOES NOT WEAKEN THE TEST. This corpus used a
  // spaced EM dash until the brand sweep, which banned that character from every tracked file
  // including this one. `slug()` keeps only letters, numbers, spaces, `_` and `-`, so an en
  // dash is dropped exactly like an em dash was and the two surrounding spaces still survive
  // as two hyphens: the behaviour under test is byte-identical. The en dash is punctuation
  // this repo does still write (`Phases 1-6` is spelled with one), so the describe title above
  // stays true. Do not "simplify" the fixture to a heading with no dropped mark at all: the
  // double hyphen is the entire point.
  const spacedDroppedMarkCorpus = (anchorInClaude: string): void => {
    put("package.json", PKG);
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/transform: agent notes",
        "",
        "Narrative.",
        "",
        "## Branch protection – and the limits of this claim",
        "",
        "It was measured.",
        "",
      ].join("\n"),
    );
    put(
      "CLAUDE.md",
      [
        "# @cosyte/transform: Project Guide for Claude",
        "",
        "## Status",
        "",
        `Why: \`documentation/agent-notes.md#${anchorInClaude}\`.`,
        "",
      ].join("\n"),
    );
  };

  it("accepts the DOUBLE-hyphen anchor GitHub actually emits", () => {
    spacedDroppedMarkCorpus("branch-protection--and-the-limits-of-this-claim");
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("drops angle brackets as characters, keeping the tag name, and says so", () => {
    // There is no HTML-tag strip in `slug()`: it was flagged HIGH by CodeQL as an incomplete
    // multi-character sanitisation, it guarded no HTML sink, and `github-slugger` -- the
    // algorithm this is checked against -- strips no tags either. This pins the behaviour that
    // replaced it rather than leaving it to be rediscovered.
    put("package.json", PKG);
    put(
      "documentation/agent-notes.md",
      [
        "# @cosyte/transform: agent notes",
        "",
        "Narrative.",
        "",
        "## The <code>attw</code> gate",
        "",
        "It was measured.",
        "",
      ].join("\n"),
    );
    put(
      "CLAUDE.md",
      [
        "# @cosyte/transform: Project Guide for Claude",
        "",
        "## Status",
        "",
        "Why: `documentation/agent-notes.md#the-codeattwcode-gate`.",
        "",
      ].join("\n"),
    );
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("refuses the single-hyphen anchor, which is dead when clicked", () => {
    spacedDroppedMarkCorpus("branch-protection-and-the-limits-of-this-claim");
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R4]");
  });
});

describe("R3: a section gutted to a horizontal rule is empty", () => {
  it("does not count a thematic break as a body", () => {
    healthy();
    const notes = readFileSync(join(dir, "documentation", "agent-notes.md"), "utf8").replace(
      "It was measured on a Tuesday.",
      "---",
    );
    put("documentation/agent-notes.md", notes);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R3]");
    expect(r.stderr).toContain("has no body");
  });
});

describe("R6: the three ways an author writes a pointer", () => {
  it("catches a path written BARE in prose, not only in backticks or a link", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nThe wrapper lives at scripts/attw.mjs and the config at src/gone/nowhere.ts.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("scripts/attw.mjs");
    expect(r.stderr).toContain("src/gone/nowhere.ts");
  });

  it("catches a DIRECTORY-shaped pointer whose directory does not exist", () => {
    // The extension arm cannot see this one: a directory has no extension. Marked tokens with
    // a trailing slash are an explicit directory claim and get their own index-independent arm.
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`docs-content/\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("docs-content");
  });

  it("exempts build output the repository deliberately does not track", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nThe tarball is built into \`dist/\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("exempts ONLY what is on the list: the list is one entry, and that is measured", () => {
    // `coverage` and `node_modules` were listed too until a refuter measured both dead:
    // emptying the map reds on `dist` alone, because CLAUDE.md names neither of the others.
    // An exemption nothing exercises is a claim nobody checks, so they were deleted, and this
    // pins that deleting them was a real narrowing rather than a cosmetic one.
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nCoverage lands in \`coverage/\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("coverage");
  });

  it("does not treat unmarked prose near-misses as directory claims", () => {
    // Every one of these reddened a correct corpus before the bare harvest was held to a
    // strict path charset and the directory arm restricted to marked tokens.
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nThe location is (segment/field/component index), the scope is \`@cosyte/*\`, and a plain absolute/\`../\` argument is followed. Every segment/\nfield/datatype mapping is cited.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("refuses a TRUNCATED pointer that is merely a prefix of a tracked path", () => {
    healthy();
    const claude = `${readFileSync(join(dir, "CLAUDE.md"), "utf8")}\nSee \`documentation/agent-notes.m\` and \`src/index.t\`.\n`;
    put("CLAUDE.md", claude);
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("documentation/agent-notes.m");
    expect(r.stderr).toContain("src/index.t");
  });
});

describe("the reconciliation is REACHABLE, not decorative", () => {
  // An earlier version guarded every read with a `tracked.has()` pre-check, which made all
  // three refusal branches unreachable by construction while the always-read file sold the
  // reconciliation as the protection. These three land on the "opened but untracked" branch.
  for (const target of ["CLAUDE.md", "documentation/agent-notes.md", "package.json"]) {
    it(`refuses when ${target} is on disk but untracked`, () => {
      healthy();
      git(dir, ["rm", "-q", "--cached", "--", target]);
      const r = runGate(dir);
      expect(r.status).toBe(2);
      expect(r.stderr).toContain("git does not track");
      expect(r.stderr).toContain(target);
      expect(r.stdout).not.toContain("✓");
    });
  }
});

describe("R7: the external allowlist cannot rot into a hiding place", () => {
  it("refuses when a path declared as the meta-repo's starts resolving in-repo", () => {
    healthy();
    // `documentation/conventions.md` is exempted because it lives in the meta-repo. If a copy
    // ever lands here the exemption is ambiguous, and an ambiguous exemption hides pointers.
    put("documentation/conventions.md", "# Conventions\n\nA copy that should not be here.\n");
    const r = runGate(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toContain("[R7]");
    expect(r.stderr).toContain("exempted from R6");
  });
});

describe("EXISTENCE IS NOT OBSERVATION: the control that reds when the gate is pointed at nothing", () => {
  it("REFUSES (exit 2) in an initialised repo with nothing tracked", () => {
    // The failure this ecosystem has hit hardest: a gate whose declared root had never
    // existed, so it printed clean on every run it ever made. A count cannot detect it: a
    // count counts the roots that DID exist. Reconciling against `git ls-files` can.
    const r = runGate(dir);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("zero tracked files");
    expect(r.stdout).not.toContain("✓");
  });

  it("REFUSES (exit 2) outside a git repository", () => {
    const bare = mkdtempSync(join(tmpdir(), "cosyte-agent-notes-nongit-"));
    try {
      writeFileSync(join(bare, "CLAUDE.md"), "# @cosyte/transform\n\nBody.\n", "utf8");
      const r = runGate(bare);
      expect(r.status).toBe(2);
      expect(r.stdout).not.toContain("✓");
    } finally {
      rmSync(bare, { recursive: true, force: true });
    }
  });

  it("REFUSES (exit 2) when package.json is untracked, rather than skipping the identity check", () => {
    healthy();
    git(dir, ["rm", "-q", "--cached", "--", "package.json"]);
    const r = runGate(dir);
    expect(r.status).toBe(2);
    expect(r.stdout).not.toContain("✓");
  });
});

describe("THIS repository's real corpus", () => {
  it("satisfies the contract", () => {
    const r = runGate(REPO_ROOT);
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("opens both contract files and package.json, reconciled against git ls-files", () => {
    const r = runGate(REPO_ROOT);
    expect(r.stdout).toContain("3 file(s) opened and reconciled");
    expect(r.stdout).toContain("git ls-files");
  });

  // The gate has TWO invocation paths and they must not drift: `pnpm check:agent-notes` runs
  // it through tsx (the engine floor is Node 22), and the `no-internal-refs` job runs the same
  // file through bare `node` on 24, where type stripping is native and no install is needed.
  // Pinned by measurement rather than by assertion in a comment. Skips below Node 24, and says
  // so, rather than silently reporting a pass it did not take -- the CI matrix runs 22 AND 24,
  // so the 24 leg always takes it.
  const major = Number(process.versions.node.split(".")[0] ?? "0");
  it.skipIf(major < 24)("agrees byte-for-byte between the tsx path and the bare-node path", () => {
    const viaTsx = runGate(REPO_ROOT);
    const r = spawnSync(process.execPath, [GATE_PATH], { cwd: REPO_ROOT, encoding: "utf8" });
    expect(r.status ?? -1).toBe(viaTsx.status);
    expect(r.stdout ?? "").toBe(viaTsx.stdout);
    expect(r.stderr ?? "").toBe(viaTsx.stderr);
  });

  it("names @cosyte/transform, and no other @cosyte package, in both titles", () => {
    // The standing negative control. A `transform` worker's file was once rewritten
    // out-of-band to attribute its measurements to a different package. Assert the identity
    // on the REAL files, not only on a fixture.
    for (const f of ["CLAUDE.md", "documentation/agent-notes.md"]) {
      const first = readFileSync(join(REPO_ROOT, f), "utf8").split("\n")[0] ?? "";
      expect(first).toContain("@cosyte/transform");
      const scoped = [...first.matchAll(/@cosyte\/[a-z0-9-]+/g)].map((m) => m[0]);
      expect(new Set(scoped)).toEqual(new Set(["@cosyte/transform"]));
    }
  });
});

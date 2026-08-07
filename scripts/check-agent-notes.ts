#!/usr/bin/env tsx
/**
 * `@cosyte/transform` agent-instruction contract gate.
 *
 * The two-file agent-instruction split landed across the whole fleet on 2026-08-04: an
 * always-read `CLAUDE.md` holding the cursor, the rules and every trap as a one-line
 * imperative with a pointer, plus an on-demand `documentation/agent-notes.md` holding the
 * narrative those imperatives point at. Nothing checked it. This file does, for THIS repo.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via `execFileSync`
 * with array args (never shell-form).
 *
 * ===========================================================================
 * ██  WHY THIS EXISTS AT ALL  ███████████████████████████████████████████████
 * ===========================================================================
 *
 * The contract is prose, and this repo's own text says prose no test can check is exactly
 * the shape that was wrong before. Three concrete ways the split rots with every existing
 * gate still green:
 *
 *   (1) `documentation/agent-notes.md` is deleted or renamed. `CLAUDE.md` keeps eight
 *       pointers into a file that is not there. Lint, coverage, `attw`, the PHI scan and
 *       the public-surface gate are all unaffected.
 *   (2) A section is emptied: its body edited away while the heading stays. Every pointer
 *       still resolves; the measurement it pointed at is gone.
 *   (3) A heading is reworded. The anchor in `CLAUDE.md` silently stops resolving. GitHub
 *       renders a dead fragment as the top of the file, so a reader lands on prose and does
 *       not notice they landed on the wrong prose.
 *
 * ===========================================================================
 * ██  EXISTENCE IS NOT OBSERVATION  █████████████████████████████████████████
 * ===========================================================================
 *
 * A check of this shape has a specific, repeatedly-hit failure mode in this ecosystem: IT
 * PRINTS GREEN OVER A CORPUS IT NEVER OPENED. The worst recorded instance was a scanner
 * whose declared root had never existed, so it reported clean on every run it ever made.
 *
 * A COUNT DOES NOT DETECT THAT. A sibling's counterpart reported `71` files against a
 * healthy `122` and read as fine, because a count counts the roots that DID exist. The
 * remedy that works is the one landed in `ncpdp`'s scanner: RECONCILE THE PATHS THIS GATE
 * ACTUALLY OPENED AGAINST AN INDEPENDENT STATEMENT OF THE CORPUS. `git ls-files` is that
 * statement: it reads the index, not the directory entries this gate walks, so the two
 * cannot fail the same way. See `reconcile()` at the bottom of this file. Every read in
 * this gate goes through `readObserved()`, which records the path, so "what we opened" is
 * structural rather than a promise.
 *
 * Do not replace the `ls-files` call with a work-tree probe. Do not let a failure to
 * enumerate become a pass: an EMPTY answer from `git ls-files` counts as NO answer.
 *
 * ===========================================================================
 * ██  EXIT CODES  ███████████████████████████████████████████████████████████
 * ===========================================================================
 *
 *   0  the contract holds
 *   1  CONTRACT VIOLATIONS FOUND: listed on stderr
 *   2  THE GATE COULD NOT COMPLETE OR COULD NOT OBSERVE: a missing contract file, an
 *      unreadable one, a broken `git ls-files`, or a reconciliation mismatch
 *
 * The 1/2 split is `scripts/phi-scan.ts`'s convention and it is load-bearing for the same
 * reason it is there: an uncaught throw lands on node's `1`, so a caller would read a gate
 * that NEVER RAN as one that ran and fired. `main()` funnels every throw to `2`.
 *
 * ===========================================================================
 * ██  WHAT THIS GATE DOES NOT COVER: READ BEFORE YOU TRUST IT  █████████████
 * ===========================================================================
 *
 *   * It proves a heading is POINTED AT. It can never prove the one-line imperative in
 *     `CLAUDE.md` says what the section in `agent-notes.md` says. The meta-repo's
 *     `documentation/conventions.md` names this explicitly: an anchor resolving proves the
 *     target exists, never that it says what the sentence promises. The exposed class is
 *     the trap phrased as a DELIBERATE OMISSION ("is deliberately left alone", "is never
 *     the default"), which carries no identifier to grep for. Enumerate those BY HAND.
 *   * FILE-POINTER RESOLUTION (rule R6) IS SCANNED IN `CLAUDE.md` ONLY, DELIBERATELY.
 *     `agent-notes.md` is narrative and quotes ILLUSTRATIVE paths that must never resolve:
 *     `src/leak.ts`, `src/linkdir/payload.txt`, `test/fixtures/` are written into throwaway
 *     git repos under `os.tmpdir()` by the PHI-scanner suite and deliberately do not exist
 *     here. Requiring them to resolve would be inventing a contract this repo does not
 *     have. Anchor pointers (R4) ARE scanned in both files, because `<file>.md#<anchor>` is
 *     unambiguous.
 *   * It reads the SOURCE of the instructions. It says nothing about whether an agent
 *     followed them.
 *   * It does not gate `CLAUDE.md`'s byte budget. That ratchet lives in the umbrella's
 *     `.claude/hooks/doc-budget.mjs` and nothing inside this repository can observe it:
 *     the same limit `CLAUDE.md` already records for the branch ruleset.
 *   * It does not verify the relocation was VERBATIM. That was a one-time property of the
 *     2026-08-04 move; there is no pre-move text here to diff against.
 *   * R5 (no orphan section) COVERS `##` ONLY. A `###` subsection inside a `##` section is
 *     not required to have its own pointer, because requiring one would force the always-read
 *     file to grow a line per subsection, which is what the byte ratchet exists to prevent.
 *     `agent-notes.md`'s preamble is worded to match.
 *   * A DIRECTORY named with no trailing slash and no extension (`src/datatypes`) is seen by
 *     the index-derived recogniser only, so it goes quiet if its top-level directory is
 *     deleted outright. Write the trailing slash to get the index-independent arm.
 *   * The prefix arm of `resolvesInIndex` accepts a pointer that stops at a `-`, `/` or `.`
 *     boundary inside a longer tracked path. That is what lets `CLAUDE.md` name an ADR by its
 *     number; it is a deliberate cost, not an oversight.
 *   * A heading carrying RAW HTML is not slugged the way GitHub renders it: the angle
 *     brackets are dropped as characters and the tag NAME survives into the anchor. Neither
 *     contract file has one, and the failure is loud (a dead anchor R4 refuses), not silent.
 *   * A bare path wrapped in EMPHASIS and nothing else (`**scripts/nosuch.mjs**`) is not seen
 *     by R6, and a section gutted to a SPACED thematic break (`- - -`) is not seen by R3. Both
 *     measured. THIS IS A SAMPLE OF A CLASS, NOT A LIST OF TWO: the gate reads shapes, so an
 *     author's punctuation can always hide a pointer and a mutation can always dress up as a
 *     body. Keep this list accurate; do not chase the class by growing the guard.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/**
 * The two files the contract is made of. Both must be tracked, both must be READ, and the
 * reconciliation below refuses if either is tracked but unobserved.
 */
const CLAUDE_MD = "CLAUDE.md";
const AGENT_NOTES = "documentation/agent-notes.md";
const CONTRACT_FILES = [CLAUDE_MD, AGENT_NOTES] as const;

/**
 * `package.json` is read for ONE reason: the negative control in R2. It is part of the
 * observed corpus, so it is listed here rather than read off to the side.
 */
const MANIFEST = "package.json";

/**
 * PATHS NAMED IN `CLAUDE.md` THAT DELIBERATELY LIVE IN THE META-REPO, NOT HERE.
 *
 * Each is written in `CLAUDE.md` qualified as the meta-repo's ("The source of truth is the
 * meta-repo's `documentation/conventions.md`"), and there is no copy in this repo on
 * purpose: a second copy is what the meta-repo exists to prevent.
 *
 * THIS LIST CANNOT SILENTLY ROT INTO A HIDING PLACE. R7 refuses if an entry EVER resolves
 * in-repo: at that moment the path is ambiguous, the exemption is wrong, and the gate says
 * so instead of quietly exempting a real pointer. That is the self-correcting shape the
 * meta-repo's rule 2 asks for: an exemption without its reason cannot correct itself.
 */
const EXTERNAL_PATHS = new Map<string, string>([
  [
    "documentation/conventions.md",
    "the meta-repo's shared conventions; deliberately not copied here",
  ],
  [
    "documentation/repos/transform.md",
    "the meta-repo's per-repo deep dive; written from outside this repo",
  ],
]);

/** A violation of the contract (exit 1), as opposed to a failure to run the gate (exit 2). */
interface Violation {
  readonly rule: string;
  readonly where: string;
  readonly detail: string;
}

/** Thrown for every condition that means THE GATE COULD NOT DECIDE. Funnelled to exit 2. */
class GateError extends Error {}

/** Every path this gate actually opened and read, recorded at the read site. */
const observed = new Set<string>();

/**
 * The only way this file reads bytes. Recording here rather than at each call site is what
 * makes `observed` a fact about the run instead of a claim about the code.
 */
function readObserved(path: string): string {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    throw new GateError(`cannot read ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  observed.add(path);
  return text;
}

/**
 * `git ls-files -z`, the independent statement of the corpus. It reads git's INDEX; the
 * rest of this gate reads the working tree by name. Two different sources is the whole
 * point: a mistake in one does not reproduce in the other.
 *
 * An EMPTY answer counts as NO answer. `git ls-files` exits 0 outside a repo and in an
 * empty one, so a zero-length result is indistinguishable from "the corpus is gone" and
 * must never read as "nothing to check, therefore clean".
 */
function trackedPaths(): Set<string> {
  let raw: string;
  try {
    raw = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    throw new GateError(
      `\`git ls-files\` failed, so the corpus cannot be stated independently: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  const paths = raw.split("\0").filter((p) => p.length > 0);
  if (paths.length === 0) {
    throw new GateError(
      "`git ls-files` reported zero tracked files, so the enumeration is broken rather than the " +
        "repository being clean. A gate that observed nothing must refuse, not pass.",
    );
  }
  return new Set(paths);
}

/**
 * GitHub's heading-anchor slug, which is what a `file.md#anchor` pointer is resolved
 * against when a human clicks it.
 *
 * Lowercase; drop everything that is not a letter, a number, a space, `_` or `-`; then
 * spaces to `-`. Note what that does and does not keep: backticks, commas and parentheses
 * are DROPPED, and so is the EN DASH, so `## Shipped-phase history (Phases 1–6)` slugs to
 * `shipped-phase-history-phases-16`, not `...phases-1-6`. Getting that wrong would make
 * this gate red on a pointer that works, which is worse than not having the gate.
 *
 * ▶ EACH SPACE BECOMES ITS OWN HYPHEN. RUNS ARE NOT COLLAPSED, AND THAT IS THE WHOLE
 * DIFFERENCE BETWEEN THIS AND A PLAUSIBLE-LOOKING SLUGGER. `## Branch protection – and the
 * limits` has a space either side of a dropped mark; the mark goes and TWO spaces remain,
 * so GitHub emits `branch-protection--and-the-limits` with a DOUBLE hyphen. A first version
 * of this function collapsed the run, and a refuter measured both harms against GitHub's own
 * renderer (`POST /markdown`) and against `github-slugger`: it passed a pointer that is DEAD
 * when clicked, and it reddened a pointer that WORKS. This was one heading away when the
 * house punctuation was a spaced em dash; the brand sweep retired that character, and it is
 * still one heading away, because EVERY dropped mark with a space either side does the same
 * thing. Do not "tidy" the run.
 *
 * ▶ THERE IS DELIBERATELY NO HTML-TAG STRIP HERE, AND ITS REMOVAL WAS NOT COSMETIC. A
 * `.replace(/<[^>]*>/g, "")` stood in this chain and CodeQL flagged it HIGH as an incomplete
 * multi-character sanitisation, correctly: a single pass leaves `<scr<script>ipt>` behind.
 * Two reasons it went rather than grew a loop. It was never a sanitiser, nothing here
 * reaches an HTML sink, so hardening it would have been defending a sink that does not
 * exist. And `github-slugger`, the algorithm this function is checked against, strips no tags
 * at all, so the line was a DEVIATION from the thing it was imitating. Measured before
 * removal: no heading in either contract file contains `<` or `>`, so every anchor is
 * byte-identical without it.
 */
function slug(heading: string): string {
  return heading
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{Zs}_-]/gu, "")
    .replace(/\p{Zs}/gu, "-");
}

interface Heading {
  readonly level: number;
  readonly text: string;
  readonly anchor: string;
  readonly line: number;
  /** Non-blank, non-heading lines between this heading and the next one, at any level. */
  readonly bodyLines: number;
}

/**
 * Parse ATX headings and measure each one's body.
 *
 * FENCED CODE IS SKIPPED. `agent-notes.md` and `CLAUDE.md` both contain ```bash blocks
 * whose lines can start with `#` (a shell comment), and reading one as a heading would
 * invent an empty section that does not exist. Setext (`===`/`---` underline) headings are
 * NOT parsed: neither contract file uses them, and inventing support for a shape the repo
 * does not have is how a gate acquires rules nobody asked for. If one is ever added here,
 * this function must be extended or it will not see it.
 *
 * A THEMATIC BREAK IS NOT A BODY. A section gutted down to a bare `---` reads as one line of
 * content to a line counter and as an empty section to a human, and "a declared section is
 * empty" is the rule this measures. Measured by a refuter, which emptied a section to a rule
 * and got a `✓`. Blockquote markers and list bullets DO count: they carry prose.
 *
 * ▶ UNSPACED RUNS ONLY: `---`, `***`, `___`. CommonMark also accepts `- - -`, and a refuter
 * measured that shape still passing. The claim is narrowed to what runs rather than the rule
 * widened, because widening it towards "a line of only dashes and spaces" starts competing
 * with list syntax, and a gate that eats a real bullet is worse than one that misses a
 * gutted section. Neither contract file uses the spaced form.
 */
function parseHeadings(text: string): Heading[] {
  const lines = text.split("\n");
  const out: { level: number; text: string; anchor: string; line: number; bodyLines: number }[] =
    [];
  const seen = new Map<string, number>();
  let inFence = false;
  const isBody = (line: string): boolean =>
    line.trim() !== "" && !/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (/^\s{0,3}(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      if (out.length > 0 && line.trim() !== "") {
        const last = out[out.length - 1];
        if (last) last.bodyLines += 1;
      }
      continue;
    }
    const m = /^(#{1,6})\s+(.*\S)\s*$/.exec(line);
    if (m) {
      const level = (m[1] ?? "").length;
      const heading = m[2] ?? "";
      const base = slug(heading);
      const n = seen.get(base) ?? 0;
      seen.set(base, n + 1);
      out.push({
        level,
        text: heading,
        anchor: n === 0 ? base : `${base}-${String(n)}`,
        line: i + 1,
        bodyLines: 0,
      });
      continue;
    }
    if (out.length > 0 && isBody(line)) {
      const last = out[out.length - 1];
      if (last) last.bodyLines += 1;
    }
  }
  return out;
}

/**
 * Every `<path>.md#<anchor>` pointer in a document, wherever it is written: inside
 * backticks, inside a markdown link target, or bare in a sentence. All three shapes are
 * live in `CLAUDE.md` today, so keying on markdown links alone would see one of eight.
 */
function anchorPointers(text: string): { path: string; anchor: string }[] {
  const out: { path: string; anchor: string }[] = [];
  const re = /([A-Za-z0-9._/-]+\.md)#([A-Za-z0-9_-]+)/g;
  for (const m of text.matchAll(re)) {
    const path = m[1];
    const anchor = m[2];
    if (path !== undefined && anchor !== undefined) out.push({ path, anchor });
  }
  return out;
}

/**
 * BUILD OUTPUT `CLAUDE.md` NAMES ON PURPOSE AND GIT DELIBERATELY DOES NOT CARRY. Same
 * self-correcting shape as `EXTERNAL_PATHS`: if one ever becomes tracked the exemption is
 * wrong and R7 refuses, so this list cannot quietly become a hiding place.
 *
 * ONE ENTRY, BECAUSE ONE IS WHAT THE CORPUS NEEDS. `coverage` and `node_modules` were listed
 * here first and a refuter measured both DEAD: emptying the map reds on `dist` alone, because
 * `CLAUDE.md` names neither of the others. An exemption nothing exercises is a claim nobody
 * checks. Add the next one when a pointer needs it, not in anticipation.
 */
const UNTRACKED_BY_DESIGN = new Map<string, string>([
  ["dist", "tsup build output; `CLAUDE.md` discusses what ships in it"],
]);

/**
 * Candidate in-repo path tokens in a document.
 *
 * THREE HARVEST SHAPES, NOT ONE: backticked spans, markdown link targets, AND bare
 * whitespace-delimited words with trailing prose punctuation trimmed. The first version
 * harvested only the first two, and a refuter measured the consequence: appending
 * `The wrapper lives at scripts/attw.mjs.` to `CLAUDE.md` in a repo tracking no `scripts/`
 * returned a green `✓`, while the identical token inside backticks reddened.
 *
 * ▶ IT IS THREE SHAPES, NOT ALL SHAPES, AND THE DIFFERENCE IS MEASURED RATHER THAN GUESSED.
 * A bare path wrapped in EMPHASIS (`**scripts/nosuch.mjs**`, `_..._`, `*...*`) is still not
 * seen, because the strict charset below rejects the marker characters and trimming them
 * would re-admit the `@cosyte/*` glob that the charset exists to keep out. Measured: no path
 * in this repo's `CLAUDE.md` is emphasised without also being backticked, so there is no live
 * false green, but do not read this paragraph as "any punctuation".
 *
 * THE RECOGNISER IS MOSTLY DERIVED FROM `git ls-files`, NOT INVENTED. A token counts as an
 * in-repo path if it is a tracked TOP-LEVEL FILENAME (`package.json`, `vitest.config.ts`) or
 * begins with a tracked TOP-LEVEL DIRECTORY plus `/` (`documentation/`, `scripts/`, `src/`,
 * `test/`, `.github/`, `.changeset/`, `docs-content/`, `vendor/`). That is a POSITIVE
 * recogniser: it widens automatically when the repo grows a directory, and it is why
 * `cosyte/.github`, `changeset-release/main`, `urn:uuid:` and `release / release` are not
 * mistaken for paths. A "does it look like a path" heuristic was tried first and produced a
 * dozen false positives on this repo's own vocabulary.
 *
 * ▶ THAT RECOGNISER ALONE HAS A HOLE, AND IT IS THE LOUD FAILURE IT MISSES, NOT A QUIET ONE:
 * a pointer at `scripts/attw.mjs` in a repo where `scripts/` HAS BEEN DELETED ENTIRELY is
 * invisible, because the recogniser learns its directories from the very index the deletion
 * emptied. That is the same shape as grading a corpus you never opened, one level up. Both
 * arms below are therefore INDEX-INDEPENDENT, and both were added because a fixture found
 * the gap, not because the code read wrong:
 *
 *   (a) a token containing `/`, carrying no `@` in its final segment, whose final segment
 *       ends in a source/doc extension this repo uses. `@cosyte/fhir.validateResource`,
 *       `@arethetypeswrong/cli@0.18.4`, `cosyte/.github/.github/workflows/ci.yml@main` and
 *       `node_modules/@cosyte/fhir` are excluded by those two conditions.
 *   (b) a BACKTICKED OR LINKED token written with a TRAILING SLASH, which is an explicit
 *       directory claim. `dist/` and `docs-content/` are both written that way in
 *       `CLAUDE.md`, and arm (a) sees neither because a directory has no extension. Arm (b)
 *       is restricted to marked tokens on purpose: an unmarked `segment/` at a line break in
 *       ordinary prose is not a directory, and treating it as one reddened a correct corpus.
 *
 * ▶ WHAT NEITHER ARM SEES, SAID RATHER THAN IMPLIED AWAY: a directory named with NO trailing
 * slash and no extension (`src/datatypes`, `src/messages`) is indistinguishable from prose
 * index-independently, so it is caught by the derived recogniser only, i.e. only while its
 * TOP-LEVEL directory still exists. Delete `src/` outright and those four pointers go quiet.
 * Write the trailing slash if you want arm (b).
 *
 * Tokens carrying whitespace or a glob metacharacter are not paths, nor are relative-prefix
 * tokens (`../`, `//`), nor URLs. A `#fragment` is stripped here and handled by the anchor
 * rule.
 */
function pathPointers(text: string, tracked: Set<string>): string[] {
  const topFiles = new Set([...tracked].filter((p) => !p.includes("/")));
  const topDirs = new Set(
    [...tracked].filter((p) => p.includes("/")).map((p) => p.split("/")[0] ?? ""),
  );

  // MARKED tokens: the author wrote backticks or a link target around it, so it is a path
  // claim by construction and the directory arm may trust it.
  const marked = new Set<string>();
  for (const m of text.matchAll(/`([^`\n]+)`/g)) if (m[1] !== undefined) marked.add(m[1]);
  for (const m of text.matchAll(/\]\(([^)\s]+)\)/g)) if (m[1] !== undefined) marked.add(m[1]);

  // BARE tokens: a whitespace-delimited word with leading/trailing prose punctuation trimmed.
  // Held to a STRICT path charset, because unmarked prose is not a path claim and this repo's
  // sentences are full of near-misses -- `@cosyte/*`, `(segment/field/component index)`, a
  // line-broken `segment/`, and `absolute/`../`` all reached the recogniser when the charset
  // was not there, and every one of them reddened a corpus that is correct. A `*` is NOT
  // trimmed, so a glob stays a glob and is refused below.
  const bare = new Set<string>();
  for (const word of text.split(/\s+/)) {
    const trimmed = word.replace(/^[.,;:!?"'([<>{]+/, "").replace(/[.,;:!?"')\]<>}]+$/, "");
    if (/^[A-Za-z0-9._/-]+$/.test(trimmed)) bare.add(trimmed);
  }

  const out: string[] = [];
  for (const [token, isMarked] of [
    ...[...marked].map((t) => [t, true] as const),
    ...[...bare].map((t) => [t, false] as const),
  ]) {
    if (/\s/.test(token) || /[*?]/.test(token)) continue;
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(token)) continue;
    const withoutFragment = token.split("#")[0] ?? "";
    const isDirClaim = isMarked && /\/$/.test(withoutFragment);
    const path = withoutFragment.replace(/\/+$/, "");
    if (path === "") continue;
    const head = path.split("/")[0] ?? "";
    if (head === "" || head === "." || head === "..") continue;
    const tail = path.slice(path.lastIndexOf("/") + 1);
    const looksLikeFile =
      path.includes("/") &&
      !tail.includes("@") &&
      /\.(?:ts|tsx|js|mjs|cjs|json|md|ya?ml|sh|txt|toml)$/.test(tail);
    if (!topFiles.has(path) && !topDirs.has(head) && !looksLikeFile && !isDirClaim) continue;
    out.push(path);
  }
  return [...new Set(out)];
}

/**
 * Resolve a path token against the INDEX, never against the filesystem: an untracked file on
 * one worker's disk is not a pointer another clone can follow.
 *
 * Three ways to resolve, narrowest first: an exact tracked file; a tracked directory; or a
 * prefix of EXACTLY ONE tracked path. The third exists for `documentation/decisions/0001`,
 * which `CLAUDE.md` names by its ADR number rather than its full filename.
 *
 * ▶ THE PREFIX ARM MUST BREAK AT A SEPARATOR. Without that condition it accepts a TRUNCATED
 * pointer: `documentation/agent-notes.m` and `src/index.t` are each a prefix of exactly one
 * tracked path and each 404s on GitHub, and a refuter measured both passing. Requiring the
 * remainder to start `-`, `/` or `.` keeps the ADR-number case and drops the truncations.
 */
function resolvesInIndex(path: string, tracked: Set<string>): boolean {
  if (tracked.has(path)) return true;
  const asDir = `${path}/`;
  for (const t of tracked) if (t.startsWith(asDir)) return true;
  let hits = 0;
  for (const t of tracked) {
    if (!t.startsWith(path)) continue;
    if (!/^[-/.]/.test(t.slice(path.length))) continue;
    hits += 1;
  }
  return hits === 1;
}

/** R1 + R2 + R3 + R4 + R5 + R6 + R7. Collects, never throws for a mere violation. */
function checkContract(tracked: Set<string>): Violation[] {
  const v: Violation[] = [];

  // ── R1 EXISTENCE. A contract file the gate cannot grade is exit 2, not a violation to
  // report and carry on from.
  //
  // ▶ THERE IS DELIBERATELY NO `tracked.has()` PRE-CHECK HERE, AND THAT IS WHAT MAKES THE
  // RECONCILIATION LOAD-BEARING RATHER THAN DECORATIVE. A first version guarded every read
  // with one, and a refuter measured the consequence by instrumenting all three of
  // `reconcile()`'s refusal branches and running the whole suite: ZERO firings. Every branch
  // was unreachable by construction, while `CLAUDE.md` and the changeset both sold the
  // reconciliation as the protection. This repo's own workflow banner, ten lines above the
  // CI step this gate rides in, says it: a check that cannot fail is documentation.
  //
  // So the read comes first and the index has the last word. A file MISSING throws out of
  // `readObserved`; a file PRESENT ON DISK BUT UNTRACKED reads fine and is then refused by
  // `reconcile`, which is a branch that genuinely fires and has a fixture.
  const texts = new Map<string, string>();
  for (const f of CONTRACT_FILES) texts.set(f, readObserved(f));
  const claude = texts.get(CLAUDE_MD) ?? "";
  const notes = texts.get(AGENT_NOTES) ?? "";

  for (const f of CONTRACT_FILES) {
    if ((texts.get(f) ?? "").trim() === "") {
      v.push({ rule: "R1", where: f, detail: "the file is empty" });
    }
  }

  // ── R2 IDENTITY, the negative control against the WRONG PACKAGE.
  //
  // This is not hypothetical here. A `transform` worker's file was once rewritten
  // out-of-band to attribute its measurements to a different package, carrying an
  // instruction to treat that as intentional and not mention it. The worker refused,
  // corrected the file and reported it. A gate should not need a worker to be vigilant:
  // if the always-read instructions stop naming THIS package, refuse.
  //
  // Keyed on `package.json`'s `name`, so it cannot drift from what is published. Same shape
  // as the contract files above: read first, and let `reconcile` refuse an untracked one.
  let pkgName = "";
  try {
    const parsed: unknown = JSON.parse(readObserved(MANIFEST));
    if (typeof parsed === "object" && parsed !== null && "name" in parsed) {
      const n: unknown = parsed.name;
      if (typeof n === "string") pkgName = n;
    }
  } catch (err) {
    throw new GateError(
      `${MANIFEST} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (pkgName === "") throw new GateError(`${MANIFEST} declares no string \`name\`.`);

  for (const f of CONTRACT_FILES) {
    const first = parseHeadings(texts.get(f) ?? "").find((h) => h.level === 1);
    if (first === undefined) {
      v.push({ rule: "R2", where: f, detail: "no level-1 heading, so the file names no package" });
    } else if (!first.text.includes(pkgName)) {
      v.push({
        rule: "R2",
        where: `${f}:${String(first.line)}`,
        detail:
          `the title does not name ${pkgName}. These are THIS package's always-read agent ` +
          `instructions; a title naming another package means the file was replaced, not edited.`,
      });
    }
  }

  // ── R3 DECLARED SECTIONS ARE NON-EMPTY, in both files. A heading with no body is a
  // pointer target that resolves to nothing, which is the failure mode a pure existence
  // check cannot see.
  for (const f of CONTRACT_FILES) {
    for (const h of parseHeadings(texts.get(f) ?? "")) {
      if (h.level === 1) continue;
      if (h.bodyLines === 0) {
        v.push({
          rule: "R3",
          where: `${f}:${String(h.line)}`,
          detail: `section "${h.text}" has no body`,
        });
      }
    }
  }

  // ── R4 ANCHOR POINTERS RESOLVE, from both files, into any tracked in-repo markdown.
  const anchorsByFile = new Map<string, Set<string>>();
  const anchorsFor = (path: string): Set<string> | undefined => {
    const cached = anchorsByFile.get(path);
    if (cached !== undefined) return cached;
    if (!tracked.has(path)) return undefined;
    const set = new Set(parseHeadings(texts.get(path) ?? readObserved(path)).map((h) => h.anchor));
    anchorsByFile.set(path, set);
    return set;
  };

  for (const f of CONTRACT_FILES) {
    for (const p of anchorPointers(texts.get(f) ?? "")) {
      if (EXTERNAL_PATHS.has(p.path)) continue;
      const anchors = anchorsFor(p.path);
      if (anchors === undefined) {
        v.push({
          rule: "R4",
          where: f,
          detail: `pointer \`${p.path}#${p.anchor}\` names a file that is not tracked here`,
        });
        continue;
      }
      if (!anchors.has(p.anchor)) {
        v.push({
          rule: "R4",
          where: f,
          detail:
            `pointer \`${p.path}#${p.anchor}\` names an anchor no heading in ${p.path} produces. ` +
            `A dead fragment renders as the TOP of the file, so a reader lands on prose and does ` +
            `not notice it is the wrong prose.`,
        });
      }
    }
  }

  // ── R5 NO ORPHAN SECTIONS. `agent-notes.md` states, in its own preamble, that "Every
  // heading is a pointer target from `CLAUDE.md`". That is the structural half of the
  // relocation contract: narrative reaching the archive with nothing left pointing at it in
  // the hot file is exactly the trap the meta-repo warns about. THE HALF THIS CANNOT SEE is
  // the one-liner that points here but no longer SAYS what this section says. That stays a
  // human obligation and is named at the top of this file.
  const claudeAnchors = new Set(
    anchorPointers(claude)
      .filter((p) => p.path === AGENT_NOTES)
      .map((p) => p.anchor),
  );
  for (const h of parseHeadings(notes)) {
    if (h.level !== 2) continue;
    if (!claudeAnchors.has(h.anchor)) {
      v.push({
        rule: "R5",
        where: `${AGENT_NOTES}:${String(h.line)}`,
        detail:
          `section "${h.text}" (#${h.anchor}) is an ORPHAN: nothing in ${CLAUDE_MD} points at ` +
          `it, so a worker who only reads the always-read file never learns it exists.`,
      });
    }
  }

  // ── R6 FILE POINTERS RESOLVE. `CLAUDE.md` ONLY: see the header for why `agent-notes.md`
  // is deliberately excluded (it quotes illustrative paths that must never resolve).
  for (const p of pathPointers(claude, tracked)) {
    if (EXTERNAL_PATHS.has(p) || UNTRACKED_BY_DESIGN.has(p)) continue;
    if (!resolvesInIndex(p, tracked)) {
      v.push({
        rule: "R6",
        where: CLAUDE_MD,
        detail: `pointer \`${p}\` resolves to nothing tracked in this repo`,
      });
    }
  }

  // ── R7 NEITHER R6 EXEMPTION LIST IS STALE: the meta-repo paths and the by-design-untracked
  // build outputs. An exemption that starts resolving in-repo is an exemption that has begun
  // hiding a real pointer. Refuse instead of exempting.
  for (const [p, reason] of [...EXTERNAL_PATHS, ...UNTRACKED_BY_DESIGN]) {
    if (resolvesInIndex(p, tracked)) {
      v.push({
        rule: "R7",
        where: "scripts/check-agent-notes.ts",
        detail:
          `\`${p}\` is exempted from R6 ("${reason}") but now resolves in this repo. The ` +
          `exemption is wrong and would hide a real broken pointer. Remove the entry.`,
      });
    }
  }

  return v;
}

/**
 * OBSERVATION, NOT EXISTENCE. Runs after the checks and can only ever REFUSE: it never
 * turns a red run green.
 *
 * ▶ BE PRECISE ABOUT WHICH OF THESE FIRES TODAY, BECAUSE AN EARLIER VERSION OF THIS FUNCTION
 * COULD NOT FIRE AT ALL. Every read was guarded by a `tracked.has()` pre-check, so all three
 * branches were unreachable by construction; a refuter instrumented them, ran the whole
 * suite, and measured ZERO firings while the always-read `CLAUDE.md` sold this as the
 * protection. The pre-checks were removed rather than the function. Now:
 *
 *   (a) `observed` is empty: a TRIPWIRE FOR A FUTURE EDIT, not a live check. It becomes
 *       reachable the moment someone makes a read conditional. Kept for that, and labelled
 *       as that rather than counted as protection.
 *   (b) a contract file is tracked but was never opened. Same: a tripwire, reachable only
 *       once a read is skipped or short-circuited.
 *   (c) something was opened that git does not carry: THIS ONE FIRES TODAY. An untracked
 *       `CLAUDE.md`, `agent-notes.md` or `package.json` sitting on one worker's disk reads
 *       perfectly well and is refused here, because a pointer no other clone can follow is
 *       not a contract. Three fixtures in the suite land on it.
 *   (d) `git ls-files` answered emptily: handled in `trackedPaths()`, which refuses there,
 *       and that is what makes an empty or non-git directory exit 2 rather than green.
 */
function reconcile(tracked: Set<string>): void {
  if (observed.size === 0) {
    throw new GateError("the gate opened zero files. An unobserved corpus is never a clean one.");
  }
  const unobserved = [...CONTRACT_FILES, MANIFEST].filter(
    (f) => tracked.has(f) && !observed.has(f),
  );
  if (unobserved.length > 0) {
    throw new GateError(
      `tracked but NEVER OPENED by this run: ${unobserved.join(", ")}. The gate reported on a ` +
        `corpus it did not read.`,
    );
  }
  const untracked = [...observed].filter((p) => !tracked.has(p));
  if (untracked.length > 0) {
    throw new GateError(
      `opened files git does not track: ${untracked.join(", ")}. The gate graded something no ` +
        `other clone of this repository has.`,
    );
  }
}

function main(): number {
  let tracked: Set<string>;
  let violations: Violation[];
  try {
    tracked = trackedPaths();
    violations = checkContract(tracked);
    reconcile(tracked);
  } catch (err) {
    if (err instanceof GateError) {
      process.stderr.write(`✗ agent-notes contract: GATE COULD NOT COMPLETE\n  ${err.message}\n`);
      return 2;
    }
    process.stderr.write(
      `✗ agent-notes contract: GATE COULD NOT COMPLETE\n  unexpected: ${
        err instanceof Error ? (err.stack ?? err.message) : String(err)
      }\n`,
    );
    return 2;
  }

  if (violations.length > 0) {
    process.stderr.write(`✗ agent-notes contract: ${String(violations.length)} violation(s)\n`);
    for (const x of violations) {
      process.stderr.write(`  [${x.rule}] ${x.where}: ${x.detail}\n`);
    }
    process.stderr.write(
      `\nThe two-file split (always-read ${CLAUDE_MD} + on-demand ${AGENT_NOTES}) is the contract.\n` +
        `Fix the pointer or the section. Never delete a trap to get green.\n`,
    );
    return 1;
  }

  process.stdout.write(
    `✓ agent-notes contract: ${String(observed.size)} file(s) opened and reconciled against ` +
      `git ls-files (${String(tracked.size)} tracked)\n`,
  );
  return 0;
}

process.exit(main());

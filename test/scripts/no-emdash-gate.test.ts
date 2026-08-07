/**
 * Tests for `scripts/check-no-emdash.mjs`, the em-dash gate.
 *
 * WHY THIS FILE EXISTS. A green check proves nothing on its own. Every defect
 * this class of gate has shipped in this ecosystem was invisible to a green run:
 * a scanner that silently skipped a file, a lost exit status, a self-exclusion
 * that made the gate the one file nobody checked, a pattern that matched nothing
 * because a forced `-G` turned its alternation into a literal. All of those
 * report OK. So the cases below feed the gate the exact things it bans and
 * assert the real process exit status, and pair each with a near miss that must
 * stay green.
 *
 * WHAT EACH GROUP PINS, AND WHY IT IS HERE:
 *
 *  1. THE TREE IS CLEAN AND THE GATE SAYS SO. The one case that would red on a
 *     regression in an ordinary file.
 *  2. EVERY BANNED SPELLING REDS, one case per arm. The arms are not decoration:
 *     the reference sweep of this rule in a sibling repository caught what the
 *     hand sweep missed precisely because a manifest held the named HTML entity
 *     rather than the literal character.
 *  3. EVERY NEAR MISS STAYS GREEN. A boundary that does not hold turns this gate
 *     into one people switch off. The hex and decimal references sit one digit
 *     away from different codepoints entirely, the named entity sits inside an
 *     ordinary English word, and the capital-U escape is a real Windows path.
 *     Each was checked as a control alongside its true positive.
 *  4. THE GATE HOLDS ITS OWN SOURCE. This is the property the sibling gates give
 *     up. They must spell the forms they ban, so they exclude themselves from
 *     the encoded arms, and an em dash appended to one of those scripts scanned
 *     OK. This gate assembles every spelling from the codepoint, contains none
 *     of them as text, and is scanned by the same code path as every other file.
 *     Two cases, and they check different halves: one feeds the gate's own bytes
 *     through `--stdin` and asserts they are clean, which says nothing about set
 *     membership; the other asserts the real tree scan lists the file, which is
 *     the half that would break if an exclusion were ever added.
 *  5. THE CHANGELOG BOUNDARY, BOTH SIDES, ON A REAL SCAN OF A REAL REPOSITORY.
 *     These run the gate over a synthetic git repository built in a temp
 *     directory, because the boundary logic is in `scanTree` and `--stdin` never
 *     reaches it. The dated archive BELOW the boundary must stay out of scope;
 *     the generated half ABOVE it must stay in scope, because a changeset
 *     summary becomes the published release body and a line in the tarball's
 *     changelog; and with the heading gone the WHOLE file is in scope, so the
 *     exemption FAILS CLOSED rather than silently widening. That last case
 *     asserts the report NAMES the occurrence, because asserting exit 1 alone
 *     held even against a gate mutated to exempt the whole file.
 *
 *     THE CASE THAT MATTERS MOST IS THE ABOVE-THE-BOUNDARY ONE, and a refuter is
 *     why it exists. Without it, changing the head slice to the empty string
 *     leaves every other assertion in this file passing: the archive count is
 *     unchanged, the partition is unchanged, the OK banner is byte identical.
 *     The gate would stop scanning the one surface the exemption is scoped
 *     around, and nothing would say so.
 *  6. THE REFUSALS, EACH DRIVEN THROUGH A REAL SCAN. A scan that examined
 *     nothing produces no findings, which is indistinguishable from a clean tree
 *     at the exit code, so every path that could return "nothing" refuses
 *     instead: too few tracked paths, a known-text file missing from the scanned
 *     set, and an archive canary that reports clean. A `.gitattributes`
 *     declaration outside `vendor/` is refused rather than honoured, because an
 *     exclusion reaching source would silence the gate with nothing saying so. A
 *     tracked file the gate cannot open is a failure, never a skip. And a
 *     tracked FILENAME carrying the character reds, which scanning contents
 *     never looks at.
 *
 * SECURITY: every subprocess call uses spawnSync with array args. No exec, no
 * shell-form.
 */

import { describe, it, expect, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO_ROOT = process.cwd();
const GATE = join(REPO_ROOT, "scripts", "check-no-emdash.mjs");

/**
 * U+2014 and its encodings, assembled from the codepoint for the same reason the
 * gate assembles them: a test file that spells them is a tracked file that
 * spells them, and the gate scans this file too. Writing one out here would red
 * the gate on its own test suite.
 */
const CP = 0x2014;
const EM = String.fromCodePoint(CP);
const HEX = CP.toString(16);
const DEC = String(CP);
const PCT = [...Buffer.from(EM, "utf8")].map((b) => `%${b.toString(16).toUpperCase()}`).join("");
const AMP = "&";
const NAMED = `${AMP}mdash`;
const NUM = `${AMP}#`;
const BS = "\\";

interface RunResult {
  code: number;
  out: string;
}

/** Run the gate over a piece of text, exactly as CI does for a PR title or body. */
function scanText(text: string, args: string[] = ["--stdin", "a control"]): RunResult {
  const r = spawnSync(process.execPath, [GATE, ...args], {
    cwd: REPO_ROOT,
    input: text,
    encoding: "utf8",
    timeout: 60_000,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

/** Run the gate over the repository's own tracked files. */
function scanTree(): RunResult {
  const r = spawnSync(process.execPath, [GATE], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("check-no-emdash: the tracked tree", () => {
  it("is clean, and the gate says which surfaces it read", () => {
    const r = scanTree();
    expect(r.out).toContain("OK:");
    expect(r.code).toBe(0);
  });

  it("read every byte of every file it did not declare binary, recomputed independently", () => {
    // THE ASSERTION THAT CLOSES THE SKIP-THE-READ CLASS, AND A REFUTER MEASURED
    // TWICE WHY IT HAS TO LOOK LIKE THIS.
    //
    // Every other check on a real-tree run counts FILES: the probe's partition
    // arithmetic, its declaration reconciliation, and the "2 declared binary" pin
    // above. A path exclusion that pushes what it skips onto the SCANNED list
    // keeps all of them byte identical to an honest run, because the file really
    // is classified and really is counted; it is simply never opened. Measured:
    // `if (rel.startsWith("docs-content/")) { scanned.push(rel); continue; }` with
    // a live em dash planted on a page that publishes to the documentation site
    // printed the same "101 tracked file(s) scanned, 2 declared binary, 103
    // filename(s) checked" banner, exited 0, and left the whole suite green. The
    // extension variant did the same. The one quantity such a mutation cannot
    // fake is the number of BYTES actually read, and the gate already prints it.
    //
    // AND THE EXPECTATION IS RECOMPUTED HERE, FROM GIT AND THE FILESYSTEM, RATHER
    // THAN TAKEN FROM ANYTHING THE GATE SAYS. A probe-internal invariant cannot
    // do this job: any in-script check can be satisfied by the same edit that
    // breaks the property, because both live in the file being mutated. An
    // independent recomputation cannot be, which is the whole point of putting it
    // in the suite instead.
    const tracked = spawnSync("git", ["ls-files", "-z"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(tracked.status).toBe(0);
    const paths = (tracked.stdout ?? "").split("\0").filter((p) => p.length > 0);
    expect(paths.length).toBeGreaterThan(80);

    const attr = spawnSync("git", ["check-attr", "--stdin", "-z", "binary"], {
      cwd: REPO_ROOT,
      input: `${paths.join("\0")}\0`,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(attr.status).toBe(0);
    const fields = (attr.stdout ?? "").split("\0");
    const declared = new Set<string>();
    for (let i = 0; i + 2 < fields.length; i += 3) {
      if (fields[i + 2] === "set") declared.add(fields[i] as string);
    }

    let expectedBytes = 0;
    for (const rel of paths) {
      if (!declared.has(rel)) expectedBytes += statSync(join(REPO_ROOT, rel)).size;
    }
    expect(expectedBytes).toBeGreaterThan(0);

    const r = scanTree();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain(`(${String(expectedBytes)} bytes)`);
  });

  it("reports the CHANGELOG boundary and its out-of-scope archive on a green run", () => {
    // A green run that does not say what it skipped implies a whole-tree scan it
    // did not perform. The exemption is on screen rather than silent.
    const r = scanTree();
    expect(r.out).toContain("Released before this file was generated");
    expect(r.out).toMatch(/occurrence\(s\) in the dated archive below it are out of scope/);
  });

  it("holds its own source to its own rule", () => {
    // This half only says the file is CLEAN. It reads the gate's bytes through
    // stdin, which never enumerates the tree, so on its own it proves nothing
    // about whether the tree scan would have opened the file. The case below is
    // the half that does.
    const source = readFileSync(GATE, "utf8");
    const r = scanText(source);
    expect(r.code, r.out).toBe(0);
  });

  it("really does have its own source in the scanned set, not merely claim so", () => {
    // The exclusion the sibling gates could not close. If one were ever added,
    // the gate would still print OK and the case above would still pass, so the
    // membership is asserted against the real tree scan. `probe()` refuses when
    // this path is missing from the scanned set, so a green tree scan is the
    // assertion; the count in the banner shows the scan was not empty.
    const r = scanTree();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/OK: \d+ tracked file\(s\) scanned/);
    // AND THE SKIP COUNT IS PINNED, NOT MERELY SHAPED. This repository declares
    // exactly two paths binary, both vendored tarballs. A path exclusion added to
    // the gate's skip condition raises this number, and a refuter showed that a
    // shape-only assertion here leaves such an exclusion completely green.
    expect(r.out).toContain("2 declared binary");
    // And a red run names the file when it is dirty, which is what makes the
    // membership observable rather than inferred.
    const dirty = scanText(`x${EM}y`);
    expect(dirty.code).toBe(1);
  });
});

describe("check-no-emdash: every banned spelling reds", () => {
  const cases: [string, string][] = [
    ["the literal character", `a${EM}b`],
    ["the percent-encoding, upper case", `a${PCT}b`],
    ["the percent-encoding, lower case", `a${PCT.toLowerCase()}b`],
    ["the named entity", `a${NAMED};b`],
    ["the named entity without its semicolon", `a${NAMED} b`],
    ["the decimal character reference", `a${NUM}${DEC};b`],
    ["the decimal reference with leading zeros", `a${NUM}0${DEC};b`],
    ["the decimal reference without its semicolon", `a${NUM}${DEC} b`],
    ["the hex character reference", `a${NUM}x${HEX};b`],
    ["the hex reference in upper case", `a${NUM}X${HEX.toUpperCase()};b`],
    ["the hex reference with leading zeros", `a${NUM}x0${HEX};b`],
    ["the JavaScript escape", `a${BS}u${HEX}b`],
    ["the braced JavaScript escape", `a${BS}u{${HEX}}b`],
  ];

  for (const [label, specimen] of cases) {
    it(`reds on ${label}`, () => {
      const r = scanText(specimen);
      expect(r.code, r.out).toBe(1);
      expect(r.out).toContain("FAIL");
    });
  }

  it("names the surface it found the hit in, so a red is actionable", () => {
    const r = scanText(`a${EM}b`, ["--stdin", "the PR title, body, or commit messages"]);
    expect(r.out).toContain("the PR title, body, or commit messages");
  });
});

describe("check-no-emdash: every near miss stays green", () => {
  const cases: [string, string][] = [
    ["a hyphen", "a-b"],
    ["an en dash, which the rule does not reach", `a${String.fromCodePoint(0x2013)}b`],
    ["the named entity inside a longer word", `${NAMED}board`],
    ["a decimal reference one digit longer", `${NUM}${DEC}0;`],
    ["a hex reference one digit longer", `${NUM}x${HEX}5;`],
    ["a Windows path holding a capital-U directory", `C:${BS}Users${BS}U${HEX}${BS}x`],
    ["a PCRE scanner naming the codepoint in its own source", `grep -P '${BS}x{${HEX}}'`],
  ];

  for (const [label, specimen] of cases) {
    it(`stays green on ${label}`, () => {
      const r = scanText(specimen);
      expect(r.code, r.out).toBe(0);
    });
  }
});

describe("check-no-emdash: it refuses rather than reporting a clean scan it did not do", () => {
  it("refuses an argument it does not understand instead of scanning nothing", () => {
    // A gate handed an argument it ignores would scan the tree, print OK, and
    // leave the caller believing something else was checked.
    const r = scanText("", ["--every-file"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("unknown argument");
  });

  it("proves it can see before it reports, even in stdin mode", () => {
    // stdin mode reads no repository file, so nothing else in that run would
    // show the scanner is not blind. The synthetic canary runs there too; this
    // asserts the mode is exercised at all rather than short-circuiting.
    const r = scanText("nothing interesting here");
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("bytes read");
  });
});

// ---------------------------------------------------------------------------
// A SYNTHETIC REPOSITORY, because the boundary logic and every refusal live in
// `scanTree`, and `--stdin` never reaches them.
// ---------------------------------------------------------------------------
//
// The gate resolves its root from its OWN location (`import.meta.dirname/..`),
// not from the working directory, so pointing it at a fixture means copying the
// script into that fixture's `scripts/`. That is deliberate in the gate: a root
// taken from the cwd would scan a subtree and report OK having skipped the rest.
//
// `probe()` sets the floor these fixtures have to clear: at least 80 tracked
// paths, `README.md` / `package.json` / `src/index.ts` / `scripts/check-no-emdash.mjs`
// all present in the scanned set, and a `CHANGELOG.md` archive that still holds
// occurrences (the on-disk canary). A fixture that does not clear the floor gets
// a REFUSED rather than a verdict, which is itself asserted below.

const BOUNDARY = "## Released before this file was generated";

interface RepoOptions {
  /** Occurrences above the archive boundary. The generated half, in scope. */
  aboveBoundary?: boolean;
  /** Occurrences below the archive boundary. The dated archive, out of scope. */
  belowBoundary?: boolean;
  /** Write the boundary heading at all. Omitting it must fail closed. */
  boundary?: boolean;
  /** How many filler files to track. `probe()` refuses below 80 paths. */
  filler?: number;
  /** A `.gitattributes` body, e.g. a `binary` declaration to be refused. */
  gitattributes?: string;
}

function git(root: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", timeout: 60_000 });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function makeRepo(opts: RepoOptions = {}): string {
  const {
    aboveBoundary = false,
    belowBoundary = true,
    boundary = true,
    filler = 90,
    gitattributes,
  } = opts;

  const root = mkdtempSync(join(tmpdir(), "no-emdash-gate-"));
  mkdirSync(join(root, "scripts"), { recursive: true });
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(join(root, "filler"), { recursive: true });
  mkdirSync(join(root, "vendor"), { recursive: true });

  copyFileSync(GATE, join(root, "scripts", "check-no-emdash.mjs"));
  writeFileSync(join(root, "README.md"), "# fixture\n");
  writeFileSync(join(root, "package.json"), '{ "name": "fixture" }\n');
  writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
  if (gitattributes !== undefined) writeFileSync(join(root, ".gitattributes"), gitattributes);

  const parts = ["# Changelog", "", "## 0.0.2", "", aboveBoundary ? `a${EM}b` : "a plain line", ""];
  if (boundary)
    parts.push(BOUNDARY, "", belowBoundary ? `an archived ${EM} entry` : "archived", "");
  writeFileSync(join(root, "CHANGELOG.md"), parts.join("\n"));

  for (let i = 0; i < filler; i++) {
    writeFileSync(join(root, "filler", `f${String(i)}.md`), "clean\n");
  }

  git(root, ["init", "-q"]);
  git(root, ["add", "-A"]);
  return root;
}

function runGateIn(root: string): RunResult {
  const r = spawnSync(process.execPath, [join(root, "scripts", "check-no-emdash.mjs")], {
    cwd: root,
    encoding: "utf8",
    timeout: 120_000,
  });
  return { code: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("check-no-emdash: the CHANGELOG boundary, both sides", () => {
  const roots: string[] = [];
  const build = (o: RepoOptions = {}): string => {
    const root = makeRepo(o);
    roots.push(root);
    return root;
  };
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("leaves the dated archive BELOW the boundary out of scope", () => {
    const r = runGateIn(build({ belowBoundary: true }));
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("out of scope");
  });

  it("keeps the generated half ABOVE the boundary in scope", () => {
    // THE CASE THAT PINS THE EXEMPTION'S SHAPE. A changeset summary becomes the
    // published release body and a line in the tarball's changelog, so an
    // occurrence here is a public-surface instance. Narrowing the head slice to
    // nothing would leave every other assertion in this file green.
    const r = runGateIn(build({ aboveBoundary: true }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("CHANGELOG.md");
  });

  it("fails closed with the boundary heading gone: the WHOLE file is in scope", () => {
    // The alternative is an exemption that silently grows to cover the half it
    // was never meant to reach.
    //
    // A REFUTER PASS IS WHY THIS ASSERTS A HIT AND NOT JUST EXIT 1. The first
    // draft asserted only the code and the phrase "in scope", and both held even
    // against a gate mutated to exempt the whole file when the heading is
    // missing: with no heading there is no archive, so the canary refused first
    // and printed the same words for a different reason. The gate now enforces
    // the canary only when an archive exists, so this branch reds on the
    // occurrence it actually found and the report names it.
    const r = runGateIn(build({ boundary: false, belowBoundary: false, aboveBoundary: true }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("in scope");
    expect(r.out).toContain("FAIL");
    expect(r.out).toContain("CHANGELOG.md");
    expect(r.out).not.toContain("REFUSED");
  });

  it("refuses when the archive canary reports clean, rather than calling it good news", () => {
    // The archive is known to hold occurrences. A scan that reports it clean has
    // gone blind, and a blind scanner's clean result on every other file is
    // worthless.
    const r = runGateIn(build({ belowBoundary: false }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain("archive below its boundary reported zero occurrences");
  });
});

describe("check-no-emdash: the refusals, driven through a real scan", () => {
  const roots: string[] = [];
  const build = (o: RepoOptions = {}): string => {
    const root = makeRepo(o);
    roots.push(root);
    return root;
  };
  afterAll(() => {
    for (const r of roots) rmSync(r, { recursive: true, force: true });
  });

  it("refuses a tree too small to be this repository", () => {
    // A filtered enumeration (a wrong root, a tool honouring .gitignore) returns
    // a short list, and a short list finds nothing. That must not read as clean.
    const r = runGateIn(build({ filler: 2 }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toMatch(/only \d+ path/);
  });

  it("refuses a known-text file missing from the scanned set", () => {
    const root = build();
    // `probe()` names four paths that are tracked and are text. Drop one from
    // the index and the refusal fires, which is what a tool honouring
    // `.gitignore` or a misfiring binary heuristic would look like from here.
    rmSync(join(root, "src", "index.ts"));
    git(root, ["add", "-A"]);
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain("src/index.ts is not in the scanned set");
  });

  it("refuses a binary declaration that reaches outside vendor/", () => {
    // A declaration is only as good as its scope. `*.ts binary` in a dotfile
    // would silence this gate over the whole source tree with nothing saying so,
    // so the exclusion is refused rather than honoured.
    const r = runGateIn(build({ gitattributes: "src/index.ts binary\n" }));
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("OUTSIDE vendor/");
  });

  it("honours a binary declaration inside vendor/, exempting its CONTENT", () => {
    // The blob carries the character's UTF-8 bytes, which is the coincidence a
    // DEFLATE stream really can produce and which no edit can remove.
    const root = build({ gitattributes: "vendor/*.bin binary\n" });
    writeFileSync(join(root, "vendor", "blob.bin"), Buffer.from([0x00, 0xe2, 0x80, 0x94, 0x00]));
    git(root, ["add", "-A"]);
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(0);
    expect(r.out).toMatch(/1 declared binary/);
  });

  it("still scans the NAME of a declared-binary path, which its content exemption does not cover", () => {
    // A declaration about a file's BYTES says nothing about its NAME, and the
    // gate claims this arm covers every tracked path, declared binaries
    // included. Without this case nothing distinguishes the arm running over a
    // declared-binary path from it being skipped with the content.
    const root = build({ gitattributes: "vendor/*.bin binary\n" });
    writeFileSync(join(root, "vendor", `blob${EM}x.bin`), Buffer.from([0x00, 0x01, 0x02]));
    git(root, ["add", "-A"]);
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("FILENAME");
  });

  it("refuses a path exclusion that ACCOUNTS for what it skipped", () => {
    // THE CASE A REFUTER BOUGHT, AND THE ONE A COUNT CHECK CANNOT MAKE. Skipping
    // a path and pushing it onto the declared-binary list keeps
    // `scanned + binary === tracked` true, and the outside-`vendor/` refusal
    // reads `.gitattributes` rather than the skip list, so neither sees it. On
    // the gate before this case existed, one added `||` clause hid a whole
    // directory, printed a clean banner and left every other test here green.
    // `probe()` check 5b now reconciles the two sets path for path.
    const root = build();
    const gate = join(root, "scripts", "check-no-emdash.mjs");
    const before = readFileSync(gate, "utf8");
    const skip = "if (binarySet.has(rel)) {";
    expect(before).toContain(skip);
    writeFileSync(
      gate,
      before.replace(skip, `if (binarySet.has(rel) || rel.startsWith("filler/")) {`),
      "utf8",
    );
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("REFUSED");
    expect(r.out).toContain("without a 'binary' declaration");
  });

  it("is green on the same fixture unmutated, so the case above pins the mutation", () => {
    // The near miss for the case above. Without it, a gate that refused every
    // fixture would pass that test for the wrong reason.
    const r = runGateIn(build());
    expect(r.code, r.out).toBe(0);
  });

  it("treats a tracked file it cannot open as a failure, never a skip", () => {
    const root = build();
    // Tracked in the index, absent from the working tree: the read throws, and
    // fail-closed means that is a red rather than one fewer file scanned.
    unlinkSync(join(root, "filler", "f0.md"));
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("could not read");
  });

  it("reds on a tracked FILENAME carrying the character, which no content scan sees", () => {
    const root = build();
    writeFileSync(join(root, "filler", `name${EM}here.md`), "clean\n");
    git(root, ["add", "-A"]);
    const r = runGateIn(root);
    expect(r.code, r.out).toBe(1);
    expect(r.out).toContain("FILENAME");
  });
});

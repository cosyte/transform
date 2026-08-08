/**
 * Unit tests for scripts/phi-scan.ts: the PHI commit-gate.
 *
 * These exercise the SHARED MACHINERY, the cross-cutting SSN/email FLOOR, the
 * HL7 v2 STRUCTURED PASS, and the reconciliation that proves the walk opened
 * what git carries.
 *
 * The scanner is invoked via spawnSync (array args, no shell) so the full CLI
 * path (argv parse, exit code, stderr) is exercised. Violator/clean files are
 * written to a throwaway temp dir so they never pollute the committed corpus.
 *
 * SECURITY: every subprocess call here uses spawnSync with array args. No exec,
 * no shell-form.
 *
 * ===========================================================================
 * ▶ EVERY VIOLATOR VALUE IN THIS FILE IS ASSEMBLED FROM PARTS AT RUNTIME, AND
 *   THAT IS LOAD-BEARING RATHER THAN STYLE.
 *
 *   This file is inside the scan's own corpus: `test/` is a walk root, so
 *   `pnpm phi-scan` reads these bytes on every run. A live dashed-SSN shape, or
 *   a live name inside a `PID|` literal here, would red the repository's own
 *   gate permanently, and both ways out of that are worse than assembling the
 *   value (the shape is named rather than written, for the same reason):
 *
 *     - allow-listing the literal blinds the floor GLOBALLY and ROUTE-BLIND,
 *       including the `--staged` pre-commit hook, for every corpus at once;
 *     - exempting this file by path leaves the largest violator-bearing file in
 *       the tree unscanned.
 *
 *   Assembling keeps the RUNTIME value byte-identical, so every assertion below
 *   is exactly as strong as it was when these were literals. What changes is
 *   only what this file's own bytes spell.
 *
 * ▶ THE RESIDUAL, STATED: nothing gates the convention itself. An editor who
 *   writes a live literal back into this file will red `pnpm phi-scan`, which
 *   is the correct direction and is the only enforcement there is.
 * ===========================================================================
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawnSync } from "node:child_process";
import {
  writeFileSync,
  mkdtempSync,
  mkdirSync,
  rmSync,
  copyFileSync,
  symlinkSync,
  realpathSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const REPO_ROOT = process.cwd();
const SCANNER_PATH = join(REPO_ROOT, "scripts", "phi-scan.ts");
const TSX_BIN = join(REPO_ROOT, "node_modules", ".bin", "tsx");

// ---------------------------------------------------------------------------
// The assembled violator values. See the banner at the top of this file.
// ---------------------------------------------------------------------------

/** A dashed SSN shape. Never written as one literal in this file. */
const SSN = ["123", "45", "6789"].join("-");
/** An email at a domain no allow-list entry covers. */
const REAL_EMAIL = ["jane.doe", "hospital.org"].join("@");
/** A second one, at a different uncovered domain, used inside the payload. */
const PAYLOAD_EMAIL = ["juanita.rivera", "example-hospital.org"].join("@");
/** Person-name tokens that are NOT in scripts/phi-allow-list.txt. */
const PAYLOAD_FAMILY = ["RIVE", "RA"].join("");
const PAYLOAD_GIVEN = ["JUAN", "ITA"].join("");
/** A date of birth in ISO shape, and the v2 TS shape of the same day. */
const PAYLOAD_DOB_ISO = ["1978", "03", "14"].join("-");
const PAYLOAD_DOB_V2 = ["1978", "03", "14"].join("");
/** An MRN-shaped id no allow-list entry covers. */
const PAYLOAD_MRN = ["MRN", "77321"].join("");

let dir: string;

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runScanner(args: string[]): RunResult {
  const r = spawnSync(TSX_BIN, [SCANNER_PATH, ...args], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    shell: false,
  });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Write a file to the temp dir and scan it by path (paths mode, no git needed). */
function scan(name: string, content: string): RunResult {
  const path = join(dir, name);
  writeFileSync(path, content);
  return runScanner([path]);
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "phi-scan-"));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("phi-scan starter: the cross-cutting floor catches SSN + email", () => {
  it("catches a dashed SSN (exit 1)", () => {
    const r = scan("ssn.txt", `patient ssn ${SSN} on file\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(SSN);
    expect(r.stderr).toMatch(/dashed SSN/);
  });

  it("catches an email at a non-test domain (exit 1)", () => {
    const r = scan("email.txt", `contact ${REAL_EMAIL} for records\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(REAL_EMAIL);
    expect(r.stderr).toMatch(/non-test domain/);
  });
});

describe("phi-scan starter: clean + allow-listed content passes", () => {
  it("a clean file with no PHI shapes exits 0", () => {
    const r = scan("clean.txt", "just some ordinary text, no identifiers here\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK: no hits/);
  });

  it("honors the allow-list: an email at a reserved test domain passes (exit 0)", () => {
    const r = scan("allowed-email.txt", "reach the team at hello@example.com anytime\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan starter: the override-log gate", () => {
  it("rejects --allow-fixture without a matching override entry (exit 2)", () => {
    const clean = join(dir, "override-me.txt");
    writeFileSync(clean, "nothing to see\n");
    const r = runScanner(["--allow-fixture", clean]);
    expect(r.code).toBe(2);
    expect(r.stderr).toMatch(/phi-scan-overrides\.md/);
  });
});

// ---------------------------------------------------------------------------
// Entries that are not regular files, on BOTH enumerating routes
// ---------------------------------------------------------------------------
//
// The walk enumerates `Dirent.isFile()`, an lstat answer, so a symbolic link is
// neither a file nor a directory; `--staged` reads content with
// `git show :<path>`, and git stores a link as its TARGET PATH under mode
// 120000. Measured on this package's own scanner before the fix, a link under
// `src/` pointing at the payload below printed "OK: no hits" and exited 0 on
// BOTH routes, and so did a tracked file replaced by such a link. These cases
// pin the refusal on each route, the negative controls that keep ordinary files
// scanned on each route, and the rule that a refusal never echoes what is on
// the other side of the link.
//
// Every case runs against a THROWAWAY GIT REPOSITORY, never against this one:
// the scanner roots everything at `process.cwd()`, so a synthetic tree is enough
// and no link or violator is ever written into the committed corpus. The
// throwaway trees live under `os.tmpdir()`, outside every scan root of this
// repo, so the suite seeds nothing a later sweep of this repo could enumerate.

/**
 * Synthetic, name-bearing payload. A payload with no name proves nothing about
 * a claim that names do not leak, so this one carries a person name, a DOB, an
 * SSN shape and an email. Every value is invented.
 */
const SYNTHETIC_PHI =
  [
    `Patient: ${PAYLOAD_FAMILY}^${PAYLOAD_GIVEN}^Q`,
    `DOB: ${PAYLOAD_DOB_ISO}`,
    `SSN: ${SSN}`,
    `Contact: ${PAYLOAD_EMAIL}`,
  ].join("\n") + "\n";

/** The link target's own name carries a synthetic name, so an echo of it is visible. */
const TARGET_NAME = `${PAYLOAD_FAMILY}-${PAYLOAD_GIVEN}-${PAYLOAD_DOB_ISO}.txt`;

/** Tokens that must never appear in a refusal message. */
const PHI_TOKENS = [
  PAYLOAD_FAMILY,
  PAYLOAD_GIVEN,
  PAYLOAD_DOB_ISO,
  SSN,
  PAYLOAD_EMAIL,
  TARGET_NAME,
];

function expectNoPhi(stderr: string): void {
  for (const t of PHI_TOKENS) expect(stderr).not.toContain(t);
}

function git(cwd: string, args: string[]): void {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  if ((r.status ?? -1) !== 0) throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
}

function gitOut(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
  return r.stdout ?? "";
}

function runIn(cwd: string, args: string[]): RunResult {
  const r = spawnSync(TSX_BIN, [SCANNER_PATH, ...args], { cwd, encoding: "utf8", shell: false });
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

const repos: string[] = [];

/**
 * A throwaway git repo laid out the way the scanner expects: an allow-list under
 * `scripts/`, a `src/` walk root, and one ordinary source file so the walk has
 * something legitimate to find. `test/fixtures/` is created too: it is the
 * scanner's other root and does not exist in this repo, so a synthetic tree is
 * the only place its behaviour can be exercised at all.
 */
function makeRepo(): string {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "phi-scan-repo-")));
  repos.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "src"));
  mkdirSync(join(root, "test", "fixtures"), { recursive: true });
  copyFileSync(
    join(REPO_ROOT, "scripts", "phi-allow-list.txt"),
    join(root, "scripts", "phi-allow-list.txt"),
  );
  writeFileSync(join(root, "src", "ordinary.ts"), "export const answer = 42;\n");
  git(root, ["init", "-q", "."]);
  return root;
}

afterAll(() => {
  for (const r of repos) rmSync(r, { recursive: true, force: true });
});

describe("phi-scan: the synthetic payload is genuinely detectable", () => {
  // Guards against proving nothing by fixture: every refusal case below rests on
  // this payload being something the floor would otherwise catch.
  it("as a plain regular file it is a hit on the floor (exit 1)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(SSN);
    expect(r.stderr).toContain(PAYLOAD_EMAIL);
  });

  it("a repo with no link and no violator scans clean (exit 0)", () => {
    const root = makeRepo();
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK: no hits/);
  });
});

describe("phi-scan: the all-mode walk refuses a non-regular entry", () => {
  it("refuses a symlink under a walk root pointing at PHI (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
    expect(r.stdout).not.toMatch(/OK/);
  });

  it("refuses a symlink under the other walk root too", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", "..", TARGET_NAME), join(root, "test", "fixtures", "leak.hl7"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/fixtures/leak.hl7");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a symlinked DIRECTORY too, which isDirectory() also answers false for", () => {
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", "elsewhere"), join(root, "src", "linked-dir"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/linked-dir");
    expectNoPhi(r.stderr);
  });

  it("names EVERY offender, not just the first", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "one.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "two.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/one.ts");
    expect(r.stderr).toContain("src/two.ts");
    expect(r.stderr).toContain("2 entries");
    expectNoPhi(r.stderr);
  });

  it("a link at a .md path is refused, and a REGULAR .md is now READ rather than skipped", () => {
    // The walk used to skip a regular `*.md` before reading a byte of it, on the
    // argument that documentation may legitimately describe violator values.
    // That exemption is GONE, and this case pins both halves of its removal:
    // a link ending in `.md` is still refused (its NAME is no evidence about
    // what is on the other side), and a REGULAR `.md` full of the payload is now
    // a hit rather than a silent pass. Red before the change on the second half:
    // the same file exited 0.
    const linked = makeRepo();
    writeFileSync(join(linked, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(linked, "src", "notes.md"));

    const r = runIn(linked, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/notes.md");
    expectNoPhi(r.stderr);

    const regular = makeRepo();
    writeFileSync(join(regular, "src", "notes.md"), SYNTHETIC_PHI);
    const rr = runIn(regular, []);
    expect(rr.code, `stderr: ${rr.stderr}`).toBe(1);
    expect(rr.stderr).toContain("src/notes.md");
    expect(rr.stderr).toContain(SSN);
  });

  it("has no extension scope of its own: a link at a non-.ts path is refused too", () => {
    // `src/**.ts` was the `--staged` route's boundary, never the walk's. The
    // walk takes every regular file under a root, whatever it is named.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.json"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.json");
    expectNoPhi(r.stderr);
  });

  it("an ignored link is out of scope, by the same rule that already excludes an ignored file", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    // The payload itself is ignored too, and that line is not decoration: the
    // walk now enumerates repo-ROOT regular files, so the payload sitting beside
    // the link is in scope on its own merits and would report a hit of its own.
    // Ignoring both is what leaves this case testing the link and nothing else.
    writeFileSync(join(root, ".gitignore"), `src/leak.ts\n/${TARGET_NAME}\n`);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("but an entry already in the index cannot be excused that way", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");
    git(root, ["add", "-f", "src/leak.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
  });
});

// NOTE: these cases cover the FINAL path component only. A named path whose
// ANCESTOR is a symlink, and a plain absolute or `../` argument, ARE still
// followed: pre-existing, disclosed in the docblock and CHANGELOG.md, and
// deliberately not closed. Do not retitle this block "follows nothing".
describe("phi-scan: the named-path route refuses a non-regular path it is handed", () => {
  // This route was NOT blind: it classified with `statSync`, which dereferences,
  // so it read the target's bytes and reported the hits it found there. It never
  // reported a false clean; it made "the scan follows nothing" untrue, and it
  // could read bytes from outside the repository entirely.
  it("refuses a named link instead of reading through it (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "named.ts"));

    const r = runIn(root, ["src/named.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/named.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a named link whose target is OUTSIDE the repository", () => {
    // The hazard the other two routes exist to avoid. Naming a path is not
    // permission to leave the tree.
    const root = makeRepo();
    const outside = realpathSync(mkdtempSync(join(tmpdir(), "phi-scan-outside-")));
    repos.push(outside);
    writeFileSync(join(outside, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join(outside, TARGET_NAME), join(root, "src", "escape.ts"));

    const r = runIn(root, ["src/escape.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("reports a DANGLING link as the link it is, not as a missing file", () => {
    // `existsSync` follows, so it reads false on a dangling link. lstat first.
    const root = makeRepo();
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "dangling.ts"));

    const r = runIn(root, ["src/dangling.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("a symbolic link");
    expect(r.stderr).not.toContain("File not found");
  });

  it("still scans an ordinary named file, and still reports a genuinely missing one", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    const hit = runIn(root, ["src/violator.ts"]);
    expect(hit.code, `stderr: ${hit.stderr}`).toBe(1);
    expect(hit.stderr).toContain(SSN);

    const missing = runIn(root, ["src/nope.ts"]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("File not found");
  });
});

describe("phi-scan: the --staged route refuses a staged non-regular entry", () => {
  it("git really does store the link as its target path, not the target's bytes", () => {
    // The measurement the refusal rests on. If git ever changed this, the
    // refusal below would be arguing from a premise that no longer holds.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    expect(gitOut(root, ["ls-files", "--stage", "src/leak.ts"])).toMatch(/^120000 /);
    const shown = gitOut(root, ["show", ":src/leak.ts"]);
    expect(shown.trim()).toBe(`../${TARGET_NAME}`);
    expect(shown).not.toContain(SSN);
  });

  it("refuses a staged symlink (exit 2), and reports no PHI", () => {
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "leak.ts"));
    git(root, ["add", "src/leak.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("refuses a TYPECHANGE: a tracked regular file replaced by a link (exit 2)", () => {
    // The shape `--diff-filter=AM` used to delete before any mode could be read.
    // Replacing a TRACKED file with a link is neither an add nor a modify: git
    // raises `:100644 120000 <sha> <sha> T`, and without `T` in the filter the
    // record never existed, so the pre-commit hook passed the link green.
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);

    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    rmSync(join(root, "src", "ordinary.ts"));
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "ordinary.ts"));
    git(root, ["add", "src/ordinary.ts"]);

    // The premise: git really does raise this as a typechange, not A or M.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AM"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toContain(" 120000 ");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/ordinary.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("scans the other direction of a typechange: a link replaced by a real file (exit 1)", () => {
    const root = makeRepo();
    symlinkSync("ordinary.ts", join(root, "src", "link.ts"));
    git(root, ["add", "src/link.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);

    rmSync(join(root, "src", "link.ts"));
    writeFileSync(join(root, "src", "link.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/link.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(SSN);
  });

  it("refuses a staged gitlink under a scanned prefix (exit 2)", () => {
    const root = makeRepo();
    const nested = join(root, "test", "fixtures", "nested");
    mkdirSync(nested);
    git(nested, ["init", "-q", "."]);
    writeFileSync(join(nested, "payload.txt"), SYNTHETIC_PHI);
    git(nested, ["add", "payload.txt"]);
    git(nested, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "n"]);
    git(root, ["add", "test/fixtures/nested"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test/fixtures/nested");
    expect(r.stderr).toContain("a gitlink");
    expectNoPhi(r.stderr);
  });

  it("still catches a staged ORDINARY file carrying the same payload (exit 1)", () => {
    // The regression control on the `--raw -z` reparse: reading the mode must not
    // cost the route the ordinary files it was already enumerating.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/violator.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
    expect(r.stderr).toContain(SSN);
  });

  it("reads every record of a multi-file stage, not just the first", () => {
    // The two-field stride is the part of the reparse that could silently
    // shorten the list. A violator staged BEHIND several clean files pins it.
    const root = makeRepo();
    for (const n of ["a", "b", "c"]) {
      writeFileSync(join(root, "src", `${n}.ts`), `export const ${n} = 1;\n`);
    }
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
  });

  it("passes a staged ordinary clean file (exit 0)", () => {
    const root = makeRepo();
    git(root, ["add", "src/ordinary.ts"]);
    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK: no hits/);
  });

  it("refuses an UNMERGED path instead of reporting clean over it (exit 2)", () => {
    // A conflicted path has no stage-0 entry, so `git show :<path>` answers
    // `fatal: path ... is in the index, but not at stage 0` and never content.
    // Its status is `U`, which is returned by neither `AM` nor `AMT`, so the
    // record did not exist and the route reported a clean scan over a path whose
    // conflicted side carries PHI. The status is the uniform part: the source
    // mode and the set of stages present both vary by conflict flavour, which is
    // why the scanner keys the refusal on the status rather than the mode.
    const root = makeRepo();
    writeFileSync(join(root, "src", "conflict.ts"), "export const a = 1;\n");
    git(root, ["add", "src/conflict.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
    git(root, ["checkout", "-q", "-b", "other"]);
    writeFileSync(join(root, "src", "conflict.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/conflict.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "other"]);
    git(root, ["checkout", "-q", "-"]);
    writeFileSync(join(root, "src", "conflict.ts"), "export const a = 3;\n");
    git(root, ["add", "src/conflict.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "second"]);
    // Conflicts, deliberately: `git merge` exits non-zero here, so it is run
    // through the tolerant helper rather than the throwing one. The identity is
    // passed INLINE and that is not decoration: a merge refuses outright with
    // "Committer identity unknown" when it can neither read nor auto-detect one,
    // leaving the index untouched, and `gitOut` discards the status. A developer
    // box hides that (a global identity, or one auto-detected from the passwd
    // entry and hostname); a CI runner has neither. Measured: this case failed on
    // `ci / verify` for both Node 22 and 24 with `expected '' to contain ' U\t'`,
    // green on the same commit locally, because the merge never ran at all.
    gitOut(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "merge", "other"]);

    // Non-vacuity FIRST: prove the merge really did leave a conflict, since
    // every assertion below is about a state that a silently-failed merge would
    // not have produced. `gitOut` discards git's exit status, so the state is
    // what gets checked, never the command's success.
    expect(gitOut(root, ["ls-files", "-u"])).toContain("src/conflict.ts");
    // The premise: an unmerged record really is dropped by the old filter.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMT"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toContain(" U\t");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/conflict.ts");
    expect(r.stderr).toContain("an unmerged path");
    expectNoPhi(r.stderr);
  });

  it("a staged link OUTSIDE the route's scope is still left alone (the scope is bounded)", () => {
    // The scope widened, so it needs a path that is genuinely outside it. `lib/`
    // is not a declared root, and a case that could not distinguish "in scope"
    // from "out of scope" would be evidence for neither.
    const root = makeRepo();
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "lib", "docs-link.txt"));
    git(root, ["add", "lib/docs-link.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// The widened scope: the tracked corpus, reconciled against `git ls-files`
// ---------------------------------------------------------------------------
//
// Measured on this repository at `daf75c3`, both enumerating routes covered
// `test/fixtures/` + `src/**.ts`, which was 31 of 102 tracked files: 71 read by
// NEITHER route, 27 of them under `test/`, 8 of those carrying inline `PID|`
// literals. And `test/fixtures/` HAS NEVER EXISTED on any commit here, so the
// walk's `existsSync` guard returned on its first line for that root on every
// run this scanner has ever made, while the run reported clean.

describe("phi-scan: the walk covers the tracked corpus, in addition to what it covered", () => {
  it("SUPERSET CONTROL: everything the old scope opened is still opened", () => {
    // The widening must only ever ADD. `test` contains `test/fixtures`, and
    // `src` dropped its `.ts` restriction, so both previous scopes are strictly
    // inside the new one. A violator at each old location still reports.
    const root = makeRepo();
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI);
    writeFileSync(join(root, "test", "fixtures", "violator.hl7"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
    expect(r.stderr).toContain("test/fixtures/violator.hl7");
  });

  it("reads a tracked file under test/ that is NOT under test/fixtures/ (the class)", () => {
    // The population this whole change exists for: 27 tracked files here sat in
    // exactly this position and were read by neither route. Red before: this
    // file exited 0.
    const root = makeRepo();
    mkdirSync(join(root, "test", "messages"), { recursive: true });
    writeFileSync(join(root, "test", "messages", "case.test.ts"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/messages/case.test.ts");
  });

  it("reads a repo-ROOT regular file, which has no directory to declare as a root", () => {
    const root = makeRepo();
    writeFileSync(join(root, "NOTES.txt"), SYNTHETIC_PHI);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("NOTES.txt");
  });

  it("REFUSES when a tracked file was never opened by the walk (exit 2, named)", () => {
    // Existence is not observation, and a count cannot substitute: a count
    // counts the roots that DID exist. This reconciles the OPENED set against
    // `git ls-files`, so a tracked path outside every root is named rather than
    // quietly absent from a clean report.
    const root = makeRepo();
    mkdirSync(join(root, "lib"));
    writeFileSync(join(root, "lib", "stray.ts"), "export const a = 1;\n");
    git(root, ["add", "lib/stray.ts"]);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("lib/stray.ts");
    expect(r.stderr).toContain("never opened");
    expect(r.stdout).not.toMatch(/OK/);
  });

  it("REFUSES an EMPTIED root, which existence checks and counts both miss", () => {
    // The half a missing-root check does not cover. The directory is still
    // there and still walkable; its tracked contents are simply gone from disk,
    // so the walk opens nothing and every count looks healthy.
    const root = makeRepo();
    writeFileSync(join(root, "src", "kept.ts"), "export const a = 1;\n");
    git(root, ["add", "src/kept.ts"]);
    rmSync(join(root, "src", "kept.ts"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/kept.ts");
  });

  it("the reconciliation is VACUOUS on an empty index, and says nothing either way", () => {
    // Stated rather than implied: with nothing tracked there is nothing to
    // reconcile against, so a clean run here rests entirely on the walk's own
    // refusals. Every throwaway repo above is in this state.
    const root = makeRepo();
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK: no hits/);
  });

  it("REFUSES a DANGLING walk root instead of reporting clean over it (exit 2)", () => {
    // `existsSync` FOLLOWS, so it answered false here and `walk` returned on its
    // first line with the corpus off the disk. Measured before this change:
    // "OK: no hits", exit 0.
    const root = makeRepo();
    rmSync(join(root, "test"), { recursive: true, force: true });
    symlinkSync(join(root, "nowhere-at-all"), join(root, "test"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test");
    expect(r.stderr).toContain("a symbolic link");
  });

  it("REFUSES a walk root that is a symlink to a real directory (it used to be FOLLOWED)", () => {
    const root = makeRepo();
    mkdirSync(join(root, "elsewhere"));
    writeFileSync(join(root, "elsewhere", "payload.txt"), SYNTHETIC_PHI);
    rmSync(join(root, "test"), { recursive: true, force: true });
    symlinkSync(join(root, "elsewhere"), join(root, "test"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
  });

  it("REFUSES a walk root that is a regular file, and that is exit 2 here", () => {
    // The per-repo exit code, derived from this script's own contract rather
    // than ported: `existsSync` answers true, `readdirSync` throws `ENOTDIR`
    // into `walk`'s catch, and an InvocationError returns 2. The `lstat`
    // preflight now answers first and returns the same 2.
    const root = makeRepo();
    rmSync(join(root, "test"), { recursive: true, force: true });
    writeFileSync(join(root, "test"), "not a directory\n");

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("test");
  });

  it("an ABSENT root is not an error on its own (a tree may legitimately lack one)", () => {
    const root = makeRepo();
    rmSync(join(root, "test"), { recursive: true, force: true });

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });
});

describe("phi-scan: --staged widened by union, and it exempts nothing", () => {
  it("blocks a staged violator under test/ outside test/fixtures/ (a new 0 -> 1)", () => {
    const root = makeRepo();
    mkdirSync(join(root, "test", "messages"), { recursive: true });
    writeFileSync(join(root, "test", "messages", "case.test.ts"), SYNTHETIC_PHI);
    git(root, ["add", "test/messages/case.test.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("test/messages/case.test.ts");
  });

  it("blocks a staged violator at a non-.ts path under src/ (the suffix bound is gone)", () => {
    const root = makeRepo();
    writeFileSync(join(root, "src", "leak.json"), SYNTHETIC_PHI);
    git(root, ["add", "src/leak.json"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/leak.json");
  });

  it("blocks a staged violator at the repository root", () => {
    const root = makeRepo();
    writeFileSync(join(root, "NOTES.txt"), SYNTHETIC_PHI);
    git(root, ["add", "NOTES.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("NOTES.txt");
  });

  it("the all-route exemption list does NOT reach --staged, nor the named-path route", () => {
    // The rule a sibling paid an INTRODUCED major for: an exemption that
    // reaches the commit-blocking route SUBTRACTS a detection the base had.
    // `vendor/` is excused by the reconciliation only. Staging one of those
    // literal paths still blocks, and naming it still scans it.
    const root = makeRepo();
    mkdirSync(join(root, "vendor"));
    const tarball = join(root, "vendor", "cosyte-fhir-0.0.0.tgz");
    writeFileSync(tarball, SYNTHETIC_PHI);

    // `vendor/` is outside the staged route's scope exactly as it was at base,
    // so this is unchanged rather than newly exempt.
    git(root, ["add", "vendor/cosyte-fhir-0.0.0.tgz"]);
    expect(runIn(root, ["--staged"]).code).toBe(0);

    // But the named-path route reads it, and reports what it finds.
    const named = runIn(root, ["vendor/cosyte-fhir-0.0.0.tgz"]);
    expect(named.code, `stderr: ${named.stderr}`).toBe(1);
    expect(named.stderr).toContain(SSN);

    // And the reconciliation excuses it rather than refusing over it.
    const all = runIn(root, []);
    expect(all.code, `stderr: ${all.stderr}`).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// A staged RENAME into a scan root
// ---------------------------------------------------------------------------
//
// `R` (rename) and `C` (copy) are returned by neither `AM` nor `AMT`, so an
// ordinary `git mv` into a scan root staged a two-path record the filter deleted
// outright and `--staged` exited 0 over it. Measured on this repo's scanner
// before the fix, on both shapes below. The gap is at PRE-COMMIT. The hook is
// `phi-scan --staged`; the all-mode sweep CI runs is the backstop, so the
// exposure was "PHI enters a local commit or a pushed branch", not "PHI merges".
//
// The remedy is `--no-renames`, which makes every staged change a single-path
// record: the destination arrives as an ordinary `A` and the source as a `D` the
// filter drops. It needs no two-path record shape and no stride work.

/** Stage a rename of `from` to `to` on top of a commit, in a fresh repo. */
function repoWithRenameInto(from: string, to: string, seed: (root: string) => void): string {
  const root = makeRepo();
  seed(root);
  git(root, ["add", "-A", "."]);
  git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);
  git(root, ["mv", from, to]);
  return root;
}

describe("phi-scan: the --staged route enumerates a staged rename", () => {
  it("git really does stage `git mv <link>` as a two-path R100 record at mode 120000", () => {
    // The measurement the fix rests on, and the premise of every case below: the
    // record the old filter deleted really did carry a mode-120000 destination.
    const root = repoWithRenameInto("notes/leak.txt", "src/leak.ts", (r) => {
      mkdirSync(join(r, "notes"));
      writeFileSync(join(r, TARGET_NAME), SYNTHETIC_PHI);
      symlinkSync(join("..", TARGET_NAME), join(r, "notes", "leak.txt"));
    });

    const raw = gitOut(root, ["diff", "--cached", "--raw"]);
    expect(raw).toMatch(/:120000 120000 [0-9a-f]+ [0-9a-f]+ R100\t/);
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMT"]).trim()).toBe("");
    expect(gitOut(root, ["ls-files", "--stage", "src/leak.ts"])).toMatch(/^120000 /);
    // And `--no-renames` turns exactly that into a single-path add.
    expect(
      gitOut(root, ["diff", "--cached", "--raw", "--no-renames", "--diff-filter=AMT"]),
    ).toMatch(/:000000 120000 [0-9a-f]+ [0-9a-f]+ A\tsrc\/leak\.ts/);
  });

  it("refuses a link renamed INTO a scan root (exit 2), and reports no PHI", () => {
    const root = repoWithRenameInto("notes/leak.txt", "src/leak.ts", (r) => {
      mkdirSync(join(r, "notes"));
      writeFileSync(join(r, TARGET_NAME), SYNTHETIC_PHI);
      symlinkSync(join("..", TARGET_NAME), join(r, "notes", "leak.txt"));
    });

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expect(r.stderr).toContain("a symbolic link");
    expectNoPhi(r.stderr);
    expect(r.stdout).not.toMatch(/OK/);
  });

  it("SCANS an ordinary PHI-bearing file renamed into a scan root (exit 1)", () => {
    // The second shape, and the one that needs no link at all: a rename that
    // substitutes a real name into the corpus passed the same way, because the
    // record was dropped before its content was ever reached.
    const root = repoWithRenameInto("notes/payload.txt", "src/payload.ts", (r) => {
      mkdirSync(join(r, "notes"));
      writeFileSync(join(r, "notes", "payload.txt"), SYNTHETIC_PHI);
    });

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/payload.ts");
    expect(r.stderr).toContain(SSN);
  });

  it("holds whatever the caller's rename/copy detection is configured to", () => {
    // `--no-renames` is passed on the command line, which beats `diff.renames`
    // in config, including `copies`, which turns `C` records on as well. Without
    // that, a repo-local setting would decide whether the gate saw the record.
    const root = repoWithRenameInto("notes/leak.txt", "src/leak.ts", (r) => {
      mkdirSync(join(r, "notes"));
      writeFileSync(join(r, TARGET_NAME), SYNTHETIC_PHI);
      symlinkSync(join("..", TARGET_NAME), join(r, "notes", "leak.txt"));
    });
    git(root, ["config", "diff.renames", "copies"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/leak.ts");
    expectNoPhi(r.stderr);
  });

  it("does not widen the scope: a rename landing OUTSIDE a scan root still passes", () => {
    // The negative control on the claim. `--no-renames` narrows what the route's
    // existing scope ADMITS; it does not give the route new ground. A link
    // renamed to `lib/` is still nothing this gate speaks about, and a case that
    // could not distinguish the two would not be evidence for either.
    const root = repoWithRenameInto("notes/leak.txt", "lib/leak.ts", (r) => {
      mkdirSync(join(r, "notes"));
      mkdirSync(join(r, "lib"));
      writeFileSync(join(r, TARGET_NAME), SYNTHETIC_PHI);
      symlinkSync(join("..", TARGET_NAME), join(r, "notes", "leak.txt"));
    });

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("still enumerates everything it enumerated before (the superset control)", () => {
    // `--no-renames` must only ever ADD records. A stage mixing an add, a modify
    // and a rename pins that the first two are still read, and read completely:
    // the violator sits BEHIND the rename in path order.
    const root = makeRepo();
    writeFileSync(join(root, "src", "tracked.ts"), "export const t = 1;\n");
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "moved.txt"), "nothing identifying here\n");
    git(root, ["add", "-A", "."]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);

    git(root, ["mv", "notes/moved.txt", "src/moved.ts"]); // R
    writeFileSync(join(root, "src", "tracked.ts"), "export const t = 2;\n"); // M
    writeFileSync(join(root, "src", "violator.ts"), SYNTHETIC_PHI); // A
    git(root, ["add", "-A", "."]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("src/violator.ts");
    expect(r.stderr).toContain(SSN);
  });
});

// ---------------------------------------------------------------------------
// "Could not complete" is exit 2, never exit 1
// ---------------------------------------------------------------------------
//
// 1 is this scanner's code for HITS FOUND, and an uncaught throw exits 1 too, so
// a scan that never ran was indistinguishable from a scan that ran and fired,
// on the wrong side, since a caller keying on the code reads a broken gate as a
// working one.

describe("phi-scan: a scan that cannot run exits 2, not 1", () => {
  it("a missing allow-list exits 2 (it threw out of main and exited 1)", () => {
    // `loadAllowList()` runs outside every `try` in `main`.
    const root = makeRepo();
    rmSync(join(root, "scripts", "phi-allow-list.txt"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("allow-list not found");
  });

  // chmod cannot take read permission away from root, so this case can only be
  // run as an unprivileged user. Skipped rather than weakened.
  const asRoot = typeof process.getuid === "function" && process.getuid() === 0;
  it.skipIf(asRoot)("an unreadable directory under a walk root exits 2 and names it", () => {
    const root = makeRepo();
    const locked = join(root, "src", "locked");
    mkdirSync(locked);
    chmodSync(locked, 0o000);
    try {
      const r = runIn(root, []);
      expect(r.code, `stderr: ${r.stderr}`).toBe(2);
      expect(r.stderr).toContain("src/locked");
      expect(r.stderr).toContain("EACCES");
    } finally {
      chmodSync(locked, 0o755);
    }
  });
});

// ---------------------------------------------------------------------------
// The HL7 v2 structured pass
// ---------------------------------------------------------------------------
//
// ▶ ENUMERATING MORE FILES BUYS THE SSN/EMAIL FLOOR AND NOTHING ELSE, AND IN
//   THIS REPOSITORY THE FLOOR FINDS NOTHING IN THE FIXTURES AT ALL. Measured
//   over the 8 tracked files carrying `PID|`: zero dashed SSNs, zero emails.
//   What they carry is names, DOBs, MRNs, one undashed SSN in an `SS`-typed
//   identifier, one street address and two phone numbers. Widening the walk
//   without this pass would have opened all 8 and reported every one clean.
//
// ▶ AND THE SHAPE THAT MAKES THIS PACKAGE DIFFERENT FROM ITS SIBLINGS: there
//   is no standalone `.hl7` fixture in this repository. Every message is a
//   `.ts` STRING LITERAL, so a recogniser that assumed the file IS the message
//   would find nothing. These cases pin that the pass finds segments inline.

describe("phi-scan: the HL7 v2 structured pass finds field-level PHI", () => {
  const pid = (fields: string): string => `PID|${fields}`;

  /** Place values at their 1-indexed v2 field positions, so a case cannot be off by one. */
  const seg = (name: string, fields: Readonly<Record<number, string>>): string => {
    const max = Math.max(0, ...Object.keys(fields).map(Number));
    const parts = [name];
    for (let i = 1; i <= max; i += 1) parts.push(fields[i] ?? "");
    return parts.join("|");
  };

  it("catches a person NAME in PID-5 that is not declared synthetic (exit 1)", () => {
    const r = scan(
      "name.ts",
      `const P = "${pid(`1||X^^^H^MR||${PAYLOAD_FAMILY}^${PAYLOAD_GIVEN}`)}";\n`,
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-5");
    expect(r.stderr).toContain(PAYLOAD_FAMILY);
  });

  it("catches a DATE OF BIRTH in PID-7, and normalizes a zoned TS to its 8 digits", () => {
    const r = scan("dob.ts", `const P = "${pid(`1||||A^B||${PAYLOAD_DOB_V2}143000-0500|F`)}";\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-7");
    expect(r.stderr).toContain(PAYLOAD_DOB_V2);
  });

  it("catches an MRN in PID-3, reading CX-1 and not the assigning authority or type", () => {
    const r = scan("mrn.ts", `const P = "${pid(`1||${PAYLOAD_MRN}^^^HOSP^MR`)}";\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-3");
    expect(r.stderr).toContain(PAYLOAD_MRN);
    // HOSP (CX-4) and MR (CX-5) are not identifiers and must not be reported.
    expect(r.stderr).not.toContain('value="HOSP"');
    expect(r.stderr).not.toContain('value="MR"');
  });

  it("names an SS-typed identifier as an SSN, which the dashed-SSN floor cannot see", () => {
    // The exact shape this repository's own ADT fixture carries. It has no
    // dashes, so the floor is structurally blind to it.
    const undashed = ["555", "44", "3210"].join("");
    const r = scan("ssn-cx.ts", `const P = "${pid(`1||${undashed}^^^SSA^SS`)}";\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("social security number");
    // Non-vacuity: the floor really does miss it on its own.
    const floorOnly = scan("ssn-plain.txt", `${undashed}\n`);
    expect(floorOnly.code, `stderr: ${floorOnly.stderr}`).toBe(0);
  });

  it("catches an ADDRESS in PID-11 and a PHONE in PID-13", () => {
    const street = ["9", "Nowhere", "Terrace"].join(" ");
    const phone = ["617", "0000"].join("-");
    const segment = seg("PID", {
      1: "1",
      11: `${street}^^Springfield^ZZ^99999`,
      13: phone,
    });
    const r = scan("addr.ts", `const P = "${segment}";\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-11");
    expect(r.stderr).toContain("PID-13");
    expect(r.stderr).toContain(street);
  });

  it("reads NK1, GT1 and IN1 too, not PID alone", () => {
    const name = `${PAYLOAD_FAMILY}^${PAYLOAD_GIVEN}`;

    const nk1 = scan("nk1.ts", `const P = "${seg("NK1", { 1: "1", 2: name, 3: "SPO" })}";\n`);
    expect(nk1.code, `stderr: ${nk1.stderr}`).toBe(1);
    expect(nk1.stderr).toContain("NK1-2");

    const gt1 = scan("gt1.ts", `const P = "${seg("GT1", { 1: "1", 3: name })}";\n`);
    expect(gt1.code, `stderr: ${gt1.stderr}`).toBe(1);
    expect(gt1.stderr).toContain("GT1-3");

    const in1 = scan("in1.ts", `const P = "${seg("IN1", { 1: "1", 16: name })}";\n`);
    expect(in1.code, `stderr: ${in1.stderr}`).toBe(1);
    expect(in1.stderr).toContain("IN1-16");
  });

  it("finds a segment INSIDE a TypeScript literal and stops at the closing quote", () => {
    // The shape this whole repository's corpus has. The trailing code after the
    // closing quote must not be read as further fields.
    const content = `const lines = ["MSH|^~\\\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1", "${pid(
      `1||||${PAYLOAD_FAMILY}^${PAYLOAD_GIVEN}`,
    )}"]; // ${PAYLOAD_MRN} in a comment\n`;
    const r = scan("inline.ts", content);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-5");
    // The comment after the literal is outside the segment: it is not a field.
    expect(r.stderr).not.toContain(PAYLOAD_MRN);
  });

  it("NEGATIVE CONTROL: an allow-listed fixture line is clean, so the pass is not a blind regex", () => {
    // Everything here is declared in scripts/phi-allow-list.txt. A pass that
    // reported this would be unusable, and a pass that reported nothing at all
    // would look identical to a broken one, which is why every case above sits
    // beside this one.
    const r = scan(
      "declared.ts",
      `const P = "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F|||123 Main St^Apt 4^Boston^MA^02101|||555-1234";\n`,
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("NEGATIVE CONTROL: a coded value in a scanned field is not read as a name", () => {
    // `CBC^Complete Blood Count` and `Boston^MA` are the false-confidence shapes
    // the docblock warns about. Component positions and a name charset keep
    // name-type codes (`L`, `ZZ`) and prefixes (`Mrs.`) out.
    const r = scan("coded.ts", `const P = "PID|1||||A^B^^^Mrs.^^L||19900101|F";\n`);
    expect(r.stderr).not.toContain('value="L"');
    expect(r.stderr).not.toContain('value="Mrs."');
  });

  it("NEGATIVE CONTROL against the WRONG standard: an X12 NM1 segment is not an HL7 one", () => {
    // This package transforms HL7 v2. A pass that fired on a sibling standard's
    // wire format would be matching text rather than parsing a message, and the
    // measurement would not be about this repository at all.
    const r = scan(
      "x12.txt",
      `NM1*IL*1*${PAYLOAD_FAMILY}*${PAYLOAD_GIVEN}****MI*${PAYLOAD_MRN}~\n`,
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("declines to judge a value injected by TEMPLATE INTERPOLATION, rather than guessing", () => {
    // A static scan cannot see what a placeholder resolves to. Reporting the
    // placeholder text would be a fabricated hit; reporting nothing about it is
    // a stated blind spot rather than a silent one.
    const r = scan("interp.ts", "const P = `PID|1||${mrn}^^^HOSP^MR||${family}^${given}`;\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
  });

  it("runs IN ADDITION TO the floor on the same target, never instead of it", () => {
    const r = scan(
      "both.ts",
      `// contact ${REAL_EMAIL}\nconst P = "PID|1||||${PAYLOAD_FAMILY}^${PAYLOAD_GIVEN}";\n`,
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("(email)");
    expect(r.stderr).toContain("PID-5");
  });
});

describe("phi-scan: the EMAIL allow-list entry, and exactly how far it reaches", () => {
  const MAILBOX = ["hello", "cosyte.com"].join("@");

  it("clears the declared mailbox IN THE DECLARED FILE, and that is the measured cost", () => {
    // ▶ THE ONE CELL THIS CHANGE SUBTRACTS, PINNED SO IT IS VISIBLE RATHER THAN
    //   DISCOVERED. Before this change `pnpm phi-scan package.json` exited 1 on
    //   the npm publisher contact in its `author` field. It exits 0 now. That is
    //   the price of the walk covering package.json at all instead of exempting
    //   the whole file, and it is the only 1 -> 0 in the change.
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), `{ "author": "Cosyte <${MAILBOX}>" }\n`);
    expect(runIn(root, ["package.json"]).code).toBe(0);
  });

  it("does NOT clear the SAME mailbox in a DIFFERENT file (the path half is real)", () => {
    // Two literals, so this entry is as narrow as the mechanism goes. If this
    // ever passes, someone has dropped the path and made it global.
    const root = makeRepo();
    writeFileSync(join(root, "src", "contact.ts"), `// ${MAILBOX}\nexport const a = 1;\n`);
    const r = runIn(root, ["src/contact.ts"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(MAILBOX);
  });

  it("does NOT clear a DIFFERENT mailbox at the same domain (it is not a domain entry)", () => {
    // If this ever passes, someone has replaced it with `EMAILDOMAIN cosyte.com`.
    const other = ["not-the-publisher", "cosyte.com"].join("@");
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), `{ "author": "${other}" }\n`);
    const r = runIn(root, ["package.json"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(other);
  });

  it("IS ROUTE-BLIND within that file, and that reach is pinned rather than assumed", () => {
    // An allow-list entry clears its literal on every route, the commit-blocking
    // one included. This case exists so that fact is measured and visible.
    const root = makeRepo();
    writeFileSync(join(root, "package.json"), `{ "author": "Cosyte <${MAILBOX}>" }\n`);
    git(root, ["add", "package.json"]);
    expect(runIn(root, ["--staged"]).code).toBe(0);
    expect(runIn(root, []).code).toBe(0);
  });

  it("REFUSES an EMAIL entry with no path rather than reading it as a global clearance", () => {
    const root = makeRepo();
    const listPath = join(root, "scripts", "phi-allow-list.txt");
    writeFileSync(listPath, `EMAIL ${MAILBOX}\n`);

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("EMAIL entry needs a path");
  });
});

// ---------------------------------------------------------------------------
// The three silent misses a refuter measured, and the residual it named
// ---------------------------------------------------------------------------
//
// Each of the first three reported a CLEAN result over content this gate claims
// to catch, so each is pinned RED-before / GREEN-after rather than described.

describe("phi-scan: the HL7 pass sees names it cannot spell, and messages in one literal", () => {
  const family = ["Kowal", "ski"].join("");
  const given = ["Barb", "ara"].join("");

  it("catches a NAME COMPONENT OUTSIDE ASCII, which an [A-Za-z] class reported clean", () => {
    // A gate blind to exactly the names least likely to be synthetic is worse
    // than no gate. Both a precomposed accent and a non-Latin script.
    const accented = ["Garc", "ía"].join("");
    const vietnamese = ["Nguy", "ễn"].join("");
    const r = scan("nonascii.ts", `const m = "PID|1||||${accented}^${vietnamese}";\n`);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(accented);
    expect(r.stderr).toContain(vietnamese);
    // Non-vacuity: a DIGIT string in the same component is still not a name.
    const coded = scan("coded-name.ts", `const m = "PID|1||||125677006^^^^^^ZZ";\n`);
    expect(coded.code, `stderr: ${coded.stderr}`).toBe(0);
  });

  it("catches a whole message in ONE literal with ESCAPED separators, and numbers its fields right", () => {
    // The other way a `.ts` file carries a v2 message here, and the shape
    // `parseHL7(raw)` consumes. Before the fix this exited 0: the character
    // before `PID|` is the letter `r` of the escape, which the boundary class
    // rejected. The escaped separator is a TERMINATOR too, or every field after
    // the first one lands at the wrong index.
    // Every value here is assembled, per the banner at the top of this file:
    // this is the one case whose payload IS a live segment literal, so writing
    // any of it out would red the repository's own gate on every run.
    const street = ["9", "Elm", "Rd"].join(" ");
    const city = ["Day", "ton"].join("");
    const zip = ["454", "02"].join("");
    const mrn = ["765", "4321"].join("");
    const dob = ["1963", "12", "07"].join("");
    const kin = ["Pet", "er"].join("");
    const phone = ["937", "5550187"].join("");
    const kinPhone = ["937", "5550188"].join("");
    const addr = `${street}^^${city}^OH^${zip}`;
    const msh = "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1";
    const pid = `PID|1||${mrn}^^^HOSP^MR||${family}^${given}||${dob}|F|||${addr}||${phone}`;
    const nk1 = `NK1|1|${family}^${kin}|SPO|${addr}|${kinPhone}`;
    const r = scan("escaped.ts", `const msg = "${msh}\\r${pid}\\r${nk1}";\n`);

    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("PID-5");
    expect(r.stderr).toContain("PID-7");
    expect(r.stderr).toContain("PID-11");
    expect(r.stderr).toContain("PID-13");
    expect(r.stderr).toContain("NK1-2");
    expect(r.stderr).toContain("NK1-4");
    // The field numbering is the half that breaks silently: without bounding on
    // the escape, the next-of-kin's relationship code is reported as PID-11.
    expect(r.stderr).not.toContain('segment=PID-11 value="SPO"');
  });

  it("does NOT read IN1-17 as a telephone field: v2.5.1 defines it as a relationship code", () => {
    // A wrong field number is a fabricated diagnostic, and the remedy it steers
    // a developer toward is a global PHONE clearance of a SNOMED code. IN1
    // carries no insured telephone at all; IN1-7 is the payer's.
    const r = scan(
      "in1-17.ts",
      'const s = "IN1|1|PLAN|CO123|BlueCross|||||||||||||125677006^Relative^SCT";\n',
    );
    expect(r.stderr).not.toContain("IN1-17");
    expect(r.stderr).not.toContain("telephone");
  });

  it("REFUSES a walk root whose lstat fails for a reason other than absence", () => {
    // Swallowing every lstat error as "absent" is the same shape as the
    // missing-root false clean this preflight exists to close. `ENOTDIR` here:
    // a root path whose own PARENT is a regular file.
    const root = makeRepo();
    rmSync(join(root, "docs-content"), { recursive: true, force: true });
    writeFileSync(join(root, "docs-content"), "not a directory\n");
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("docs-content");
  });

  it("RESIDUAL, pinned as a residual: UNTRACKED content outside every root is invisible", () => {
    // Disclosed rather than closed. The reconciliation covers the TRACKED half
    // (a tracked stray refuses, pinned above); an untracked one under an
    // undeclared top-level directory is seen by neither enumerating route. This
    // case asserts the gap so a future edit that closes it reds here and the
    // disclosure gets updated rather than silently outliving the defect.
    const root = makeRepo();
    mkdirSync(join(root, "notes"));
    writeFileSync(join(root, "notes", "leak.ts"), SYNTHETIC_PHI);
    expect(runIn(root, []).code).toBe(0);
    // And it is not invisible to the route that is handed it.
    expect(runIn(root, ["notes/leak.ts"]).code).toBe(1);
  });
});

describe("phi-scan: the coverage claim is POSITIVE, and this is what makes it checkable", () => {
  // Two refuter passes measured an exhaustive NEGATIVE list ("what this does not
  // catch") incomplete in the false-confidence direction, the second time after
  // it had been extended in answer to the first. A negative list of that shape
  // cannot be kept true. The banner now enumerates exactly which fields are
  // read; these cases assert the boundary of that enumeration from both sides,
  // so a field quietly added to the table without being added to the banner reds
  // here rather than shipping as a silently wider claim.
  const family = ["Kowal", "ski"].join("");
  const given = ["Barb", "ara"].join("");

  const seg = (name: string, fields: Readonly<Record<number, string>>): string => {
    const max = Math.max(0, ...Object.keys(fields).map(Number));
    const parts = [name];
    for (let i = 1; i <= max; i += 1) parts.push(fields[i] ?? "");
    return parts.join("|");
  };

  it("reads EVERY ONE of the 35 fields the banner names, and NONE that it does not", () => {
    // ▶ ALL 35, NOT A SAMPLE, AND THAT IS THE FINDING. An earlier draft named
    //   eight and its comment claimed a field added to the table without being
    //   added to the banner would red here. Measured: adding PID-4 and PID-18 to
    //   the table left the suite 75/75 GREEN. Worse is the NARROWING direction,
    //   where the code drops a field and the banner goes on claiming it: 15 of
    //   the (then) 28 fired in no test at all, so that shipped green too.
    //   Enumerating every named field is what makes the claim durable in both
    //   directions.
    //
    // ▶ EACH ROW CARRIES THE v2.5.1 ITEM NUMBER THE FIELD NUMBER WAS CORROBORATED
    //   BY, and that is the point of this list rather than a note on it. Every
    //   number here is checked against a published copy of HL7 v2.5.1 (the
    //   segment attribute tables of Chapter 3 for PID/NK1 and Chapter 6 for
    //   GT1/IN1), cross-checked against a second version-pinned publication, and
    //   cited in `scripts/phi-scan.ts`. An item number is the standard's own
    //   stable identifier for an element, so a future reader re-checking a row is
    //   checking the SAME element rather than a same-numbered one. Fifteen of
    //   these had never been checked against any published source: the whole GT1
    //   row, PID-6/9/19/20, NK1-30/33 and IN1-18/19. None of the fifteen was
    //   wrong. One CITATION was (GT1 is clause 6.5.5, not 6.5.4).
    const name = `${family}^${given}`;
    const covered: [string, string, string, Record<number, string>][] = [
      ["PID", "PID-3", "00106", { 3: "A77321^^^HOSP^MR" }],
      ["PID", "PID-5", "00108", { 5: name }],
      ["PID", "PID-6", "00109", { 6: name }],
      ["PID", "PID-7", "00110", { 7: "19631207" }],
      ["PID", "PID-9", "00112", { 9: name }],
      ["PID", "PID-11", "00114", { 11: "9 Elm Rd^^Dayton^OH^45402" }],
      ["PID", "PID-13", "00116", { 13: "9375550187" }],
      ["PID", "PID-14", "00117", { 14: "9375550186" }],
      ["PID", "PID-19", "00122", { 19: "555443210" }],
      ["PID", "PID-20", "00123", { 20: "DL77321" }],
      ["NK1", "NK1-2", "00191", { 2: name }],
      ["NK1", "NK1-4", "00193", { 4: "9 Elm Rd^^Dayton^OH^45402" }],
      ["NK1", "NK1-5", "00194", { 5: "9375550188" }],
      ["NK1", "NK1-6", "00195", { 6: "9375550189" }],
      ["NK1", "NK1-16", "00110", { 16: "19631207" }],
      // The seven below were DISCLOSED AS UNREAD by a refuter and asserted clean
      // by this very case. The same published tables that corroborated the rest
      // ground them, so they are read now: a UNION with the previous list, never
      // a replacement. Every row that reported before this change still reports.
      ["NK1", "NK1-26", "00109", { 26: name }],
      ["NK1", "NK1-30", "00748", { 30: name }],
      ["NK1", "NK1-31", "00749", { 31: "9375550188" }],
      ["NK1", "NK1-32", "00750", { 32: "9 Elm Rd^^Dayton^OH^45402" }],
      ["NK1", "NK1-33", "00751", { 33: "A77321" }],
      ["NK1", "NK1-37", "00754", { 37: "555443210" }],
      ["GT1", "GT1-2", "00406", { 2: "G77321" }],
      ["GT1", "GT1-3", "00407", { 3: name }],
      ["GT1", "GT1-4", "00408", { 4: name }],
      ["GT1", "GT1-5", "00409", { 5: "9 Elm Rd^^Dayton^OH^45402" }],
      ["GT1", "GT1-6", "00410", { 6: "9375550190" }],
      ["GT1", "GT1-7", "00411", { 7: "9375550191" }],
      ["GT1", "GT1-8", "00412", { 8: "19631207" }],
      ["GT1", "GT1-12", "00416", { 12: "555443210" }],
      ["GT1", "GT1-19", "00423", { 19: "EMP77321" }],
      ["IN1", "IN1-16", "00441", { 16: name }],
      ["IN1", "IN1-18", "00443", { 18: "19631207" }],
      ["IN1", "IN1-19", "00444", { 19: "9 Elm Rd^^Dayton^OH^45402" }],
      ["IN1", "IN1-36", "00461", { 36: "POL77321" }],
      ["IN1", "IN1-49", "01230", { 49: "MEM77321" }],
    ];
    expect(covered).toHaveLength(35);
    for (const [segment, label, item, fields] of covered) {
      const r = scan(`cov-${label}.ts`, `const m = "${seg(segment, fields)}";\n`);
      expect(
        r.code,
        `${label} (v2.5.1 item ${item}) is NAMED in the banner and must report. stderr: ${r.stderr}`,
      ).toBe(1);
      // The exact locator the report prints, with its trailing space: `PID-3`
      // alone is a prefix of `PID-33` and would let a renumbering pass.
      expect(r.stderr).toContain(`segment=${label} `);
    }

    // OUTSIDE the named set: each must be clean, and each zero is a GAP the
    // banner declares, not a clearance. They run in the SAME case as the 35
    // positives above, deliberately, so a wholesale detector failure cannot
    // produce them, and each carries the v2.5.1 element it actually is.
    //
    // ▶ IN1-17 IS FIRST BECAUSE IT IS THE MEASURED DEFECT THIS WHOLE DISCIPLINE
    //   EXISTS FOR. It shipped as a telephone field and is *Insured's
    //   Relationship To Patient* (item 00442), so a coded relationship was
    //   reported as a phone number and the remedy it steered a developer toward
    //   was a global PHONE clearance of that digit string. IN1 carries no insured
    //   telephone at all; IN1-7 (item 00432) is the payer's, an organisation's.
    //   The rest are OFF-BY-ONE controls: a value one field away from a field
    //   that IS read must stay clean, which is what a wrong number would break.
    //
    // ▶ THESE NINE ROWS ARE CORROBORATED THE SAME WAY THE 35 ABOVE ARE, AND THE
    //   FIRST DRAFT OF THIS LIST WAS NOT. A refuter measured `PV1-7` written here
    //   as item 00147; PV1-7 is item **00137** (Attending Doctor) and 00147 is
    //   PV1-17 (Admitting Doctor). Eight of the nine happened to be right, which
    //   is the point: they were ASSERTED FROM RECALL rather than extracted from
    //   the table the 35 were extracted from, so being right was luck and being
    //   wrong was invisible. No detection changed either way (PV1 is read by
    //   nothing, and the case asserts a clean result), which is exactly how a
    //   wrong citation survives: it costs nothing until someone re-checks a row
    //   against it and lands on a different element, confirmed. **Extract an item
    //   number from the standard or do not write one.**
    const uncovered: [string, string, string, Record<number, string>][] = [
      ["IN1", "IN1-17", "00442", { 17: "9375550190" }],
      ["IN1", "IN1-7", "00432", { 7: "9375550191" }],
      ["PID", "PID-4", "00107", { 4: "ALT77321" }],
      ["PID", "PID-10", "00113", { 10: name }],
      ["PID", "PID-18", "00121", { 18: "ACC77321" }],
      ["NK1", "NK1-3", "00192", { 3: name }],
      ["GT1", "GT1-11", "00415", { 11: name }],
      ["PV1", "PV1-7", "00137", { 7: `1234^${family}^${given}` }],
      ["PV1", "PV1-19", "00149", { 19: "V77321" }],
    ];
    for (const [segment, label, item, fields] of uncovered) {
      const r = scan(`unc-${label}.ts`, `const m = "${seg(segment, fields)}";\n`);
      expect(
        r.code,
        `${label} (v2.5.1 item ${item}) is declared OUT of scope. stderr: ${r.stderr}`,
      ).toBe(0);
      expect(r.stderr).not.toContain(`segment=${label} `);
    }
  }, 120_000);

  it("NK1-37 is an UNDASHED SSN, which the cross-cutting floor is structurally blind to", () => {
    // ▶ NON-VACUITY FOR THE SHARPEST CELL THE WIDENING ADDED, and the class rule
    //   this repository paid for: ENUMERATION ALONE BUYS THE FLOOR AND NOTHING
    //   ELSE. The floor matches a DASHED shape only, so this value passes it on
    //   its own; the field table is the only thing that catches it. Both
    //   polarities in one case, so neither half can drift away from the other.
    const undashed = ["555", "44", "3210"].join("");

    const floorOnly = scan("nk1-37-floor.txt", `${undashed}\n`);
    expect(floorOnly.code, `stderr: ${floorOnly.stderr}`).toBe(0);

    const structured = scan("nk1-37-field.ts", `const m = "${seg("NK1", { 37: undashed })}";\n`);
    expect(structured.code, `stderr: ${structured.stderr}`).toBe(1);
    expect(structured.stderr).toContain("segment=NK1-37 ");
    expect(structured.stderr).toContain("social security number");
  });

  it("a literal backslash before r or n truncates the segment, and can silence the field it cuts", () => {
    // The fourth recogniser limit, disclosed rather than guessed at: the escaped
    // separator is also the terminator, so a Windows path in an address field
    // ends the segment there. Pinned so the disclosure cannot outlive the
    // behaviour. The fields BEFORE the cut keep their positions, which is what
    // makes this a truncation rather than a renumbering.
    //
    // ▶ AND THE SECOND HALF, WHICH AN EARLIER DRAFT OF THE DISCLOSURE GOT WRONG
    //   IN THE FLATTERING DIRECTION: it claimed the field the cut lands in still
    //   reports. It reports only if the surviving prefix still clears a
    //   recogniser floor. The second probe below cuts inside a family name, and
    //   that field goes silent along with everything after it.
    const winPath = ["C:", "records", "scan.tif"].join("\\\\");
    const r = scan(
      "backslash.ts",
      `const p = "${seg("PID", { 5: `${family}^${given}`, 7: "19631207", 11: `${winPath}^^Springfield^ZZ^99999`, 13: "5551230000" })}";\n`,
    );
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    // Everything before the cut is still read, at its right field number.
    expect(r.stderr).toContain("PID-5");
    expect(r.stderr).toContain("PID-7");
    expect(r.stderr).toContain("PID-11");
    // And the truncation itself: PID-13 is past the cut.
    expect(r.stderr).not.toContain("PID-13");

    // A cut INSIDE a name: the prefix no longer clears the name-token floor, so
    // PID-5 itself goes silent and so does every field after it. Only PID-3,
    // which precedes the cut, survives.
    const cut = scan(
      "backslash-name.ts",
      `const p = "${seg("PID", { 3: "A77321^^^HOSP^MR", 5: "O\\rourke^Sean", 7: "19631207", 13: "5551230000" })}";\n`,
    );
    expect(cut.code, `stderr: ${cut.stderr}`).toBe(1);
    expect(cut.stderr).toContain("PID-3");
    expect(cut.stderr).not.toContain("PID-5");
    expect(cut.stderr).not.toContain("PID-7");
  });
});

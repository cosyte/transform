/**
 * Unit tests for scripts/phi-scan.ts — the STARTER PHI commit-gate.
 *
 * These exercise the SHARED MACHINERY and the cross-cutting SSN/email FLOOR that
 * ships with the template. They deliberately do NOT test structured, field-level
 * PHI detection — that is format-specific and is the author's obligation to add
 * (see the STARTER banner in scripts/phi-scan.ts). When you add structured
 * detectors, add positive tests here proving they CATCH real-looking names /
 * DOBs / ids for this standard — a weak scanner is worse than none.
 *
 * The scanner is invoked via spawnSync (array args, no shell) so the full CLI
 * path (argv parse, exit code, stderr) is exercised. Violator/clean files are
 * written to a throwaway temp dir so they never pollute the committed corpus.
 *
 * SECURITY: every subprocess call here uses spawnSync with array args. No exec,
 * no shell-form.
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

/** Write a file to the temp dir and scan it by path (paths mode — no git needed). */
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
    const r = scan("ssn.txt", "patient ssn 123-45-6789 on file\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/123-45-6789/);
    expect(r.stderr).toMatch(/dashed SSN/);
  });

  it("catches an email at a non-test domain (exit 1)", () => {
    const r = scan("email.txt", "contact jane.doe@hospital.org for records\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toMatch(/jane\.doe@hospital\.org/);
    expect(r.stderr).toMatch(/non-test domain/);
  });
});

describe("phi-scan starter: clean + allow-listed content passes", () => {
  it("a clean file with no PHI shapes exits 0", () => {
    const r = scan("clean.txt", "just some ordinary text, no identifiers here\n");
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK — no hits/);
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
// `src/` pointing at the payload below printed "OK — no hits" and exited 0 on
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
    "Patient: RIVERA^JUANITA^Q",
    "DOB: 1978-03-14",
    "SSN: 123-45-6789",
    "Contact: juanita.rivera@example-hospital.org",
  ].join("\n") + "\n";

/** The link target's own name carries a synthetic name, so an echo of it is visible. */
const TARGET_NAME = "RIVERA-JUANITA-1978-03-14.txt";

/** Tokens that must never appear in a refusal message. */
const PHI_TOKENS = [
  "RIVERA",
  "JUANITA",
  "1978-03-14",
  "123-45-6789",
  "juanita.rivera@example-hospital.org",
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
 * something legitimate to find. `test/fixtures/` is created too — it is the
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
    expect(r.stderr).toContain("123-45-6789");
    expect(r.stderr).toContain("juanita.rivera@example-hospital.org");
  });

  it("a repo with no link and no violator scans clean (exit 0)", () => {
    const root = makeRepo();
    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
    expect(r.stdout).toMatch(/OK — no hits/);
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

  it("the .md exemption does not extend to a link that merely ends in .md", () => {
    // A regular `.md` file is skipped as documentation. That is a judgement about
    // bytes the walk could have read; a link's NAME is no evidence about what is
    // on the other side, so the exemption must not carry over to one.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(join("..", TARGET_NAME), join(root, "src", "notes.md"));

    const r = runIn(root, []);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/notes.md");
    expectNoPhi(r.stderr);
  });

  it("has no extension scope of its own — a link at a non-.ts path is refused too", () => {
    // `src/**.ts` is the `--staged` route's boundary, NOT the walk's. The walk
    // skips regular `*.md` as documentation and takes everything else.
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
    writeFileSync(join(root, ".gitignore"), "src/leak.ts\n");

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
// followed — pre-existing, disclosed in the docblock and CHANGELOG.md, and
// deliberately not closed. Do not retitle this block "follows nothing".
describe("phi-scan: the named-path route refuses a non-regular path it is handed", () => {
  // This route was NOT blind — it classified with `statSync`, which dereferences,
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
    expect(hit.stderr).toContain("123-45-6789");

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
    expect(shown).not.toContain("123-45-6789");
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

  it("refuses a TYPECHANGE — a tracked regular file replaced by a link (exit 2)", () => {
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

  it("scans the other direction of a typechange — a link replaced by a real file (exit 1)", () => {
    const root = makeRepo();
    symlinkSync("ordinary.ts", join(root, "src", "link.ts"));
    git(root, ["add", "src/link.ts"]);
    git(root, ["-c", "user.email=t@example.com", "-c", "user.name=t", "commit", "-qm", "base"]);

    rmSync(join(root, "src", "link.ts"));
    writeFileSync(join(root, "src", "link.ts"), SYNTHETIC_PHI);
    git(root, ["add", "src/link.ts"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain("123-45-6789");
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
    expect(r.stderr).toContain("123-45-6789");
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
    expect(r.stdout).toMatch(/OK — no hits/);
  });

  it("refuses an UNMERGED path instead of reporting clean over it (exit 2)", () => {
    // A conflicted path has no single staged blob: `git diff --cached --raw`
    // reports `:100644 000000 <sha> 0000000 U`, the index holds three entries at
    // stages 1/2/3, and `git show :<path>` cannot answer for it. `U` is returned
    // by neither `AM` nor `AMT`, so the record did not exist and the route
    // reported a clean scan over a path whose conflicted side carries PHI.
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
    // through the tolerant helper rather than the throwing one.
    gitOut(root, ["merge", "other"]);

    // The premise: an unmerged record really is dropped by the old filter.
    expect(gitOut(root, ["diff", "--cached", "--raw", "--diff-filter=AMT"]).trim()).toBe("");
    expect(gitOut(root, ["diff", "--cached", "--raw"])).toContain(" U\t");

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(2);
    expect(r.stderr).toContain("src/conflict.ts");
    expect(r.stderr).toContain("an unmerged path");
    expectNoPhi(r.stderr);
  });

  it("a staged link OUTSIDE the route's scope is left alone (the scope is unchanged)", () => {
    // `--staged` only ever covered `test/fixtures/**` and `src/**.ts`. The mode
    // check narrows what that scope admits; it does not widen the scope, and
    // saying otherwise would overstate what this closes.
    const root = makeRepo();
    writeFileSync(join(root, TARGET_NAME), SYNTHETIC_PHI);
    symlinkSync(TARGET_NAME, join(root, "docs-link.txt"));
    git(root, ["add", "docs-link.txt"]);

    const r = runIn(root, ["--staged"]);
    expect(r.code, `stderr: ${r.stderr}`).toBe(0);
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
    expect(r.stderr).toContain("123-45-6789");
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
    expect(r.stderr).toContain("123-45-6789");
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

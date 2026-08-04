#!/usr/bin/env tsx
/**
 * `@cosyte/transform` PHI scanner — the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via
 * `execFileSync` with array args (never shell-form). Walks the synthetic test
 * fixtures (and a conservative text pass over `src/`) and REFUSES anything that
 * looks like real PHI, so a developer cannot commit a real-looking fixture by
 * accident.
 *
 * ===========================================================================
 * ██  STARTER — READ BEFORE YOU RELY ON THIS  ███████████████████████████████
 * ===========================================================================
 *
 *   This file is the SHARED MACHINERY only. As shipped it detects EXACTLY TWO
 *   cross-cutting PHI shapes that apply to ANY format:
 *
 *       (1) a dashed Social Security Number   (\d{3}-\d{2}-\d{4})
 *       (2) an email at a non-test domain
 *
 *   That is a FLOOR, not a gate. It does NOT understand Transform. It will NOT
 *   catch a patient name, a date of birth, an MRN / member id, an address, or a
 *   phone number sitting in a structured Transform field — the PHI that a real
 *   Transform message actually carries.
 *
 *   ⚠  A scanner that silently ships SSN/email-only detection is a FALSE-
 *      CONFIDENCE RISK: it reports green on fixtures stuffed with real names and
 *      DOBs. Before you trust `pnpm phi-scan` as a safety gate for Transform,
 *      YOU MUST add structured, field-level detection for THIS standard's PHI
 *      (names, DOB, MRN / member id, address, phone) in the clearly-fenced
 *      TODO section inside `scanTarget` below.
 *
 *   Worked examples of structured, format-aware detection live in the sibling
 *   parsers — read one before you start:
 *       ../hl7/scripts/phi-scan.ts     (segment → field → component aware)
 *       ../x12/scripts/phi-scan.ts     (ISA-delimited NM1 / DMG / PER aware)
 *       ../dicom/scripts/phi-scan.ts   (binary tag-aware)
 *       ../ccda/scripts/phi-scan.ts    (XML element aware)
 *       ../ncpdp/scripts/phi-scan.ts   (fixed-field aware)
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`) — a positive declaration that a
 *   fixture's identifiers are fake. Byte-strict formats cannot carry an inline
 *   `# synthetic: true` header, so the allow-list is the proven substitute
 *   (same approach every sibling uses). A whole-file bypass needs
 *   `--allow-fixture <path>` AND a logged entry in `phi-scan-overrides.md`.
 * ===========================================================================
 *
 * Modes:
 *   --staged                 - scan only files staged in `git diff --cached`
 *   --allow-fixture <path>   - bypass one path; rejected unless logged in
 *                              phi-scan-overrides.md
 *   <path> [<path>...]       - scan specific paths
 *   (no args)                - scan all in-scope working-tree files
 *
 * Exit codes: 0 (clean), 1 (hits found), 2 (could not complete: a bad
 * invocation, or an in-scope entry the scan cannot account for). EVERY failure
 * to complete is 2, including one thrown before the scan starts: an uncaught
 * throw exits 1, which is this scanner's code for HITS FOUND, so the two used to
 * be indistinguishable on the wrong side. See `run()` at the foot of the file.
 *
 * ---------------------------------------------------------------------------
 * AN IN-SCOPE ENTRY THAT IS NOT A REGULAR FILE REFUSES THE SCAN (exit 2), ON ALL
 * THREE MODES. It is never silently skipped, because BOTH ENUMERATING routes
 * were blind to it in a way that read as clean. Measured on this package's own
 * scanner before this change, over a link under `src/` pointing at a
 * name-bearing synthetic payload:
 *
 *   - all-mode printed "OK — no hits" and exited 0. The walk enumerates
 *     `Dirent.isFile()`, which is an lstat answer, so a symbolic link is neither
 *     a file nor a directory and fell out of the loop whatever it pointed at.
 *     A linked DIRECTORY takes its whole subtree with it for the same reason.
 *   - `--staged` printed "OK — no hits" and exited 0 over the same link staged.
 *     That route reads content with `git show :<path>`, and git stores a
 *     symbolic link as its TARGET PATH under mode 120000 (`git ls-files --stage`
 *     read `120000` on it), so it is handed the path text, never the target's
 *     bytes.
 *
 * The third mode, a named `<path>`, was not blind — it classified with
 * `statSync`, which DEREFERENCES, so it read the target's bytes and reported
 * hits it found there. That is a false-clean-free route and still wrong: the
 * bytes could be outside the repository. It lstats too now.
 *
 * ▶ SCOPE THAT EXACTLY, BECAUSE A LOOSER WORDING OF IT WAS MEASURED FALSE TWICE.
 * The rule is: EVERY ENTRY THE SCAN ENUMERATES, AND EVERY PATH NAMED DIRECTLY,
 * IS REFUSED IF IT IS NOT A REGULAR FILE. It is NOT "the scanner follows
 * nothing". `lstat` answers for the FINAL path component only, so a named path
 * whose ANCESTOR component is a symlink is still followed and still reads bytes
 * from wherever that ancestor lands — as does a plain absolute or `../`
 * argument. Both are PRE-EXISTING and unchanged here, and are listed with the
 * other residuals in CHANGELOG.md. Do NOT close them by growing this guard with realpath
 * or containment logic: that is a defect surface of its own, and the two routes
 * that actually gate a commit (the `--staged` pre-commit hook and the all-mode
 * walk CI runs) are not affected by either.
 *
 * No route is made to follow an entry it refuses. Following would read bytes the
 * enumeration does not control (outside the repo, a loop, a device, a FIFO that
 * blocks the gate forever), and git does not carry those bytes anyway, so a hit
 * on them would be a claim about something no commit contains. Refusing states
 * the only true thing available: there is an entry here the scan cannot account
 * for, so the scan is not clean.
 *
 * "In scope" is each route's own existing boundary, not a new one: the walk
 * still excludes a gitignored entry (the same rule that already excludes a
 * gitignored file, so links do not get a second, stricter boundary of their
 * own), and `--staged` still only looks at `test/fixtures/**` and `src/**.ts`.
 * This narrows what those scopes ADMIT; it does not widen the scopes. Note that
 * `test/fixtures/` does not exist in this repo today, so `src/` is the only
 * directory the walk actually descends. The walk has NO extension scope of its
 * own — it skips regular `*.md` as documentation and takes everything else — so
 * a link at `src/leak.json`, and a linked directory, are refused there too. The
 * `.ts` suffix is the `--staged` route's boundary, not the walk's; do not
 * describe them as one rule.
 *
 * THE STAGED ROUTE READS `--raw`, AND ITS `--diff-filter` ADMITS `T`. Replacing
 * a TRACKED regular file with a link is neither an add nor a modify: measured
 * here, `git diff --cached --raw --diff-filter=AM` printed NOTHING for that
 * change while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T`.
 * Under an `AM` filter the record dies before any mode can be read and the hook
 * passes a mode-120000 blob green. Admitting `T` also covers the reverse
 * typechange — a tracked link replaced by a real file bearing PHI, which is a
 * scan that must now happen rather than a refusal.
 *
 * ▶ AND THE FILTER ALONE WAS NOT ENOUGH: `R`/`C` ARE RETURNED BY NEITHER `AM`
 * NOR `AMT`, SO AN ORDINARY `git mv` INTO A SCAN ROOT WENT STRAIGHT PAST IT.
 * Measured on this repo's scanner before this change: `git mv notes/leak.txt
 * src/leak.ts` over a link to a name-bearing payload staged as
 * `:120000 120000 <sha> <sha> R100`, the filter deleted the two-path record
 * outright, and `--staged` reported a clean scan and exited **0** over a
 * mode-120000 entry at `src/leak.ts`; renaming an ordinary PHI-bearing file into
 * the same scope passed identically. THE GAP IS AT PRE-COMMIT. The hook is
 * `phi-scan --staged`, and the all-mode sweep CI runs is the backstop, so the
 * exposure was "PHI enters a local commit or a pushed branch", not "PHI merges".
 * `--no-renames` closes it with no stride work: every staged change arrives as a
 * single-path record, so the destination is an ordinary `A` and the source a `D`
 * the filter drops. Re-measured here under `diff.renames=true|copies|false|1`
 * and `renameLimit=1`: every setting yields the same single-path `A`, so the
 * enumeration is a strict SUPERSET of the previous one.
 *
 * `U` (UNMERGED) IS ADMITTED TOO, AND IS REFUSED RATHER THAN SCANNED. A
 * conflicted path has no stage-0 entry, so `git show :<path>` answers
 * `fatal: path ... is in the index, but not at stage 0` rather than any content.
 * Under `AMT` that record did not exist and the route reported clean over it.
 * WHAT IS UNIFORM ACROSS CONFLICT FLAVOURS IS THE STATUS AND THE DESTINATION
 * MODE, AND NOTHING ELSE. Measured over both-modified, add/add, modify/delete,
 * delete/modify, rename/rename and symlink/symlink: the status is always `U` and
 * the destination mode always `000000`, while the SOURCE mode varies (`100644`,
 * `120000`, `000000`) and so does the set of stages present (1/2/3, 1/2, 2/3,
 * 1/3). The refusal therefore keys on the STATUS, which is why `gitEntryKind`
 * consults it before the mode. Do not write `:100644 000000 <sha> 0000000 U`
 * down as the canonical shape; it is one flavour of six.
 *
 * A refusal names the entry's own repo-relative path and an engine-owned token
 * for its kind. IT NEVER REPORTS THE LINK TARGET, which is text off the working
 * tree and can itself carry PHI — a target path of the shape
 * `<surname>-<given>-<dob>.txt` is the whole reason. The shape is written out
 * rather than an example, because a diagnostic ABOUT a PHI leak is itself a PHI
 * surface, and that applies to the prose explaining it too.
 * ---------------------------------------------------------------------------
 */

import { readFileSync, lstatSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, relative, sep, isAbsolute } from "node:path";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const REPO_ROOT = process.cwd();
const ALLOW_LIST_PATH = join(REPO_ROOT, "scripts", "phi-allow-list.txt");
const OVERRIDE_LOG_PATH = join(REPO_ROOT, "phi-scan-overrides.md");

// Roots walked in "all" mode. test/fixtures gets the full scan; src gets the
// same conservative shape pass because it is hand-written code, not data —
// JSDoc `@example` snippets must not carry real PHI either.
const FIXTURE_ROOT = join(REPO_ROOT, "test", "fixtures");
const SRC_ROOT = join(REPO_ROOT, "src");

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Hit {
  path: string;
  segment: string; // locator (e.g. "(ssn)" / "(email)" or your field id)
  value: string;
  reason: string;
}

interface AllowList {
  /**
   * Uppercase synthetic person-name tokens. UNUSED by the starter floor — the
   * structured name detector you add in the TODO section consumes these.
   */
  names: Set<string>;
  /**
   * Synthetic dates of birth (raw, format-normalized as you choose). UNUSED by
   * the starter floor — your structured DOB detector consumes these.
   */
  dobs: Set<string>;
  /**
   * Synthetic id values (SSN / MRN / member-id shapes). UNUSED by the starter
   * floor — your structured id detector consumes these.
   */
  ids: Set<string>;
  /** Allowed email domains (anything else is a hit). Used by the starter floor. */
  emailDomains: Set<string>;
}

interface Args {
  mode: "all" | "staged" | "paths";
  paths: string[];
  allowFixtures: string[];
}

class InvocationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvocationError";
  }
}

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): Args {
  let staged = false;
  const paths: string[] = [];
  const allowFixtures: string[] = [];
  let i = 0;
  while (i < argv.length) {
    const a = argv[i];
    if (a === "--") {
      for (let j = i + 1; j < argv.length; j += 1) {
        const v = argv[j];
        if (v !== undefined) paths.push(v);
      }
      break;
    } else if (a === "--staged") {
      staged = true;
      i += 1;
    } else if (a === "--allow-fixture") {
      const next = argv[i + 1];
      if (next === undefined) {
        throw new InvocationError("--allow-fixture requires a path argument");
      }
      allowFixtures.push(next);
      i += 2;
    } else if (a !== undefined && a.startsWith("--")) {
      throw new InvocationError(`Unknown flag: ${a}`);
    } else if (a !== undefined) {
      paths.push(a);
      i += 1;
    } else {
      i += 1;
    }
  }

  if (staged && paths.length > 0) {
    throw new InvocationError("--staged cannot be combined with positional paths");
  }

  // An `--allow-fixture` path is a *subtractive* acknowledgement on a broader
  // scan, never a scan target on its own — so it also seeds the positional path
  // set. That makes `--allow-fixture X` mean "scan X, but allow it" (proving the
  // override gate actually subtracts a scanned target) instead of a silent no-op.
  const scanPaths = paths.length > 0 ? paths : [...allowFixtures];

  let mode: Args["mode"];
  if (staged) {
    mode = "staged";
  } else if (scanPaths.length > 0) {
    mode = "paths";
  } else {
    mode = "all";
  }
  return { mode, paths: scanPaths, allowFixtures };
}

// ---------------------------------------------------------------------------
// Allow-list + override log
// ---------------------------------------------------------------------------

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  const raw = readFileSync(ALLOW_LIST_PATH, "utf8");
  const names = new Set<string>();
  const dobs = new Set<string>();
  const ids = new Set<string>();
  const emailDomains = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const line = lineRaw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const sp = line.indexOf(" ");
    if (sp < 0) continue;
    const tag = line.slice(0, sp);
    const value = line.slice(sp + 1).trim();
    if (value.length === 0) continue;
    switch (tag) {
      case "NAME":
        names.add(value.toUpperCase());
        break;
      case "DOB":
        dobs.add(value);
        break;
      case "ID":
        ids.add(value.toUpperCase());
        break;
      case "EMAILDOMAIN":
        emailDomains.add(value.toLowerCase());
        break;
      default:
        break;
    }
  }
  return { names, dobs, ids, emailDomains };
}

function normalizePath(p: string): string {
  const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
  const rel = relative(REPO_ROOT, abs);
  return rel.split(sep).join("/");
}

function loadOverrideLog(): Set<string> {
  if (!existsSync(OVERRIDE_LOG_PATH)) return new Set();
  const raw = readFileSync(OVERRIDE_LOG_PATH, "utf8");
  const out = new Set<string>();
  for (const lineRaw of raw.split(/\r?\n/)) {
    const m = /^###\s+(.+?)\s*$/.exec(lineRaw);
    if (m && m[1] !== undefined) out.add(normalizePath(m[1]));
  }
  return out;
}

function validateAllowFixtures(allowFixtures: string[]): void {
  if (allowFixtures.length === 0) return;
  const overrides = loadOverrideLog();
  const missing = allowFixtures.map(normalizePath).filter((p) => !overrides.has(p));
  if (missing.length > 0) {
    const lines = missing.map((p) => `  - ${p}`).join("\n");
    throw new InvocationError(
      `--allow-fixture rejected: no matching entry in phi-scan-overrides.md for:\n${lines}\n` +
        `Add a "### <path>" subsection to phi-scan-overrides.md and commit it.`,
    );
  }
}

// ---------------------------------------------------------------------------
// Target enumeration
// ---------------------------------------------------------------------------

interface Target {
  path: string; // forward-slash repo-relative path for reporting
  read: () => Buffer;
}

/**
 * An entry the enumeration reached but cannot scan. Both fields are safe to
 * print: `path` is the entry's own repo-relative path (the same locus every hit
 * already carries) and `kind` is a token from the closed set below. Nothing off
 * the other side of a link is ever recorded here.
 */
interface Unscannable {
  path: string;
  kind: string;
}

/**
 * The `lstat`-shaped predicates shared by `Dirent` and `Stats`. Both routes that
 * classify an entry answer the same questions, so they share one closed set
 * rather than drifting into two.
 */
interface KindProbe {
  isSymbolicLink(): boolean;
  isFIFO(): boolean;
  isSocket(): boolean;
  isBlockDevice(): boolean;
  isCharacterDevice(): boolean;
}

/** Closed-set, engine-owned description of a filesystem entry's kind. */
function entryKind(e: KindProbe): string {
  if (e.isSymbolicLink()) return "a symbolic link";
  if (e.isFIFO()) return "a FIFO";
  if (e.isSocket()) return "a socket";
  if (e.isBlockDevice()) return "a block device";
  if (e.isCharacterDevice()) return "a character device";
  return "not a regular file";
}

/**
 * Enumerate a scan root. `Dirent`'s predicates are lstat answers and are not
 * exhaustive: an entry that is neither a directory nor a regular file is
 * collected into `unscannable` rather than dropped, so the caller can refuse
 * instead of reporting clean over it.
 */
function walk(dir: string, out: string[], unscannable: Unscannable[]): void {
  if (!existsSync(dir)) return;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    // A directory the walk cannot read is a scan that cannot account for what is
    // under it, which is the same thing a link is and gets the same answer: an
    // InvocationError, so the run exits 2 rather than falling out of `main` as an
    // uncaught throw (which node reports as exit 1, the code that means HITS
    // FOUND). Only the errno code joins the path; the message is engine-owned.
    const code = err instanceof Error && "code" in err ? String(err.code) : "unknown";
    throw new InvocationError(
      `refusing the scan: could not read the directory ${normalizePath(dir)} (${code}). ` +
        `The walk cannot vouch for entries it was never able to enumerate.`,
    );
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      walk(full, out, unscannable);
    } else if (e.isFile()) {
      // README/markdown docs may legitimately describe violator values; they
      // are documentation, not fixtures.
      if (e.name.toLowerCase().endsWith(".md")) continue;
      out.push(full);
    } else {
      // Deliberately NOT subject to the `.md` exemption above. That exemption is
      // a judgement about a file whose bytes the walk could have read; a link's
      // name is no evidence at all about what is on the other side.
      unscannable.push({ path: normalizePath(full), kind: entryKind(e) });
    }
  }
}

/**
 * Refuse (exit 2) over entries the enumeration reached and cannot scan. EVERY
 * offender is named, not just the first: a developer who has to re-run the gate
 * once per link learns to distrust it.
 */
function refuseUnscannable(entries: Unscannable[], why: string, remedy: string): void {
  if (entries.length === 0) return;
  const lines = entries.map((u) => `  - ${u.path} (${u.kind})`).join("\n");
  // Deliberately NOT "is not a regular file": an unmerged path's three index
  // entries are all regular blobs, and what is wrong with it is that there is no
  // single one to read. Each line carries its own precise kind.
  const noun = entries.length === 1 ? "entry cannot be scanned" : "entries cannot be scanned";
  throw new InvocationError(
    `refusing the scan: ${String(entries.length)} ${noun}:\n${lines}\n${why} ${remedy}`,
  );
}

function gitIgnored(paths: string[]): Set<string> {
  const ignored = new Set<string>();
  if (paths.length === 0) return ignored;
  try {
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding —
    // `encoding: "buffer"` with `input` is rejected by Node.
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      input: paths.map(normalizePath).join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const p of out.toString("utf8").split("\0")) {
      if (p.length > 0) ignored.add(p);
    }
  } catch {
    // `git check-ignore` exits 1 when nothing matches — treat as none ignored.
  }
  return ignored;
}

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];
  walk(FIXTURE_ROOT, files, unscannable);
  walk(SRC_ROOT, files, unscannable);

  // One `git check-ignore` over both lists. An ignored entry is already out of
  // scope for the file route, so applying the same rule to a link keeps a single
  // boundary rather than inventing a second, stricter one for links alone.
  const ignored = gitIgnored([...files.map(normalizePath), ...unscannable.map((u) => u.path)]);

  refuseUnscannable(
    unscannable.filter((u) => !ignored.has(u.path)),
    "The walk can neither read such an entry nor vouch for what is on the other side of it.",
    "Remove it, replace it with a regular file, or (if it is genuinely not part of the " +
      "corpus) untrack it and add it to .gitignore.",
  );

  return files
    .filter((abs) => !ignored.has(normalizePath(abs)))
    .map((abs) => ({ path: normalizePath(abs), read: () => readFileSync(abs) }));
}

/**
 * Named-path mode. `lstat`, NOT `stat`: this route used to classify with
 * `statSync`, which dereferences, so a named link passed the `isFile()` test and
 * `readFileSync` then read the TARGET's bytes — including a target outside the
 * repository entirely.
 *
 * It never reported a false clean (it reported hits it found on the far side),
 * but it made the scanner's stated rule weaker than one of its routes, which
 * teaches the next reader the wrong invariant. A non-regular named path now
 * refuses through the same closed-set path as the other two routes.
 *
 * ▶ WHAT THIS DOES NOT DO, MEASURED: `lstat` answers for the FINAL component, so
 * a named path whose ANCESTOR is a symlink (`src/linkdir/payload.txt`) is still
 * followed and still read, and so is a plain absolute or `../` argument. Both
 * predate this change and neither is narrowed here. The all-mode walk over the
 * same tree DOES refuse that ancestor, so the two routes disagree about one
 * link — stated rather than closed, because closing it means realpath or
 * containment logic, which is a guard growing past the defect it fixes. Neither
 * commit-gating route reaches it.
 */
function buildTargetsForPaths(paths: string[]): Target[] {
  const unscannable: Unscannable[] = [];
  const targets: Target[] = [];
  for (const p of paths) {
    const abs = isAbsolute(p) ? p : resolve(REPO_ROOT, p);
    let st;
    try {
      // A DANGLING link lstats fine while `existsSync` (which follows) reads
      // false, so this ordering reports it as the link it is rather than as a
      // missing file.
      st = lstatSync(abs);
    } catch {
      throw new InvocationError(`File not found: ${p}`);
    }
    if (st.isFile()) {
      targets.push({ path: normalizePath(abs), read: () => readFileSync(abs) });
    } else if (st.isDirectory()) {
      // Pre-existing behaviour, kept verbatim: a named directory is an
      // invocation mistake, not an entry the scan must account for.
      throw new InvocationError(`Not a regular file: ${p}`);
    } else {
      unscannable.push({ path: normalizePath(abs), kind: entryKind(st) });
    }
  }

  refuseUnscannable(
    unscannable,
    "Naming such an entry does not let the scan vouch for what is on the other side of it.",
    "Name the regular file you mean instead.",
  );

  return targets;
}

/** git's file modes for a regular blob. Every other mode is not a file to read. */
const REGULAR_BLOB_MODES = new Set(["100644", "100755"]);

/**
 * Closed-set, engine-owned description of a staged record the route cannot read.
 * The STATUS is consulted first: an unmerged path's destination mode is `000000`
 * (there is no stage-0 entry at all), which the mode branch below would describe
 * as a bare number and which is not what is wrong with it.
 */
function gitEntryKind(status: string, mode: string): string {
  if (status === "U") return "an unmerged path, from a conflicted merge";
  if (mode === "120000") return "a symbolic link";
  if (mode === "160000") return "a gitlink (a nested repository)";
  return `a git mode-${mode} entry`;
}

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>` — the info half of a `--raw -z` record. */
const RAW_RECORD = /^:(?:\d{6}) (\d{6}) [0-9a-f]+ [0-9a-f]+ ([A-Z]\d*)$/;

function buildTargetsForStaged(): Target[] {
  let listBuf: Buffer;
  try {
    // SECURITY: array-form execFileSync, no shell. `--raw` rather than
    // `--name-only` because the DESTINATION MODE is the only thing that
    // distinguishes a staged regular file from a staged symlink or gitlink, and
    // `git show :<path>` answers all three without complaint.
    //
    // `T` (TYPECHANGE) IS IN THE FILTER, AND LEAVING IT OUT MAKES THE MODE CHECK
    // BELOW UNREACHABLE WHENEVER THE FILE WAS ALREADY TRACKED. Measured on this
    // repo's scanner: replacing a tracked `src/` file with a link printed
    // nothing under `--diff-filter=AM` while the unfiltered `--raw` printed
    // `:100644 120000 <sha> <sha> T`, so the record died before any mode could
    // be read and the hook passed the link green. Typechange carries a single
    // path, exactly like `A` and `M`, so admitting it costs the two-field
    // stride below nothing.
    //
    // `--no-renames` FOR THE SAME REASON, AND THE FILTER ALONE WAS NOT ENOUGH.
    // Rename detection is ON by default and `diff.renames` can turn copy
    // detection on too, so `git mv <link> src/<name>.ts` staged as
    // `:120000 120000 <sha> <sha> R100` with TWO paths, which `--diff-filter`
    // then deleted outright. Measured on this repo's scanner before this change:
    // `git mv notes/leak.txt src/leak.ts` over a link to a name-bearing payload
    // reported a clean scan and exited 0, with `git ls-files --stage` reading
    // `120000` on the destination; a rename of an ordinary PHI-bearing file into
    // the same scope passed identically. Turning detection off makes the
    // destination arrive as an ordinary single-path `A`
    // (`:000000 120000 0000000 <sha> A`) and the source a `D` the filter drops.
    // Re-measured here under `diff.renames=true|copies|false|1` and
    // `renameLimit=1`: every setting yields that same single-path `A`, so the
    // enumeration is a strict SUPERSET of the previous one and the two-field
    // stride below becomes STRUCTURAL rather than conditional on a caller's
    // config.
    //
    // `U` (UNMERGED) IS IN THE FILTER SO IT CAN BE REFUSED RATHER THAN DROPPED.
    // A conflicted path has no stage-0 entry, so `git show :<path>` answers
    // `fatal: path ... is in the index, but not at stage 0` and never content.
    // Under `--diff-filter=AMT` that record did not exist and the route reported
    // clean over a path whose conflicted side may carry PHI. It carries a single
    // path, exactly like `A`/`M`/`T`, so it costs the stride nothing. The status
    // is the only uniform thing about it: across six conflict flavours the
    // destination mode is always `000000` but the SOURCE mode and the set of
    // index stages both vary, which is why the kind is decided by status first.
    //
    // ▶ THE STRIDE CLAIM IS ABOUT THIS ARGV, NOT ABOUT `--no-renames` ALONE.
    // Measured: `--find-copies-harder` re-enables two-path `R`/`C` records even
    // when it appears BEFORE `--no-renames`, and a `-M`/`-C` appended after it
    // overrides it in the ordinary way. Neither is passed here and no config key
    // sets either. If you ever add an argument to this list, re-measure that no
    // record can carry a second path before assuming the stride still holds.
    listBuf = execFileSync(
      "git",
      ["diff", "--cached", "--raw", "-z", "--no-renames", "--diff-filter=AMTU"],
      {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (err) {
    throw new InvocationError(
      `git diff --cached failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // `--raw -z` emits `<info>\0<path>\0` per record. `R` (rename) and `C` (copy)
  // are the only statuses carrying a SECOND path, and `--no-renames` above means
  // git cannot emit either, so the stride is two fields. The regex still admits
  // a score-suffixed status: if one ever reached here the stride would desync
  // and the next record would fail to parse, which REFUSES: the same outcome as
  // any other unparseable record, and the safe one. A record that does not parse
  // REFUSES rather than being skipped: a silently shortened list is exactly the
  // shape this scan must never report clean over.
  const fields = listBuf.toString("utf8").split("\0");
  const staged: { path: string; mode: string; status: string }[] = [];
  let i = 0;
  while (i < fields.length) {
    const info = fields[i];
    if (info === undefined || info.length === 0) {
      i += 1;
      continue;
    }
    const m = RAW_RECORD.exec(info);
    const mode = m?.[1];
    const status = m?.[2];
    const path = fields[i + 1];
    if (mode === undefined || status === undefined || path === undefined || path.length === 0) {
      throw new InvocationError(
        "could not read the output of `git diff --cached --raw -z`: unrecognized record. " +
          "Refusing rather than scanning a list that may be short.",
      );
    }
    staged.push({ path, mode, status });
    i += 2;
  }

  const inScope = staged.filter(
    (s) =>
      s.path.startsWith("test/fixtures/") || (s.path.startsWith("src/") && s.path.endsWith(".ts")),
  );

  refuseUnscannable(
    inScope
      .filter((s) => s.status === "U" || !REGULAR_BLOB_MODES.has(s.mode))
      .map((s) => ({ path: s.path, kind: gitEntryKind(s.status, s.mode) })),
    "The index either holds such an entry by reference rather than as content, or holds no single " +
      "version of it at all, so nothing readable through it would be evidence about what it carries.",
    "Unstage it, resolve it, or replace it with a regular file.",
  );

  return inScope.map(({ path: relPath }) => ({
    path: relPath,
    // SECURITY: array-form execFileSync, no shell. `:<path>` is a git pathspec.
    read: (): Buffer =>
      execFileSync("git", ["show", `:${relPath}`], {
        encoding: "buffer",
        stdio: ["ignore", "pipe", "pipe"],
      }),
  }));
}

// ---------------------------------------------------------------------------
// Cross-cutting shape checks — the format-agnostic FLOOR
// ---------------------------------------------------------------------------

function scanCommonShapes(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Dashed SSN anywhere (a dashed \d{3}-\d{2}-\d{4} is always a hit).
  for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    hits.push({ path, segment: "(ssn)", value: m[0], reason: "dashed SSN pattern" });
  }
  // Emails whose domain is not an allow-listed reserved / test domain.
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (!allow.emailDomains.has(domain)) {
      hits.push({ path, segment: "(email)", value: m[0], reason: "email with non-test domain" });
    }
  }
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

function scanTarget(target: Target, allow: AllowList, hits: Hit[]): void {
  let buf: Buffer;
  try {
    buf = target.read();
  } catch (err) {
    throw new InvocationError(
      `could not read ${target.path}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  const text = buf.toString("utf8");

  // The format-agnostic floor: dashed SSN + non-test email. This runs on every
  // target and is all the starter detects.
  scanCommonShapes(target.path, text, allow, hits);

  // ── TODO: add Transform-specific structured field-level PHI detection here ──
  //
  //   The floor above ONLY catches SSN/email shapes. Before you rely on this
  //   scanner as a real safety gate you MUST add structured, field-level
  //   detection for Transform's PHI — at minimum: person NAMES, DATE OF BIRTH,
  //   MRN / MEMBER ID, ADDRESS, and PHONE — parsing `text` according to the
  //   Transform wire format and checking each PHI-bearing field against the
  //   allow-list (`allow.names` / `allow.dobs` / `allow.ids`), pushing a `Hit`
  //   for anything not positively declared synthetic.
  //
  //   Parse the format properly (delimiters / segments / elements / tags) — do
  //   NOT bolt on a blind text regex for names: coded values (`CBC^Complete
  //   Blood Count`, `Boston^MA`) produce false confidence. See the sibling
  //   parsers named in the STARTER banner at the top of this file for worked,
  //   spec-aware examples you can adapt:
  //
  //     const d = detectTransformDelimiters(text);          // if applicable
  //     for (const record of splitTransform(text, d)) {
  //       // check name / dob / id / address / phone fields against `allow`
  //       // hits.push({ path: target.path, segment: "<field>", value, reason });
  //     }
  //
  //   Until this section is implemented, treat a green `pnpm phi-scan` as
  //   "no SSN/email shapes found" — NOT as "no PHI".
  // ───────────────────────────────────────────────────────────────────────────
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    process.stdout.write("[phi-scan] OK — no hits\n");
    return;
  }
  const byPath = new Map<string, Hit[]>();
  for (const h of hits) {
    const arr = byPath.get(h.path);
    if (arr) arr.push(h);
    else byPath.set(h.path, [h]);
  }
  for (const [path, group] of byPath) {
    process.stderr.write(`[phi-scan] HIT: ${path}\n`);
    for (const h of group) {
      process.stderr.write(
        `  segment=${h.segment} value=${JSON.stringify(h.value)} (${h.reason})\n`,
      );
    }
  }
  process.stderr.write(
    `[phi-scan] ${String(hits.length)} hit(s) across ${String(byPath.size)} file(s). ` +
      `If a value is genuinely synthetic, declare it in scripts/phi-allow-list.txt OR ` +
      `run with --allow-fixture <path> AND log it in phi-scan-overrides.md.\n`,
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): number {
  let args: Args;
  try {
    args = parseArgs(process.argv.slice(2));
    validateAllowFixtures(args.allowFixtures);
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  const allow = loadAllowList();
  const allowed = new Set<string>(args.allowFixtures.map(normalizePath));

  let targets: Target[];
  try {
    if (args.mode === "staged") targets = buildTargetsForStaged();
    else if (args.mode === "paths") targets = buildTargetsForPaths(args.paths);
    else targets = buildTargetsForAll();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
      return 2;
    }
    throw err;
  }

  targets = targets.filter((t) => !allowed.has(t.path));

  const hits: Hit[] = [];
  for (const t of targets) {
    try {
      scanTarget(t, allow, hits);
    } catch (err) {
      if (err instanceof InvocationError) {
        process.stderr.write(`[phi-scan] ${err.message}\n`);
        return 2;
      }
      throw err;
    }
  }

  report(hits);
  return hits.length === 0 ? 0 : 1;
}

/**
 * The outermost net, and the reason it exists is an EXIT CODE, not a stack.
 * `loadAllowList()` runs outside every `try` in `main` and throws an
 * `InvocationError` when `scripts/phi-allow-list.txt` is missing; so did the
 * `readdirSync` in `walk` before the guard above. An uncaught throw exits **1**,
 * and 1 is this scanner's code for HITS FOUND, so "the scan could not run" was
 * indistinguishable from "the scan ran and found PHI", on the wrong side: a
 * caller that keys on the code would have read a broken gate as a working one
 * that fired. Every failure to complete now exits **2**.
 *
 * An unexpected throw still prints its stack, because a gate that swallows its
 * own bugs into a tidy sentence is harder to fix than one that does not.
 */
function run(): number {
  try {
    return main();
  } catch (err) {
    if (err instanceof InvocationError) {
      process.stderr.write(`[phi-scan] ${err.message}\n`);
    } else {
      process.stderr.write(
        `[phi-scan] refusing the scan: it failed before it could account for every in-scope ` +
          `entry.\n${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
      );
    }
    return 2;
  }
}

process.exit(run());

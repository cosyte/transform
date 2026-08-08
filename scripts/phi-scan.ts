#!/usr/bin/env tsx
/**
 * `@cosyte/transform` PHI scanner: the CI / pre-commit half of the PHI commit-gate.
 *
 * Pure Node. Zero runtime deps. `git` is the only subprocess, always via
 * `execFileSync` with array args (never shell-form). Walks the synthetic test
 * fixtures (and a conservative text pass over `src/`) and REFUSES anything that
 * looks like real PHI, so a developer cannot commit a real-looking fixture by
 * accident.
 *
 * ===========================================================================
 * ██  WHAT THIS DETECTS, AND WHAT IT STILL DOES NOT  ███████████████████████
 * ===========================================================================
 *
 *   TWO passes run on EVERY target, on ALL THREE ROUTES. The second is "in
 *   addition to" the first, never "instead of" it:
 *
 *   (1) THE CROSS-CUTTING FLOOR, which applies to any format:
 *         - a dashed Social Security Number   (\d{3}-\d{2}-\d{4})
 *         - an email at a non-allow-listed domain or address
 *
 *   (2) THE HL7 v2 STRUCTURED PASS, which is what this package's corpus
 *       actually carries. `@cosyte/transform` ships NO standalone `.hl7`
 *       fixture files at all: every message in the corpus is an inline `.ts`
 *       STRING LITERAL, so this pass finds segment literals ANYWHERE in a
 *       target's text rather than assuming the file IS the message.
 *
 *   ⚠  ENUMERATING MORE FILES BUYS THE FLOOR AND NOTHING ELSE. The floor finds
 *      ZERO in this repository's HL7 fixtures: they carry no dashed SSN and no
 *      email. Widening the walk without (2) would have opened 8 files full of
 *      names, DOBs and MRNs and reported every one of them clean. That is the
 *      false confidence this banner exists to refuse.
 *
 *   ══════════════════════════════════════════════════════════════════════════
 *   ▶ THE COVERAGE STATEMENT IS POSITIVE, AND THAT SHAPE IS THE POINT.
 *
 *   Two successive refuter passes measured an EXHAUSTIVE NEGATIVE LIST of "what
 *   this does not catch" incomplete, in the false-confidence direction, and the
 *   second measured it incomplete AGAIN after it had been extended in answer to
 *   the first. Seven PHI-bearing v2.5.1 fields reported clean while the list
 *   claimed to be authoritative: NK1-26 (mother's maiden name), NK1-31 (contact
 *   telephone), NK1-32 (contact address), NK1-37 (contact SSN), GT1-2
 *   (guarantor number), GT1-4 (guarantor spouse name) and IN1-49 (insured's id).
 *
 *   A negative list of that shape CANNOT be kept true: every clause of every
 *   segment of the standard would have to appear on it. So the claim is stated
 *   the only way that is checkable, as EXACTLY WHAT IS READ. Anything not named
 *   below IS NOT CHECKED, including but not limited to the seven fields above.
 *
 *       PID-3, PID-19, PID-20 ....... id / SSN / driver's licence
 *       PID-5, PID-6, PID-9 ......... name / mother's maiden name / alias
 *       PID-7 ....................... date of birth
 *       PID-11 ...................... address
 *       PID-13, PID-14 .............. home / business telephone
 *       NK1-2, NK1-30 ............... name / contact person's name
 *       NK1-4 ....................... address
 *       NK1-5, NK1-6 ................ telephone
 *       NK1-16 ...................... date of birth
 *       NK1-33 ...................... next-of-kin identifiers
 *       GT1-3 ....................... guarantor name
 *       GT1-5 ....................... guarantor address
 *       GT1-6, GT1-7 ................ guarantor telephone
 *       GT1-8 ....................... guarantor date of birth
 *       GT1-12, GT1-19 .............. guarantor SSN / employee id
 *       IN1-16, IN1-18, IN1-19 ...... insured name / DOB / address
 *       IN1-36 ...................... insured's policy identifier
 *
 *   NO OTHER SEGMENT IS READ AT ALL: not PV1, ORC, OBR, OBX, RXA, SCH, TXA, and
 *   not MSH. NO OTHER FIELD of the four segments above is read. Within a field,
 *   only the components named in each `check…Field` are read.
 *
 *   ▶ PROVENANCE, SAID PLAINLY BECAUSE ITS ABSENCE WAS THE ROOT CAUSE OF A
 *   MEASURED DEFECT. The field numbers are asserted from HL7 v2.5.1 (PID and
 *   NK1 in Chapter 3, GT1 and IN1 in Chapter 6) and were cross-corroborated
 *   in-repo only, against `src/messages/related-person.ts` and the vendored
 *   `@cosyte/hl7` type surface. **They were NOT checked against a published copy
 *   of the standard.** One of them was wrong on the way here: IN1-17 shipped as
 *   a telephone field and is in fact Insured's Relationship To Patient, so a
 *   SNOMED code was reported as a phone number. That is why the table is
 *   deliberately narrow, why it is stated positively, and why widening it means
 *   citing a source rather than adding a number.
 *   ══════════════════════════════════════════════════════════════════════════
 *
 *   ⚠  FOUR THINGS THE PASS CANNOT SEE EVEN INSIDE THE FIELDS IT READS. These
 *      are properties of the recogniser rather than of the table above:
 *        - a value injected by TEMPLATE INTERPOLATION (`${…}`) into a segment
 *          literal. A static text scan cannot see what a placeholder resolves
 *          to; such a component is skipped rather than guessed at.
 *        - a segment written with a NON-DEFAULT field or component separator.
 *          The pass keys on `SEG|` and splits on `^` / `~` / `&`, the v2 default
 *          and what this corpus uses; MSH-1 and MSH-2 are not consulted.
 *        - a NAME COMPONENT THAT IS ONE CHARACTER, so a middle initial is below
 *          the token floor. Raising it competes with the one- and two-letter
 *          CODE values that share those component positions.
 *        - A LITERAL BACKSLASH FOLLOWED BY `r` OR `n` INSIDE A FIELD VALUE ENDS
 *          THE SEGMENT EARLY, because the escaped separator is also the
 *          terminator. Measured: a Windows path in PID-11 truncates there, so
 *          PID-13 and PID-14 go unread. It can only SHORTEN a segment, NEVER
 *          RENUMBER one, since the fields before the cut keep their positions.
 *          **BUT THE FIELD IT CUTS IN CAN GO SILENT TOO**, and an earlier draft
 *          of this line claimed otherwise: the surviving prefix reports only if
 *          it still clears a recogniser floor, so a cut before the digits of a
 *          phone, or inside a family name, loses that field AND everything after
 *          it. Not decidable from static text, so disclosed rather than guessed.
 *
 *      Anything inside a BINARY or compressed target is unreadable to both
 *      passes: they decode as UTF-8, and a name inside a gzip stream survives.
 *
 *      ▶ TWO ENTRIES THAT USED TO BE ON A NEGATIVE LIST WERE FIXED RATHER THAN
 *      DISCLOSED, because both were reachable and both reported CLEAN: a name
 *      component outside ASCII (`García`, `Nguyễn`), and a whole message pasted
 *      into ONE literal with ESCAPED `\r` separators. Do not re-narrow either.
 *
 *   Worked examples of structured, format-aware detection live in the sibling
 *   parsers:
 *       ../hl7/scripts/phi-scan.ts     (segment → field → component aware)
 *       ../x12/scripts/phi-scan.ts     (ISA-delimited NM1 / DMG / PER aware)
 *       ../dicom/scripts/phi-scan.ts   (binary tag-aware)
 *       ../ccda/scripts/phi-scan.ts    (XML element aware)
 *       ../ncpdp/scripts/phi-scan.ts   (fixed-field aware)
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`): a positive declaration that a
 *   fixture's identifiers are fake. Byte-strict formats cannot carry an inline
 *   `# synthetic: true` header, so the allow-list is the proven substitute
 *   (same approach every sibling uses). A whole-file bypass needs
 *   `--allow-fixture <path>` AND a logged entry in `phi-scan-overrides.md`.
 *
 *   ▶ AN ALLOW-LIST ENTRY IS GLOBAL AND ROUTE-BLIND. It clears that literal on
 *     the commit-blocking `--staged` route too, and on `<path>`. Adding one is
 *     therefore a subtraction from every route at once, and the one entry here
 *     that subtracts a detection this scanner had BEFORE this change is called
 *     out by name in `scripts/phi-allow-list.txt`.
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
 *   - all-mode printed "OK: no hits" and exited 0. The walk enumerates
 *     `Dirent.isFile()`, which is an lstat answer, so a symbolic link is neither
 *     a file nor a directory and fell out of the loop whatever it pointed at.
 *     A linked DIRECTORY takes its whole subtree with it for the same reason.
 *   - `--staged` printed "OK: no hits" and exited 0 over the same link staged.
 *     That route reads content with `git show :<path>`, and git stores a
 *     symbolic link as its TARGET PATH under mode 120000 (`git ls-files --stage`
 *     read `120000` on it), so it is handed the path text, never the target's
 *     bytes.
 *
 * The third mode, a named `<path>`, was not blind: it classified with
 * `statSync`, which DEREFERENCES, so it read the target's bytes and reported
 * hits it found there. That is a false-clean-free route and still wrong: the
 * bytes could be outside the repository. It lstats too now.
 *
 * ▶ SCOPE THAT EXACTLY, BECAUSE A LOOSER WORDING OF IT WAS MEASURED FALSE TWICE.
 * The rule is: EVERY ENTRY THE SCAN ENUMERATES, AND EVERY PATH NAMED DIRECTLY,
 * IS REFUSED IF IT IS NOT A REGULAR FILE. It is NOT "the scanner follows
 * nothing". `lstat` answers for the FINAL path component only, so a named path
 * whose ANCESTOR component is a symlink is still followed and still reads bytes
 * from wherever that ancestor lands, as does a plain absolute or `../`
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
 * "In scope" is each route's own boundary: the walk still excludes a gitignored
 * entry (the same rule that already excludes a gitignored file, so links do not
 * get a second, stricter boundary of their own). The refusal narrows what those
 * scopes ADMIT; it does not widen the scopes. The walk has NO extension scope of
 * its own, so a link at `src/leak.json`, and a linked directory, are refused
 * there too.
 *
 * ---------------------------------------------------------------------------
 * THE SCAN SCOPE IS THE TRACKED CORPUS, AND IT IS RECONCILED AGAINST `git
 * ls-files` ON EVERY RUN. Both enumerating routes used to cover `test/fixtures/`
 * plus `src/`, and MEASURED ON THIS REPOSITORY AT `daf75c3`, THAT WAS 31 OF 102
 * TRACKED FILES: 71 were read by NEITHER ROUTE, 27 of them under `test/`,
 * 8 of those carrying inline HL7 `PID|` literals with names, DOBs and MRNs.
 *
 * ▶ AND THE SHARPEST HALF: `test/fixtures/` HAS NEVER EXISTED IN THIS
 * REPOSITORY, ON ANY COMMIT (`git log --all -- 'test/fixtures*'` is empty). The
 * walk's `existsSync` guard returned immediately for it on every run this
 * scanner has ever made, and the run still printed "OK: no hits" and exited 0.
 * A DECLARED ROOT THAT WAS NEVER OPENED IS INDISTINGUISHABLE FROM A CLEAN ONE.
 *
 * ▶ A COUNT DOES NOT DETECT THAT, AND NEITHER DOES AN EXISTENCE CHECK. "145
 * files scanned" counts the roots that DID exist, and refusing a MISSING root
 * still leaves an EMPTIED one reporting clean. The only thing that observes it
 * is reconciling what the walk actually OPENED against what git actually
 * TRACKS, which `reconcileWithGit` does in all-mode. Every tracked path the walk
 * did not open REFUSES (exit 2) and is named.
 *
 * ▶ WHAT THE RECONCILIATION DOES NOT CLOSE, AND NO REPO IN THIS ECOSYSTEM HAS:
 * IT COMPARES PATH SETS, NOT THE BYTES GIT CARRIES AT THOSE PATHS. A root
 * swapped for a directory that mirrors the tracked NAMES still reconciles, over
 * decoy contents. Widening the roots makes that narrower rather than closed: a
 * decoy must now mirror 100 names, not 7. It is also VACUOUS ON AN EMPTY INDEX,
 * which is why the suite's throwaway repos still exercise the other guards.
 *
 * ▶ A WALK ROOT THAT IS NOT A DIRECTORY REFUSES BEFORE THE WALK. `existsSync`
 * FOLLOWS a link, so a DANGLING root read false and `walk` returned without
 * enumerating anything: measured here, `ln -s /nowhere test/fixtures` printed
 * "OK: no hits" and exited 0. A root that is a symlink to a real directory was
 * FOLLOWED, reading bytes git does not carry. Both now refuse with 2 via an
 * `lstat` per declared root. A root that is simply ABSENT is not an error (a
 * tree may legitimately not have one); the reconciliation is what notices if
 * anything tracked lived under it.
 *
 * EXIT CODE FOR A REGULAR-FILE ROOT, DERIVED FROM THIS SCRIPT'S OWN CONTRACT AND
 * NOT PORTED FROM A SIBLING: **2**. Measured before this change, `existsSync`
 * answered true and `readdirSync` threw `ENOTDIR` into the `walk` catch, which
 * raises an `InvocationError` and returns 2 from `main`. It is 2 for the new
 * `lstat` preflight too, so the code did not move.
 * ---------------------------------------------------------------------------
 *
 * THE STAGED ROUTE READS `--raw`, AND ITS `--diff-filter` ADMITS `T`. Replacing
 * a TRACKED regular file with a link is neither an add nor a modify: measured
 * here, `git diff --cached --raw --diff-filter=AM` printed NOTHING for that
 * change while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T`.
 * Under an `AM` filter the record dies before any mode can be read and the hook
 * passes a mode-120000 blob green. Admitting `T` also covers the reverse
 * typechange: a tracked link replaced by a real file bearing PHI, which is a
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
 * tree and can itself carry PHI: a target path of the shape
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

/**
 * Directories walked in "all" mode, plus the repo-root regular files, which are
 * enumerated separately by `walkTopLevel` (a root file has no directory to
 * declare). Together these cover the whole tracked corpus, which is what
 * `reconcileWithGit` then proves on every run.
 *
 * ▶ ROOTS MUST STAY DISJOINT. `test` covers `test/fixtures` rather than sitting
 * beside it: declaring both would report every nested file twice.
 *
 * ▶ WIDEN BY UNION, NEVER BY REPLACEMENT. Each entry here is "in addition to";
 * the previous list (`test/fixtures` + `src`) is a strict SUBSET of this one, so
 * nothing the walk opened before can stop being opened.
 *
 * ▶ `vendor/` IS DELIBERATELY ABSENT. It holds two `pnpm pack` gzip tarballs of
 * sibling packages, and see `RECONCILE_EXEMPT` for why a text scan over gzip
 * bytes is neither a detection nor a clearance.
 */
const WALK_ROOT_NAMES = [
  ".changeset",
  ".github",
  "docs-content",
  "documentation",
  "scripts",
  "src",
  "test",
] as const;

const WALK_ROOTS = WALK_ROOT_NAMES.map((name) => join(REPO_ROOT, name));

/**
 * The tracked paths `reconcileWithGit` excuses, as LITERAL PATHS.
 *
 * ▶ THREE RULES, AND EACH WAS PAID FOR ELSEWHERE IN THIS ECOSYSTEM:
 *   1. A literal path, NEVER a predicate. A predicate reads as a tidy rule and
 *      then applies to files nobody enumerated when they wrote it.
 *   2. It reaches the ALL route only. `--staged` is the commit-blocking
 *      pre-commit gate and exempts nothing; `<path>` scans exactly what it is
 *      handed, so `pnpm phi-scan vendor/<tarball>` still reads those bytes and
 *      still reports what it finds. NO DETECTION EITHER ROUTE HAD IS
 *      SUBTRACTED.
 *   3. It is enumerated here in source, so adding one is a reviewed act and a
 *      diff, never a silently-widening glob.
 *
 * WHY THESE TWO: they are gzip archives. Their bytes are not the text they
 * carry, so scanning them is neither a detection nor a clearance: a name inside
 * one is compressed and unreadable to any text pass, and a clean result over
 * them would be evidence of nothing. Both are `pnpm pack` outputs of sibling
 * `@cosyte/*` repositories, each gated by its own PHI scanner at its own source.
 * Measured here before this change, the fhir tarball produced exactly one hit:
 * seven bytes of DEFLATE output that happen to match the email shape, and that
 * change with every repack. It is written as a shape rather than quoted,
 * because this file is inside the scan's own corpus and a quoted violator here
 * would red the gate on every run.
 *
 * ▶ IF `pnpm vendor:refresh` EVER RENAMES A TARBALL, THIS LIST GOES STALE AND
 * THE GATE REFUSES (exit 2) NAMING THE NEW PATH. That is the safe direction and
 * it is deliberate: the remedy is to update this list, never to loosen it into a
 * `vendor/**` pattern. The names are pinned in `scripts/vendor-refresh.sh`.
 */
const RECONCILE_EXEMPT = new Set(["vendor/cosyte-fhir-0.0.0.tgz", "vendor/cosyte-hl7-0.0.0.tgz"]);

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
  /** Uppercase synthetic person-name tokens, consumed by the XPN name check. */
  names: Set<string>;
  /** Synthetic dates of birth, normalized to the leading 8 digits of a v2 TS. */
  dobs: Set<string>;
  /** Uppercase synthetic id values (SSN / MRN / member-id shapes). */
  ids: Set<string>;
  /** Uppercase synthetic address components (street, city, postal code). */
  addresses: Set<string>;
  /** Synthetic phone values, compared on their digits only. */
  phones: Set<string>;
  /** Allowed email domains: every address at one of these passes. */
  emailDomains: Set<string>;
  /**
   * Allowed email ADDRESSES, keyed `<repo-relative path>\0<lowercased address>`.
   *
   * ▶ TWO LITERALS, AND THE PATH HALF IS THE POINT. An `EMAILDOMAIN` entry
   * excuses a whole domain everywhere; an unscoped address entry excuses one
   * mailbox everywhere. This excuses ONE mailbox in ONE file, which is the
   * narrowest instrument this allow-list has. The same address in any other
   * file, and any other address in the same file, both still report.
   *
   * It is still route-blind within that file, which is a property of the
   * allow-list rather than of this tag: an entry clears its literal on the walk,
   * on `<path>`, and on the commit-blocking `--staged`. That cost is stated in
   * `scripts/phi-allow-list.txt` beside the entry and pinned by tests. The
   * entries themselves live in that file; quoting one here would put a live
   * address in a file the scan reads.
   */
  emails: Set<string>;
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
  // scan, never a scan target on its own, so it also seeds the positional path
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

/**
 * The key an `EMAIL` allow-list entry is stored and looked up under. A path and
 * an address, joined by a byte neither can contain, so a path ending in the
 * address's first characters cannot be confused for a different entry.
 */
function emailKey(path: string, address: string): string {
  return `${path}\u0000${address.toLowerCase()}`;
}

function loadAllowList(): AllowList {
  if (!existsSync(ALLOW_LIST_PATH)) {
    throw new InvocationError(`allow-list not found at ${ALLOW_LIST_PATH}`);
  }
  const raw = readFileSync(ALLOW_LIST_PATH, "utf8");
  const names = new Set<string>();
  const dobs = new Set<string>();
  const ids = new Set<string>();
  const addresses = new Set<string>();
  const phones = new Set<string>();
  const emailDomains = new Set<string>();
  const emails = new Set<string>();
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
      case "ADDRESS":
        addresses.add(value.toUpperCase());
        break;
      case "PHONE":
        phones.add(digitsOf(value));
        break;
      case "EMAILDOMAIN":
        emailDomains.add(value.toLowerCase());
        break;
      case "EMAIL": {
        // `EMAIL <repo-relative path> <address>`. Both halves are required: an
        // entry with no path is REFUSED rather than read as a global clearance,
        // because the looser reading is the one that silently excuses a mailbox
        // in a file nobody had in mind when they wrote the line.
        const gap = value.indexOf(" ");
        if (gap < 0) {
          throw new InvocationError(
            `allow-list: an EMAIL entry needs a path and an address ("EMAIL <path> <address>"), got: ${value}`,
          );
        }
        const scope = value.slice(0, gap).trim();
        const address = value.slice(gap + 1).trim();
        if (scope.length === 0 || address.length === 0) {
          throw new InvocationError(
            `allow-list: an EMAIL entry needs a path and an address ("EMAIL <path> <address>"), got: ${value}`,
          );
        }
        emails.add(emailKey(normalizePath(scope), address));
        break;
      }
      default:
        break;
    }
  }
  return { names, dobs, ids, addresses, phones, emailDomains, emails };
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
      // ▶ THE `*.md` SKIP THAT USED TO SIT HERE IS GONE, AND ITS REMOVAL IS
      // PURELY ADDITIVE, AND THE COUNT IT USED TO CARRY WAS WRONG TWICE. Under the
      // OLD roots the skip dropped **ZERO** files: `src/` holds no markdown and
      // `test/fixtures/` never existed, so it was dead code. Under the widened
      // roots it would drop **15**, which is the only reason removing it matters
      // at all, and it is why the two figures published before (16, then 14)
      // were both counts of something else. The skip existed on the argument
      // that documentation may legitimately describe violator values. Two
      // things were wrong with that.
      // First, it was an ENUMERATION-time judgement standing in for a
      // CONTENT-time one: the allow-list already exists to say "this literal is
      // synthetic", by value and under review, which a filename cannot. Second,
      // it was never true of the other routes: `pnpm phi-scan notes.md` ran the
      // same content passes at base and reported what it found, so the skip made
      // the two routes disagree about the same bytes. Measured over this repo's
      // tracked corpus, opening all 15 produced ZERO new hits.
      out.push(full);
    } else {
      unscannable.push({ path: normalizePath(full), kind: entryKind(e) });
    }
  }
}

/**
 * Enumerate the REGULAR FILES sitting directly at the repository root. They have
 * no directory of their own to declare as a walk root, and there are 14 of them
 * tracked here (`package.json`, `README.md`, every config file), so leaving them
 * out would leave the reconciliation permanently red for no reason.
 *
 * Directories are skipped rather than descended: the declared roots above own
 * that, and descending from here would double-report every file under them.
 * Non-regular entries are collected exactly as they are inside a root.
 */
function walkTopLevel(out: string[], unscannable: Unscannable[]): void {
  let entries;
  try {
    entries = readdirSync(REPO_ROOT, { withFileTypes: true });
  } catch (err) {
    const code = err instanceof Error && "code" in err ? String(err.code) : "unknown";
    throw new InvocationError(
      `refusing the scan: could not read the repository root (${code}). ` +
        `The walk cannot vouch for entries it was never able to enumerate.`,
    );
  }
  for (const e of entries) {
    if (e.isDirectory()) continue;
    // ▶ `.git` IS A REGULAR FILE IN A SUBMODULE WORKING TREE, not a directory,
    // and this repository IS consumed as one. Measured here: without this line
    // the walk opened `.git` and read the `gitdir:` pointer inside it. That is
    // git's own metadata, not corpus, it is never tracked, and in a plain clone
    // it is a directory the branch above already skips, so admitting it made the
    // scan's behaviour differ between a clone and a submodule for no gain. A
    // LITERAL name, never a dot-file predicate: `.gitignore`, `.npmrc` and
    // `.gitattributes` are corpus and stay in scope.
    if (e.name === ".git") continue;
    const full = join(REPO_ROOT, e.name);
    if (e.isFile()) out.push(full);
    else unscannable.push({ path: normalizePath(full), kind: entryKind(e) });
  }
}

/**
 * `lstat` each declared root BEFORE walking it, and refuse anything that is not
 * a directory.
 *
 * ▶ THE CASE THIS EXISTS FOR IS A DANGLING LINK, AND `existsSync` IS WHY IT WAS
 * INVISIBLE: `existsSync` FOLLOWS, so it answers FALSE for a link pointing at
 * nothing, `walk` returned on its first line, and the run printed "OK: no hits"
 * and exited 0 with the whole corpus off the disk. Measured on this scanner.
 * A root that is a symlink to a REAL directory was the other half: it was
 * followed, so the scan read bytes from wherever the link landed and called them
 * the corpus.
 *
 * A root that is simply ABSENT is NOT refused here. A tree may legitimately not
 * have one, and refusing existence is not the same as observing content:
 * `reconcileWithGit` is what notices that something tracked lived under it.
 */
function refuseNonDirectoryRoots(roots: string[]): void {
  const bad: Unscannable[] = [];
  for (const root of roots) {
    let st;
    try {
      st = lstatSync(root);
    } catch (err) {
      // ONLY a genuine absence is excused. Any other `lstat` failure (`EACCES`
      // on the parent, `ELOOP`, `ENAMETOOLONG`) is a root the walk cannot
      // account for, and swallowing all of them as "absent" would be the same
      // shape as the missing-root false clean this preflight exists to close.
      const code = err instanceof Error && "code" in err ? String(err.code) : "unknown";
      if (code === "ENOENT") continue;
      bad.push({ path: normalizePath(root), kind: `unreadable (${code})` });
      continue;
    }
    if (st.isDirectory()) continue;
    bad.push({
      path: normalizePath(root),
      kind: st.isFile() ? "a regular file where a directory is declared" : entryKind(st),
    });
  }
  refuseUnscannable(
    bad,
    "A declared scan root that is not a directory is a root the walk cannot open, and an " +
      "unopened root reads exactly like a clean one.",
    "Restore the directory, or remove the root from WALK_ROOT_NAMES in this script.",
  );
}

/**
 * Reconcile what the all-mode walk actually OPENED against what git actually
 * TRACKS, and refuse (exit 2) over every tracked path that was not opened.
 *
 * ▶ EXISTENCE IS NOT OBSERVATION, AND A COUNT CANNOT SUBSTITUTE FOR THIS. A file
 * count counts the roots that DID exist, so a healthy-looking total says nothing
 * about a root that was never opened. Refusing a MISSING root only covers half
 * the failure too, because an EMPTIED one opens nothing and reports clean.
 * Comparing the opened set to `git ls-files` is the only check that observes
 * either, and it also catches a stale `WALK_ROOT_NAMES` after a directory is
 * added.
 *
 * ▶ WHAT IT DOES NOT DO, STATED RATHER THAN IMPLIED: it compares PATH SETS, not
 * the bytes git carries at those paths. A root replaced by a directory that
 * mirrors the tracked NAMES reconciles cleanly over decoy contents. It is also
 * VACUOUS ON AN EMPTY INDEX: with nothing tracked there is nothing to reconcile
 * against, so this proves nothing in a fresh tree, and the walk's own refusals
 * are what still hold there.
 *
 * ▶ NEVER RE-ADD A `tracked.has(...)` PRE-CHECK IN FRONT OF A READ. That inverts
 * the direction of the evidence: it would make the walk agree with git by
 * construction, at zero firings, while this comment sold it as protection.
 */
function reconcileWithGit(opened: Set<string>): void {
  let out: string;
  try {
    // SECURITY: array-form execFileSync, no shell.
    out = execFileSync("git", ["ls-files", "-z"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    throw new InvocationError(
      `refusing the scan: could not list tracked files (${err instanceof Error ? err.message : String(err)}). ` +
        `Without git's index there is nothing to reconcile the walk against.`,
    );
  }
  const missing = out
    .split("\0")
    .filter((p) => p.length > 0)
    .filter((p) => !opened.has(p) && !RECONCILE_EXEMPT.has(p));
  if (missing.length === 0) return;
  const lines = missing.map((p) => `  - ${p}`).join("\n");
  const noun = missing.length === 1 ? "tracked file was" : "tracked files were";
  throw new InvocationError(
    `refusing the scan: ${String(missing.length)} ${noun} never opened by the walk:\n${lines}\n` +
      `A declared root that is missing, emptied or replaced looks exactly like a clean one, so ` +
      `the walk is reconciled against git's index rather than trusted.\n` +
      `Read the paths before reaching for a remedy, because the commonest cause is not a scope ` +
      `problem at all: a tracked file DELETED from the working tree but not from the index reports ` +
      `here, and the fix is to restore it or to stage the deletion. Only if the path is genuinely ` +
      `outside every scan root should you add its directory to WALK_ROOT_NAMES, and only if it ` +
      `genuinely cannot be scanned should you add that literal path to RECONCILE_EXEMPT with the ` +
      `reason written down. Widening RECONCILE_EXEMPT is the last resort, never the first.`,
  );
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
    // SECURITY: array-form execFileSync, no shell. Default (Buffer) encoding:
    // `encoding: "buffer"` with `input` is rejected by Node.
    const out = execFileSync("git", ["check-ignore", "--stdin", "-z"], {
      input: paths.map(normalizePath).join("\0"),
      stdio: ["pipe", "pipe", "ignore"],
    });
    for (const p of out.toString("utf8").split("\0")) {
      if (p.length > 0) ignored.add(p);
    }
  } catch {
    // `git check-ignore` exits 1 when nothing matches: treat as none ignored.
  }
  return ignored;
}

function buildTargetsForAll(): Target[] {
  const files: string[] = [];
  const unscannable: Unscannable[] = [];

  refuseNonDirectoryRoots(WALK_ROOTS);
  for (const root of WALK_ROOTS) walk(root, files, unscannable);
  walkTopLevel(files, unscannable);

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

  const opened = files.map(normalizePath).filter((p) => !ignored.has(p));

  // The reconciliation runs on the OPENED set, after every filter above, so a
  // tracked file dropped by any of them is named rather than assumed.
  reconcileWithGit(new Set(opened));

  return opened.map((rel) => ({
    path: rel,
    read: () => readFileSync(join(REPO_ROOT, rel)),
  }));
}

/**
 * Named-path mode. `lstat`, NOT `stat`: this route used to classify with
 * `statSync`, which dereferences, so a named link passed the `isFile()` test and
 * `readFileSync` then read the TARGET's bytes, including a target outside the
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
 * link: stated rather than closed, because closing it means realpath or
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

/**
 * The `--staged` route's path scope, and it is a STRICT SUPERSET of the one it
 * replaces.
 *
 * BEFORE: `test/fixtures/**` OR `src/**.ts`. Both are contained here
 * (`test/fixtures/x` is under the `test` root; `src/x.ts` is under the `src`
 * root, and the `.ts` suffix requirement is DROPPED rather than kept, so
 * `src/leak.json` is admitted too), which is what makes this widening additive:
 * nothing the pre-commit hook blocked before can stop being blocked.
 *
 * ▶ THIS ROUTE EXEMPTS NOTHING. `RECONCILE_EXEMPT` is an all-route concept and
 * is deliberately not consulted here: `--staged` IS the commit gate, and a
 * corpus exemption that reaches it SUBTRACTS a detection at exactly the moment
 * the gate is meant to fire. `vendor/` is simply outside this scope, as it was
 * before, so no staged detection changes there either.
 *
 * A repo-root file (no `/` in its path) is admitted, matching `walkTopLevel`.
 */
function stagedRouteAdmits(path: string): boolean {
  if (!path.includes("/")) return true;
  const top = path.slice(0, path.indexOf("/"));
  return (WALK_ROOT_NAMES as readonly string[]).includes(top);
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

/** `:<srcmode> <dstmode> <srcsha> <dstsha> <status>`: the info half of a `--raw -z` record. */
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

  const inScope = staged.filter((s) => stagedRouteAdmits(s.path));

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
// Cross-cutting shape checks: the format-agnostic FLOOR
// ---------------------------------------------------------------------------

function scanCommonShapes(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  // Dashed SSN anywhere (a dashed \d{3}-\d{2}-\d{4} is always a hit).
  for (const m of content.matchAll(/\b\d{3}-\d{2}-\d{4}\b/g)) {
    hits.push({ path, segment: "(ssn)", value: m[0], reason: "dashed SSN pattern" });
  }
  // Emails whose domain is not an allow-listed reserved / test domain, and whose
  // full address is not itself allow-listed. The address check is the narrower
  // of the two by construction and exists so a single known mailbox can be
  // declared without excusing its whole domain.
  for (const m of content.matchAll(/\b[A-Za-z0-9._%+-]+@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g)) {
    const domain = (m[1] ?? "").toLowerCase();
    if (allow.emailDomains.has(domain)) continue;
    if (allow.emails.has(emailKey(path, m[0]))) continue;
    hits.push({ path, segment: "(email)", value: m[0], reason: "email with non-test domain" });
  }
}

// ---------------------------------------------------------------------------
// The HL7 v2 structured pass: field- and component-level PHI
// ---------------------------------------------------------------------------
//
// ▶ THIS PASS DOES NOT ASSUME THE FILE IS THE MESSAGE, AND THAT IS THE WHOLE
// POINT HERE. `@cosyte/transform` ships no standalone `.hl7` fixture at all:
// every message in its corpus is a `.ts` STRING LITERAL, usually one segment per
// array element. A recogniser written the usual way, parsing a target as a
// document, would find nothing in any of them. So segment literals are located
// ANYWHERE in the text and each is read from its segment id to the end of the
// line or to the closing quote of the literal it sits in, whichever comes first.
//
// ▶ AND THE FLOOR FINDS NOTHING IN THAT CORPUS, WHICH IS WHY THIS PASS SHIPS
// WITH THE WIDER WALK RATHER THAN AFTER IT. Measured over the 8 tracked files
// carrying `PID|`: zero dashed SSNs and zero emails between them. What they
// carry is names, DOBs, MRNs, one undashed SSN in an `SS`-typed identifier, one
// street address and two phone numbers, and the floor is blind to every one.

// ▶ EVERY FIELD NUMBER BELOW IS FROM HL7 v2.5.1, AND THE CLAUSE IS CITED BECAUSE
// AN UNCITED TABLE IS WHAT PRODUCES A WRONG ONE. PID is Chapter 3 §3.4.2, NK1
// Chapter 3 §3.4.5, PV1 Chapter 3 §3.4.3, GT1 Chapter 6 §6.5.4 and IN1 Chapter 6
// §6.5.6. Measured cost of not citing them: a first draft of this table mapped
// **IN1-17 as a telephone field**. IN1-17 is *Insured's Relationship To Patient*
// (CE, table 0063), so a SNOMED relationship code was reported as a phone
// number, and the remedy that diagnostic steered a developer toward was a global
// `PHONE` clearance of that digit string. **IN1 carries no insured telephone at
// all**: IN1-7 is the PAYER's number, an organisation's, so `IN1` is absent from
// `PHONE_FIELDS` deliberately rather than by omission.

/** PHI-bearing fields per segment, by v2 field number (`PID-5` is index 5). */
const NAME_FIELDS: Record<string, number[]> = {
  PID: [5, 6, 9],
  NK1: [2, 30],
  GT1: [3],
  IN1: [16],
};
const DOB_FIELDS: Record<string, number[]> = {
  PID: [7],
  NK1: [16],
  GT1: [8],
  IN1: [18],
};
const ID_FIELDS: Record<string, number[]> = {
  PID: [3, 19, 20],
  NK1: [33],
  GT1: [12, 19],
  IN1: [36],
};
const ADDRESS_FIELDS: Record<string, number[]> = {
  PID: [11],
  NK1: [4],
  GT1: [5],
  IN1: [19],
};
const PHONE_FIELDS: Record<string, number[]> = {
  PID: [13, 14],
  NK1: [5, 6],
  GT1: [6, 7],
  // IN1 is absent on purpose: see the citation note above.
};

const PHI_SEGMENTS = Object.keys(NAME_FIELDS);

/**
 * Locate a segment literal by its `SEG|` opening. The leading boundary keeps
 * `PID-3` in prose and `xPID|` in an identifier from matching; only a real
 * segment id immediately followed by the default field separator qualifies.
 *
 * ▶ THE `\\r` / `\\n` ALTERNATIVE IS NOT DECORATION, AND IT WAS A MEASURED
 * SILENT MISS. A v2 message pasted into a TypeScript literal in one piece writes
 * its segment terminator as the ESCAPE `\\r`, so the character immediately before
 * `PID|` is the letter `r`, which `[^A-Za-z0-9]` rejects. Measured before this
 * alternative was added: a whole ADT in one literal, carrying a name, a DOB, an
 * MRN, an address and two phone numbers across PID and NK1, scanned
 * `OK: no hits` at exit 0, while the identical message written one segment per
 * array element produced 8 hits. That is the OTHER way a `.ts` file carries a
 * message here, and it is exactly the shape `parseHL7(raw)` consumes. Purely
 * additive: it only adds places a segment can start.
 */
const SEGMENT_OPENING = new RegExp(
  `(?:^|\\\\[rn]|[^A-Za-z0-9])(${PHI_SEGMENTS.join("|")})\\|`,
  "g",
);

/** Digits only, so `555-1234`, `(555) 1234` and `5551234` compare equal. */
function digitsOf(value: string): string {
  return value.replace(/\D+/g, "");
}

/**
 * A component the pass declines to judge because its value is not in the text.
 * A template placeholder resolves at runtime, and a static scan that guessed at
 * one would be fabricating either a hit or a clearance.
 */
function isInterpolated(component: string): boolean {
  return component.includes("${");
}

/** XPN / XCN family-name components carry `&`-separated subcomponents. */
function firstSubcomponent(component: string): string {
  const amp = component.indexOf("&");
  return amp < 0 ? component : component.slice(0, amp);
}

/**
 * A component plausible as a written person name. Coded values (`CBC^Complete
 * Blood Count`), name-type codes (`L`, `ZZ` in XPN-7) and empty components are
 * excluded by shape rather than by position, because the position rules above
 * already restrict which components are read at all.
 */
function looksLikeNameToken(component: string): boolean {
  // ▶ UNICODE LETTERS, NOT `[A-Za-z]`, AND THAT WAS A MEASURED SILENT MISS. An
  // ASCII-only class reports a name it cannot spell as CLEAN rather than as
  // unrecognised, so `Garcia` hit while the same name written with its accent
  // exited 0, as did every name in a non-Latin script. A gate that is blind to
  // exactly the names least likely to be synthetic is worse than no gate.
  // `\p{L}` excludes digits, so a coded value stays out; combining marks are
  // admitted so a decomposed accent does not split a token.
  return /^\p{L}[\p{L}\p{M}'\-. ]+$/u.test(component) && component.trim().length > 1;
}

function fieldsOf(segment: string): string[] {
  return segment.split("|");
}

function componentsOf(field: string): string[] {
  return field.split("^");
}

/** CX and XPN fields repeat on `~`. */
function repetitionsOf(field: string): string[] {
  return field.split("~");
}

function checkNameField(ctx: SegmentContext, index: number, field: string): void {
  for (const rep of repetitionsOf(field)) {
    const comps = componentsOf(rep);
    // XPN-1 family, XPN-2 given, XPN-3 middle. Nothing past component 3 is a
    // name: XPN-5 is a prefix, XPN-7 a name-type code.
    for (const c of [comps[0], comps[1], comps[2]]) {
      if (c === undefined || c.length === 0 || isInterpolated(c)) continue;
      const token = firstSubcomponent(c);
      if (!looksLikeNameToken(token)) continue;
      if (ctx.allow.names.has(token.toUpperCase())) continue;
      ctx.hit(index, token, "person name not declared synthetic in the allow-list");
    }
  }
}

function checkDobField(ctx: SegmentContext, index: number, field: string): void {
  if (field.length === 0 || isInterpolated(field)) return;
  const m = /^(\d{8})/.exec(field.trim());
  if (m?.[1] === undefined) return;
  if (ctx.allow.dobs.has(m[1])) return;
  ctx.hit(index, m[1], "date of birth not declared synthetic in the allow-list");
}

function checkIdField(ctx: SegmentContext, index: number, field: string): void {
  for (const rep of repetitionsOf(field)) {
    if (rep.length === 0 || isInterpolated(rep)) continue;
    const comps = componentsOf(rep);
    // CX-1 is the id value; CX-4 is the assigning authority and CX-5 the
    // identifier type code, neither of which is an identifier.
    const value = (comps[0] ?? rep).trim();
    if (value.length === 0 || isInterpolated(value)) continue;
    if (ctx.allow.ids.has(value.toUpperCase())) continue;
    const typeCode = (comps[4] ?? "").trim().toUpperCase();
    const reason =
      typeCode === "SS" || /^\d{9}$/.test(value)
        ? "social security number not declared synthetic in the allow-list"
        : "patient / member identifier not declared synthetic in the allow-list";
    ctx.hit(index, value, reason);
  }
}

function checkAddressField(ctx: SegmentContext, index: number, field: string): void {
  for (const rep of repetitionsOf(field)) {
    const comps = componentsOf(rep);
    // XAD-1 street, XAD-2 other designation, XAD-3 city, XAD-5 postal code.
    // XAD-4 (state) and XAD-6 (country) are not identifying on their own.
    for (const c of [comps[0], comps[1], comps[2], comps[4]]) {
      if (c === undefined || c.trim().length === 0 || isInterpolated(c)) continue;
      const value = firstSubcomponent(c).trim();
      if (value.length === 0) continue;
      if (ctx.allow.addresses.has(value.toUpperCase())) continue;
      ctx.hit(index, value, "address component not declared synthetic in the allow-list");
    }
  }
}

function checkPhoneField(ctx: SegmentContext, index: number, field: string): void {
  for (const rep of repetitionsOf(field)) {
    for (const c of componentsOf(rep)) {
      if (c.length === 0 || isInterpolated(c)) continue;
      const digits = digitsOf(c);
      if (digits.length < 4) continue;
      if (ctx.allow.phones.has(digits)) continue;
      ctx.hit(index, c.trim(), "telephone number not declared synthetic in the allow-list");
    }
  }
}

interface SegmentContext {
  allow: AllowList;
  hit: (fieldIndex: number, value: string, reason: string) => void;
}

/**
 * Extract every PHI-bearing segment literal from `content` and check it field by
 * field.
 *
 * The literal ends at the first CR, LF, double quote or backtick. Those are the
 * segment terminator of a real v2 message and the closing delimiters of the two
 * TypeScript literal forms this corpus uses. A single quote is deliberately NOT
 * a terminator: it appears inside real family names (`O'Brien`), and ending
 * there would scan LESS, which is the wrong direction for a gate.
 */
function scanHl7Segments(path: string, content: string, allow: AllowList, hits: Hit[]): void {
  for (const opening of content.matchAll(SEGMENT_OPENING)) {
    const id = opening[1];
    if (id === undefined) continue;
    const start = (opening.index ?? 0) + opening[0].length - id.length - 1;
    const rest = content.slice(start);
    // The ESCAPED separators are terminators as well as boundaries. Without them
    // a whole message in one literal is read as ONE segment, and every field
    // after the first embedded `\r` lands at the wrong index: measured, a PID
    // followed by an escaped separator and an NK1 reported the next-of-kin's
    // relationship code as the patient's ADDRESS. Bounding on them makes each
    // segment's field numbering its own again.
    const end = rest.search(/\\[rn]|[\r\n"`]/);
    const segment = end < 0 ? rest : rest.slice(0, end);
    const fields = fieldsOf(segment);

    const ctx: SegmentContext = {
      allow,
      hit: (fieldIndex, value, reason) => {
        hits.push({ path, segment: `${id}-${String(fieldIndex)}`, value, reason });
      },
    };

    const run = (
      table: Record<string, number[]>,
      check: (c: SegmentContext, i: number, f: string) => void,
    ): void => {
      for (const index of table[id] ?? []) {
        const field = fields[index];
        if (field === undefined || field.length === 0) continue;
        check(ctx, index, field);
      }
    };

    run(NAME_FIELDS, checkNameField);
    run(DOB_FIELDS, checkDobField);
    run(ID_FIELDS, checkIdField);
    run(ADDRESS_FIELDS, checkAddressField);
    run(PHONE_FIELDS, checkPhoneField);
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

  // ▶ TWO PASSES, AND THE SECOND IS "IN ADDITION TO" THE FIRST, NEVER "INSTEAD
  // OF" IT. Every target gets both, on every route. The floor is format-blind
  // and catches shapes the structured pass never looks for (an SSN in prose, an
  // email in a doc comment); the structured pass catches the field-level PHI a
  // real v2 message carries, none of which has an SSN or email shape. Making
  // either exclusive of the other would open a leak wider than it closed.
  scanCommonShapes(target.path, text, allow, hits);
  scanHl7Segments(target.path, text, allow, hits);
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function report(hits: Hit[]): void {
  if (hits.length === 0) {
    process.stdout.write("[phi-scan] OK: no hits\n");
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

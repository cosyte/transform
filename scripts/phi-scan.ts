#!/usr/bin/env tsx
/**
 * `@cosyte/transform` PHI scanner: the CI / pre-commit half of the PHI commit-gate.
 *
 * ===========================================================================
 * 🛑 THIS BRANCH IS A DERIVATION, NOT A SHIPPABLE SCANNER. DO NOT MERGE IT.
 *
 * It does NOT typecheck against `@cosyte/script-utils@0.0.2`, and that is the
 * deliverable rather than an oversight: the two type errors ARE the measurement.
 * `ctx.allow.addresses` and `ctx.allow.phones` do not exist on the engine's
 * `AllowList`, so this repository's ADDRESS and PHONE declarations have no
 * remedy under the engine as published. A branch that compiled would look
 * mergeable and would be lying.
 *
 * Every gap this derivation found is marked `🛑 PARAM GAP` below. Each one is a
 * change to `@cosyte/script-utils`, never a local workaround: a repo-local
 * workaround is precisely what this whole item exists to delete, because it is
 * what makes the next PHI escape cost thirteen pull requests instead of one.
 * ===========================================================================
 *
 * ===========================================================================
 * WHAT IS IN THIS FILE, AND WHAT IS NOT.
 *
 * The MACHINERY is `@cosyte/script-utils/phi-scan`, a devDependency: argument
 * parsing, the allow-list and override log, target enumeration on all three
 * routes, the union of the working-tree walk with the bytes git carries, content
 * deduplication, THE COMPLETENESS RULE, every refusal, and the cross-cutting
 * SSN/email FLOOR. Read that module's docblock for what each rule closes and
 * what it costs; nothing is restated here, because a claim written down twice is
 * a claim that drifts.
 *
 * IT IS A DEPENDENCY AND NOT A COPY, AND THAT IS THE POINT. This file used to
 * carry the whole engine, in a byte-distinct copy shared with twelve siblings,
 * so a newly-found escape cost one pull request and one adversarial review PER
 * REPO. Three escape classes have been paid for that way already. Now it costs
 * one pull request in `cosyte/config` and a version bump here.
 *
 * IT IS A devDependency, NEVER A RUNTIME ONE. The zero-dep rule governs what
 * ships; a dev-time gate does not ship.
 *
 * WHAT STAYS LOCAL is what genuinely differs: THE FIVE PER-REPO AXES below, and
 * the HL7 v2 STRUCTURED FIELD DETECTION in `detect` at the foot of this file.
 * ===========================================================================
 *
 * ===========================================================================
 * ██  WHAT THIS DETECTS  ████████████████████████████████████████████████████
 * ===========================================================================
 *
 *   TWO passes run on EVERY target, on ALL THREE ROUTES. The second is "in
 *   addition to" the first, never "instead of" it:
 *
 *   (1) THE CROSS-CUTTING FLOOR, owned by the engine, which applies to any
 *       format: a dashed Social Security Number, and an email at a domain the
 *       allow-list does not declare.
 *
 *   (2) THE HL7 v2 STRUCTURED PASS in `detect` below, which is what this
 *       package's corpus actually carries. `@cosyte/transform` ships NO
 *       standalone `.hl7` fixture files at all: every message in the corpus is
 *       an inline `.ts` STRING LITERAL, so this pass finds segment literals
 *       ANYWHERE in a target's text rather than assuming the file IS the
 *       message.
 *
 *   ⚠  ENUMERATING MORE FILES BUYS THE FLOOR AND NOTHING ELSE. The floor finds
 *      ZERO in this repository's HL7 fixtures: they carry no dashed SSN and no
 *      email. A sweep without (2) would open files full of names, DOBs and MRNs
 *      and report every one of them clean.
 *
 *   ══════════════════════════════════════════════════════════════════════════
 *   ▶ THE COVERAGE STATEMENT IS POSITIVE, AND THAT SHAPE IS THE POINT.
 *
 *   Two successive refuter passes measured an EXHAUSTIVE NEGATIVE LIST of "what
 *   this does not catch" incomplete, in the false-confidence direction, and the
 *   second measured it incomplete AGAIN after it had been extended in answer to
 *   the first. A negative list of that shape CANNOT be kept true: every clause
 *   of every segment of the standard would have to appear on it. So the claim is
 *   stated the only way that is checkable, as EXACTLY WHAT IS READ. Anything not
 *   named below IS NOT CHECKED.
 *
 *   ▶ EACH ROW CARRIES THE v2.5.1 ITEM NUMBER, AND THAT IS THE ANTI-DRIFT
 *   DEVICE, NOT DECORATION. An item number is the standard's own stable
 *   identifier for an element, so a reader can re-check a row against a
 *   published copy without having to trust this comment, and a number that
 *   silently moved is visible rather than plausible.
 *
 *   ▶ EXTRACT AN ITEM NUMBER OR DO NOT WRITE ONE, AND THAT IS MEASURED HERE.
 *   The rows in this table were pulled out of the attribute tables
 *   mechanically; nine rows in the suite's NEGATIVE-CONTROL list were written
 *   from recall instead, and one of them (`PV1-7`) was wrong. Eight being right
 *   was luck, and the wrong one was invisible because it changed no detection at
 *   all.
 *
 *       PID-3   00106 .. Patient Identifier List ................. id
 *       PID-5   00108 .. Patient Name ............................ name
 *       PID-6   00109 .. Mother's Maiden Name .................... name
 *       PID-7   00110 .. Date/Time of Birth ...................... DOB
 *       PID-9   00112 .. Patient Alias ........................... name
 *       PID-11  00114 .. Patient Address ......................... address
 *       PID-13  00116 .. Phone Number - Home ..................... phone
 *       PID-14  00117 .. Phone Number - Business ................. phone
 *       PID-19  00122 .. SSN Number - Patient .................... id
 *       PID-20  00123 .. Driver's License Number - Patient ....... id
 *       NK1-2   00191 .. Name .................................... name
 *       NK1-4   00193 .. Address ................................. address
 *       NK1-5   00194 .. Phone Number ............................ phone
 *       NK1-6   00195 .. Business Phone Number ................... phone
 *       NK1-16  00110 .. Date/Time of Birth ...................... DOB
 *       NK1-26  00109 .. Mother's Maiden Name .................... name
 *       NK1-30  00748 .. Contact Person's Name ................... name
 *       NK1-31  00749 .. Contact Person's Telephone Number ....... phone
 *       NK1-32  00750 .. Contact Person's Address ................ address
 *       NK1-33  00751 .. Next of Kin/Associated Party's Ids ...... id
 *       NK1-37  00754 .. Contact Person Social Security Number ... id
 *       GT1-2   00406 .. Guarantor Number ........................ id
 *       GT1-3   00407 .. Guarantor Name .......................... name
 *       GT1-4   00408 .. Guarantor Spouse Name ................... name
 *       GT1-5   00409 .. Guarantor Address ....................... address
 *       GT1-6   00410 .. Guarantor Ph Num - Home ................. phone
 *       GT1-7   00411 .. Guarantor Ph Num - Business ............. phone
 *       GT1-8   00412 .. Guarantor Date/Time Of Birth ............ DOB
 *       GT1-12  00416 .. Guarantor SSN ........................... id
 *       GT1-19  00423 .. Guarantor Employee ID Number ............ id
 *       IN1-16  00441 .. Name Of Insured ......................... name
 *       IN1-18  00443 .. Insured's Date Of Birth ................. DOB
 *       IN1-19  00444 .. Insured's Address ....................... address
 *       IN1-36  00461 .. Policy Number ........................... id
 *       IN1-49  01230 .. Insured's ID Number ..................... id
 *
 *   NO OTHER SEGMENT IS READ AT ALL: not PV1, ORC, OBR, OBX, RXA, SCH, TXA, and
 *   not MSH. NO OTHER FIELD of the four segments above is read. Within a field,
 *   only the components named in each `check…Field` are read.
 *
 *   ▶ PROVENANCE. EVERY ROW ABOVE IS CORROBORATED AGAINST A PUBLISHED COPY OF
 *   HL7 v2.5.1, read as the SEGMENT ATTRIBUTE TABLES of the v2.5.1 standard
 *   text: Chapter 3, Patient Administration (PID §3.4.2, NK1 §3.4.5) and
 *   Chapter 6, Financial Management (GT1 §6.5.5, IN1 §6.5.6), at
 *   `www.hl7.eu/HL7v2x/v251/std251/ch03.html` and `…/ch06.html`, 2026-08-08.
 *   Every row was then cross-checked, field by field, against a SECOND
 *   independently published and version-pinned artifact: the HAPI HL7 v2
 *   generated structures for v2.5.1,
 *   `hapifhir.github.io/hapi-hl7v2/v251/apidocs/…/model/v251/segment/<SEG>.html`.
 *   The two agree on the number, the name and the data type of every row, and on
 *   the segment lengths (PID 39, NK1 39, GT1 57, IN1 53).
 *
 *   ▶ THE VERSION IS LOAD-BEARING, AND THAT IS MEASURED RATHER THAN CAUTIONARY.
 *   Three of these rows read DIFFERENTLY in a later v2: PID-9, PID-19 and PID-20
 *   are WITHDRAWN from v2.7 onward, and a published v2+ copy of the same segment
 *   says exactly that at exactly those numbers. Grounding a number against the
 *   wrong version's table therefore yields a confident wrong answer rather than
 *   an error. This package targets v2.5.1, so cite v2.5.1.
 *
 *   ▶ AND THE RULE THAT OUTLIVES THIS CHANGE: DO NOT ADD A FIELD NUMBER YOU
 *   CANNOT GROUND. Measured cost of not citing at all: a first draft of this
 *   table mapped IN1-17 as a telephone field. IN1-17 is Insured's Relationship
 *   To Patient (CE, table 0063, item 00442), so a SNOMED relationship code was
 *   reported as a phone number. **IN1 carries no insured telephone at all**:
 *   IN1-7 (item 00432) is Insurance Co Phone Number, the PAYER's, an
 *   organisation's, so `IN1` is absent from `PHONE_FIELDS` deliberately rather
 *   than by omission. IN1-17 is the suite's negative control for that reason.
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
 *          **BUT THE FIELD IT CUTS IN CAN GO SILENT TOO**: the surviving prefix
 *          reports only if it still clears a recogniser floor, so a cut before
 *          the digits of a phone, or inside a family name, loses that field AND
 *          everything after it. Not decidable from static text, so disclosed
 *          rather than guessed.
 *
 *      Anything inside a BINARY or compressed target is unreadable to both
 *      passes: they decode as UTF-8, and a name inside a gzip stream survives.
 *
 *      ▶ TWO ENTRIES THAT USED TO BE ON A NEGATIVE LIST WERE FIXED RATHER THAN
 *      DISCLOSED, because both were reachable and both reported CLEAN: a name
 *      component outside ASCII (`García`, `Nguyễn`), and a whole message pasted
 *      into ONE literal with ESCAPED `\r` separators. Do not re-narrow either.
 *
 *   The mechanism for declaring genuinely-synthetic identifiers is the
 *   allow-list (`scripts/phi-allow-list.txt`): a positive declaration that a
 *   fixture's identifiers are fake. A whole-file bypass (`--allow-fixture
 *   <path>`) still needs a logged entry in `phi-scan-overrides.md`, but it is
 *   RECORDED AND REFUSED rather than honored: it cannot reach exit 0 in any mode.
 *
 *   ▶ AN ALLOW-LIST ENTRY IS GLOBAL AND ROUTE-BLIND. It clears that literal on
 *     the commit-blocking `--staged` route too, and on `<path>`.
 * ===========================================================================
 *
 * ===========================================================================
 * EXIT CONTRACT, DEFINED HERE AND NOT INHERITED:
 *
 *   0  the scan ran, READ EVERY TARGET IT ENUMERATED, and found nothing.
 *   1  HITS. Reserved for "this corpus contains something that looks like PHI".
 *      It is NOT exclusive: an allow-list, or an override log, that EXISTS but
 *      cannot be READ throws a plain `Error` and takes node's own exit 1, which
 *      a caller reads as "hits found". The engine names that escape rather than
 *      claiming to have closed it.
 *   2  EVERY STATE THE ENGINE RAISES IN WHICH THE SCAN CANNOT ACCOUNT FOR
 *      SOMETHING. The full list is in the engine's `run()` docblock.
 *
 * 1 IS RESERVED BECAUSE CI AND THE PRE-COMMIT HOOK BRANCH ON THE CODE. A caller
 * must be able to tell "PHI was found here" from "this scan is not trustworthy".
 *
 * DO NOT PORT THESE NUMBERS INTO, OR OUT OF, A SIBLING PARSER. The `@cosyte/*`
 * scanners do not agree on them and are not required to. That is why the engine
 * has no default for them.
 * ===========================================================================
 */

import { runPhiScan, type DetectContext } from "@cosyte/script-utils/phi-scan";

// ===========================================================================
// ██  THE FIVE PER-REPO AXES  ███████████████████████████████████████████████
// ===========================================================================
//
// A PORT IS NOT A COPY. Five things genuinely differ between the sibling
// `@cosyte/*` scanners, and every one of them is a PARAMETER of the shared
// engine rather than a fork of it. Each is re-derived HERE, for THIS repo:
//
//   1. EXIT CODES        `EXIT_CODES`. No default exists, deliberately.
//   2. ROOTS+EXCLUSIONS  `SCAN_ROOTS`, `EXCLUDED_PATHS`, and the READ filter.
//   3. `--staged` SCOPE  `isStagedReadable`.
//   4. GITLINKS          `regularBlobModes`, defaulted by the engine to git's
//                        two regular-blob modes. Nothing to set here: this
//                        repository has no gitlink and wants none refused
//                        differently from the shared boundary.
//   5. EOL NORMALIZATION No parameter: the engine's walk/index deduplication is
//                        BY CONTENT, so where the index carries LF and the
//                        working tree CRLF, BOTH forms are scanned. CHECKED
//                        rather than skipped: this repo's `.gitattributes`
//                        declares only `vendor/*.tgz binary` and sets no `text`
//                        or `eol` attribute, so nothing here rewrites line
//                        endings on checkout and the two copies agree.
// ===========================================================================

// ===========================================================================
// 🛑 PARAM GAP 1 -- `AllowList` CARRIES NO `addresses` AND NO `phones`.
//
// The engine parses NAME / DOB / ID / EMAILDOMAIN and nothing else, so this
// repository's ADDRESS and PHONE declarations are dropped in silence: an
// unrecognised tag hits the parser's `default: break`. MEASURED, with those two
// sets stubbed empty and everything else in this file unchanged: 16 hits across
// `test/messages/to-fhir.test.ts` and `test/scripts/phi-scan.test.ts`, and every
// single one is a value `scripts/phi-allow-list.txt` already declares synthetic
// (`123 Main St`, `Apt 4`, `Boston`, `02101`, `456 Oak Ave`, `1 St`, `555-1234`,
// `555-9999`). The gate is permanently red with no remedy a developer can reach.
//
// WHY A CALLER-SIDE TRANSFORM WILL NOT DO: parsing the allow-list is the
// engine's job by construction, and a local re-parse is exactly the machinery
// this item exists to delete.
//
// 🛑 PARAM GAP 2 -- THE FLOOR HAS NO PATH-SCOPED EMAIL DECLARATION, AND THIS ONE
// IS UNREACHABLE FROM A CALLER AT ALL.
//
// `EMAIL <path> <address>` is this repository's narrowest allow-list instrument:
// one mailbox, in one file. It is consumed by the cross-cutting FLOOR, which the
// engine owns and which reads `emailDomains` only. A `detect` function can ADD
// hits and can never withdraw one, so no caller-side code can restore the
// narrowing. MEASURED on this branch: 4 email hits over 2 files, all of them the
// npm publisher mailbox in `package.json` and in the allow-list's own
// declaration of it, which this repository has audited, named on purpose and
// pinned by tests as non-PHI.
//
// THE ONLY CONFIG-EXPRESSIBLE ANSWER IS `EMAILDOMAIN cosyte.com`, AND IT IS A
// REAL SUBTRACTION, NOT A REWRITE: it widens the clearance from two (path,
// address) literals to every mailbox at the company domain, in every file, on
// every route including the commit-blocking one. That is the cell this repo
// deliberately kept narrow, so it is not taken here.
//
// 🛑 PARAM GAP 4 -- THE `<path>` ROUTE FOLLOWS A SYMBOLIC LINK, AND IT REPORTS
// A FALSE CLEAN. This is an ENGINE DEFECT rather than a missing parameter, it
// reaches all thirteen adopters, and it is the same class as the escape this
// lineage's own pass-3 refuter caught at a scan root: `lstat`, never `stat`.
// `buildTargetsForPaths` classifies with `existsSync` + `statSync`, and BOTH
// dereference. MEASURED on this branch, with `src/leak.ts` a symbolic link to a
// clean file OUTSIDE the repository: `phi-scan src/leak.ts` printed
// `OK: no hits` at exit 0, having read bytes git does not carry and vouched for
// an in-repo path on their basis. A link to a payload-bearing file reported its
// hits under the LINK's path, which is a diagnostic naming a locus a developer
// will open and find clean. A DANGLING link answers `File not found` rather than
// naming it as the link it is, because `existsSync` follows too. THIS SCANNER
// REFUSED ALL THREE (exit 2) BEFORE ADOPTION, so adopting as published is a
// measured regression on a route this repository documents a claim about.
// ===========================================================================

/** AXIS 1: this repo's exit contract, stated in the header block above. */
const EXIT_CODES = { clean: 0, hits: 1, refuse: 2 } as const;

/**
 * AXIS 2: the roots `all` mode walks. THE WHOLE REPOSITORY.
 *
 * ▶ IT IS A WIDENING, AND EVERY EARLIER ROOT IS CONTAINED IN IT. This scanner
 * used to declare seven directories (`.changeset`, `.github`, `docs-content`,
 * `documentation`, `scripts`, `src`, `test`) plus a separate enumeration of the
 * repo-root regular files, because a root file has no directory to declare.
 * `["."]` is a strict superset of that union, so nothing the walk opened before
 * can stop being opened, and the top-level-file special case disappears rather
 * than being ported.
 *
 * ▶ AND IT IS WHAT MAKES CRITERION 2 TRUE BY CONSTRUCTION rather than by
 * inspection: no path this repository can name is outside a root of `["."]`, so
 * `isStagedReadable` below cannot admit anything the root half does not cover.
 * The engine REFUSES that mismatch rather than narrowing to the intersection.
 *
 * 🛑 NOT `["./"]`, `["./."]` OR ANY `./`-PREFIXED SPELLING. The engine
 * normalises a root the way it normalises every other path, so those all mean
 * the same thing today; the reason to write it plainly anyway is that a root
 * which walks correctly while matching no INDEX path empties the union and both
 * index refusals in silence, and that is the shape a `./`-prefixed root had
 * before the normalization landed.
 *
 * The engine prunes gitignored directories during descent and skips `.git` by
 * name, so `dist/`, `coverage/` and `node_modules/` cost this sweep nothing.
 */
const SCAN_ROOTS: readonly string[] = ["."];

/**
 * AXIS 2 (the subtractive half): repo-relative paths NO sweeping route reads:
 * not the walk, not the index union, not `--staged`. A named `<path>` still
 * reads them, which is the engine's boundary and is unchanged from this
 * scanner's earlier `RECONCILE_EXEMPT`.
 *
 * 🛑 EXCLUDE A LITERAL PATH, NEVER A CLASS. A predicate ("skip binary blobs")
 * needs no maintenance and is exactly why it is refused: a sibling measured that
 * such a predicate would have dropped two of its own hand-written sources, which
 * embed NUL bytes as HMAC domain separators, so git's own binary heuristic calls
 * them binary. A literal path is reviewable in a diff; a class quietly grows new
 * members.
 *
 * AN ENTRY HERE IS A FILE THE SCAN HAS NO VERDICT ABOUT, so each one says why.
 *
 * ▶ THIS SCANNER'S OWN TEST FILE IS DELIBERATELY *NOT* HERE, unlike the shared
 * template's. `test/scripts/phi-scan.test.ts` is inside this scan's corpus and
 * stays inside it: its violator payloads are assembled from parts at runtime
 * precisely so that no violator literal is ever written into this repository.
 * Excluding it would remove the only proof that the arrangement works.
 */
const EXCLUDED_PATHS: ReadonlySet<string> = new Set<string>([
  // The two vendored `pnpm pack` gzip archives of sibling `@cosyte/*` packages
  // (`pnpm vendor:refresh` writes them; the names are pinned in
  // `scripts/vendor-refresh.sh`). Their bytes are not the text they carry, so
  // scanning them is neither a detection nor a clearance: a name inside one is
  // compressed and unreadable to any text pass, and a clean result over them
  // would be evidence of nothing. Measured on this repository, the fhir tarball
  // produces one hit that is seven bytes of DEFLATE output matching the email
  // shape, and it changes with every repack. Each sibling is gated by its own
  // PHI scanner at its own source.
  //
  // 🛑 IF `pnpm vendor:refresh` EVER RENAMES A TARBALL, THIS LIST GOES STALE AND
  // THE GATE REDS ON THE NEW PATH rather than going quiet. That is the safe
  // direction: the remedy is to update these two literals, never to loosen them
  // into a `vendor/**` predicate.
  "vendor/cosyte-fhir-0.0.0.tgz",
  "vendor/cosyte-hl7-0.0.0.tgz",
]);

/**
 * AXIS 2, the READ half of scope for the two SWEEPING routes, OVERRIDDEN, with
 * the measurement beside the override as the engine's docblock requires.
 *
 * THE SHARED DEFAULT EXEMPTS MARKDOWN AND THIS REPOSITORY DOES NOT. The `*.md`
 * skip was removed from this scanner deliberately, in a graded change, on two
 * grounds that both still hold: it was an ENUMERATION-time judgement standing in
 * for a CONTENT-time one (the allow-list already exists to say "this literal is
 * synthetic", by value and under review, which a filename cannot), and it was
 * never true of the named-path route, so the routes disagreed about the same
 * bytes. Measured over this repo's tracked corpus at the time, opening every
 * tracked `.md` produced ZERO new hits, so the cost of the override is a longer
 * sweep and nothing else.
 *
 * ▶ AND THE REASON NOT TO DROP BACK TO THE DEFAULT IS MEASURED ELSEWHERE IN THIS
 * ECOSYSTEM: a tracked `.md` is read by NEITHER sweeping route under it, and
 * `README.md` and `CHANGELOG.md` SHIP IN THE npm TARBALL while `docs-content/`
 * ships to the docs site. Taking the default here would be a subtraction on
 * exactly the files that leave the box.
 *
 * 🛑 THIS IS THE *SWEEP'S* READ FILTER, NOT A SCOPE PREDICATE. The engine's
 * non-regular and non-blob refusals key on the ROOT half of scope, never on
 * this: a `.md`-named symbolic link is refused on both sweeping routes whatever
 * this function returns, because a link's name is no evidence about what is on
 * the other side of it.
 */
function isWalkReadable(): boolean {
  return true;
}

/**
 * AXIS 3: the READ half of scope for `--staged`, i.e. which regular blobs a
 * COMMIT is blocked on.
 *
 * ▶ IT IS A STRICT SUPERSET OF THE PREDICATE IT REPLACES, WHICH IS WHAT MAKES
 * THIS WIDENING SAFE TO STATE. The earlier `stagedRouteAdmits` admitted any
 * repo-root file plus anything whose first path segment was one of the seven
 * declared walk roots. Everything it admitted, this admits; what it did not
 * admit was `vendor/**` and any top-level directory nobody had declared yet, and
 * the second of those is the silent half: a new top-level directory used to be
 * outside the commit gate until somebody remembered to add it.
 *
 * ▶ `vendor/**` STAYS OUT, THROUGH `EXCLUDED_PATHS` RATHER THAN THROUGH THIS
 * PREDICATE, so the two tarballs are named once and are out of every sweeping
 * route at once. That is a change of MECHANISM, not of outcome: `--staged` did
 * not read them before either.
 *
 * ▶ IT DOES NOT MIRROR THE SWEEP'S READ FILTER BY ACCIDENT — both are now
 * "everything", and they are written as two functions because they answer two
 * different questions and the engine enforces only one relationship between
 * them (this one must stay inside `SCAN_ROOTS`).
 */
function isStagedReadable(): boolean {
  return true;
}

// ---------------------------------------------------------------------------
// THE HL7 v2 STRUCTURED PASS: the half the shared engine deliberately does not
// own, because it differs per healthcare standard.
//
// ▶ THIS PASS DOES NOT ASSUME THE FILE IS THE MESSAGE, AND THAT IS THE WHOLE
// POINT HERE. `@cosyte/transform` ships no standalone `.hl7` fixture at all:
// every message in its corpus is a `.ts` STRING LITERAL, usually one segment per
// array element. A recogniser written the usual way, parsing a target as a
// document, would find nothing in any of them. So segment literals are located
// ANYWHERE in the text and each is read from its segment id to the end of the
// line or to the closing quote of the literal it sits in, whichever comes first.
// ---------------------------------------------------------------------------

// ===========================================================================
// ██  THE VOCABULARY DERIVATION  ████████████████████████████████████████████
// ===========================================================================
//
// 🛑 PARAM GAP 3 — AND IT IS THE STRUCTURAL ONE. THE PREMISE "ONE REPO, ONE
// VOCABULARY" IS FALSE HERE, AND IT IS FALSE BY MEASUREMENT RATHER THAN BY
// ARGUMENT. `@cosyte/transform` is not a parser: it CONVERTS between standards,
// so the SAME synthetic identity appears in its corpus in THREE field
// vocabularies at once. Only the first has ever had a detector.
//
//   V1. THE HL7 v2 WIRE VOCABULARY -- `PID|...|PUBLIC^JANE^Q|...`.
//       Located by segment id and field number. This is the whole of `detect`
//       below, and it is the only vocabulary any version of this scanner has
//       ever read.
//
//   V2. THE FHIR R4 ELEMENT VOCABULARY -- `"family"`, `"given"`, `"birthDate"`,
//       `"line"`, `"city"`, `"postalCode"`, `"telecom"`, `identifier.value`.
//       Located by element name inside an object literal or a serialised JSON
//       assertion. MEASURED PRESENT AND UNREAD: `test/messages/to-fhir.test.ts`
//       asserts on the literal string `"birthDate":"1980-01-15"`, and
//       `test/datatypes/human-name.test.ts` asserts `family` is `Public` and
//       `given` is `Jane`, `Q`.
//
//   V3. THE TIER-BOUNDARY COMPOSITE VOCABULARY -- `familyName`, `givenName`,
//       `street`, `otherDesignation`, `city`, `zipOrPostalCode`. This is the
//       `@cosyte/hl7` composite object this package CONSUMES, and it is neither
//       v2 wire nor FHIR. MEASURED PRESENT AND UNREAD: the `toFhirAddress`
//       call in `test/datatypes/address.test.ts`.
//
// ▶ AND V3 IS NOT A HYPOTHETICAL GAP, IT ALREADY CARRIES AN UNDECLARED VALUE.
// `test/datatypes/address.test.ts` passes `street: "1 Main St"`. Uppercased that
// is `1 MAIN ST`, and `scripts/phi-allow-list.txt` declares `1 ST`, `123 MAIN
// ST`, `456 OAK AVE`, `APT 4`, `BOSTON` and `02101` -- not `1 MAIN ST`. So the
// moment a V3 recogniser exists this value REPORTS, and it has to be declared or
// changed. Named here rather than pre-declared, because declaring a token to
// silence a detector that does not exist yet is how an allow-list rots.
//
// ▶ WHICH OF THE COORDINATOR'S THREE SHAPES TRANSFORM NEEDS: THE FIRST, ONE
// MERGED VOCABULARY, AND THE OTHER TWO ARE REFUTED BY MEASUREMENT RATHER THAN
// PREFERRED AGAINST.
//   - PER-ROOT vocabularies cannot work here: the three vocabularies CO-OCCUR
//     INSIDE SINGLE FILES. `test/messages/to-fhir.test.ts` carries V1 and V2
//     together; `src/datatypes/human-name.ts` carries V2 and V3 together in one
//     JSDoc `@example`. No root selects one.
//   - PER-FILE-TYPE vocabularies select nothing: every file named above is
//     `.ts`. An extension cannot tell them apart, and a content sniffer would
//     have to run all three recognisers to find out which applies, which is the
//     merged shape with an extra step that can only ever subtract.
//   - MERGED is a strict SUPERSET of today's single-vocabulary run, so it cannot
//     lose a detection this repo already has.
//
// ▶ THE COST OF MERGING, STATED RATHER THAN LEFT TO BE FOUND. One merged
// allow-list per KIND means declaring `PUBLIC` synthetic clears it in all three
// vocabularies at once. FOR THIS REPOSITORY THAT IS CORRECT AND NOT A
// CONCESSION: it is the same identity crossing a tier boundary, and requiring it
// to be declared once per vocabulary would mean three chances to forget. The
// real cost is elsewhere and it is a RECOGNISER-QUALITY problem, not a selector
// problem: V2's element names (`family`, `given`, `line`, `city`) are ordinary
// English words and ordinary property names, so a recogniser keyed on the bare
// WORD will fire on code that carries no PHI. V2 must key on STRUCTURE -- a
// property named `family` whose value is a string literal -- exactly as V1 keys
// on `SEG|` and a field number rather than on the letters `PID`.
//
// ▶ SO THE ENGINE PARAMETER MUST BE A LIST, NOT A SINGLETON. Five detector
// KINDS (name, DOB, id, address, phone) are universal, as the premise says. What
// is per-repo is HOW MANY RECOGNISERS run over them: a single-standard sibling
// declares ONE, and `transform` declares THREE over ONE merged vocabulary. That
// is the one thing twelve single-standard repos cannot discover.
//
// ▶ WHAT IS STILL CODE BELOW, AND WHAT OF IT IS ALREADY DATA. Under the rule
// that all process moves to the engine, the V1 RECOGNISER below (`SEGMENT_OPENING`,
// `checkNameField` and its four siblings, the repetition/component splitting) is
// PROCESS and belongs in `@cosyte/script-utils` as the shipped "HL7 v2 segment"
// recogniser kind. What this repository would keep is already isolated and
// already pure data: the five `*_FIELDS` tables immediately below, which are
// nothing but `segment id -> field number[]` per detector kind. They are left
// beside the code they drive rather than moved to a file of their own, because
// inventing a parameter FORMAT the engine has not defined yet would be the same
// mistake in the other direction.
// ===========================================================================

/** PHI-bearing fields per segment, by v2 field number (`PID-5` is index 5). */
const NAME_FIELDS: Record<string, number[]> = {
  PID: [5, 6, 9],
  NK1: [2, 26, 30],
  GT1: [3, 4],
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
  NK1: [33, 37],
  GT1: [2, 12, 19],
  IN1: [36, 49],
};
const ADDRESS_FIELDS: Record<string, number[]> = {
  PID: [11],
  NK1: [4, 32],
  GT1: [5],
  IN1: [19],
};
const PHONE_FIELDS: Record<string, number[]> = {
  PID: [13, 14],
  NK1: [5, 6, 31],
  GT1: [6, 7],
  // IN1 is absent on purpose: see the citation note in the banner above.
};

/**
 * The segment ids `SEGMENT_OPENING` will locate at all, as the UNION of every
 * table above.
 *
 * ▶ IT WAS `Object.keys(NAME_FIELDS)`, AND THAT IS A SILENT-MISS SHAPE EVEN
 * THOUGH IT ANSWERS IDENTICALLY TODAY. Read from one table, a segment added to
 * (say) `ID_FIELDS` alone is never located, so its fields are never read, and
 * NOTHING reports: no error, no warning, and a coverage table above that names
 * rows the scanner cannot reach.
 */
const PHI_SEGMENTS = [
  ...new Set([
    ...Object.keys(NAME_FIELDS),
    ...Object.keys(DOB_FIELDS),
    ...Object.keys(ID_FIELDS),
    ...Object.keys(ADDRESS_FIELDS),
    ...Object.keys(PHONE_FIELDS),
  ]),
];

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
 * MRN, an address and two phone numbers across PID and NK1, scanned clean at
 * exit 0, while the identical message written one segment per array element
 * produced 8 hits.
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
 * excluded by shape rather than by position.
 *
 * ▶ UNICODE LETTERS, NOT `[A-Za-z]`, AND THAT WAS A MEASURED SILENT MISS. An
 * ASCII-only class reports a name it cannot spell as CLEAN rather than as
 * unrecognised, so `Garcia` hit while the same name written with its accent
 * exited 0, as did every name in a non-Latin script. A gate that is blind to
 * exactly the names least likely to be synthetic is worse than no gate.
 */
function looksLikeNameToken(component: string): boolean {
  return /^\p{L}[\p{L}\p{M}'\-. ]+$/u.test(component) && component.trim().length > 1;
}

/** CX and XPN fields repeat on `~`. */
function repetitionsOf(field: string): string[] {
  return field.split("~");
}

function componentsOf(field: string): string[] {
  return field.split("^");
}

/** What one `check…Field` is handed: the allow-list, and a locus-filling `hit`. */
interface SegmentContext {
  allow: DetectContext["allow"];
  hit: (fieldIndex: number, value: string, reason: string) => void;
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

/**
 * THE STANDARD-SPECIFIC FIELD DETECTION. The engine has already run the
 * cross-cutting floor (SSN + email shapes) over `ctx.text` and reported any hits
 * against the correct locus. Everything below is this repository's.
 *
 * The literal ends at the first CR, LF, double quote or backtick. Those are the
 * segment terminator of a real v2 message and the closing delimiters of the two
 * TypeScript literal forms this corpus uses. A single quote is deliberately NOT
 * a terminator: it appears inside real family names (`O'Brien`), and ending
 * there would scan LESS, which is the wrong direction for a gate.
 *
 * @param ctx The target's text and bytes, the parsed allow-list, and `hit`.
 */
function detect(ctx: DetectContext): void {
  for (const opening of ctx.text.matchAll(SEGMENT_OPENING)) {
    const id = opening[1];
    if (id === undefined) continue;
    const start = (opening.index ?? 0) + opening[0].length - id.length - 1;
    const rest = ctx.text.slice(start);
    // The ESCAPED separators are terminators as well as boundaries. Without them
    // a whole message in one literal is read as ONE segment, and every field
    // after the first embedded `\r` lands at the wrong index: measured, a PID
    // followed by an escaped separator and an NK1 reported the next-of-kin's
    // relationship code as the patient's ADDRESS.
    const end = rest.search(/\\[rn]|[\r\n"`]/);
    const segment = end < 0 ? rest : rest.slice(0, end);
    const fields = segment.split("|");

    const segCtx: SegmentContext = {
      allow: ctx.allow,
      // NEVER BUILD A PATH HERE. The engine fills in the locus, which carries an
      // origin label when the bytes came from the index rather than from disk.
      hit: (fieldIndex, value, reason) => {
        ctx.hit({ segment: `${id}-${String(fieldIndex)}`, value, reason });
      },
    };

    const run = (
      table: Record<string, number[]>,
      check: (c: SegmentContext, i: number, f: string) => void,
    ): void => {
      for (const index of table[id] ?? []) {
        const field = fields[index];
        if (field === undefined || field.length === 0) continue;
        check(segCtx, index, field);
      }
    };

    run(NAME_FIELDS, checkNameField);
    run(DOB_FIELDS, checkDobField);
    run(ID_FIELDS, checkIdField);
    run(ADDRESS_FIELDS, checkAddressField);
    run(PHONE_FIELDS, checkPhoneField);
  }
}

process.exit(
  runPhiScan({
    exitCodes: EXIT_CODES,
    scanRoots: SCAN_ROOTS,
    excludedPaths: EXCLUDED_PATHS,
    isWalkReadable,
    isStagedReadable,
    detect,
  }),
);

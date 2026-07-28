#!/usr/bin/env bash
# scripts/check-no-internal-refs.sh
#
# Founder directive, 2026-07-27: NO INTERNAL PROJECT BOOKKEEPING ON A PUBLIC SURFACE.
# Anything a consumer reads (a GitHub release body, README.md, docs-content/, the npm
# package description, the JSDoc their editor renders, the message text their log prints)
# describes what the software does and what changed. It must never carry our internal
# bookkeeping: item identifiers (`TRANSFORM-6`, `CCDA-P7`), "Phase 5" / "roadmap Phase K" /
# "roadmap §4.3", sweep and programme names, ADR numbers, internal repo paths, or process
# commentary about how the artifact came to exist. Source of truth: the meta-repo's
# `documentation/conventions.md`, "No internal project bookkeeping on a public surface". The
# founder's words: "The releases should also not speak on anything regarding phases, etc.
# That has no relevance to the user consuming it. This goes for readmes and documentation as
# well."
#
# WHY THIS IS A GATE AND NOT A MEMORY NOTE. Founder, same day: "it needs to not just be a
# memory note, but something that is addressed in the workflow accordingly. This needs to
# not happen again." A one-time sweep regresses the first time someone writes `(TRANSFORM-7)`
# into a README. A documented rule governs whoever reads it; a gate governs everyone.
#
# WHERE THE IDENTIFIERS DO BELONG, and therefore what this gate deliberately does NOT scan:
# the changeset, CHANGELOG.md, commit messages, the PR title and body, CLAUDE.md,
# `documentation/decisions/`, source `//` comments, and the meta-repo. The traceability is
# real and worth keeping; it just belongs on the inside. So this is a translation at the
# boundary, not a deletion, and the boundary is what SCAN SURFACE below defines.
#
# ---------------------------------------------------------------------------
# WHAT IS LIFTED FROM WHERE, AND WHAT IS DELIBERATELY NOT.
#
#   * THE SHAPE is `hl7`'s `scripts/check-no-internal-refs.sh`
#     ([hl7#62](https://github.com/cosyte/hl7/pull/62), [hl7#64](https://github.com/cosyte/hl7/pull/64)),
#     which is the reference implementation the siblings copy, plus the FOURTH PASS (`src/`
#     string literals) that `ncpdp` added and `hl7` does not have
#     ([ncpdp#36](https://github.com/cosyte/ncpdp/pull/36)). THE SHAPE, NOT THE FILE.
#
#     CARRIED VERBATIM FROM `hl7`, because it is the cross-repo half and a divergent copy is
#     worse than a known shared limit: THE PREFIX LIST, the standards-designation list, all
#     six rule patterns, the paragraph-join second pass, the doc-comment third pass, the
#     silent-green route closures, and the NEGATIVE self-tests. The `hl7` prefix list is
#     copied CHARACTER FOR CHARACTER, `SYNTH` included -- see the note at PROJECT_PREFIXES.
#
#     RE-DERIVED FOR THIS REPO: the scan surface (`SURFACE_PATHS`, the npm-`files` tripwire's
#     known set) and every self-test sample.
#
#     THREE WIDENINGS ARE CARRIED ON TOP OF `hl7`'s RULES, each named here so a later
#     "resync with hl7" is a decision rather than an accident. Two are `ncpdp`'s and one is
#     this repo's; ALL THREE BELONG IN THE SHARED LIST, not in eleven copies (residual (i)).
#       (a) `phases?` RATHER THAN `phase` in rule 2 (from `ncpdp`). `hl7` matches the
#           singular only. Measured on this tree, the plural was live in the README, in
#           docs-content and in `src/` doc comments ("Phases 1-6", "the later phases reuse"),
#           and a singular rule walks past all of it.
#       (b) `/` IN RULE 3's SEPARATOR CLASS (from `ncpdp`). It costs nothing and closes the
#           path-shaped ADR citation (`adr/0001`) that survived a whole gate in that repo.
#       (c) `roadmap §N` IN RULE 2 (THIS REPO's, and the one to weigh). Measured on
#           `e6c4531`: 20 citations of the roadmap BY SECTION NUMBER (`(roadmap §4.5)`,
#           `(roadmap §Phase 5)`), across 19 doc-comment lines plus one wrapped onto the
#           next. `hl7`'s rule already has a `roadmap phase` arm, so this completes an arm
#           rather than inventing a rule, and `roadmap §` has no legitimate reading in a
#           consumer's editor. THE BARE `(§4.7)` FORM IS **NOT** GUARDED -- 28 of those were
#           live too; see residual (xiii) for the full arithmetic.
#
#   * THE DETECTION RULES ultimately come from `cosyte/.github`
#     `scripts/release-notes.mjs` (its `CONTENT_RULES`), validated against every published
#     release body across the org. THE REASONING IS KEPT WITH THEM ON PURPOSE. Every one of
#     the traps recorded below shipped a public defect before it was caught, and a reader who
#     has not hit them will tidy the guard away as over-complication.
#
# ---------------------------------------------------------------------------
# THE FIVE TRAPS THAT BREAK A NAIVE DETECTOR. Do not "simplify" past them.
#
#   (1) KEY ON KNOWN PROJECT PREFIXES, NEVER ON THE `WORD-N` SHAPE. THIS REPO IS DENSE WITH
#       THE COLLIDING SHAPE, because a v2-to-FHIR mapper's whole vocabulary is written that
#       way: `MSH-2`, `PID-3`, `PV1-44`, `OBX-5`, `OBR-25`, `RXA-20`, `SCH-8`, `NK1-4`,
#       `CX.4`, `XPN.7`, plus `ICD-10-CM`, `HL7-V2`, `FHIR-R4` and `DICOM-SR`. NONE of those
#       segment-field references is caught, and the reason is the ONLY reason: their leading
#       token is not on the prefix list. A shape rule would strip the reference material this
#       package exists to document. The cost of keying on prefixes is that A NEW PROGRAMME
#       MEANS ADDING ITS PREFIX BY HAND, and nothing catches it until someone does. That is
#       the cheaper of the two mistakes.
#
#   (2) DECAPITATION, which is a rule for the person REMEDIATING a hit, not for the scanner.
#       Stripping an identifier off the FRONT leaves the fragment behind: "Phase 7
#       (thirteenth slice): builder emits X (CCDA-P7)" became "(thirteenth slice): builder
#       emits X" across 17 lines of ccda's published release notes, which is worse than the
#       text it replaced. Repair the head: drop a leading orphan parenthetical, strip leading
#       punctuation, recapitalise. IT HAPPENED IN THIS SWEEP TOO, twice: removing `(§4.7)`
#       from the head of a continuation line left `* : both must carry ...`, and removing
#       `(§6 output validation)` left a doc comment whose last line was just `* */`. Both
#       were repaired by hand. A mid-sentence cut is worse than no cut.
#
#   (3) CASE SENSITIVITY. The identifier rule is case-SENSITIVE and the segment after the
#       hyphen must start uppercase or with a digit, which is what lets `FHIR-bridge` and
#       `docs-content/` through. IT IS LOAD-BEARING HERE: `FHIR-core`, `FHIR-required` and
#       `FHIR-core-fixed` appear eight times across this package's public surface and doc
#       comments, and a case-insensitive rule calls every one of them a violation. Leading
#       digits are fine too (`835`, `271`, `837` open X12 headlines legitimately), so nothing
#       here keys on a leading number.
#
#   (4) PHASE PATTERNS NEED A LETTER SUFFIX (`Phase 5b`) AND A LETTER-ONLY FORM (`Phase W`):
#       a digits-only pattern misses both. Ordinal `slice` and `wave` are ours too
#       ("thirteenth slice", "second wave"): "slice" is our word for a unit of work and a
#       reader does not have it. In prose it should read "change".
#
#   (5) THE REMEDIATION PROSE IS ITSELF A DEFECT SURFACE, and on `ncpdp` it was the trap that
#       fired last: the refuter's second pass found three majors, ALL of them in prose that
#       repo's worker had just written to replace stripped identifiers, the worst of which
#       STRENGTHENED A GUARANTEE WHILE DELETING THE LEG THAT GROUNDED IT. THE REMEDY IS TO
#       CUT, NOT TO REWRITE: delete the claim rather than replace it, and revert a rewrite
#       verbatim rather than repair it. Stripping an identifier is a deletion; the temptation
#       to "improve" the sentence around it is how this rule ships new falsehoods while
#       closing old ones. In this sweep the substitutions were deliberately kept WEAKER than
#       what they replaced ("deferred to a later phase" -> "not implemented", "a Phase-6
#       concern" -> "not bundled"), never stronger.
#
# ---------------------------------------------------------------------------
# SCAN SURFACE. This gate scans the PUBLIC surface only. The same identifier is REQUIRED on
# the inside and BANNED on the outside, so scanning every tracked file would red on
# CHANGELOG.md, `.changeset/`, CLAUDE.md and source comments, where the convention explicitly
# says the identifiers belong. A gate that reds on correct content is a gate someone deletes.
#
# In scope:
#   * README.md            the repo's front page, and shipped inside the npm tarball
#   * LICENSE              shipped inside the npm tarball
#   * docs-content/        every tracked file, including sidebars.json: this is the content
#                          published to docs.cosyte.com
#   * package.json         the npm-visible metadata ONLY (`description`, `keywords`),
#                          extracted and scanned as text. Named explicitly by the convention.
#                          The rest of package.json is not public prose, and scanning it
#                          whole would red on a future dependency or script name that happens
#                          to match.
#   * src/ DOC COMMENTS    a THIRD PASS, with its own rule array, self-tests and extractor.
#                          `src/` JSDoc IS public: it is compiled into `dist/index.d.ts` and
#                          `dist/index.d.cts`, `dist` is the first entry in package.json's
#                          `files`, and it is what a consumer's editor shows on hover. It is
#                          BY FAR THE LARGER SURFACE IN THIS REPO: measured on the base
#                          commit of the change that added this gate, AND WITH THE RULE SET
#                          THAT SHIPS BESIDE IT, 54 doc-comment lines plus 29
#                          wrapped-across-lines blocks matched, against 32 lines on the whole
#                          public markdown surface. Say WHICH rule set with every count:
#                          the same tree measures 47 and 26 without the two `roadmap` arms,
#                          and a first draft of this file quoted those figures beside the
#                          widened rules. A refuter caught it. Residual (xii) is the general
#                          form of that mistake; this is the instance.
#   * src/ STRING LITERALS a FOURTH PASS: the text a consumer reads in their LOG. See the
#                          note at STR_RULE_NAME.
#
# Out of scope, each for a stated reason:
#   * CHANGELOG.md         SHIPS INSIDE THE NPM TARBALL (it is in package.json `files`), so
#                          it is genuinely public surface, and it carries internal
#                          identifiers across its history. It is excluded anyway because the
#                          convention names CHANGELOG.md as one of the places identifiers
#                          BELONG, and because rewriting a released changelog's history
#                          destroys the traceability that same convention preserves. THAT IS
#                          A LIVE CONTRADICTION IN THE STANDARD, IT IS ECOSYSTEM-WIDE (every
#                          repo has it), `hl7` and `ncpdp` exclude it on exactly this
#                          reasoning, and it is not for one repo to settle alone. RECORDED
#                          HERE AND QUEUED ON `PUBLIC-SURFACE-HYGIENE` IN THE META-REPO,
#                          rather than silently decided in either direction.
#   * documentation/       THIS REPO'S OWN ARCHITECTURE DECISION RECORDS
#                          (`documentation/decisions/0001-...`, `0002-...`). Not in
#                          package.json `files`, not published to docs.cosyte.com (only
#                          `docs-content/` is), and an ADR is BY DEFINITION a record of how
#                          the artifact came to exist, which is the exact category the
#                          convention names as internal. Rule 3 bans ADR numbers on the
#                          public surface and rule 5 bans the `documentation/decisions/`
#                          path; scanning the ADRs themselves would red on files whose whole
#                          job is to carry one.
#   * phi-scan-overrides.md
#                          the audit log for fixture-level PHI-scan bypasses. Internal
#                          compliance bookkeeping, not consumer documentation.
#   * CLAUDE.md, .github/, .changeset/, scripts/, test/, vendor/
#                          internal by definition, or code rather than prose.
#   * src/ `//` COMMENTS   OUT of scope, because THE CONVENTION SAYS SO: it names source
#                          comments as one of the places identifiers BELONG. That is the
#                          whole reason, and it is deliberately the only one. DO NOT REASON
#                          ABOUT THIS BOUNDARY FROM WHAT REACHES `dist/`. Two drafts of the
#                          `ncpdp` copy tried and both were false, each caught by a refuter.
#                          Measured here too, and the measurement differs from `ncpdp`'s in a
#                          way that would mislead if copied rather than re-taken: this repo's
#                          tsup config STRIPS `//` comments from `dist/index.mjs` and
#                          `dist/index.cjs` (zero of them survive, checked), where `ncpdp`
#                          measured 45 carried through verbatim. It changes NOTHING, because
#                          `dist` is `files[0]`, there is no `.npmignore`, and `dist/*.map`
#                          carries every tracked source byte in `sourcesContent` (checked: a
#                          `//` comment reading "(Phase 2)" is in there), SO EVERYTHING IN
#                          `src/` IS IN THE TARBALL EITHER WAY. That is exactly why the
#                          boundary must not be argued from reachability. This
#                          gate's line is therefore not "what reaches the consumer's disk"
#                          (all of it does) but WHAT THE CONSUMER IS SHOWN: JSDoc their
#                          editor renders on hover, and message text their log prints. Those
#                          are passes three and four. A comment they would have to go digging
#                          for is not.
#   * dist/                NOT SCANNED, and this is the gate's stated ceiling rather than a
#                          closed hole. `dist/` is untracked build output: neither this
#                          script nor CI can read it without building first, and this script
#                          does not build. What the third pass gates is dist's SOURCE, a
#                          proxy that holds only because the dts build copies doc text
#                          verbatim. MEASURED ON THE BASE COMMIT, with these rules: built
#                          `dist/index.d.ts` carried 45 violating lines (43 of them rule 2,
#                          1 rule 3, 1 rule 5); it carries 0 after the source sweep, so
#                          the proxy held on this tree. A build that began transforming
#                          comments would decouple the two silently.
#
# ---------------------------------------------------------------------------
# NO STDIN / PR-TEXT MODE, deliberately. This rule says identifiers BELONG in the commit, the
# PR and the changeset, so a PR-text half here would red on correct work. The half that keeps
# identifiers out of a published RELEASE BODY exists and is not here: `cosyte/.github`
# `scripts/release-notes.mjs assert` runs inside the shared release pipeline and refuses to
# publish a violating body.
#
# ---------------------------------------------------------------------------
# DISCLOSED RESIDUALS. Known and stated rather than discovered later.
#
#   (i)   THE PREFIX LIST IS DUPLICATED across every copy of this gate and against
#         release-notes.mjs, because a bash gate inside a package repo cannot import from
#         `cosyte/.github` and vendoring a 900-line Node script into 11 repos is worse. So
#         the copies can drift. The cross-repo fix is ONE SHARED LIST (published as data by
#         `cosyte/.github`, or as a `@cosyte/*` package), and it is ONE fix across every copy
#         rather than one per repo. Do not patch this copy alone; a divergent variant is
#         worse than a known shared limit. This copy's list is `hl7`'s CHARACTER FOR
#         CHARACTER, and the three rule widenings named at the top are flagged for that same
#         shared fix.
#   (ii)  The scan reads file CONTENTS, never file NAMES. A tracked path that itself carries
#         an identifier passes green.
#   (iii) An identifier inside a fenced code block, a URL, or a link target is treated exactly
#         like prose. Deliberate (a reader sees it either way), but a legitimate quotation of
#         an internal path in an example would have to be rewritten rather than escaped.
#   (iv)  This gate does not check the em dash. That rule is `check-no-emdash.sh` in the
#         sibling repos that have it; THIS REPO HAS NO SUCH SCRIPT YET (queued on
#         `EMDASH-CONFORMANCE`), and adding one is not this gate's job. Note that this
#         package's own public surface DOES contain em dashes today; they are out of scope
#         here and were left untouched.
#   (v)   IT CATCHES IDENTIFIERS, NOT PROSE ABOUT OUR PROCESS. The founder's rule bans both.
#         "establishing the message-map -> resource-graph pattern the later phases reuse",
#         "see the 'last verified' note in the repo doc" and "see the roadmap for the full
#         non-goals" were all live on this package's public surface and were removed BY HAND
#         alongside this gate. No pattern would have found them: they are ordinary English
#         sentences whose only fault is that they describe how the artifact came to exist.
#         THE BY-HAND HALF IS NOT CLAIMED COMPLETE and should not be. This gate raises the
#         floor; it does not replace the reviewer.
#   (vi)  `phase` AT THE END OF A CLAUSE IS NOT CAUGHT. Rule 2 keys on `phase` plus a
#         FOLLOWING word, so `phase models` reds but `phase.` / `phase;` / `phase)` does not.
#         THAT SHAPE WAS THE ENTIRE STRING-LITERAL BACKLOG IN THIS REPO: the one runtime
#         warning message carrying our bookkeeping read "... its conversion is deferred to a
#         later phase); dropped." and the fourth pass DID NOT MATCH IT. It was a reviewer
#         catch. The determiner form was written, measured and REMOVED in the `hl7` copy
#         because of what it cost in clinical phrasing ("the phase of the clinical study",
#         "the phase of illness"); that verdict is inherited rather than re-litigated. The
#         paragraph-joined passes narrow it: `phase` at a line end followed by more prose in
#         the same paragraph DOES red, because the join makes the next word adjacent.
#  (vii)  `D-NN`-STYLE SINGLE-LETTER INTERNAL LABELS ARE NOT CAUGHT, deliberately. Catching
#         them needs a single-letter prefix, and that is trap (1) with a sharp edge in a
#         clinical package: legacy SNOMED RT codes are axis-prefixed in exactly that shape
#         (`D-13000` topography, `T-32000`, `M-80003`). This repo does not use `D-NN` labels
#         today; the non-catch is stated so a future one is a known gap, not a surprise.
# (viii)  A VIOLATION SPLIT BY INLINE MARKUP REJOINS IN NEITHER PASS. `phase **8**` and
#         `phase [8](...)` put markup between the two tokens, and neither the line scan nor
#         the paragraph join strips it. Closing it needs a markdown renderer, not a bigger
#         regex. REACHABLE HERE: this repo's docs and doc comments bold heavily.
#   (ix)  THE THIRD PASS CANNOT SEE `dist/`, only its source. Stated at length in SCAN
#         SURFACE and repeated here because it is the single most important thing to know
#         about what this gate does and does not prove.
#   (x)   RULE 4 (`slice`) FALSE-POSITIVES ON "the slice of Y" IN CODE PROSE, where `slice`
#         means portion and is nobody's jargon. Measured zero instances on this tree; the
#         `.slice(` calls in `src/` are not preceded by a determiner so they do not match. If
#         one appears where no rewrite reads well, that is the signal to narrow the rule and
#         assert the phrasing in SRC_NEGATIVE[3], not to widen an exclusion quietly.
#   (xi)  A DOC COMMENT THAT DOES NOT OPEN ITS OWN LINE IS INVISIBLE TO THE THIRD PASS. The
#         extractor enters a block only on `^[[:space:]]*/**`, so `const x = 1; /** ... */`
#         is scanned by neither pass 3 nor pass 4. Not fixed, because entering mid-line means
#         tracking whether the `/**` is itself inside a string or a regex, which is a
#         tokenizer. Prettier puts a doc comment on its own line and `format:check` runs
#         ahead of this gate on the ladder, so the construct does not occur here today.
#  (xii)  MEASURE ON THE REFLOWED TEXT, NOT LINE BY LINE, when you sweep by hand. And QUOTE A
#         COUNT WITH THE TREE IT WAS TAKEN ON, OR NOT AT ALL.
# (xiii)  THE BARE `(§4.7)` ROADMAP-SECTION CITATION IS NOT GUARDED, and this is the largest
#         single hole in this copy. THE ARITHMETIC, measured on `e6c4531` and written out
#         because a first draft of this file got it wrong twice: 51 `src/` doc-comment lines
#         carried a `§` citation. 19 of them carry the WORD `roadmap` on the same line and a
#         20th citation wraps onto the next line; those 20 are what rule 2's new arm catches.
#         The other 32 lines carry no `roadmap`. FOUR of those 32 are caught anyway, by rule
#         2's ORDINARY `phase` arm, because they read `§Phase N` rather than `§4.7`. That
#         leaves 28 genuinely unguarded bare section numbers. All 51 lines were cleared by
#         hand. A bare-`§` rule was considered and NOT written: `§` is ordinary
#         typography in a standards-heavy package (a spec citation a consumer genuinely
#         wants), so keying on it alone would be trap (1) arriving through punctuation. This
#         is the "where a rule cannot be guarded, CUT it rather than harden it" call, made
#         deliberately: the instances are gone, the rule is not there to keep them gone.
#
# Run it locally with `pnpm check:no-internal-refs`.
set -euo pipefail

# LOCALE PIN, load-bearing, and inherited from check-no-emdash for the same measured
# reason: `grep -P` compiles PCRE in UTF-8 mode only when the locale says so. Under
# LC_CTYPE=POSIX (a bare container, cron, `sh -c`) GNU grep's handling of non-ASCII in the
# input and of `\w` in the pattern changes, and the docs scanned here contain non-ASCII
# (the en dash in "Phases 6-7", `§`, curly quotes). A gate whose matching depends on an
# inherited environment is a gate that reports green somewhere and red elsewhere.
export LC_ALL=C.UTF-8

# ---------------------------------------------------------------------------
# THE BANNED SET, transcribed from release-notes.mjs CONTENT_RULES
# ---------------------------------------------------------------------------

# Known project and programme prefixes. THE KEYING IS ON THESE, NEVER ON THE `WORD-N` SHAPE:
# see trap (1). This list is `hl7`'s CHARACTER FOR CHARACTER, `SYNTH` included.
#
# `SYNTH` IS KEPT HERE AND IS ABSENT FROM `ncpdp`'s COPY, and the difference is measured
# rather than stylistic: that repo's runnable examples use synthetic message ids that say so
# in their value (`SYNTH-MSG-0001`), so the prefix reds on nine lines of correct example
# data there. Measured on this tree, `SYNTH` appears ZERO times on the public surface and in
# `src/`, so keeping it costs nothing and keeps this copy diffable against the reference.
# Asserted in NEGATIVE[0] the other way round: nothing here depends on `SYNTH` matching.
#
# `PKG` is absent for `hl7`'s reason (`PKG-1`/`PKG-4` are HL7 v2 Chapter 17 Item Packaging
# segment-field references, which an HL7 v2 consumer can legitimately write). Kept absent so
# the copies stay diffable, and because it has never been minted as an item anywhere.
PROJECT_PREFIXES='PARSERS-PUBLIC|DOCS-CONTENT|KNOWLEDGEBASE|TERMINOLOGY|PATHWAYS|TRANSFORM|WEBSITE|STAGING|SUPPLY|NCPDP|ASSETS|EMDASH|README|CONFIG|DICOM|SYNTH|DEID|CCDA|ASTM|MLLP|FHIR|CREW|DOCS|PERF|SYNC|VERSION|PUBLIC|HL7|X12|IAC|CLI|KB|PW|PUB|CI|REAL|TERM|WF|VERIFY'

# STANDARDS DESIGNATIONS THAT COLLIDE WITH THE PREFIX LIST, excluded explicitly. Carried from
# `hl7` VERBATIM, including the `HL7-\d{3,4}` arm that `ncpdp` deliberately dropped -- and the
# split is the point. `ncpdp` dropped it because a pharmacy parser's docs have no v2 table
# convention. THIS PACKAGE IS AN HL7 v2 CONSUMER: its whole vocabulary is v2 tables (HL70162
# route, HL70200 name-use, HL70203 identifier-type, HL70485 priority), so it shares `hl7`'s
# collision profile, not `ncpdp`'s, and `HL7-0203` is reference material a reader needs.
# Measured: `HL7-` appears zero times on this tree today, so the arm currently exempts
# nothing; it is carried because the FORM is one this package may legitimately write, which
# is the opposite of the situation that justified dropping it next door.
#
# There is no shape that separates a designation from an identifier, so the separation is an
# explicit, reviewable exclusion list -- the same bargain as keying on prefixes: it must be
# extended by hand, and that is the cheaper mistake. Every entry is asserted in NEGATIVE[0].
STANDARDS_DESIGNATION='HL7-(?:V2|V3|CDA|FHIR|OMG|\d{3,4}[A-Z]?)|FHIR-R\d[A-Z]?|DICOM-(?:SR|RT|SEG|DIR|PS\d)|NCPDP-(?:SCRIPT|TELECOM|D\.\d)|X12-\d{3}[A-Z]?|X12-\d{6}|CCDA-R\d(?:\.\d)?|ASTM-E\d+'

# Rule 1: internal project identifier. CASE SENSITIVE, and the segment after the hyphen must
# start with an uppercase letter or a digit, which is what lets `FHIR-bridge`, `FHIR-core`,
# `FHIR-required` and `HL7-defined` through (trap 3).
#
# THE COLLISIONS THIS RULE HAS TO SURVIVE IN A v2-TO-FHIR MAPPER ARE THE WHOLE REPO.
# Segment-field references (`MSH-9`, `PID-3`, `PV1-44`, `OBX-5`, `OBR-25`, `RXA-20`, `SCH-8`,
# `NK1-4`, `TXA-19`, `ORC-12`, `RXO-9`, `RXR-1`) are typographically identical to an item
# identifier and are the reference material every doc comment in this package is made of.
# They survive for one reason only: their leading token is not on the prefix list. NEVER
# re-key this rule on the `WORD-N` shape. All of them are asserted in NEGATIVE[0] and
# SRC_NEGATIVE[0] so a later "simplification" reds here instead of deleting them.
#
# The second alternative is our internal priority label, and it matches its own trailing word
# rather than looking ahead for one: an earlier version keyed on `P\d+` followed by
# end-of-string or a comma, which is the shape rule this file exists to avoid. It deleted the
# ICD-10-CM code in "Map ICD-10 P07, P22 and P29 to SNOMED CT" and truncated the code range
# "P00-P96". Corrupting a diagnosis code to remove an internal label is not a trade worth
# making.
RULE_NAME[0]='internal project identifier'
RULE_PATTERN[0]='\b(?!(?:'"$STANDARDS_DESIGNATION"')\b)(?:'"$PROJECT_PREFIXES"')(?:-[A-Z0-9][A-Z0-9.]*)+\b|\bP\d+ (?:safety|documentation)\b'

# Rule 2: phase and wave language, plus roadmap-section citations. CASE INSENSITIVE via the
# inline `(?i)`, because the rules do not share a case policy and one `grep -i` for all of
# them would break trap (3). `Phase 5b` and `Phase W` are both covered (trap 4). The negative
# lookahead keeps ordinary English off the list, so "in phase with the source system" and
# "out of phase" survive.
#
# THE CLINICAL LOOKBEHINDS AND `hl7`'s CSP FIELD-NAME LOOKAHEAD ARE BOTH KEPT VERBATIM, and
# both are kept for the same reason: they only ever EXCLUDE, so neither can cause a miss of
# our jargon, and diverging from the reference to delete an alternation buys nothing.
# `study|clinical|trial|acute|chronic|luteal|follicular|liquid|gas` are ordinary clinical
# English this package's docs can reach for. `identifier|start|end|evaluability|number` exempt
# the field names of the HL7 v2 Chapter 7 `CSP` Clinical Study Phase segment (`CSP-1 Study
# Phase Identifier`, `CSP-2 Study Phase Start Date/Time`, ...). Measured: `CSP` appears zero
# times on this tree today, but this is an HL7 v2 library and CSP is HL7 v2 vocabulary, so the
# construction is one it may legitimately write. A bare `Phase III` is still flagged, because
# it is genuinely ambiguous with an internal single-letter item and a loud red on a rare line
# beats a silent hole.
#
# `phase[ -]` rather than `phase ` is kept: `Phase-L` was live in `hl7`'s docs and slipped a
# space-only rule, and `Phase-1`/`Phase-6` were live in THIS repo's doc comments.
#
# TWO WIDENINGS ON `hl7`'s PATTERN, both named at the top of this file:
#   * `phases?` (from `ncpdp`). Measured live here: "Phases 1-6" in the README, intro and
#     `src/index.ts`, and "the later phases reuse" in `src/messages/to-fhir.ts`.
#   * `roadmap[ ]?§?` (THIS REPO's). `hl7` writes "roadmap Phase K"; this repo wrote
#     "(roadmap §4.5)" and "(roadmap §Phase 5)" 20 times, across 19 doc-comment lines plus
#     one wrapped onto the next. Completing the existing `roadmap phase` arm rather than
#     inventing a rule. Asserted in POSITIVE[1]. The BARE `(§4.7)` form is NOT covered --
#     residual (xiii), a deliberate stop, with the arithmetic written out there.
ORDINAL='(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth|thirteenth|fourteenth|fifteenth|sixteenth|seventeenth|eighteenth|nineteenth|twentieth|twenty-first|twenty-second|twenty-third|twenty-fourth|\d+(?:st|nd|rd|th))'
PHASE_NOT_CLINICAL='(?<!study )(?<!clinical )(?<!trial )(?<!acute )(?<!chronic )(?<!luteal )(?<!follicular )(?<!liquid )(?<!gas )'
PHASE_NOT_FIELD='(?!of\b|with\b|in\b|out\b|the\b|and\b|is\b|for\b|to\b|identifier\b|start\b|end\b|evaluability\b|number\b|(?:I{1,3}|IV)\s+(?:trial|stud|clinical|oncolog))'
RULE_NAME[1]='phase, wave or roadmap-section language'
RULE_PATTERN[1]='(?i)\b(?:roadmap[ ]?§?[ ]?phases?\b[ ]?[A-Za-z0-9]*|roadmap[ ]?§[ ]?\d|'"$PHASE_NOT_CLINICAL"'phases?[ -]'"$PHASE_NOT_FIELD"'[A-Za-z0-9]+[a-z]?\b|wave \d+\b|the \w+ and final phase\b|documentation residual\b|'"$ORDINAL"' (?:slice|wave)\b)'

# Rule 3: ADR references. An ADR number is a pointer into a decision record the reader did not
# come here for. THIS REPO HAS TWO OF ITS OWN (`documentation/decisions/0001-...`, `0002-...`),
# which is exactly why the rule is kept rather than dropped as `hl7`-shaped: the temptation to
# cite them by number from the README is live, and one live citation ("ADR 0018 applied to
# mappings") was measured in `src/messages/immunization.ts`. Cite what the decision WAS, not
# the number it has.
#
# `/` IS ADDED TO THE SEPARATOR CLASS (from `ncpdp`), where three live citations written as
# PATHS survived a whole gate because a space-or-hyphen class cannot see them. It costs
# nothing here and closes the same hole. Note that THIS repo writes its ADR paths as
# `documentation/decisions/0001-...`, which RULE 5 catches, not this one; the `/` arm covers
# the `adr/0001` form a page copied from a sibling would bring along.
#
# THE `\d{3,4}` FLOOR IS INHERITED AND IS A KNOWN GAP: `ADR 7` and `ADR-12` are not caught.
# Left as `hl7` has it, because every ADR in this ecosystem is written four-digit and lowering
# the floor to `\d{1,4}` would start matching ordinary two-digit numbers after any three
# letters that happen to spell `adr`. Worth knowing here: `"ADR"` is also a live STRING VALUE
# in this package (an HL7 v2 route-of-administration code in `src/terminology/concept-map.ts`),
# and it passes green precisely because the rule requires digits after it.
RULE_NAME[2]='ADR reference'
RULE_PATTERN[2]='(?i)\bADR[ \-/]?\d{3,4}\b'

# Rule 4: `slice`, our internal word for a unit of work. It is ALSO real clinical vocabulary
# elsewhere in this ecosystem: a DICOM study has slices, with a slice thickness, a slice
# location and slice spacing. So this keys on the determiner forms that are unambiguously ours
# ("this slice", "the final slice") and excludes the imaging nouns. A bare `slice` is
# deliberately NOT flagged: across this corpus that word is more often the reader's than ours,
# and in THIS package it is overwhelmingly `String.prototype.slice` in TypeScript.
#
# THE IMAGING-NOUN EXCLUSION IS KEPT VERBATIM even though this package documents v2-to-FHIR
# mapping and reaches for none of it. It only ever EXCLUDES, so it cannot cause a miss of our
# jargon; diverging from the sibling copies to delete an unused alternation would make the
# copies harder to diff for no safety gained (residual (i)).
#
# `phase` IS DELIBERATELY NOT MATCHED HERE. A refuter pass on the `hl7` copy added it to catch
# "non-goals of this phase"; the next pass measured what it cost and the answer was ordinary
# clinical English: "the phase of the clinical study", "the phase of illness". No modifier
# exclusion list rescues that, because the collision is with the HEAD noun rather than the
# modifier. That verdict is inherited, not re-litigated: rule 2 still catches `phase X`, and
# "of this phase" with no following identifier is the reviewer's catch in residual (vi).
IMAGING_NOUNS='thickness|location|spacing|position|interval|order|number|index|gap|count|data|pixel|orientation|plane|direction|width|vector|sensitivity|progression|factor'
RULE_NAME[3]='internal jargon ("slice")'
RULE_PATTERN[3]='(?i)\b(?:this|that|the|each|another|previous|next|final|current)\s+(?:(?!(?:of|in|on|between|per|for|to|with|at)\s)[\w-]+\s+){0,2}slices?\b(?!\s+(?:'"$IMAGING_NOUNS"'))'

# Rule 5: internal repo paths. A docs page carries citations, and a reader who installs
# @cosyte/transform has no meta-repo and no such file. One live instance was measured in
# `src/index.ts` ("see `operations/roadmaps/transform.md`"), rendered in every consumer's
# editor. Keyed on the known meta-repo paths, not on a `dir/file.md` shape, for exactly the
# reason trap (1) gives -- this package's own pages legitimately cite `docs-content/` files.
#
# THE `documentation/decisions/` ARM DOUBLES AS THIS REPO'S OWN ADR-PATH GUARD, which is not
# true in the siblings: `hl7` and `ncpdp` keep their ADRs under `docs/adr/`, this repo keeps
# them under `documentation/decisions/` -- the same path the meta-repo uses. One pattern, two
# jobs, and both of them wanted.
RULE_NAME[4]='internal repo path'
RULE_PATTERN[4]='\boperations/(?:BACKLOG\.md|roadmaps/|plans/)|\bdocumentation/(?:decisions/|ecosystem-map\.md|conventions\.md)|\bBACKLOG\.md\b'

# Rule 6: internal traceability markers. Bracketed spec-trace tags that key into a roadmap
# traceability table, and "Open-question #12" pointers into a decision log the reader cannot
# open. Zero instances measured on this tree; the rule is carried because the convention that
# produces them is shared across the repos and a page copied from a sibling would bring them
# along. Both are DELIMITER-ANCHORED rather than shape-keyed, which is the only reason they
# are safe: the tag rule requires a literal `[S-` opening bracket and at least two characters
# after it, so a documented character range like `[S-Z]` does not match, and neither does a
# value set written `[SNOMED]`.
RULE_NAME[5]='internal traceability marker'
RULE_PATTERN[5]='\[S-[A-Z][A-Z0-9]+(?:-[A-Z0-9]+)*\]|(?i:\bopen[- ]question #?\d+\b)'

RULE_COUNT=6

# ---------------------------------------------------------------------------
# THE `src/` DOC-COMMENT RULE SET, deliberately a SEPARATE ARRAY
# ---------------------------------------------------------------------------
#
# WHY A SECOND SURFACE EXISTS AT ALL. The block above scans markdown a reader browses.
# This one scans the JSDoc a consumer's EDITOR renders: `src/` doc comments are compiled
# into `dist/index.d.ts` and `dist/index.d.cts` by tsup, `dist` is the first entry in
# package.json's `files`, and every `npm i @cosyte/transform` receives them. It is BY FAR
# THE LARGER of the two surfaces in this repo, not an afterthought: measured on the base
# commit of the change that added this gate, and with the rule set that ships beside it,
# tracked `src/**/*.ts` carried 54 matching doc-comment lines plus 29 blocks that matched
# only once reflowed, against 32 lines on the whole public markdown surface. Among them, an
# exported issue code documented as "deferred to a later phase" and a module header reading
# "Phase 2 covers the ADT family" -- sentences that tell a consumer nothing except that we
# build in phases.
#
# WHY A SEPARATE ARRAY RATHER THAN REUSING RULE_PATTERN. Code comments are not markdown.
# The two surfaces have different collision profiles (TypeScript prose says
# `dob.value.slice(0, n)`; markdown says "the thirteenth slice"), different wrap
# shapes, and different self-test material. Sharing one array would mean a fix for one
# surface silently retunes the other, and the negative self-test that caught it would be in
# the wrong file's language. They START identical. They are ALLOWED to diverge, and when
# they do, each side's NEGATIVE sample is what stops the divergence from being a widening.
#
# WHAT IS SCANNED, precisely: only text inside `/** ... */` blocks. NOT `//` line comments
# and NOT `/* */` block comments, and that boundary is the whole point rather than a
# convenience. `/** */` is what the dts build carries into `dist`; `//` is not. The
# convention names source comments as a place identifiers BELONG. So the line this draws is
# exactly the founder's line: what a CONSUMER receives is public and is swept; what only a
# maintainer reads stays internal.
#
# REMOVING A DOC COMMENT TO SATISFY THIS PASS IS A REGRESSION, NOT A FIX. JSDoc with an
# `@example` on every public export is a hard guardrail in CLAUDE.md and the JSDoc lint
# rule is an error, but neither lint nor coverage notices prose deleted from the middle of
# a block. Rewrite the sentence to say what the software does.
SRC_RULE_NAME[0]="${RULE_NAME[0]}"; SRC_RULE_PATTERN[0]="${RULE_PATTERN[0]}"
SRC_RULE_NAME[1]="${RULE_NAME[1]}"; SRC_RULE_PATTERN[1]="${RULE_PATTERN[1]}"
SRC_RULE_NAME[2]="${RULE_NAME[2]}"; SRC_RULE_PATTERN[2]="${RULE_PATTERN[2]}"
SRC_RULE_NAME[3]="${RULE_NAME[3]}"; SRC_RULE_PATTERN[3]="${RULE_PATTERN[3]}"
SRC_RULE_NAME[4]="${RULE_NAME[4]}"; SRC_RULE_PATTERN[4]="${RULE_PATTERN[4]}"
SRC_RULE_NAME[5]="${RULE_NAME[5]}"; SRC_RULE_PATTERN[5]="${RULE_PATTERN[5]}"
SRC_RULE_COUNT=6

# ---------------------------------------------------------------------------
# THE `src/` STRING-LITERAL RULE SET: the fourth pass, and the one hl7 does not have
# ---------------------------------------------------------------------------
#
# WHY IT EXISTS, AND WHY IT IS NOT IN THE COPY THIS FILE WAS PORTED FROM. A parser's most
# widely read text is not its README and not its JSDoc: it is its WARNING MESSAGES. Every
# quirk this library tolerates surfaces as a `message` string that a consumer prints to a
# log, shows in a UI, or pastes into a support ticket. Those strings are neither markdown
# nor doc comments, so the three passes above walk straight past them.
#
# MEASURED, not assumed, on the base commit of the change that added this gate. `ncpdp` had
# SIX such messages; THIS REPO HAD ONE, the `TRANSFORM_ELEMENT_DROPPED` message text:
#   "populated source element was not carried to its FHIR target (no target in this map, or
#    its conversion is deferred to a later phase); dropped."
# It is gone. IT WAS NOT FOUND BY A RULE, AND THIS PASS DID NOT FIND IT EITHER. Say that
# plainly rather than let the pass imply otherwise: it ends the clause at `phase` (`phase)`),
# which is residual (vi), the shape rule 2 deliberately does not cover because the
# determiner-plus-`phase` form collides with ordinary clinical English. It was a reviewer
# catch, found by reading every string literal in `src/` by hand.
#
# SO WHAT IS THIS PASS WORTH? It closes the SURFACE, not that one shape. An item identifier
# (`(TRANSFORM-7)`), an ADR number, a meta-repo path, a `Phase 9` with a following token, or a
# traceability tag written into a warning message is caught here and is caught nowhere
# else. Rule 1 is the highest-value rule in this file and it had no reach into a string at
# all. A surface with no gate on it regresses silently; a surface with a gate that shares
# one stated residual regresses loudly for everything except that residual. Both halves of
# that sentence are true and neither is the whole story.
#
# THE FALSE-POSITIVE RISK WAS MEASURED BEFORE THE PASS WAS ADDED, because a rule over code
# strings is the obvious place for one. In `ncpdp` it was all six rules over 2,528 literals
# for zero matches; measured again here on the remediated tree, also ZERO. The material that
# had to survive is this package's own: import specifiers, the `TRANSFORM_*` issue-code
# constants (underscored, so rule 1's hyphen requirement never fires), the FHIR element and
# status literals ("planned", "entered-in-error", "data-absent-reason"), the canonical system
# URIs, and the v2 route/site code tables -- including the literal `"ADR"`, an HL7 v2
# route-of-administration code that passes only because rule 3 requires digits after it. The
# rules are therefore reused whole rather than trimmed: a narrowed copy would have no
# measurement behind it.
#
# WHAT IS SCANNED, precisely: double-quoted and backtick literals on lines that are NOT
# whole-line comments. Three boundaries, each deliberate:
#   * WHOLE-LINE COMMENTS ARE SKIPPED (`//`, `/*`, `/**`, and a continuation ` *`). Pass
#     three owns doc comments, and `//` comments are deliberately out of scope for the
#     whole gate: the convention names source comments as a place identifiers BELONG.
#     Without this skip, a `//` comment that happens to contain a backticked
#     symbol would be scanned as a string and the stated boundary would quietly move.
#   * A TRAILING COMMENT ON A CODE LINE IS STILL SCANNED. Accepted rather than solved:
#     splitting a trailing comment off needs a tokenizer, and the failure mode is an
#     over-report on a line a maintainer can read in one second.
#   * SINGLE-QUOTED LITERALS ARE NOT SCANNED. Prettier (`@cosyte/prettier-config`) emits
#     double quotes, `format:check` runs ahead of this gate on the verify ladder, and
#     tracked `src/` contains no single-quoted string. Including `'` would instead capture
#     comment prose between two apostrophes, which would drag `//` comments into scope
#     through the back door.
#   * A MULTI-LINE TEMPLATE LITERAL IS SCANNED PER LINE, so a violation split across its
#     line breaks is missed. Under-reports rather than over-reports. There is no reflow
#     pass here because a reflow would have to model template continuation, and the fix
#     for a missed one is the same as for any residual: the reviewer.
STR_RULE_NAME[0]="${RULE_NAME[0]}"; STR_RULE_PATTERN[0]="${RULE_PATTERN[0]}"
STR_RULE_NAME[1]="${RULE_NAME[1]}"; STR_RULE_PATTERN[1]="${RULE_PATTERN[1]}"
STR_RULE_NAME[2]="${RULE_NAME[2]}"; STR_RULE_PATTERN[2]="${RULE_PATTERN[2]}"
STR_RULE_NAME[3]="${RULE_NAME[3]}"; STR_RULE_PATTERN[3]="${RULE_PATTERN[3]}"
STR_RULE_NAME[4]="${RULE_NAME[4]}"; STR_RULE_PATTERN[4]="${RULE_PATTERN[4]}"
STR_RULE_NAME[5]="${RULE_NAME[5]}"; STR_RULE_PATTERN[5]="${RULE_PATTERN[5]}"
STR_RULE_COUNT=6

# ---------------------------------------------------------------------------
# SELF-TESTS. A gate is believed only after it has shown it can still see.
# ---------------------------------------------------------------------------
#
# Two halves, and the second is the one that is unusual. POSITIVE samples prove each rule
# still matches what it bans (the check-no-emdash property: refuse to report a clean tree
# from a scanner that cannot see). NEGATIVE samples prove each rule still lets through the
# reference material it was most likely to destroy, which is trap (1) turned into an
# assertion: if someone "simplifies" the identifier rule to a `WORD-N` shape, the negative
# self-test reds here instead of silently deleting `HL7-V2` and `PID-3` from a v2-to-FHIR
# mapper's docs on the next sweep. Both halves run on every invocation, local and
# CI, and both refuse rather than warn.

self_test_fail() {
  echo "ERROR: check-no-internal-refs - SELF-TEST FAILED: $1" >&2
  echo "       The scanner is not behaving as specified, so no result from it can be" >&2
  echo "       believed. Refusing to report on the tree." >&2
  exit 1
}

# rule index -> text that MUST match. Every sample is written in THIS repo's own
# vocabulary, so a reader can tell what the rule is for without opening another package.
POSITIVE[0]='Item TRANSFORM-6 is done, and CCDA-P7 with it'
POSITIVE[1]='Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2), Phases 6 and 7 preceded it, and it is cited as roadmap Phase K, roadmap 4.5 and roadmap Phase 5'
POSITIVE[2]='Decided in ADR 0015, restated in ADR-0021, and recorded in adr/0001-tier-dependency.md'
POSITIVE[3]='This slice adds the compound helper and the final slice removes it'
POSITIVE[4]='Roadmap operations/roadmaps/transform.md and documentation/decisions/0001-x.md'
POSITIVE[5]='Repeating [S-SIG], and Open-question #12 resolves the direction'

# rule index -> text that must NOT match. Every entry is real reference material from an
# NCPDP, HL7, X12 or FHIR context, real example data from this package's own docs, or
# ordinary English that collides with our jargon.
NEGATIVE[0]='the segment-field references this package is made of -- MSH-9, PID-3, PID-5, PV1-2, PV1-44, NK1-4, OBR-25, OBX-5, OBX-11, RXA-20, RXO-9, RXR-1, SCH-8, TXA-19, ORC-12, CX.4 and XPN.7; the v2 tables HL70001, HL70085, HL70162, HL70203 and HL70485, and a hyphenated table HL7-0203; FHIR-core-fixed systems, a FHIR-required element, FHIR-bridge stability, docs-content/ layout, HL7-defined tables, HL7-V2 and HL7-CDA, FHIR-R4, DICOM-SR, NCPDP-SCRIPT, X12-837P and X12-005010, ICD-10-CM P00-P96, 835 remittance'
NEGATIVE[1]='A Phase III oncology trial and a Phase II study; the clinical phases of a drug programme; the acute phase reactant; luteal phase dosing and follicular phase dosing; the liquid phase of a preparation; the CSP-1 Study Phase Identifier and CSP-2 Study Phase Start Date/Time; the adapter stays in phase with the source system and is out of phase'
NEGATIVE[2]='ADR is a route-of-administration code, not a decision record, and 0015 alone is a value'
NEGATIVE[3]='The slice thickness and the number of slices are DICOM attributes, each slice location is too; dob.value.slice(0, tIndex) and raw.slice(0, 4) are TypeScript; and the phase of the clinical study, the phase of illness and each phase of the trial are the reader words this rule must not touch'
NEGATIVE[4]='Parser operations are documented in the README, and documentation for the API is generated'
NEGATIVE[5]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

# THE THREE WIDENINGS EACH GET THEIR OWN ASSERTION, separate from the array loop, and the
# reason is that the array samples are too RICH to prove them: every array sample carries the
# `hl7` form as well, so all six still match under `hl7`'s narrower patterns. They prove the
# rules work; they do NOT prove the rules still carry the arms this copy added. A "resync with
# hl7" that reverted them would leave the whole suite green while silently reopening the exact
# holes they exist to close -- 20 roadmap-section citations and every plural `Phases 1-6` on
# this tree. So each widened form is asserted ALONE, with nothing else for the rule to match.
ADR_PATH_SAMPLE='Ratified in adr/0001-tier-dependency.md'
if ! printf '%s\n' "$ADR_PATH_SAMPLE" | grep -qP -e "${RULE_PATTERN[2]}"; then
  self_test_fail "rule 'ADR reference' no longer matches an ADR cited as a PATH ('adr/0001-...'). Three live citations survived a whole gate in a sibling repo because of that gap. Do not drop '/' from the separator class."
fi

PHASE_PLURAL_SAMPLE='It ships Phases 1-6'
if ! printf '%s\n' "$PHASE_PLURAL_SAMPLE" | grep -qP -e "${RULE_PATTERN[1]}"; then
  self_test_fail "rule 'phase, wave or roadmap-section language' no longer matches the PLURAL form ('Phases 1-6'), which is the form this repo's README, docs-content and src/ doc comments all wrote. Do not narrow 'phases?' back to 'phase'."
fi

ROADMAP_SECTION_SAMPLE='Grounded on the map (roadmap §4.5)'
if ! printf '%s\n' "$ROADMAP_SECTION_SAMPLE" | grep -qP -e "${RULE_PATTERN[1]}"; then
  self_test_fail "rule 'phase, wave or roadmap-section language' no longer matches a roadmap cited by SECTION NUMBER ('roadmap §4.5'). Twenty live citations in this repo's src/ doc comments were invisible to hl7's pattern. Do not drop the 'roadmap §' arm."
fi

# AND THE OTHER DIRECTION: the BARE section citation must NOT match, because no rule guards it
# (residual (xiii)) and a future reader must not mistake its absence for an oversight. If
# someone adds a bare-`§` rule, this reds -- which is the moment to weigh it deliberately,
# against the spec citations a standards package legitimately writes.
BARE_SECTION_SAMPLE='Grounded on the map (§4.5)'
if printf '%s\n' "$BARE_SECTION_SAMPLE" | grep -qP -e "${RULE_PATTERN[1]}"; then
  self_test_fail "rule 'phase, wave or roadmap-section language' now matches a BARE section citation ('(§4.5)'). That is residual (xiii), a deliberate NON-catch: a bare § is ordinary spec-citation typography in a standards package. If you meant to close it, remove this assertion in its own commit with the argument written down."
fi

i=0
while [ "$i" -lt "$RULE_COUNT" ]; do
  if ! printf '%s\n' "${POSITIVE[$i]}" | grep -qP -e "${RULE_PATTERN[$i]}"; then
    self_test_fail "rule '${RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${NEGATIVE[$i]}" | grep -qP -e "${RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${NEGATIVE[$i]}" | grep -oP -e "${RULE_PATTERN[$i]}" | head -1)
    self_test_fail "rule '${RULE_NAME[$i]}' now matches legitimate reference material (matched: '${hit}'). This is the WORD-N trap: it destroys the standards designations and field references a v2-to-FHIR mapper's docs exist to provide."
  fi
  i=$((i + 1))
done

# The `src/` set gets its OWN self-tests, in the language of the surface it guards. The
# NEGATIVE samples are built from material that is actually present in this package's
# source: HL7 v2 segment-field references in doc comments, the standards designations, and
# TypeScript that reads like our jargon (`dob.value.slice(0, tIndex)`). If someone widens the
# `src` rules into the WORD-N shape, this reds instead of deleting `PID-3` and `OBX-5` from an
# exported function's IntelliSense on the next sweep.
SRC_POSITIVE[0]='Item TRANSFORM-6 is done, and CCDA-P7 with it'
SRC_POSITIVE[1]='Phase 5b closes it (Phase W, Phase-L and the thirteenth slice landed earlier, in wave 2), Phases 6 and 7 preceded it, and it is cited as roadmap Phase K, roadmap 4.5 and roadmap Phase 5'
SRC_POSITIVE[2]='Decided in ADR 0015, restated in ADR-0021, and recorded in adr/0001-tier-dependency.md'
SRC_POSITIVE[3]='This slice adds the compound helper and the final slice removes it'
SRC_POSITIVE[4]='Roadmap operations/roadmaps/transform.md and documentation/decisions/0001-x.md'
SRC_POSITIVE[5]='Repeating [S-SIG], and Open-question #12 resolves the direction'

SRC_NEGATIVE[0]='the segment-field references this package is made of -- MSH-9, PID-3, PID-5, PV1-2, PV1-44, NK1-4, OBR-25, OBX-5, OBX-11, RXA-20, RXO-9, RXR-1, SCH-8, TXA-19, ORC-12, CX.4 and XPN.7; the v2 tables HL70001, HL70085, HL70162, HL70203 and HL70485, and a hyphenated table HL7-0203; FHIR-core-fixed systems, a FHIR-required element, FHIR-bridge stability, docs-content/ layout, HL7-defined tables, HL7-V2 and HL7-CDA, FHIR-R4, DICOM-SR, NCPDP-SCRIPT, X12-837P and X12-005010, ICD-10-CM P00-P96, 835 remittance'
SRC_NEGATIVE[1]='A Phase III oncology trial and a Phase II study; the clinical phases of a drug programme; the acute phase reactant; luteal phase dosing and follicular phase dosing; the liquid phase of a preparation; the CSP-1 Study Phase Identifier and CSP-2 Study Phase Start Date/Time; the adapter stays in phase with the source system and is out of phase'
SRC_NEGATIVE[2]='ADR is a route-of-administration code, not a decision record, and 0015 alone is a value'
SRC_NEGATIVE[3]='The slice thickness and the number of slices are DICOM attributes, each slice location is too; dob.value.slice(0, tIndex) and raw.slice(0, 4) are TypeScript; and the phase of the clinical study, the phase of illness and each phase of the trial are the reader words this rule must not touch'
SRC_NEGATIVE[4]='Parser operations are documented in the README, and documentation for the API is generated'
SRC_NEGATIVE[5]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

# The STRING-LITERAL set gets its own samples too, in the language of a runtime warning
# message. The POSITIVE ones are what the rules DO catch in a message string; the rule-2
# sample is deliberately NOT one of the six real messages this change removed, because
# none of those matched (see the residual note at STR_RULE_NAME) and asserting a sample
# the rule cannot match is how a gate ends up believed for the wrong reason. The NEGATIVE
# ones are real strings from this package's source: the underscored warning codes (which
# must never look like an identifier), an import specifier, the field tables, and a
# REMEDIATED warning message, so a widening that starts flagging correct messages reds
# here instead of on the next pull request.
STR_POSITIVE[0]='TRANSFORM-6 shipped this converter'
STR_POSITIVE[1]='Added in Phase 9 and reworked in phase 10b'
STR_POSITIVE[2]='Behaviour fixed by ADR 0001, recorded in adr/0001-tier-dependency.md'
STR_POSITIVE[3]='Added by the final slice of the converter'
STR_POSITIVE[4]='See operations/roadmaps/transform.md'
STR_POSITIVE[5]='Traced as [S-SIG]'

STR_NEGATIVE[0]='TRANSFORM_ELEMENT_DROPPED and TRANSFORM_CODE_UNMAPPED and TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, ./codes.js and ../terminology/naming-system.js, http://terminology.hl7.org/CodeSystem/v2-0203, the route code ADR, the statuses planned and entered-in-error and data-absent-reason, HL7-V2 and FHIR-R4 and NCPDP-SCRIPT, MSH-9 and PID-3 and OBX-5 and RXA-20'
STR_NEGATIVE[1]='populated source element was not carried to its FHIR target (no target in this map, or its conversion is not implemented); dropped. A Phase III trial and the acute phase reactant are out of scope, and the converter stays in phase with the source system.'
STR_NEGATIVE[2]='ADR is a route-of-administration code, not a decision record, and 0001 alone is a value'
STR_NEGATIVE[3]='birthDate is read as dob.value.slice(0, tIndex). The slice thickness and the number of slices are DICOM attributes.'
STR_NEGATIVE[4]='Parser operations are documented in the README, and documentation for the API is generated'
STR_NEGATIVE[5]='A character range like [S-Z], a value set written [SNOMED], and open questions about the feed'

i=0
while [ "$i" -lt "$STR_RULE_COUNT" ]; do
  if ! printf '%s\n' "${STR_POSITIVE[$i]}" | grep -qP -e "${STR_RULE_PATTERN[$i]}"; then
    self_test_fail "string-literal rule '${STR_RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${STR_NEGATIVE[$i]}" | grep -qP -e "${STR_RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${STR_NEGATIVE[$i]}" | grep -oP -e "${STR_RULE_PATTERN[$i]}" | head -1)
    self_test_fail "string-literal rule '${STR_RULE_NAME[$i]}' now matches a legitimate runtime string (matched: '${hit}'). A warning message a consumer reads must survive this gate; only our bookkeeping must not."
  fi
  i=$((i + 1))
done

i=0
while [ "$i" -lt "$SRC_RULE_COUNT" ]; do
  if ! printf '%s\n' "${SRC_POSITIVE[$i]}" | grep -qP -e "${SRC_RULE_PATTERN[$i]}"; then
    self_test_fail "src rule '${SRC_RULE_NAME[$i]}' no longer matches its own positive sample."
  fi
  if printf '%s\n' "${SRC_NEGATIVE[$i]}" | grep -qP -e "${SRC_RULE_PATTERN[$i]}"; then
    hit=$(printf '%s\n' "${SRC_NEGATIVE[$i]}" | grep -oP -e "${SRC_RULE_PATTERN[$i]}" | head -1)
    self_test_fail "src rule '${SRC_RULE_NAME[$i]}' now matches legitimate reference material (matched: '${hit}'). This is the WORD-N trap, arriving through the source-comment surface: it destroys the field references a v2-to-FHIR mapper's IntelliSense exists to provide."
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# Refusals. Anything the scanner writes to stderr means it did not read everything it was
# given, and an incomplete scan must never print OK. Exit status cannot carry that signal:
# grep exits 1 on "no match", which xargs reports as 123, so "clean" and "died part way
# through the batch" are indistinguishable by code. A match inside input grep classifies
# as binary also arrives on stderr with empty stdout.
# ---------------------------------------------------------------------------
ERRLOG=$(mktemp)
FILELIST=$(mktemp)
SCANLIST=$(mktemp)
NPMBUF=$(mktemp)
REFLOWBUF=$(mktemp)
RAWBUF=$(mktemp)
SRCLIST=$(mktemp)
SRCSCAN=$(mktemp)
DOCLINES=$(mktemp)
DOCMAP=$(mktemp)
DOCFLOW=$(mktemp)
DOCFLOWMAP=$(mktemp)
STRLINES=$(mktemp)
STRMAP=$(mktemp)
trap 'rm -f "$ERRLOG" "$FILELIST" "$SCANLIST" "$NPMBUF" "$REFLOWBUF" "$RAWBUF" \
      "$SRCLIST" "$SRCSCAN" "$DOCLINES" "$DOCMAP" "$DOCFLOW" "$DOCFLOWMAP" \
      "$STRLINES" "$STRMAP"' EXIT

refuse_if_incomplete() {
  [ -s "$ERRLOG" ] || return 0
  cat "$ERRLOG" >&2
  echo "" >&2
  # GNU grep >= 3.5 prints "grep: FILE: binary file matches" on STDERR with nothing on
  # stdout, so a match in input it cannot read as text arrives here rather than in the hit
  # list. Name that case, or the run reds blaming an I/O failure that never happened and
  # sends a reader hunting it. This branch only chooses the wording; every path exits 1.
  if grep -qi 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-internal-refs - the input named above MATCHED a banned pattern," >&2
    echo "       but grep classifies it as binary, so the hit has no line number. Treat it" >&2
    echo "       as a real violation, and repair the file's encoding (it should be UTF-8)." >&2
  fi
  if grep -qiv 'binary file' "$ERRLOG"; then
    echo "ERROR: check-no-internal-refs - the scan reported errors, so it did not read all" >&2
    echo "       of its input. Refusing to report green from an incomplete scan." >&2
  fi
  exit 1
}

fail_with_hits() {
  local what="$1" hits="$2"
  echo "$hits" >&2
  echo "" >&2
  echo "ERROR: check-no-internal-refs - internal project bookkeeping found in ${what}." >&2
  echo "       A consumer reads this surface. Item identifiers, phase and wave language," >&2
  echo "       ADR numbers and meta-repo paths belong in the changeset, CHANGELOG.md, the" >&2
  echo "       commit, the PR and the roadmap. Translate at the boundary: say what the" >&2
  echo "       software does and what changed." >&2
  echo "       When you strip an identifier off the FRONT of a line, repair the head too:" >&2
  echo "       drop a leading orphan parenthetical, strip leading punctuation, recapitalise." >&2
  echo "       Leaving the fragment behind is worse than the text it replaced." >&2
  echo "       Rule: documentation/conventions.md, 'No internal project bookkeeping on a" >&2
  echo "       public surface'." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# Build the scan list
# ---------------------------------------------------------------------------
#
# `git ls-files` is relative to the working directory, so from a subdirectory it lists a
# subtree and the scan would report OK having skipped the rest of the surface. Anchor at
# the top level.
cd "$(git rev-parse --show-toplevel)"

# The public surface, as paths. Each is justified in the SCAN SURFACE note at the top.
SURFACE_PATHS=(README.md LICENSE docs-content)

# Every named surface path must still be tracked. Without this, renaming or deleting
# README.md makes the gate scan less and still print OK, which is the same silent-green
# failure the routes below close, arriving through the file list instead of through grep.
for p in "${SURFACE_PATHS[@]}"; do
  if [ -z "$(git ls-files -- "$p")" ]; then
    echo "ERROR: check-no-internal-refs - the public surface path '$p' is not tracked." >&2
    echo "       Either it was renamed or removed (update SURFACE_PATHS in this script," >&2
    echo "       deliberately), or the scan is about to cover less than it claims." >&2
    echo "       Refusing to report green from a shrunken surface." >&2
    exit 1
  fi
done

# DRIFT TRIPWIRE on the npm tarball. `files` in package.json decides what a consumer
# actually receives, so anything added there is new public surface this gate would not know
# about. Rather than let that pass silently, refuse until someone puts it in SURFACE_PATHS
# or names it below as deliberately excluded.
#
# EVERY entry is checked, not just the prose-looking ones. Filtering `files` down to
# `*.md`/`LICENSE` first would discard `dist` before checking, and so structurally could
# not see the tarball's largest prose payload: the compiled JSDoc in `dist/index.d.ts`. A
# tripwire that cannot see the thing it was built to catch is not a tripwire. The two
# standing exclusions are named with their reasons in SCAN SURFACE above: `CHANGELOG.md`
# (contested, queued) and `dist` (untracked build output this script cannot read; its
# SOURCE is gated by the third pass instead).
command -v node >/dev/null || {
  echo "ERROR: check-no-internal-refs - node is required (to read package.json) and is not" >&2
  echo "       on PATH. Refusing to skip the npm-surface half of this gate." >&2
  exit 1
}
UNKNOWN_TARBALL_DOCS=$(node -e '
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
  // Scanned by this gate:            README.md, LICENSE
  // Excluded deliberately, reasons in SCAN SURFACE: CHANGELOG.md, dist
  const known = new Set(["README.md", "LICENSE", "CHANGELOG.md", "dist"]);
  process.stdout.write((pkg.files ?? []).filter((f) => !known.has(f)).join(" "));
')
if [ -n "$UNKNOWN_TARBALL_DOCS" ]; then
  echo "ERROR: check-no-internal-refs - package.json 'files' ships something this gate does" >&2
  echo "       not cover: $UNKNOWN_TARBALL_DOCS" >&2
  echo "       That is public surface a consumer receives in the tarball. Add it to" >&2
  echo "       SURFACE_PATHS, or record it as a deliberate exclusion in this script." >&2
  exit 1
fi

git ls-files -z -- "${SURFACE_PATHS[@]}" > "$FILELIST"

if [ ! -s "$FILELIST" ]; then
  echo "ERROR: check-no-internal-refs - no tracked public-surface files to scan. Refusing" >&2
  echo "       to report green from a scan that read nothing." >&2
  exit 1
fi

# THE SILENT-GREEN ROUTES, all closed here. This list is NOT a claim of exhaustiveness:
# route (9) was found by a refuter against an hl7 copy whose own comment implied it was
# already complete.
#
#   (1) THE SCANNER CANNOT SEE. Closed by the locale pin and the positive self-tests
#       above, plus the negative self-tests, which are stronger than the em-dash gate's
#       single sample: they also catch a rule widened into the trap (1) shape.
#   (2) AN EMPTY FILE LIST. `xargs` without `-r` runs grep anyway, and grep with no file
#       operand reads STDIN, finds nothing, and exits 0. Closed by `-r` AND by refusing an
#       empty list outright, above and again after the loop.
#   (3) `git ls-files` FAILS (unreadable or corrupt index) AND ITS STATUS IS ERASED. The
#       list is built as its OWN command, not as the head of the pipeline: piped, its
#       status is swallowed by the `|| true` the no-match case needs, and the scan reports
#       OK over an empty list.
#   (4) A PATH THE SCANNER NEVER RECEIVES. `git ls-files` C-quotes any path holding a
#       space, a quote or a non-ASCII byte, so unseparated, grep is handed a name no file
#       has. Closed by `-z` here and `-0` on xargs.
#   (5) A FILENAME PARSED AS AN OPTION. A tracked file named `-q` would silence the whole
#       batch and the gate would print OK. Closed by `-e` before the pattern and `--`
#       after it.
#   (6) A FILENAME READ AS STANDARD INPUT, which `--` does NOT close. `--` stops `-` being
#       parsed as an OPTION; grep then reads the bare operand `-` as STDIN, and xargs
#       points its child's stdin at /dev/null, so a tracked file literally named `-` (a
#       `cmd > -` typo, which `git add -A` stages without complaint) is NEVER OPENED and
#       the gate prints OK and exits 0 over a live violation. Closed by `./`-prefixing
#       every path AS THE LIST IS BUILT, in the loop below rather than through `sed -z`, so
#       the scan stays a single command with the stderr capture bound to all of it and
#       there is no GNU-only stage that has no self-test of its own.
#       BE PRECISE ABOUT REACHABILITY: grep treats only a BARE `-` operand as stdin, and
#       every path this gate scans is emitted by `git ls-files` under a listed surface
#       path. None of those is the repo root today, so the worst a file named `-` can
#       produce is `docs-content/-`, which grep opens normally. The route becomes live the
#       moment SURFACE_PATHS gains a root-level glob or `.`. The prefix is therefore kept
#       as the thing that makes widening the surface safe, not as decoration.
#   (7) AN UNREAD ENTRY THAT IS NOT A MISSED MATCH. `-d skip` silently skips a tracked
#       symlink to a directory: no stderr, so nothing refuses, and the gate goes green
#       having never opened it. `-d skip` is NOT used. The loop refuses a tracked entry
#       that is not a regular file BY NAME instead, which is louder. The `! -L` guard
#       matters: `-d` follows symlinks, so a symlink to a directory tests true and would
#       be skipped as if it were a gitlink.
#   (8) A SCAN THAT DIED PART WAY THROUGH AND REPORTED CLEAN. grep's exit status cannot
#       distinguish that from no-match. Closed by capturing stderr and refusing on any of
#       it; see refuse_if_incomplete.
#   (9) A VIOLATION THAT STRADDLES A LINE WRAP. Not inherited from the em-dash family at
#       all: that gate matches a single character, so line anchoring costs it nothing.
#       Every rule here except the bare identifier is multi-token, and this repo hard-wraps
#       its markdown, so a phase sentence broken across two lines reads perfectly on the
#       rendered page and is invisible to a line scan. Closed by the paragraph-joined
#       second pass at the bottom of this file.
#
# Also, and not a route so much as a standing choice: NO `-I`. `-I` skips anything grep's
# heuristic calls binary, which includes a genuine TEXT file with a broken encoding, so a
# violation inside one would be skipped in silence. This repo's public surface is markdown
# and JSON with no binaries (checked: no tracked file under it holds a NUL byte), so losing
# `-I` makes a future binary a loud red instead of a silent miss. Fail closed, not open.
# `-H` is set so every hit carries its filename: grep omits the name when handed exactly
# one file, which an xargs batch boundary can produce.
: > "$SCANLIST"
gitlinks=0
scanned=0
while IFS= read -r -d '' f; do
  if [ -d "$f" ] && [ ! -L "$f" ]; then
    gitlinks=$((gitlinks + 1))
    continue
  fi
  if [ ! -r "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked file is not readable: $f" >&2
    echo "       Refusing to report green from a scan that could not open its input." >&2
    exit 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked entry is not a regular file: $f" >&2
    echo "       Refusing to report green from a scan that skipped one of its inputs." >&2
    exit 1
  fi
  printf './%s\0' "$f" >> "$SCANLIST"
  scanned=$((scanned + 1))
done < "$FILELIST"

if [ ! -s "$SCANLIST" ]; then
  echo "ERROR: check-no-internal-refs - no public-surface files survived list building." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# The npm metadata is public surface that is not a file of its own. Extract the two fields
# the convention names and scan them as text. Written with a real newline between fields so
# a hit reports a usable line number.
node -e '
  const pkg = JSON.parse(require("fs").readFileSync("package.json", "utf8"));
  const lines = ["description: " + (pkg.description ?? ""), "keywords: " + (pkg.keywords ?? []).join(", ")];
  process.stdout.write(lines.join("\n") + "\n");
' > "$NPMBUF"
if [ ! -s "$NPMBUF" ]; then
  echo "ERROR: check-no-internal-refs - could not read the npm metadata from package.json." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Scan, one rule at a time so a hit can name the rule it broke
# ---------------------------------------------------------------------------
#
# Each rule is its own single command with its own stderr capture, rather than one merged
# pattern: a merged pattern cannot report WHICH rule fired, and "phase language" and
# "internal identifier" want different remediation advice. The cost is N passes over a
# handful of markdown files, which is nothing.
ALL_HITS=""
i=0
while [ "$i" -lt "$RULE_COUNT" ]; do
  : > "$ERRLOG"
  HITS=$(xargs -0 -r grep -H -nP -e "${RULE_PATTERN[$i]}" -- < "$SCANLIST" 2>>"$ERRLOG" || true)
  refuse_if_incomplete

  : > "$ERRLOG"
  NPM_HITS=$(grep -H -nP -e "${RULE_PATTERN[$i]}" -- "$NPMBUF" 2>>"$ERRLOG" || true)
  refuse_if_incomplete
  # Report the npm metadata under a name a reader can act on, not a temp path.
  [ -n "$NPM_HITS" ] && NPM_HITS=$(printf '%s\n' "$NPM_HITS" | sed "s|^${NPMBUF}|package.json (npm metadata)|")

  for block in "$HITS" "$NPM_HITS"; do
    [ -n "$block" ] || continue
    ALL_HITS="${ALL_HITS}[${RULE_NAME[$i]}]"$'\n'"${block}"$'\n'
  done
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# Second pass: the same rules over PARAGRAPH-JOINED text
# ---------------------------------------------------------------------------
#
# WHY THIS EXISTS. Every rule above except the bare identifier is MULTI-TOKEN (`phase X`,
# `wave N`, `this slice`, `roadmap phase K`), grep matches within a line, and this repo
# hard-wraps its markdown by house style. So a violation that happens to straddle a wrap is
# invisible to the line scan, while a reader of the rendered page sees it plainly, because
# markdown folds a soft line break into a space. In the hl7 copy this was not hypothetical:
# a spec-notes page read "... A future phase" / "may add opt-in decode ...", and the gate
# printed OK over it.
#
# So the file is joined the way markdown renders it (consecutive non-blank lines in a
# paragraph become one line, blank lines stay blank) and scanned again. Line numbers are
# lost by construction, so this pass reports the FILE and the MATCHED TEXT, and it reports
# only matches the line pass did not already produce, which keeps a wrapped hit from being
# printed twice in the same run.
#
# It cannot replace the line pass: that one gives line numbers, which is what a remediator
# actually needs. It is additive, and its cost is a second grep per file per rule over a
# handful of markdown files.
while IFS= read -r -d '' f; do
  # WHITESPACE IS SQUEEZED, and that is the whole difference between this pass working and
  # this pass looking as though it works. Joining lines verbatim leaves the continuation
  # line's own indentation in the joined text: an indented wrap produces `phase   may`, and
  # every rule here is written with single spaces, so it does not match. Indented
  # continuations are the DOMINANT wrap shape in this corpus, because the pages are mostly
  # bulleted, so the pass would miss the very case it was added for while reporting that it
  # had run. Squeezing runs of whitespace to one space is also what markdown itself does to
  # a paragraph, so this models the rendered page rather than approximating it.
  : > "$ERRLOG"
  awk '
    /^[[:space:]]*$/ { print ""; next }
    { line = $0; gsub(/[[:space:]]+/, " ", line); sub(/^ /, "", line); printf "%s ", line }
    END { print "" }
  ' "$f" > "$REFLOWBUF" 2>>"$ERRLOG"
  refuse_if_incomplete

  i=0
  while [ "$i" -lt "$RULE_COUNT" ]; do
    : > "$ERRLOG"
    grep -oP -e "${RULE_PATTERN[$i]}" -- "$f" > "$RAWBUF" 2>>"$ERRLOG" || true
    refuse_if_incomplete

    : > "$ERRLOG"
    FLOW_HITS=$(grep -oP -e "${RULE_PATTERN[$i]}" -- "$REFLOWBUF" 2>>"$ERRLOG" || true)
    refuse_if_incomplete

    if [ -n "$FLOW_HITS" ]; then
      # Only what the line pass could not see. An empty RAWBUF means no line-pass match, and
      # `grep -f` with no patterns selects nothing, so -v then keeps every wrapped hit.
      EXTRA=$(printf '%s\n' "$FLOW_HITS" | grep -Fxv -f "$RAWBUF" | sort -u || true)
      if [ -n "$EXTRA" ]; then
        while IFS= read -r m; do
          [ -n "$m" ] || continue
          ALL_HITS="${ALL_HITS}[${RULE_NAME[$i]} / wrapped across lines]"$'\n'"${f}: ${m}"$'\n'
        done <<< "$EXTRA"
      fi
    fi
    i=$((i + 1))
  done
done < "$SCANLIST"

# ---------------------------------------------------------------------------
# THIRD PASS: `src/` DOC COMMENTS, the prose that compiles into `dist/`
# ---------------------------------------------------------------------------
#
# THE CEILING, STATED FIRST, because it is the honest frame for everything below.
# `dist/` is UNTRACKED BUILD OUTPUT. No checked-in gate can scan it without building
# first, and this script deliberately does not build. So the thing a consumer actually
# receives is NOT what is checked here. What is checked is its SOURCE: the `/** */`
# blocks the dts build copies verbatim. That is a PROXY, and it is a good one only
# because the copy is verbatim -- tsup rewrites declarations, not doc text. A rewrite of
# the build that started transforming comments would silently decouple the two, and
# nothing here would notice. This pass therefore raises the floor on `dist/`; it does not
# observe `dist/`.
#
# Two consequences worth naming rather than discovering:
#   * A doc comment that never reaches an exported declaration is swept anyway. That is
#     deliberate: which comments survive the dts rollup is a property of the BUILD, not of
#     the source, and gating on it would make the gate's answer depend on tsup's inlining
#     decisions. This package has a SINGLE entry point (`.`), so "does it reach a declaration
#     file" is one question rather than five -- which makes the proxy tighter here than in the
#     multi-entry siblings, not looser.
#   * `dist/*.d.cts` is the same text as `dist/*.d.ts`, so one clean source covers both
#     conditions.

# The `src/` surface must still be tracked, for the same reason SURFACE_PATHS is checked:
# a rename that empties this list must red, not shrink the scan in silence.
git ls-files -z -- 'src/*.ts' 'src/**/*.ts' > "$SRCLIST"
if [ ! -s "$SRCLIST" ]; then
  echo "ERROR: check-no-internal-refs - no tracked src/*.ts files to scan for doc" >&2
  echo "       comments. Either the source moved (update this pass, deliberately) or the" >&2
  echo "       scan is about to cover less than it claims. Refusing to report green." >&2
  exit 1
fi

# Same list-building discipline as the public-surface pass: `./`-prefixed as the list is
# built (route 6), a non-regular-file entry refused by name rather than skipped (route 7),
# an unreadable entry refused (not silently missed).
: > "$SRCSCAN"
src_scanned=0
while IFS= read -r -d '' f; do
  if [ -d "$f" ] && [ ! -L "$f" ]; then continue; fi
  if [ ! -r "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked source file is not readable: $f" >&2
    echo "       Refusing to report green from a scan that could not open its input." >&2
    exit 1
  fi
  if [ ! -f "$f" ]; then
    echo "ERROR: check-no-internal-refs - tracked source entry is not a regular file: $f" >&2
    echo "       Refusing to report green from a scan that skipped one of its inputs." >&2
    exit 1
  fi
  printf './%s\0' "$f" >> "$SRCSCAN"
  src_scanned=$((src_scanned + 1))
done < "$SRCLIST"

if [ ! -s "$SRCSCAN" ]; then
  echo "ERROR: check-no-internal-refs - no source files survived list building." >&2
  echo "       Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# EXTRACT THE DOC COMMENTS. Two buffers per pass, and the reason for the second one is
# line numbers: the rules must run over doc text ALONE (so a rule cannot match a line
# number, a path, or the code on the far side of a `*/`), which means the location has to
# travel beside the text rather than inside it. DOCLINES holds one doc line of text per
# line; DOCMAP holds `file:lineno` at the SAME line index. A hit at index N in one is
# located by index N in the other.
#
# The leaders are stripped the way an IDE strips them: `/**`, a leading `*`, and `*/`
# disappear, because none of them is part of what the reader sees on hover. `//` and
# plain `/* */` are NOT extracted -- see the boundary argument at SRC_RULE_NAME above.
: > "$DOCLINES"; : > "$DOCMAP"; : > "$DOCFLOW"; : > "$DOCFLOWMAP"
: > "$ERRLOG"
while IFS= read -r -d '' f; do
  awk -v file="$f" -v dl="$DOCLINES" -v dm="$DOCMAP" -v df="$DOCFLOW" -v dfm="$DOCFLOWMAP" '
    function emit() {
      gsub(/[[:space:]]+/, " ", joined); sub(/^ /, "", joined); sub(/ $/, "", joined)
      if (joined != "") { print joined >> df; print file ":" blockstart >> dfm }
      joined = ""
    }
    # End of a paragraph inside a block: emit it, keep the block open, keep reporting the
    # location as the block start (a paragraph index would be a number no reader can use).
    function flush2() { if (blockstart > 0) emit() }
    # End of the block.
    function flush() { if (blockstart > 0) emit(); blockstart = 0 }
    {
      line = $0
      if (!indoc) {
        if (line !~ /^[[:space:]]*\/\*\*/) { next }
        indoc = 1; blockstart = FNR; joined = ""
        sub(/^[[:space:]]*\/\*\*/, "", line)
      }
      # THE TERMINATOR IS TESTED BEFORE THE LEADER IS STRIPPED, and that ordering is the
      # whole correctness of this extractor. Stripping first turns a closing " */" into
      # "/" (the leader pattern eats the asterisk of the terminator), the block never
      # closes, and every `//` comment and line of CODE after it is scanned as doc text.
      # That is not hypothetical: it is what the first draft of the hl7 pass did, and it
      # reported 60 violations that were all real bookkeeping sitting in `//` comments
      # this surface deliberately does not cover. A gate that over-reports is not "safe":
      # it would have forced a sweep of the wrong lines.
      # TESTING THE TERMINATOR AGAINST DOC TEXT IS CORRECT, NOT A SHORTCUT: a doc comment
      # whose prose contains `*/` (a glob like `src/**/*.ts`, a regex ending `*/`) would
      # close the block early and drop the rest of it from the scan. THE CONSTRUCT IS
      # UNREACHABLE IN VALID TYPESCRIPT: block comments do not nest and cannot contain
      # `*/`, so the compiler ends the comment at exactly the same character this does,
      # and `typecheck` runs ahead of this gate on the ladder. The extractor mirrors the
      # language; it does not approximate it.
      closed = 0
      if (line ~ /\*\//) { closed = 1; sub(/\*\/.*$/, "", line) }
      # Exactly ONE leading asterisk, never `\*+`: a greedy leader would swallow the
      # opening `**` of markdown bold ("* **Fail-safe:**") and alter the scanned text.
      sub(/^[[:space:]]*\*[[:space:]]?/, "", line)
      sub(/^[[:space:]]+/, "", line)
      # The LINE pass sees the doc text with its location beside it.
      print line >> dl; print file ":" FNR >> dm
      # The FLOW pass accumulates a PARAGRAPH, not the whole block, and squeezes it the way
      # a tooltip reflows one. A BLANK doc line is a paragraph break and ends the run, for
      # the same reason the markdown pass above prints an empty line rather than joining
      # through it: a list item ending "(this module)" followed by a blank line and a new
      # sentence starting "The ..." is not the text "(this module) The ...", and joining
      # through the break invents adjacencies that no reader ever sees. Left unbroken, a
      # doc line ending in "phase" followed by a blank line and a paragraph opening with a
      # capital letter would red as "phase X". That is an over-report rather than a silent
      # green, but a gate that reds on correct content is a gate someone deletes.
      if (line ~ /^[[:space:]]*$/) { flush2() } else { joined = joined " " line }
      if (closed) { flush(); indoc = 0 }
    }
    END { if (indoc) flush() }
  ' "$f" 2>>"$ERRLOG"
done < "$SRCSCAN"
refuse_if_incomplete

# An extraction that produced nothing from a non-empty, JSDoc-heavy source tree means the
# extractor broke, not that the tree is clean. Same class as the empty-file-list refusal.
if [ ! -s "$DOCLINES" ]; then
  echo "ERROR: check-no-internal-refs - extracted no doc-comment text from ${src_scanned}" >&2
  echo "       tracked source file(s). Every public export in this package carries JSDoc," >&2
  echo "       so an empty extraction means the extractor is broken, not that the source" >&2
  echo "       is clean. Refusing to report green from a scan that read nothing." >&2
  exit 1
fi

# SCAN. Line pass first (it can name a file and a line), then the reflowed pass for
# violations that straddle a wrap. Wraps are not hypothetical here either: this package's
# doc comments are wrapped at the same column as its markdown, and a sentence ending
# "... this" / "phase models" is exactly as invisible to a line scan in JSDoc as it is in
# markdown. The reflow models a hover tooltip: whitespace squeezed, `*` leaders already
# gone.
SRC_HITS=""
i=0
while [ "$i" -lt "$SRC_RULE_COUNT" ]; do
  : > "$ERRLOG"
  LINE_IDX=$(grep -nP -e "${SRC_RULE_PATTERN[$i]}" -- "$DOCLINES" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$LINE_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      loc=$(sed -n "${n}p" "$DOCMAP")
      txt=$(sed -n "${n}p" "$DOCLINES")
      SRC_HITS="${SRC_HITS}[${SRC_RULE_NAME[$i]} / src doc comment]"$'\n'"${loc}: ${txt}"$'\n'
    done <<< "$LINE_IDX"
  fi

  : > "$ERRLOG"
  FLOW_IDX=$(grep -nP -e "${SRC_RULE_PATTERN[$i]}" -- "$DOCFLOW" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$FLOW_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      # Report only what the line pass could not see, so a wrapped hit is not printed
      # twice. A block whose violation is on one line is already reported above.
      blockloc=$(sed -n "${n}p" "$DOCFLOWMAP")
      # DELIMITED, not a bare substring. An unanchored `*"$blockloc"*` makes
      # `./src/x.ts:1` a substring of an existing hit at `./src/x.ts:12`, so a real wrapped
      # violation in the block starting at line 1 is suppressed by an unrelated hit at
      # line 12. It never loses the RED (SRC_HITS is non-empty either way) but it loses the
      # REPORT, which is the line a remediator needs. The trailing ':' is what a location
      # is always followed by in SRC_HITS.
      case "$SRC_HITS" in
        *"${blockloc}: "*|*"${blockloc} (block): "*) continue ;;
      esac
      m=$(sed -n "${n}p" "$DOCFLOW" | grep -oP -e "${SRC_RULE_PATTERN[$i]}" | head -1)
      SRC_HITS="${SRC_HITS}[${SRC_RULE_NAME[$i]} / src doc comment, wrapped across lines]"$'\n'"${blockloc} (block): ${m}"$'\n'
    done <<< "$FLOW_IDX"
  fi
  i=$((i + 1))
done

# ---------------------------------------------------------------------------
# FOURTH PASS: `src/` STRING LITERALS, the prose that reaches a consumer's LOG
# ---------------------------------------------------------------------------
#
# The argument for this pass, the measurement behind it, and its four stated boundaries
# are at STR_RULE_NAME above. In short: a parser's warning messages are read more often
# than its README, they are neither markdown nor doc comments, and six of them carried
# "this phase" into a consumer's log until this pass was written.
#
# The extractor keeps text ONLY, never the quotes, and records `file:line` beside each
# extracted line in the same index-aligned way the doc-comment pass does. Several literals
# on one source line are joined with a space, which is safe because a rule that matched
# across the join would have to span two adjacent literals in one expression; measured
# zero such matches, and an over-report there is a maintainer reading one line.
: > "$STRLINES"; : > "$STRMAP"
: > "$ERRLOG"
while IFS= read -r -d '' f; do
  awk -v file="$f" -v sl="$STRLINES" -v sm="$STRMAP" '
    # Whole-line comments are skipped: the doc-comment pass owns `/** */`, and `//` is
    # deliberately out of scope for this gate. Matches `//`, `/*`, `/**` and a ` *`
    # continuation line.
    /^[[:space:]]*(\/\/|\/\*|\*)/ { next }
    {
      line = $0
      out = ""
      while (match(line, /"([^"\\]|\\.)*"|`([^`\\]|\\.)*`/)) {
        out = out " " substr(line, RSTART + 1, RLENGTH - 2)
        line = substr(line, RSTART + RLENGTH)
      }
      if (out != "") { print out >> sl; print file ":" FNR >> sm }
    }
  ' "$f" 2>>"$ERRLOG"
done < "$SRCSCAN"
refuse_if_incomplete

# A source tree this size cannot contain zero string literals. An empty extraction means
# the extractor broke, not that the tree is clean; same class as every other refusal here.
if [ ! -s "$STRLINES" ]; then
  echo "ERROR: check-no-internal-refs - extracted no string literals from ${src_scanned}" >&2
  echo "       tracked source file(s). This package's warning messages, warning codes and" >&2
  echo "       import specifiers are all string literals, so an empty extraction means the" >&2
  echo "       extractor is broken, not that the source is clean. Refusing to report green" >&2
  echo "       from a scan that read nothing." >&2
  exit 1
fi

STR_HITS=""
i=0
while [ "$i" -lt "$STR_RULE_COUNT" ]; do
  : > "$ERRLOG"
  STR_IDX=$(grep -nP -e "${STR_RULE_PATTERN[$i]}" -- "$STRLINES" 2>>"$ERRLOG" | cut -d: -f1 || true)
  refuse_if_incomplete
  if [ -n "$STR_IDX" ]; then
    while IFS= read -r n; do
      [ -n "$n" ] || continue
      loc=$(sed -n "${n}p" "$STRMAP")
      txt=$(sed -n "${n}p" "$STRLINES")
      STR_HITS="${STR_HITS}[${STR_RULE_NAME[$i]} / src string literal]"$'\n'"${loc}:${txt}"$'\n'
    done <<< "$STR_IDX"
  fi
  i=$((i + 1))
done

[ -n "$ALL_HITS" ] && fail_with_hits "the public surface listed above" "$ALL_HITS"
[ -n "$SRC_HITS" ] && fail_with_hits "src/ doc comments, which compile into dist/ and render in every consumer's editor" "$SRC_HITS"
[ -n "$STR_HITS" ] && fail_with_hits "src/ string literals, which reach a consumer as warning and error message text" "$STR_HITS"

echo "check-no-internal-refs: OK (${scanned} public-surface file(s) and the npm metadata scanned against ${RULE_COUNT} rules, line by line and paragraph-joined; ${src_scanned} source file(s) scanned against ${SRC_RULE_COUNT} rules for doc-comment bookkeeping, line by line and paragraph-reflowed, and against ${STR_RULE_COUNT} rules for string-literal bookkeeping; ${gitlinks} gitlink(s) skipped)"


# @cosyte/transform: agent notes

**What this is.** The long-form narrative that used to live in `CLAUDE.md`: the per-incident
sections, the shipped-phase history, and the long rationales behind the guardrails. It was relocated
here on **2026-08-04** under `CLAUDE-MD-AUDIT`, because `CLAUDE.md` is always-read by every worker
that `cd`s into this repo and the per-worker token cost is paid on every session (umbrella ADR 0023,
amendment 2026-08-04).

**Relocated, not deleted.** The narrative below is the CLAUDE.md text **verbatim**: nothing was
softened, summarised, or dropped. Be precise about what that claim covers, because this file's whole
value is that it does not overstate. **The accounting below covers the seven sections the 2026-08-04
relocation produced, and nothing after them**: sections added later are new prose written here, not
relocated `CLAUDE.md` text, and the verbatimness claim does not reach them. (It said "the narrative
below" without that scope until 2026-08-06, when the first later section made it false; a refuter
measured it, and it is scoped rather than deleted.) Of those seven: **two headings**
(`Branch protection…`, `Dependency watching`) are the originals carried across whole; **four** are new
headings over relocated bodies that were bullets in `CLAUDE.md`'s `Status`, `Engineering Guardrails`
and `Standing disciplines` sections; and **one** (`Publish state, and the stale claim inside it`) is
mostly **newly written on 2026-08-04**, with the relocated original quoted inside it as a blockquote. Every `##` section heading is a pointer
target from `CLAUDE.md`, and the contract gate keeps that true. **`###` subsections inside them are
deliberately NOT pointer targets**: requiring one would force the always-read file to grow a line per
subsection, which is what its byte ratchet exists to prevent. This sentence read "Every heading" until
2026-08-06, when adding the first `###` headings here made that literally false; it is narrowed to
what is checked rather than left as a claim nothing holds up.

`CLAUDE.md` keeps the cursor, the rules, and **every** trap as a one-line imperative that points back
here. If a one-liner there and a paragraph here ever disagree, **this file is the measurement** and
the one-liner is the reminder: fix the one-liner, do not weaken this.

**These are things that cost a defect to learn.** Several are refuted claims: a sentence someone
wrote, a refuter measured false, and the correction stayed. Do not re-assert one of them from
reading the code. **Re-measure, or leave it alone.**

---

## Shipped-phase history (Phases 1–6)

**Phases 1–6 shipped** (roadmap `operations/roadmaps/transform.md` §Phase 1–6). Pre-alpha `0.0.x`,
**published on npm**: this line read "not yet published to npm" for several releases after first
publish, which is part of why a `VERSION` constant stuck at `"0.0.0"` went unnoticed on a shipped
package. **Never quote a version here**; `npm view @cosyte/transform version` is the only source of
truth. **Published is not installable here:** the `@cosyte/fhir` peer is not on the registry, so
`npm install @cosyte/transform` fails to resolve. Both halves travel together or neither is
useful. Phase 1: the **six safety-critical datatype converters** (`toFhirDateTime`,
`toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`, `toFhirAddress`, `toFhirQuantity`),
the **value-free diagnostic channel** (`ISSUE_CODES`/`FATAL_CODES`, `TransformIssue`,
`toOperationOutcome`), and the minimal **NamingSystem resolver** (`createNamingSystem`). Phase 2 was
the first **message-level assembly**: `toFhir(msg)` turns an HL7 v2 **ADT** message into a FHIR R4
**message `Bundle`** (MSH→`MessageHeader`, PID→`Patient`, PV1→`Encounter`, NK1→`RelatedPerson`, with
`urn:uuid:` reference wiring, the HL70001/HL70004 table maps, a segment-assembled fallback for
non-IG-mapped triggers, and a conservative-emit gate against `@cosyte/fhir.validateResource`). Phase
3: the **ORU^R01 → DiagnosticReport + Observation** results graph, OBR→`DiagnosticReport` (status via
HL70123, `DIAGNOSTIC_REPORT_STATUS_MAP`), OBX→`Observation` with **OBX-2 value-type discrimination**
of OBX-5→`value[x]` (NM→`valueQuantity`, CWE→`valueCodeableConcept`, SN→structured, ST/TX→`valueString`),
OBX-8→`interpretation` (HL70078, `HL70078_INTERPRETATION_CODES`), OBX-11→`status` (HL70085,
`OBSERVATION_STATUS_MAP`), with the "never a confident wrong result" fail-safes (a corrected/cancelled
result never emits as `final`; an unmapped status withholds the resource; a precision-exact magnitude
read from the raw OBX-5). Every segment→resource and field→element map is grounded firsthand on the
IG's ConceptMaps and cited. Phases 4–5 added the message-level graphs for **ORM_O01/OML_O21 →
ServiceRequest** and **RXO → MedicationRequest** (Phase 4) and the thin IG singles **VXU_V04 →
Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference** (Phase 5). Phase 6 added the
**terminology value-translation** layer: a `$translate`-shaped, additive, fail-safe engine
(`toFhirCodeableConceptVia`) applying the license-clean IG value ConceptMaps (each transcribed +
verified **firsthand against the raw IG JSON**) to the previously structural-only coded fields: RXR
route/site (HL70162 / HL70550), SCH-8 appointment type (HL70277), RXO-9 substitution (HL70161), and
OBR-5 priority (HL70485, `SERVICE_REQUEST_PRIORITY_MAP`). A code in the IG's `(unmapped)` group is
flagged, never coerced; SNOMED-target maps (RXR-4 method, SCH-7 reason) stay structural/BYO, no
SNOMED bundled; and fields with no IG value map (TXA-2, RXA-5) are documented as structural, never
invented.

**Deferred to later phases:** deeper terminology (the full HL7 THO NamingSystem crosswalk beyond the
shipped value maps, consumer-supplied ConceptMap application), the reverse FHIR→v2 direction (Phase 7),
and profiles (Phase 8).

## Publish state, and the stale claim inside it

**Read this whole section before you edit a publish-state sentence anywhere in this repo.** Two
readings of the same fact are on record here. The relocation of 2026-08-04 deliberately carried
**both** across rather than picking one, because picking one is how a stale claim becomes fact.

**The paragraph as it stood in `CLAUDE.md`, verbatim in wording.** Its dash punctuation was
normalized by the brand sweep of 2026-08-07, which took `U+2014` out of every tracked file in this
repository including this quotation. **Not one word, claim, qualifier or identifier changed**, and the
sweep is recorded here rather than left for a reader to discover, because this section's whole value
is that it does not overstate what it reproduces.

> **Consumes two cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer dependencies**, vendored
> as `pnpm pack` tarballs in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008): refresh with
> `pnpm vendor:refresh`. Pinned shas: hl7 `46d50eb`, fhir `7a099b2`. **They are not both unpublished,
> and that wording was stale.** `@cosyte/hl7` is on the registry; **`@cosyte/fhir` is not** (npm 404,
> a human-gated publish), and it is the fhir peer alone that makes this package uninstallable from
> npm. Derive it, do not recall it: `npm view @cosyte/hl7 version`, `npm view @cosyte/fhir version`.
> **Third-party runtime deps: zero.**

**That paragraph is itself flagged stale**, in the umbrella backlog, alongside the same claim in
`hl7`, `mllp` and `deid`. It has now been corrected **twice**: first from "both unpublished", then
again below, which is the reason it is quoted rather than silently rewritten. **Relocating a
disputed claim must not launder it into fact.** It is reproduced above as history, not as a
measurement.

**The specific words under dispute are `npm 404, a human-gated publish`, and the two halves are not
equally wrong: say which is which rather than rejecting the line wholesale.** Two different facts
sit behind them and the old wording collapses them into one:

- **The package is absent from the registry**, so `npm view @cosyte/fhir` answers **404** and a
  consumer install of `@cosyte/transform` fails **`E404`** on the missing peer. That half is not the
  defect. **Do not generalise the code across siblings**: `@cosyte/synth` is blocked by the same
  absent peer but fails **`ERESOLVE`**, a different code for the same cause.
- **The publish ATTEMPT is refused with `E403` on `PUT`**, cause unestablished: tracked as
  `FHIR-NPM-NAME`. **This is where `a human-gated publish` misleads.** It reads as a routine approval
  someone has not clicked yet. It is not: CI is green, provenance reaches the transparency log
  _before_ the refusal, and the registry rejects at **policy**. The human step on record is
  **escalating a captured trace to npm**, which is a support ticket, not a release gate. Treating it
  as "waiting on a human" invites an agent to go looking for a button to press. **There isn't one.**

The work is staged on `main`; the registry refuses it. The same blockage takes `transform` and
`synth` down with it: both are on the registry and both **fail to install**, because the unpublished
`fhir` peer cannot resolve.

**The `FHIR-NPM-NAME` name is a label, not a diagnosis. The "name-similarity" reading is
RETRACTED.** It implied a rename, and **the error never asked for one**. **DO NOT RENAME ANYTHING**
on the strength of that identifier: not `@cosyte/fhir`, not `@cosyte/transform`, not a scope, not an
export. The cause is unexplained and staying unexplained is the honest state.

**So do not resolve this from memory, and do not resolve it from this file.** Every reading here has
a date on it and at least one was wrong when read. Derive it:

```bash
npm view @cosyte/transform version
npm view @cosyte/hl7 version
npm view @cosyte/fhir version
```

**Visibility and publish state are independent**, never infer one from the other. And **never move a
published version backwards** (umbrella ADR 0001).

## Branch protection (and the limits of this claim)

`main` is protected by the repository ruleset **`ci-required-checks`** (id `19914044`,
`source_type: Repository`, `enforcement: active`, conditions `~DEFAULT_BRANCH`, `bypass_actors: []`).
Rules: `deletion`, `non_fast_forward`, `required_status_checks`.

**It did not always bind, and the half-done state is the thing to recognise.** This repo had no
ruleset at all until `PUBLIC-SURFACE-HYGIENE` (#11) created `19914044` requiring exactly one context,
`no-internal-refs`. From that point the repo _had a ruleset_ and still did not gate its build:
`ci / verify`, `ci / actionlint` and `codeql` were all advisory, so any of them could be red and the
merge still landed on `main`, and `main` is the branch that publishes. **Having a ruleset is not the
same as being protected.** `CI-REQUIRED-CHECKS` folded the four build contexts into that same ruleset
rather than adding a second one, deliberately: `ncpdp` is the cautionary case, where a correctly
pinned base ruleset sat beside two later rulesets that pinned nothing, and the repo read as "pinned"
because one of its rulesets was. **One ruleset per repo means one place to audit.**

Required contexts, each pinned to **`integration_id: 15368`** (the `github-actions` app) so that a
commit status of the same name posted by any other actor with write access cannot satisfy it:

| context                                    | emitted by             |
| ------------------------------------------ | ---------------------- |
| `ci / verify (22, ubuntu-latest)`          | `ci.yml`               |
| `ci / verify (24, ubuntu-latest)`          | `ci.yml`               |
| `ci / actionlint`                          | `ci.yml`               |
| `codeql / analyze (javascript-typescript)` | `codeql.yml`           |
| `no-internal-refs`                         | `no-internal-refs.yml` |

These are the names GitHub actually reports, **read off real check runs**, never off a workflow's
`name:` field. Provenance stated exactly, because "two independent heads" is not true of all five:
the four build contexts were read off **two** independent `pull_request` heads, `66715e5b` (head of
#11) and `460bfcf8` (head of #7). `no-internal-refs` could only be read off **one**, `66715e5b`,
because `460bfcf8` predates the workflow that emits it and carries no such check run. All five were
then confirmed together on the change that required them, #12, whose first head was `57a62b2`: it
read `BLOCKED` until the five landed and `CLEAN` after, on that head and on every later one.
That distinction is the whole trap: the workflow named `Public-surface gate`
emits the context `no-internal-refs`, and requiring a context nothing emits does not fail a PR, it
leaves it **pending and unmergeable forever**. None of the three workflows that emit these five
contexts (`ci.yml`, `codeql.yml`, `no-internal-refs.yml`) carries a `paths:` filter, so no PR can
skip one.

**What is deliberately NOT required, and why each would be a defect:**

- **`scorecard / analysis`** runs on `push` to `main` and on a schedule, never on `pull_request`.
  Requiring it would strand every PR pending forever.
- **`release / release`** runs on `push` to `main`. It is not a PR gate.
- The **`CodeQL`** check posted by the Advanced Security app (id `57789`) reports **alert state**, not
  whether the analysis ran. `codeql / analyze (javascript-typescript)` already gates that.

**A required job gates all of its steps.** Splitting a step out of `ci / verify` into its own job
silently un-requires it, with no error and no warning. There is a banner on `ci.yml` where someone
would trip it.

**Three of the five names are set upstream, in another repo, on a floating ref.**
`ci / verify (22, ubuntu-latest)`, `ci / verify (24, ubuntu-latest)` and `ci / actionlint` come from
the DEFAULT inputs of `cosyte/.github/.github/workflows/ci.yml@main` (`node-versions`, `os`,
`run-actionlint`). This repo's caller passes none of them. Change a default there and every PR here
strands pending, with nothing in this repo to warn you. It fails closed rather than open, and every
repo pinning this reference set shares it, so it is an ecosystem concern rather than a local one --
but it is the reason the context list is not stable just because this repo is.

**And the gate can leave the job entirely, which is the sharper edge in this repo.** Requiring
`ci / verify` pins that `pnpm test` runs; it does not pin _what_ it runs. The suites are chosen by the
`include` glob in `vitest.config.ts`, and the shared `@cosyte/vitest-config` sets no `test.include` of
its own, so that line decides today. **It is not the only lever:** the `test` and `test:coverage`
script bodies in `package.json` are plain `vitest run` invocations, and adding a path argument or
`--exclude` there drops suites without touching the glob, equally unobserved by the ruleset. The glob
is what currently selects `test/messages/property.test.ts` and
`test/datatypes/boundary.property.test.ts` -- the property and fuzz suites carrying the never-throw,
value-free-diagnostic, reference-resolution and emit-validity claims that are the point of the
fail-safe rule. **Narrow that glob and they stop running with the job still green and the ruleset
still satisfied.** The ruleset does not protect them; it protects the job that happens to run them.
There is a banner on `vitest.config.ts` saying so.

The per-directory coverage gate is a **thin, incidental** backstop and should not be mistaken for a
real one. Measured on `dfc7739`: excluding `test/messages/property.test.ts` alone takes
`src/messages/**` branch coverage from **90.11% to 88.82%**, which breaches the `>= 90` gate, so that
particular deletion is caught today. It is caught by a 1.29-point margin, because the property run
happens to be the only thing reaching some branches -- any example test covering them restores the
margin and the backstop goes quiet. And coverage can never see the loss of the **properties**
themselves, since a trivial test touching the same lines satisfies it identically.

**▶ The cost of requiring a new context, which is real and was measured here.** A PR whose branch
predates a required workflow cannot emit that workflow's context, so it goes `BLOCKED` until it is
rebased or re-run. **PR #10 ("Version Packages", head `2996df7`) has zero check runs and reports
`BLOCKED`** -- and it is the structural case, not a stale branch: Changesets opens that PR as
`github-actions[bot]` with the default `GITHUB_TOKEN`, and GitHub does not start workflow runs for
that token's events. With `bypass_actors: []` nobody can merge past it. The escape is one empty
commit onto `changeset-release/main`; it is written out on `release.yml`.

**▶ Scope of the claim, stated plainly: a ruleset makes a red check BLOCK a merge. It does not make
the check correct, and nothing inside this repository can observe its own ruleset.** Delete the
ruleset and this test suite stays green, `verify.sh` stays green, and this section keeps asserting
protection. It is not verifiable from inside the repo, by `verify.sh`, or by any gate here. Verify it
the only way that works, and check **every** ruleset the call returns:

```bash
gh api 'repos/cosyte/transform/rulesets?includes_parents=true'
gh api repos/cosyte/transform/rulesets/19914044
```

Recorded as **unproven** rather than fine: no fork PR has ever run here, so neither the
first-time-contributor approval gate nor whether `codeql / analyze` can report on a fork token (which
cannot hold `security-events: write`) has been observed.

## Dependency watching

`.github/dependabot.yml` configures weekly `npm` and `github-actions` updates. Before it existed this
repo showed **zero** open Dependabot PRs, which meant nothing was looking, not that nothing was stale.
Two limits are written into that file rather than left to be discovered: automatic **security** update
PRs are a repo setting that currently reads `disabled`, and **Dependabot never resolves a
`file:vendor/*.tgz` specifier**, so the vendored `@cosyte/hl7` and `@cosyte/fhir` tarballs -- the
versions the tests actually exercise -- are unwatched by both the `file:` route and the peer-dep route
and stay a `pnpm vendor:refresh` job by hand.

## The `attw` guardrail, in full

**▶ `attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE
BARE CLI.** `getExitCode.js` in `@arethetypeswrong/cli@0.18.4` opens with `if (!analysis.types)
return 0`: an untyped package is a legitimate npm package, so "no types at all" is a description,
not a problem, and the problem list is never consulted. No `--profile`, `--ignore-rules` or config
setting reaches that early return. For a package that ships types it means the declarations were
**not in the tarball**, which is a broken publish reported as a pass. The invocation here was
never lenient: it was the bare `attw --pack .` on the default strict profile.
**The race only supplies the condition.** Reproduced here on a quiet box with zero concurrency:
`rm -rf dist && attw --pack .`, and `pnpm build && rm -f dist/index.d.*ts && attw --pack .`, both
print the sentence and exit 0. The second is the realistic window: `tsup` emits the bundles in
one pass and the declarations in a later one, so **every** build has an interval where `dist/`
holds `.mjs`/`.cjs` and no `.d.ts`; measured at **1,600 / 1,646 / 2,018 ms** over three
consecutive quiet-box builds, polling every 5 ms. A concurrent build or `clean` in the same
working tree lands `attw` in it. So the answer is **not** a lock, a lease or a build queue: the
gate must be able to say its own inputs were missing, whatever removed them.
`scripts/attw.mjs` carries **two nets, and they catch different things**: a preflight that every
relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of
`exports`) exists and is non-empty, which catches the build window and _names the missing file_;
and a post-check on `attw`'s untyped sentence, which catches what the preflight structurally
cannot, namely declarations present on disk but excluded from the tarball by `files`/`.npmignore`.
**No instance of that second case is on record in this repo.** `test/scripts/attw-gate.test.ts`
pins both nets against the real binary, including the upstream exit-0 itself, so an `attw` upgrade
that reworks the wording or fixes the exit code reds the suite instead of letting the net go
quietly slack. It also pins a **negative control** on a well-formed package, and that a real
`attw` failure still fails with `attw`'s own status: a gate that only ever fails is not a gate,
and one that swallows the status is not one either. Reducing the wrapper to the bare CLI reds 10
of its 13 tests; that is how the suite was checked for bite rather than assumed to have it.
**The post-check reads a string, so what would hide that string is refused**, not tolerated.
**Three routes were measured here** to hand back exit 0 over an untyped pack: `--quiet`,
`--format json`, and a `.attw.json` setting either (`readConfig()` applies it after argv).
`--config-path` is refused too, but **by inference, not measurement**. The refusal is **by option
name, wholesale, not by value**: a harmless `--format` value blinds nothing and is refused
anyway, which is the deliberate trade against value-parsing them.
**Two limits of a green here.** A **complete but stale `dist/`** passes both nets (not live today
only because the ladder runs `build` before `attw`); and this package's unpublished
`@cosyte/fhir` peer is **not** something `attw` speaks to: measured, a good pack reports "No
problems found" and exits 0, identically with `node_modules/@cosyte/fhir` moved aside, so `attw`
never resolves that peer. A green `attw` has never meant a consumer can install the peer.
**This is a per-repo script.** It was ported here from `terminology`'s graded fix (terminology#28,
`bf153cb`); siblings that still invoke the CLI directly still carry the defect, and the prose does
**not** port with the code: every number above was re-measured on this package. Derive who is
left rather than writing a count down:
`rg -l --glob '**/package.json' '"attw":' /workspace`.

## The PHI scanner guardrail, in full

**▶ THE PHI SCANNER REFUSES (exit 2) EVERY ENTRY IT ENUMERATES, AND EVERY PATH NAMED DIRECTLY, THAT
IS NOT A REGULAR FILE. THAT IS THE WHOLE CLAIM: "it follows nothing" IS THE LOOSER WORDING, AND
TWO SEPARATE REFUTER PASSES MEASURED IT FALSE.** See the ancestor-component residual below before
you tighten this sentence back up.
Before `PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES` (ported from `terminology#37`, `5f81640`) a symbolic
link was clean on **both** enumerating routes, measured on this repo's own scanner over a link under
`src/` pointing at a name-bearing synthetic payload: all-mode printed `OK: no hits` / exit **0**,
and so did `--staged`. The walk enumerates `Dirent.isFile()`, an **lstat** answer, so a link is
neither a file nor a directory, and a linked _directory_ takes its whole subtree with it.
`--staged` reads `git show :<path>`, and **git stores a link as its TARGET PATH under mode
`120000`**, so that route gets the path text, never the target's bytes.
**Do not "fix" this by following the link.** Following reads bytes the enumeration does not control
(outside the repo, a loop, a device, a FIFO that blocks the gate forever), and git does not carry
them anyway, so a hit on them would be a claim about something no commit contains.
**▶ AND THE THIRD MODE IS THE ONE A DRAFT OF THIS GUARDRAIL GOT WRONG: IT SAID "FOLLOWS NOTHING"
WHILE ONE ROUTE STILL FOLLOWED.** A refuter measured it: the named-`<path>` mode classified with
`statSync`, which **dereferences**, so `pnpm phi-scan src/link.ts` read the TARGET's bytes and
reported hits from them, including a target **outside the repository**, the first hazard the
sentence above says the scanner does not incur. It was never a false clean, which is exactly why
reading the code did not catch it. It lstats now; **if you touch `buildTargetsForPaths`, re-measure
the sentence, do not re-assert it.** A dangling link is reported as the link it is, because
`existsSync` follows and would call it a missing file.
**▶ AND `lstat` ANSWERS FOR THE FINAL COMPONENT ONLY: a second refuter pass measured that too,
after the first fix.** A named path whose **ancestor** is a symlink (`src/linkdir/payload.txt`) is
still followed and still read from wherever that ancestor lands, as is a plain absolute or `../`
argument. The all-mode walk over the same tree **does** refuse that ancestor, so the two routes
disagree about one link. **Pre-existing, disclosed, and deliberately NOT closed:** closing it means
realpath or containment logic, which is a guard growing past the defect it fixes, and neither
commit-gating route (the `--staged` pre-commit hook, the all-mode walk CI runs) reaches it.
**▶ THE ONE-LETTER TRAP: `--diff-filter` MUST KEEP `T`.** Replacing a **tracked** file with a link
is neither an add nor a modify. Measured here, `git diff --cached --raw --diff-filter=AM` printed
**nothing** for that change while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T`,
so under `AM` the record dies before any mode is read and the hook passes a mode-`120000` blob
**green** while the changelog claims it refuses one. `T` also buys the reverse typechange (link →
real file bearing PHI), which must be _scanned_, not refused. The route reads `--raw -z` purely so
the destination mode is visible; `--name-only` cannot see it.
**A refusal never echoes the link target**: that is working-tree text and can itself carry PHI.
Name the entry's own repo-relative path plus a token from the closed `entryKind`/`gitModeKind`
sets, nothing else. **This applies to the prose too**: a diagnostic about a PHI leak is itself a PHI
surface, which is why the docblock writes the dangerous target as a _shape_ and not an example.
**The walk has NO extension scope of its own**, so a link at `src/leak.json` and a linked directory
are refused there too. It used to skip a regular `*.md` before reading a byte of it; **that
exemption is gone** and the removal is purely additive (see the scope section below). `src/**.ts`
was the **`--staged`** route's boundary, not the walk's, and that suffix bound is gone too.

### The scan scope is the tracked corpus, and it is reconciled against git

**▶ THE HEADLINE, MEASURED ON THIS REPOSITORY AT `daf75c3` RATHER THAN PORTED FROM A SIBLING.** Both
enumerating routes covered `test/fixtures/` plus `src/`, and that was **31 of 102 tracked files: 71
read by NEITHER route, 27 of them under `test/`, 8 of those carrying inline HL7 `PID|` literals**
with names, DOBs and MRNs in them.

**▶ STATE BOTH DENOMINATORS, AND RE-DERIVE THEM AFTER THE CHANGESET IS WRITTEN.** They are not the
same number, because this change adds a tracked file of its own and an earlier draft counted itself
out of date: base `daf75c3` is **102 tracked / 31 opened / 71 in neither / 27 of those under
`test/`**; head is **103 tracked / 101 opened / 2 in neither / 0 under `test/`**, and both of the two
are declared literal exemptions. **70 files were newly opened, of which 69 existed at base and were
hand-read**; the seventieth is this change's own changeset.

**▶ AND THE SHARPEST HALF, WHICH IS THIS REPOSITORY'S OWN AND NOT A SIBLING'S: `test/fixtures/` HAS
NEVER EXISTED HERE, ON ANY COMMIT.** `git log --all -- 'test/fixtures*'` is empty. The walk's
`existsSync` guard returned on its first line for that root on **every run this scanner has ever
made**, and every one of those runs printed `OK: no hits` and exited 0. **A declared root that was
never opened is indistinguishable from a clean one.**

**▶ A COUNT DOES NOT DETECT THAT, AND NEITHER DOES AN EXISTENCE CHECK.** A file count counts the
roots that DID exist, so a healthy total says nothing about a root nobody opened; and refusing a
MISSING root leaves the other half, because an EMPTIED one opens nothing and still reports clean.
The only thing that observes either is `reconcileWithGit`, which compares what the walk actually
OPENED against `git ls-files` and refuses (exit 2), naming every tracked path that was not opened.
**Never re-add a `tracked.has()` pre-check in front of a read**: that makes the walk agree with git
by construction, at zero firings, exactly as it did in the contract gate.

**▶ WHAT THE RECONCILIATION DOES NOT CLOSE, AND NO REPO IN THIS ECOSYSTEM HAS: IT COMPARES PATH
SETS, NOT THE BYTES GIT CARRIES AT THOSE PATHS.** A root swapped for a directory mirroring the
tracked NAMES still reconciles, over decoy contents. Widening makes that narrower rather than
closed: a decoy must now mirror 100 names, not 7. It is also **vacuous on an empty index**, which is
the state every throwaway repo in the suite is in, so the walk's own refusals are what hold there.

**▶ A WALK ROOT THAT IS NOT A DIRECTORY NOW REFUSES BEFORE THE WALK, AND `existsSync` IS WHY IT WAS
INVISIBLE. `existsSync` FOLLOWS**, so a DANGLING root read false, `walk` returned immediately, and
the run reported clean with the corpus off the disk: measured here, `OK: no hits` / exit **0**. A
root that was a symlink to a real directory was the other half, and it was **followed**, so the scan
read bytes git does not carry and called them the corpus. Both refuse with **2** now, via an `lstat`
per declared root. An **absent** root is deliberately not an error: a tree may legitimately lack
one, and the reconciliation is what notices anything tracked lived under it.

**▶ THE EXIT CODE FOR A REGULAR-FILE ROOT IS `2` HERE, DERIVED FROM THIS SCRIPT'S OWN CONTRACT AND
NOT PORTED.** Measured before the change: `existsSync` answered true, `readdirSync` threw `ENOTDIR`
into `walk`'s catch, which raises an `InvocationError` and returns 2 from `main`. The new `lstat`
preflight answers first and returns the same 2, so the code did not move. **Siblings differ and
porting one is the bug this item exists to stop.**

**▶ ROOTS MUST STAY DISJOINT, AND WIDENING IS BY UNION.** `test` covers `test/fixtures` rather than
sitting beside it: declaring both reports every nested file twice. The previous list is a strict
SUBSET of the new one, and the `--staged` scope's previous predicate is a strict subset of its new
one (the `.ts` suffix requirement is dropped, not kept), so nothing either route saw can stop being
seen. **Proved by grid rather than argued: 168 cells, 14 paths x 4 payloads x 3 routes,
each run against the base scanner and the head scanner. 37 base `1` cells still `1`, 74 cells
`0 -> 1`, and exactly ONE `1 -> 0`,** which is the next paragraph. **The totals factor and the
figure published before did not:** 14 paths x 4 payloads x 3 routes is 168 cells, and 37 + 74 + 1 +
56 unchanged zeros is 168. It is a recorded measurement rather than a fixture: nothing in the suite
pins the BASE half, because a head-only test structurally cannot. What the suite does pin is the
head side of every cell that carries the argument, each by a named case.

**▶ THE ONE SUBTRACTION, NAMED RATHER THAN LEFT TO BE FOUND: `pnpm phi-scan package.json` exited 1
on the npm publisher contact in its `author` field and now exits 0.** That mailbox is public,
organisational and not PHI; it is **named in `scripts/phi-allow-list.txt` rather than scrubbed**,
because deleting it to get green would destroy the evidence the audit looked at it. It is declared
with the `EMAIL` tag, which takes **two literals, a path and an address**, so it is the narrowest
instrument this allow-list has: the same address in any other file still reports, and any other
address in that file still reports. **An allow-list entry is still ROUTE-BLIND** (it clears on the
commit-blocking `--staged` too) and that reach is pinned from both directions by tests rather than
asserted. Without the entry the choice was a worse hole (exempting the whole file) or an unusable
gate (every commit touching `package.json` blocked).

**▶ THE ALL-ROUTE EXEMPTION LIST IS TWO LITERAL PATHS AND IT NEVER REACHES A BLOCKING ROUTE.** The
two vendored `pnpm pack` tarballs are gzip archives: their bytes are not the text they carry, so a
text pass over them is neither a detection nor a clearance, and both are gated at their own source
repositories. Measured before the change, the fhir tarball produced exactly one hit, seven bytes of
DEFLATE output matching the email shape, which changes with every repack. **A literal path, never a
predicate; the all route only; `<path>` still reads them.** If `pnpm vendor:refresh` renames one the
gate refuses naming the new path, which is the safe direction and is deliberate.

**▶ `.git` IS A REGULAR FILE IN A SUBMODULE WORKING TREE**, not a directory, and this repository is
consumed as one. It is skipped by literal name: it is git's own metadata, never tracked, and in a
plain clone it is a directory the walk already skipped, so admitting it made the scan behave
differently in a clone and a submodule for nothing.

### The HL7 v2 structured pass, and why enumeration alone would have been false confidence

**▶ ENUMERATING MORE FILES BUYS THE SSN/EMAIL FLOOR AND NOTHING ELSE.** Measured over the 8 tracked
files carrying `PID|` here: **zero dashed SSNs and zero emails between them.** Widening the walk
without a recogniser would have opened 8 files full of names, DOBs, MRNs, one undashed SSN, a street
address and two phone numbers, and reported every one of them **clean**. The two halves ship
together and each is **"in addition to"**, never "instead of": both passes run on every target on
all three routes.

**▶ AND THE SHAPE THAT MAKES THIS PACKAGE DIFFER FROM ITS PARSER SIBLINGS: THERE IS NO STANDALONE
`.hl7` FIXTURE IN THIS REPOSITORY AT ALL.** Every message in the corpus is a `.ts` **string
literal**, usually one segment per array element. A recogniser written the usual way, treating the
file as the document, would have found nothing in any of them. So the pass locates segment literals
**anywhere in a target's text** and reads each from its segment id to the first CR, LF, double quote
or backtick. A single quote is deliberately NOT a terminator: it occurs in real family names, and
stopping there would scan less.

It parses **PID / NK1 / GT1 / IN1** by field and component and checks names (XPN 1/2/3), DOB (the
leading 8 digits of a TS), ids (CX-1 across `~` repetitions, with an `SS` type code or a bare
9-digit value named as an SSN), addresses (XAD 1/2/3/5) and phones (XTN components with 4+ digits).

**▶ EVERY FIELD NUMBER IS CITED TO HL7 v2.5.1 BY CHAPTER AND CLAUSE IN THE SOURCE, AND THE REASON IS
A MEASURED DEFECT: an uncited table produced `IN1-17` as a telephone field.** IN1-17 is *Insured's
Relationship To Patient*, so a SNOMED relationship code was reported as a phone number, and the
remedy that diagnostic steered a developer toward was a global `PHONE` clearance of that digit
string. **IN1 carries no insured telephone at all**; IN1-7 is the payer's. Found by the refuter.

**▶ TWO SILENT MISSES THE REFUTER FOUND WERE FIXED RATHER THAN DISCLOSED, BECAUSE BOTH REPORTED
CLEAN OVER CONTENT THE GATE CLAIMS TO CATCH.** (1) The name-token class was `[A-Za-z]`, so `Garcia`
hit and the same name written with its accent exited 0, as did every name in a non-Latin script: a
gate blind to exactly the names least likely to be synthetic. It is a Unicode letter class now,
which still excludes digits so a coded value stays out. (2) A whole message pasted into ONE literal
with **escaped** `\r` separators was never located, because the character before `PID|` is the
letter `r` of the escape: measured, an ADT carrying a name, a DOB, an MRN, an address and two phones
scanned clean at exit 0 while the same message one segment per array element produced 8 hits. The
escaped separator is now both a boundary AND a terminator, and the terminator half is load-bearing:
without it the whole message is read as one segment and the next-of-kin's relationship code is
reported as the patient's PID-11 address.

**▶ THE COVERAGE STATEMENT IS POSITIVE, AND THAT SHAPE IS THE FINDING RATHER THAN A STYLE CHOICE.**
Two successive refuter passes measured an EXHAUSTIVE NEGATIVE LIST of "what this does not catch"
incomplete in the false-confidence direction, and the second measured it incomplete AGAIN after it
had been extended in answer to the first. Seven PHI-bearing v2.5.1 fields reported clean while the
list called itself authoritative: NK1-26, NK1-31, NK1-32, NK1-37 (a contact SSN, invisible to the
floor too because it is undashed), GT1-2, GT1-4 and IN1-49 (the insured's id, while three files told
a reader the pass covers "member id"). **A negative list of that shape cannot be kept true**, because
every clause of every segment would have to appear on it. The banner in `scripts/phi-scan.ts` now
enumerates EXACTLY the fields that are read, and says that anything not named is not checked. That
claim is checkable; the other one was not. **Correct it by narrowing the claim, never by silently
adding a field number.**

**▶ PROVENANCE, RECORDED BECAUSE ITS ABSENCE WAS THE ROOT CAUSE.** The field numbers are asserted
from HL7 v2.5.1 and were cross-corroborated **in-repo only**, against `src/messages/related-person.ts`
and the vendored `@cosyte/hl7` type surface. They were **not** checked against a published copy of
the standard, and one of them was wrong on the way here (IN1-17). That is why the table is
deliberately narrow and why widening it means citing a source, not adding a number.

**And a fourth recogniser limit the second pass found**: a literal backslash followed by `r` or `n`
inside a field value ends the segment early, because the escaped separator is also the terminator.
Measured, a Windows path in PID-11 truncates there and PID-13/14 go unread. It can only SHORTEN a
segment, never renumber one (the fields before the cut keep their positions) and the field it cuts
in still reports, so it is disclosed rather than guessed at: it is not decidable from static text.

**▶ AND ONE PRE-EXISTING RESIDUAL THE REFUTER NAMED: UNTRACKED content under an undeclared top-level
directory is invisible to BOTH enumerating routes.** The reconciliation covers the tracked half
only, by construction. Head is strictly better than base here, and the gap is pinned by a test that
asserts it, so a future edit closing it reds that case rather than letting the disclosure outlive
the defect.

**Nothing patient-identifying was found in the 69 pre-existing files the widening newly opened**,
every one of them hand-read. The fixture values are placeholders and are **named in the allow-list rather than
scrubbed**: `Jane Q. Public` and `Jane Doe`, the mnemonics keyed to their suites (`Appt^Amy`,
`Doc^Dana`, `Imm^Ian`, `Kin^Next`), `MRN1`/`MRN2`/`MRN12345`, an SSN-shaped `999887777` in area
number 999 which the Social Security Administration has never issued, placeholder street lines, and
two numbers in the reserved 555 range. The one org-traceable string is the publisher mailbox above.

**▶ THE SCANNER'S OWN TEST FILE IS NOW INSIDE THE CORPUS, AND ITS VIOLATOR PAYLOADS ARE ASSEMBLED
FROM PARTS AT RUNTIME.** A live literal there would red the repository's own gate on every run, and
both alternatives are worse: allow-listing it blinds the floor globally and route-blind, and
exempting the file by path leaves the largest violator-bearing file in the tree unscanned.
Assembling keeps every runtime value byte-identical, so no assertion lost bite. **The residual:
nothing gates the convention itself** beyond the gate reddening if someone writes a literal back.
**▶ THE RENAME RESIDUAL IS CLOSED, AND THE FRAMING IT WAS FILED UNDER WAS FALSE.** It was
disclosed here as "admitting `R`/`C` needs the two-path record shape, a scope decision". **There is
no scope decision and no record shape work**: the remedy is `--no-renames` on the `git diff
--cached` invocation, which makes git unable to emit `R` or `C` at all, so the destination arrives
as an ordinary single-path `A` and the source as a `D` the filter drops. That sentence was ported
in from a sibling and repeated rather than measured: the ecosystem's own porting trap, and the
reason to re-measure a disclosure before carrying it forward.
Measured on this repo's scanner before the fix, on **both** shapes: `git mv notes/leak.txt
src/leak.ts` over a link staged `:120000 120000 <sha> <sha> R100`, `--diff-filter=AMT` returned
nothing, and `--staged` reported a clean scan and exited **0** over a mode-`120000` entry at
`src/leak.ts`; `git mv notes/payload.txt src/payload.ts` over an ordinary PHI-bearing file passed
identically. **The gap was at PRE-COMMIT** (the hook is `phi-scan --staged`) with the CI all-mode
walk as the backstop, so the exposure was "PHI enters a local commit or a pushed branch", not "PHI
merges". The enumeration is a strict **superset** of the previous one, re-measured here under
`diff.renames=true|copies|false|1` and `renameLimit=1`: every setting yields the same single-path
`A`, which also makes the two-field stride **structural** rather than conditional on a caller's
config. **The stride claim is about this ARGV, not about `--no-renames` alone**: measured,
`--find-copies-harder` re-enables two-path records even placed BEFORE it, and a later `-M`/`-C`
overrides it in the ordinary way. Neither is passed and no config key sets either, but adding an
argument to that list means re-measuring the stride rather than assuming it.
Ported from `dicom#60`. **Unmerged (`U`) records went the same way**: returned by neither
`AM` nor `AMT`, so a conflicted in-scope path reported clean; `U` is now admitted and **refused**,
because it has no stage-0 entry and `git show :<path>` answers `fatal: path ... is in the index,
but not at stage 0`. **Key it on the STATUS, not the mode, and do not write one flavour's record
down as canonical**: across both-modified, add/add, modify/delete, delete/modify, rename/rename and
symlink/symlink the status is always `U` and the dst mode always `000000`, while the SRC mode
(`100644`/`120000`/`000000`) and the set of stages present (1/2/3, 1/2, 2/3, 1/3) both vary.
**Three residuals remain disclosed, not closed.** Do not silently re-close any, and do not let a
future edit read as though they were. (1) This scanner still has **no refuse-a-scan-that-observed-
nothing rule** on the routes themselves: an empty enumeration reports clean. The all route now has
a partial answer, `reconcileWithGit`, which refuses when the walk opened less than git tracks; that
does **not** cover `--staged` or `<path>`, and it is **vacuous on an empty index**, so the sentence
is narrowed rather than retired. (2) The ancestor-component and absolute/`../` reads above, on the
named-path mode only. (3) **A scan ROOT'S OWN PATH staged as a non-regular entry is outside the
`--staged` route's scope**, because that scope tests the root NAMES as path prefixes and an index
entry at exactly `src` matches neither prefix nor a repo-root file. Measured identically on both
trees: `ln -s elsewhere src && git add -A` stages `:000000 120000 0000000 <sha> A src` and
`--staged` reports clean / exit **0**. The all-mode walk now answers that tree two ways rather than
one: the `lstat` preflight refuses the root outright, and the reconciliation refuses over whatever
was tracked beneath it. `dicom`'s copy of this function carries a guard for the staged half and
**it did not come across in the port**. Pre-existing, and its own item.
**Exit **2** now means every failure to complete, not just a bad invocation.** A throw raised
before or outside `main`'s inner `try` blocks (`loadAllowList()` on a missing
`scripts/phi-allow-list.txt`, `readdirSync` on an unreadable directory under a walk root) left the
process on node's uncaught-exception code, **1**, which is this scanner's code for HITS FOUND. A
caller keying on the code read a gate that never ran as one that ran and fired. `run()` at the foot
of the file is the outermost net and `walk` names an unreadable directory itself; an unexpected
throw still prints its stack, because a gate that swallows its own bugs is harder to fix.
Pinned in `test/scripts/phi-scan.test.ts` against **throwaway git repos under `os.tmpdir()`**: the
scanner roots everything at `process.cwd()`, so never write a link or a violator into this corpus
to test it. **The enumerate-then-read race is deliberately still open here**, and the condition that
sentence named as hypothetical has now happened: it said the race was unreachable by scope _until a
walk root widens_, and the roots have widened to the whole tracked corpus. **Re-measured rather than
re-asserted**: `pnpm build` writes only to `dist/` and `coverage/`, both gitignored and neither a
root; the temp-using suites still `mkdtemp` into `os.tmpdir()`; and `dist-artifacts/`, which
`pack:docs` writes, is gitignored too. What DID come into scope is `.changeset/`, where
`pnpm changeset` and `changeset version` create and delete files, so a scan racing a release step
can now enumerate an entry that is gone before it is read. That path exits **2** through
`scanTarget`'s read guard rather than reporting clean, which is the safe direction, but it is a real
new reachability and is recorded as one rather than left to be discovered.

## No internal project bookkeeping on a public surface, in full

**No internal project bookkeeping on a public surface** (founder directive, 2026-07-27). What a
consumer reads (`README.md`, `docs-content/`, the npm `description`, a release body, the JSDoc
their editor renders, the message text their log prints) says what the software does and what
changed. Item identifiers (`TRANSFORM-6`), phase and wave language, roadmap section numbers
(`roadmap §4.5`, `§Phase 6`), ADR numbers, meta-repo paths and "how this got built" commentary
belong in the changeset, `CHANGELOG.md`, the commit, the PR and the roadmap. It is a
**translation** at the boundary, not a deletion, and when you strip a label off the front of a
line, **repair the head**: a fragment reads worse than the text it replaced. Gated by
`pnpm check:no-internal-refs`. The gate keys on known project prefixes, so **a new programme
prefix has to be added to it by hand**; and it catches identifiers, not English sentences about
our process, so the reviewer still owns half the rule.

**This repo is dense with the colliding shape**, because a v2-to-FHIR mapper's whole vocabulary is
written `WORD-N`: `MSH-9`, `PID-3`, `PV1-44`, `OBX-5`, `OBR-25`, `RXA-20`, `SCH-8`, `TXA-19`.
None of those is caught, and the only reason is that their leading token is not on the prefix
list. **Never re-key the rule on the `WORD-N` shape**, and never "resync" the prefix list with a
sibling repo's copy without re-reading why this one keeps `SYNTH` and the `HL7-\d{3,4}`
exclusion. Case sensitivity is load-bearing too: `FHIR-core`, `FHIR-required` and
`FHIR-core-fixed` are live here and a case-insensitive rule calls every one of them a violation.

**Three source surfaces, three different answers.** `/** */` doc comments compile into
`dist/*.d.ts` and render in a consumer's editor, so they are **gated**. String literals reach a
consumer as diagnostic message text, so they are **gated too**. `//` and plain `/* */` comments
are **not gated** and identifiers are **welcome** in them, because **the convention says source
comments are a place identifiers belong**. That is the whole reason. **Do not justify this
boundary from what reaches `dist/`**: two attempts to do so in a sibling repo were both false.
Measured here: this repo's tsup config strips `//` comments from the bundles, but `dist` is
`files[0]`, there is no `.npmignore`, and `dist/*.map` carries every tracked source byte in
`sourcesContent`, so **everything in `src/` is in the tarball anyway**. The line is not what
reaches a consumer's disk (all of it does) but what a consumer is **shown**. Two consequences: a
doc comment is not the place for "which stage added this" framing, and **removing a doc comment
to satisfy the gate is a regression**, not a fix (JSDoc with `@example` on every public export is
a hard guardrail above, and neither lint nor coverage will catch its loss). What the gate cannot
do is read `dist/` itself: `dist/` is untracked build output, so this is a gate on the source of
the published text, not on the published text.

## The agent-instruction contract gate, in full

**What it is.** `scripts/check-agent-notes.ts`, run as `pnpm check:agent-notes`, plus
`test/scripts/agent-notes-contract.test.ts`. It checks the two-file agent-instruction split that
landed across the fleet on **2026-08-04**: an always-read `CLAUDE.md` carrying the cursor, the
rules and every trap as a one-line imperative with a pointer, and this on-demand file carrying the
narrative those imperatives point at. The relocation took the tree from **1,327,773 to 527,428
bytes**, roughly **200K tokens off every worker**. Nothing checked that the contract held. This
does, for this repo, in this repo's own CI, so it costs the umbrella's automation plane nothing.

**Why prose needed a gate here of all places.** This repo's own text says that prose no test can
check is exactly the shape that was wrong before. Three ways the split rots with every existing
gate still green, none of which lint, coverage, `attw`, the PHI scan or the public-surface gate can
see: the archive is deleted or renamed and `CLAUDE.md` keeps eight pointers into nothing; a section
is emptied while its heading stays, so every pointer resolves and the measurement is gone; a
heading is reworded, and because GitHub renders a dead `#fragment` as the **top of the file**, the
reader lands on prose and does not notice it is the wrong prose.

### The seven rules

- **R1 existence**: both contract files are tracked in `git ls-files` and non-empty.
- **R2 identity, the negative control against the WRONG package**: the level-1 title of each
  contract file must contain the `name` from `package.json`. Not hypothetical here: a `transform`
  worker's file was once rewritten out-of-band to attribute its measurements to a different
  package, carrying an instruction to treat that as intentional and not mention it. The worker
  refused, corrected the file and reported it. A gate should not need a worker to be vigilant.
- **R3 declared sections are non-empty**: every heading below level 1, in **both** files, has a
  body. Fenced code is skipped, so a `# comment` inside a ```bash block is not read as an empty
  heading.
- **R4 anchor pointers resolve**: every `<file>.md#<anchor>` in either file, written as a markdown
  link, inside backticks, or bare in a sentence (all three shapes are live in `CLAUDE.md`, so
  keying on markdown links alone would see one of eight). Slugging follows GitHub's algorithm, and
  the detail that matters is that the **en dash is dropped, not converted**:
  `## Shipped-phase history (Phases 1–6)` slugs to `shipped-phase-history-phases-16`. Getting that
  wrong would red a pointer that works, which is worse than having no gate.
- **R5 no orphan sections**: every `##` here is the target of at least one pointer from
  `CLAUDE.md`. This file's own preamble makes that claim; R5 is what keeps it true.
- **R6 file pointers resolve**: every in-repo path token in `CLAUDE.md` resolves against the
  **index**, as an exact file, a directory, or a prefix of exactly one tracked path (that last one
  exists for `documentation/decisions/0001`, which `CLAUDE.md` names by ADR number).
- **R7 the external allowlist cannot rot**: `documentation/conventions.md` and
  `documentation/repos/transform.md` are declared external because they live in the meta-repo. If
  either ever resolves in-repo the gate **refuses**: an ambiguous exemption is one that has begun
  hiding a real broken pointer.

### Existence is not observation

A check of this shape has one specific, repeatedly-hit failure mode here: **it prints green over a
corpus it never opened.** The worst recorded instance was a scanner whose declared root **had never
existed**, so it reported clean on every run it ever made. **A count does not detect that**: a
sibling's counterpart reported `71` against a healthy `122` and read as fine, because a count
counts the roots that DID exist.

So every read goes through `readObserved()`, which records the path, and `reconcile()` compares
what was opened against `git ls-files`: the index, not the directory entries, so the two cannot
fail the same way. It refuses on: nothing opened at all; a contract file tracked but never opened;
a file opened that git does not carry; and `git ls-files` answering **emptily**, which counts as no
answer rather than as an empty repository. **Exit `2` means the gate could not decide; exit `1`
means violations were found**: the PHI scanner's split, load-bearing for the same reason it is
there, because an uncaught throw lands on node's `1` and a caller would read a gate that never ran
as one that ran and fired.

### What was measured, not asserted

- **42 of the suite's 43 tests are red on the parent** (`7f4d59b`), measured by running the suite
  with `scripts/check-agent-notes.ts` moved aside, not by reading it. The single green one is the
  corpus-only identity control, which reads the two titles directly and never invokes the gate,
  and it holding on the parent is the correct result, not a gap.
- **Red before, green after, one edit apart.** The R4 test rewords a heading (the corpus is RED),
  then repairs the pointer in `CLAUDE.md` (GREEN). R5 does the same with an orphan section.
  Nothing else changes between the two runs, so the colour is attributable.
- **The control that reds when the gate is pointed at nothing**: an initialised git repo with
  nothing tracked exits **2**, and a directory that is not a git repo at all exits **2**. Neither
  prints a `✓`.
- **The R6 recogniser had a hole and a fixture found it, not a reading.** Deriving "is this a path"
  purely from `git ls-files` means a pointer at `scripts/attw.mjs` in a repo where `scripts/` has
  been **deleted entirely** is invisible, because the recogniser learns its directories from the
  index the deletion emptied. That is the same shape as grading a corpus you never opened, one
  level up. Two index-independent arms close it: a source/doc extension, and a marked token with a
  trailing slash.

### What the grade found, and what was changed rather than argued

The `conformance-refuter` **REFUTED pass 1** with nine `INTRODUCED` findings, four of them major,
every one measured rather than reasoned. All nine were fixed. Recorded because several are the kind
of thing that reads correct and is not:

- **The slug was not GitHub's, and the gate was one heading away from both harms.** It collapsed
  runs of spaces to a single hyphen; GitHub gives **each space its own hyphen**, so
  `## Branch protection – and the limits` anchors as `branch-protection--and-the-limits`, with a
  DOUBLE hyphen. Verified against GitHub's own renderer (`POST /markdown`) and `github-slugger`.
  Measured consequence: a **dead** pointer passed green, and a pointer that **works** was reddened.
  The mark shown above was a spaced **em** dash when this was written, and that was the house
  punctuation at the time; the brand sweep of 2026-08-07 removed the character from every tracked
  file, so the example and the two pinning tests now use a spaced **en** dash instead. `slug()`
  drops both alike and keeps both surrounding spaces, so the behaviour is unchanged and so is the
  bite of the tests. **Any dropped mark with a space either side reproduces it**, so do not read the
  sweep as having retired the trap. Fixed and pinned by two tests.
- **A check that cannot fail is documentation.** `reconcile()` had every read guarded by a
  `tracked.has()` pre-check, which made all three of its refusal branches unreachable BY
  CONSTRUCTION, instrumented and measured at **zero firings across the whole suite**, while
  `CLAUDE.md` and the changeset both sold the reconciliation as the protection. The pre-checks were
  removed, not the function: a contract file present on disk but untracked now reads fine and is
  refused by the reconciliation, which is a branch that genuinely fires and has three fixtures.
  Two branches remain honest **tripwires for a future edit** and are labelled as that, not counted.
- **R6 saw two of the three ways an author writes a pointer.** Bare prose was invisible:
  `The wrapper lives at scripts/attw.mjs.` passed green while the identical token in backticks
  reddened. Widening it naively then reddened a **correct** corpus in five places (`@cosyte/*`,
  `(segment/field/component index)`, a line-broken `segment/`, an inline markdown link, and
  ``absolute/`../` ``), so the bare arm is held to a strict path charset and the directory arm is
  restricted to marked tokens.
- **A truncated pointer resolved.** `documentation/agent-notes.m` and `src/index.t` are each a
  prefix of exactly one tracked path and each 404s on GitHub. The prefix arm now requires the
  remainder to break at a `-`, `/` or `.`.
- **A section gutted to a bare `---` counted as having a body.**
- **The `verify.sh` claim in `CLAUDE.md` was false in the safe direction**: it said the ladder ran
  neither route. It runs `test:coverage`, which runs the suite, which runs the gate. Corrected.
- **This diff falsified this file's own preamble.** Adding the first `###` headings here made
  "Every heading is a pointer target" literally false, in a shape R5 cannot see (it covers `##`).
  The sentence was narrowed to what is checked, with the date and the reason, rather than left
  standing.
- **The changeset put a repo-internal CI gate on the public release page.** Reworded until the real
  `release-notes.mjs` classifies it **internal-only** and drops it from the body, which is the
  founder's stated position on gates of this class. Verified by running `prepare`, not by reading
  the classifier.

**Pass 2 was NOT REFUTED**, with all nine re-derived by running, including the slug, checked against
GitHub's own renderer over all 26 headings and all 8 pointers, and `reconcile()` re-instrumented
(branch (c) fires 5 times across the suite, (d) once, (a) and (b) zero, which is exactly what the code
claims). It raised **four minor prose-accuracy findings, and every one was answered by CORRECTING THE
CLAIM rather than growing the guard**, the standing rule in this repo, applied a third time:

- The relocation's "2 + 4 + 1 = seven sections, verbatim" accounting was falsified by this diff's own
  new eighth section. Scoped to the relocation rather than re-counted.
- R6 sees backticks, link targets and bare prose, **not** a bare path wrapped in emphasis. The
  charset that rejects the emphasis markers is the same one that keeps `@cosyte/*` out, so the
  narrowing is deliberate. Disclosed, not widened.
- Two of three `UNTRACKED_BY_DESIGN` entries were measured **dead**: emptying the map reds on `dist`
  alone. Deleted. An exemption nothing exercises is a claim nobody checks.
- R3's thematic-break rule covers `---`, `***`, `___` and not CommonMark's spaced `- - -`. Widening
  it towards "dashes and spaces" starts competing with list syntax, and a gate that eats a real
  bullet is worse than one that misses a gutted section.

**A fifth correction came from CI, after both passes, and is recorded because it is the same
shape.** CodeQL flagged the `slug()` chain HIGH for an **incomplete multi-character sanitisation**:
a single-pass `<[^>]*>` strip, which is genuinely incomplete. It was **removed rather than
hardened**: it guarded no HTML sink, and `github-slugger`, the algorithm this function is checked
against, strips no tags at all, so the line was a deviation from the thing it was imitating.
Measured before removing it: **no heading in either contract file contains `<` or `>`**, so every
anchor is byte-identical without it. The resulting behaviour (angle brackets dropped as characters,
the tag NAME surviving into the anchor) is now disclosed and pinned by a test.

**These four are a SAMPLE OF A CLASS, not a list of four.** The gate reads shapes, so an author's
punctuation can always hide a pointer and a mutation can always dress up as a body. The honest move
is to keep the disclosed-limits list accurate, not to chase the class.

### What this gate does NOT cover

- **It proves a heading is POINTED AT. It can never prove the one-liner in `CLAUDE.md` says what
  the section here says.** The meta-repo's conventions name this exactly: an anchor resolving
  proves the target exists, never that it says what the sentence promises. The exposed class is the
  trap phrased as a **deliberate omission** ("is deliberately left alone", "is never the default"),
  which carries no identifier to grep for. **Enumerate those by hand.**
- **R6 is `CLAUDE.md`-only, deliberately.** This file is narrative and quotes **illustrative** paths
  that must never resolve: `src/leak.ts`, `src/linkdir/payload.txt`, `test/fixtures/` are written
  into throwaway repos under `os.tmpdir()` by the PHI-scanner suite. Requiring them to resolve
  would push a worker to create them, which is the opposite of what the narrative says. Anchor
  pointers (R4) are scanned in both files, because `<file>.md#<anchor>` is unambiguous.
- **It reads the source of the instructions and says nothing about whether an agent followed them.**
- **It does not gate `CLAUDE.md`'s byte budget.** That ratchet lives in the umbrella's
  `.claude/hooks/doc-budget.mjs`, and nothing inside this repository can observe it: the same
  limit already recorded here for the branch ruleset. **Never quote the number in a repo file.**
- **It does not verify the 2026-08-04 relocation was verbatim.** That was a one-time property of
  the move; there is no pre-move text here to diff against.
- **Setext (`===`/`---` underline) headings are not parsed.** Neither contract file uses them and
  inventing support for a shape the repo does not have is how a gate acquires rules nobody asked
  for. Add one and this gate will not see it.

### Where it runs, and the one place it does not

Two invocation paths, **pinned to agree by a test** rather than by a comment: `pnpm
check:agent-notes` runs it through `tsx` (the engine floor is Node 22), and the `no-internal-refs`
job runs the same file through bare `node` on 24, where type stripping is native and no install is
needed. That test skips below Node 24 and says so; the CI matrix runs 22 **and** 24, so the 24 leg
always takes it.

It is enforced **two independent ways on purpose**. The suite runs inside `ci / verify`, which is
required, but that route inherits this repo's documented **"the gate can leave the job"** hole
verbatim: the `include` glob in `vitest.config.ts` and the `test`/`test:coverage` script bodies in
`package.json` can each drop the suite with the job still green and the ruleset still satisfied.
The `no-internal-refs` step depends on neither, so **the two routes cannot be removed by the same
edit.** It rides in that already-required job rather than a new workflow because a required job
gates all of its steps, so it binds the moment it lands, with no ruleset edit and therefore no
window in which open PRs strand pending on a context nothing has emitted yet.

**What the umbrella's `scripts/verify.sh` ladder does and does not reach, measured rather than
assumed.** The ladder is a fixed script-name list. It runs `test:coverage`, whose vitest `include`
glob picks up `test/scripts/agent-notes-contract.test.ts`, which spawns this gate against the real
repository root and asserts exit 0, **so route 1 does run locally.** What it does not run is the
standalone `check:agent-notes` script, which the ladder has never heard of, and its own
unladdered-script detector fires and says so. **A worker in a submodule cannot fix that**: the fix
is one name in an umbrella file. An earlier version of this section said `verify.sh` ran neither;
a refuter measured that false, and the correction stands rather than the claim.

## No em dash, anywhere

**The rule.** Founder directive of 2026-07-24, stated canonically in the knowledgebase brand-voice
document: cosyte never uses the em dash. Not in a file, not in a filename, not in a commit message,
not in a PR title or body. Rewrite with a period, a colon, a comma or parentheses. **Never
re-encode the character**: the HTML entity, both numeric character references, the percent-encoding
and both JavaScript escapes are banned on the same footing as the literal, and each has its own arm
in the gate.

**The census, re-derived in Python over raw bytes, 2026-08-07.** 659 occurrences across 75 of the
98 tracked files. **The umbrella's figure of 660 across 76 was taken before the npm `description`
fix landed**, which removed exactly one occurrence from exactly one file, so the two agree. Every
other spelling the rule names (the named entity, the decimal and hex references, the
percent-encoding, both JavaScript escapes) was searched for and is **absent**: the literal
character is the only spelling this repository has ever carried.

**609 occurrences across 73 files were rewritten**, each by what the sentence wanted rather than by
one substitution: a colon where the dash introduced an appositive, a comma before a conjunction, a
negation or a relative pronoun, a comma where the clause already carried a colon, parentheses where
the mark scoped an aside. Consumer-visible surfaces in that count: `README.md`, the seven
`docs-content/` pages that publish to the documentation site, and the `src/` JSDoc that compiles
into `dist/index.d.ts` / `dist/index.d.cts` and renders on a consumer's hover. **No issue code, no
fatal code, no type and no documented behaviour changed.**

**COUNT THE BYTES IN PYTHON, NEVER WITH `grep`.** The org-wide census that scoped this work was
taken with a broken scanner and was low in every repository it touched. In the agent containers
`grep` is a shell **function** that forces `-I` and `--ignore-files`, and under `xargs` it is
bypassed for `/usr/bin/grep`, which in the container's empty locale **fails at exit 2 and prints
nothing** for `-P '\x{2014}'`. Piped to `wc -l` that reads `0`. Re-derive every figure here before
acting on it.

### The one runtime string, and why it moved by hand first

`scripts/phi-scan.ts`'s clean-run line carried the character. It is **quoted in prose in two
docblocks and asserted by regex in three tests**, so all five sites moved together, by hand,
**before** any bulk pass ran. A bulk pass that touches a string literal and not its assertion
desyncs a suite silently, which is how a sibling repository lost 13 assertions in one commit. The
line now reads `[phi-scan] OK: no hits`. The `check-agent-notes.ts` R5 orphan message changed the
same way; its test asserts on the token `ORPHAN`, so it did not move.

### The semantic value, converted before the bulk pass

`src/messages/diagnostic-report.ts`'s OBR mapping table had a bare `|` cell in the `via` column for
OBR-8, meaning "nothing here". A bulk rewrite turns that into a stray mark that reads as a
rendering artefact rather than an absent value, which is a defect a sibling shipped. It was
converted by hand first, and to the **true** value rather than to a word: OBR-8 goes through
`toFhirDateTime` at the call site, so the cell now names that converter.

### The slug fixtures moved to an en dash, and the trap did not go away

`test/scripts/agent-notes-contract.test.ts` proves that GitHub gives **each space its own hyphen**,
using a heading whose dropped mark has a space on either side. That fixture was a spaced em dash.
`slug()` keeps only letters, numbers, spaces, `_` and `-`, so an **en** dash is dropped in exactly
the same way and the two surrounding spaces still survive as two hyphens: the behaviour under test
is unchanged, and so is the bite of the two cases that pin it. **Do not read the sweep as having
retired the trap.** Every dropped mark with a space either side reproduces it, and the en dash is
punctuation this repo does still write (`Phases 1–6`).

### The exemptions, both of them, with their reasons

Nothing was skipped silently. Two files still carry the character and each is an exemption with a
written reason, not a remainder.

**`CHANGELOG.md` (49), and the exemption is a BOUNDARY rather than a file.** The gate scans
everything **above** `## Released before this file was generated` and nothing below it. Above that
heading is generated by the release from a changeset summary, and a changeset summary becomes the
published release body **and** a line in the tarball's changelog, so an occurrence there is a
public-surface instance. Below it is the hand-maintained history that predates changelog
generation, preserved verbatim when it was relocated, and `test/scripts/changelog-generation.test.ts`
measures that a release passes the archive through unchanged. **It fails closed**: if the boundary
heading disappears, the whole file is in scope and the gate reds loudly, because the alternative is
an exemption that silently grows to cover the generated half. The archive is also the gate's
**on-disk canary**: a scan that reports it clean has gone blind rather than found good news, and
the gate refuses rather than reporting that as a pass.

**`vendor/cosyte-hl7-0.0.0.tgz` (1), declared `binary` in `.gitattributes`.** A DEFLATE stream can
hold `E2 80 94` by coincidence and this one does; there is no edit that removes a byte from someone
else's compressed archive, and the tarball is third-party content this repo consumes rather than
authors. `vendor/cosyte-fhir-0.0.0.tgz` is declared alongside it and carries none today.
**`.gitattributes` is not a silencer**: the gate REFUSES any `binary` declaration outside
`vendor/`, so widening the exclusion means editing the gate deliberately. And a declaration about a
file's BYTES says nothing about its NAME, so tracked filenames are scanned whatever that file says.

**Nothing else was skipped.** `CLAUDE.md` (47) and this file (68) were swept like any other tracked
file. The banner at the top of this file protects its **claims** from being softened; it is not a
banner protecting its **bytes** from being repunctuated, and an exemption here would grow, because
this file is appended to. The one quotation that is reproduced verbatim, in
`Publish state, and the stale claim inside it`, was swept too, and the section now says so in the
sentence that introduces it: the wording, every claim and every qualifier are untouched, and only
the dash punctuation moved.

### The gate, and why it is Node rather than shell

`scripts/check-no-emdash.mjs` shells out for nothing. It reads bytes with `node:fs`; the only child
processes are `git ls-files` and `git check-attr`, and both have their exit status checked rather
than assumed. That closes two classes at once: the container `grep` shim above, and the lost exit
status of a pipeline (`grep` exits 1 on no-match, `xargs` reports that as 123, so "clean" and "died
part way through" are indistinguishable in the shell form).

**IT EXCLUDES NOTHING BY PATH, AND THAT IS THE POINT.** A scanner that spells the forms it bans has
to exclude itself, and a self-exclusion is a demonstrated false green in a sibling: an em dash
appended to that gate scanned OK, because the gate was the one file nobody checked. Here every
spelling is **assembled at runtime from the codepoint `0x2014`** and the prose names the forms
rather than writing them out, so the file contains none of them as text and is scanned by the same
code path as every other tracked file. **Assemble a new arm; never paste a literal in, and never
answer a red by adding an exclusion.** The test file does the same thing for the same reason.

**▶ THE PARTITION IS RECONCILED AGAINST THE DECLARATION, NOT MERELY BALANCED, AND A REFUTER IS WHY.**
The first version of this gate checked only that `scanned + binary === tracked`. That balances for a
path exclusion which **accounts** for what it skips: push the skipped paths onto the declared-binary
list and the arithmetic still adds up, while the outside-`vendor/` refusal reads `.gitattributes`
rather than the skip list and so never sees them. A refuter added `|| rel.startsWith("docs-content/")`
to the skip condition, 34 characters, planted an em dash on a page that publishes to the
documentation site, and got a clean banner with **all 38 tests green**. The only tell was a count
nothing asserted. `probe()` check 5b now reconciles the two sets **path for path**, so the only thing
that may skip a file's content is a `.gitattributes` declaration; the real-tree case pins the banner
at `2 declared binary`; and a **mutation** case reproduces the refuter's exclusion against a copy of
the gate in a throwaway repository and requires the refusal, with the unmutated fixture beside it as
the near miss. Proven red-before, green-after: the pre-fix gate exits **0** on that fixture.

**▶ AND THE PARTITION CHECKS ALL COUNT FILES, WHICH IS WHY THE SUITE ASSERTS BYTES.** The refuter's
second pass showed check 5b closes one bucket of two. An exclusion that pushes what it skips onto the
**scanned** list rather than the declared-binary one keeps every file count byte identical to an
honest run, because the path really is classified and really is counted; it is simply never opened.
Measured with a live em dash planted on a page that publishes to the documentation site: the same
`101 tracked file(s) scanned, 2 declared binary, 103 filename(s) checked` banner, exit **0**, 40 of
40 tests green. The extension variant behaved the same. **The one quantity a skip-the-read mutation
cannot fake is `bytesRead`**, which the gate already prints, so the suite now recomputes the expected
total **independently**, from `git ls-files` plus `git check-attr` plus `statSync`, and asserts the
banner against it. **It has to live in the test, not in `probe()`**: an in-script invariant can
always be satisfied by the same edit that breaks the property, because both sit in the file being
mutated. Both surviving mutations red on that one assertion and nothing else.

**It refuses rather than reporting a clean tree it cannot prove.** Seven checks, each closing a way
the gate could return "no findings" having examined nothing: the character it scans for really is
`E2 80 94`; every pattern matches a specimen built to contain exactly its spelling; `findEmDashes`
finds something in every one of those specimens (checks 1 and 2 pass even if that function is
blind); the CHANGELOG archive canary above; the enumeration returned a tree; every tracked path is
classified exactly once **and every skipped one is declared**; and four known-text files are in the
scanned set. **The floor on the
enumeration is 80 paths, deliberately not the 103 tracked when this landed** so an ordinary
deletion does not read as a filtered enumeration.

### Two jobs, and one of them must never be required

`.github/workflows/no-emdash.yml` runs `no-emdash` over tracked files and filenames, and
`no-emdash-messages` over the PR title, body and commit range. The split is the whole design: a
sibling shipped this as ONE job and had to exempt the lot, which un-required the tracked-file half
as well.

**▶ `no-emdash-messages` MUST NEVER BE A REQUIRED CONTEXT, AND THE REASON IS WRITTEN DOWN RATHER
THAN INFERRED.** Dependabot composes a PR body by pasting the dependency's **upstream release
notes** into it, em dashes included. Requiring that context would block a dependency bump on prose
nobody in this org wrote and nobody here can edit without rewriting the PR by hand: the same
refusal this ecosystem already made for a CI `pnpm audit`, a gate that fails on someone else's
clock. **Do not "fix" it with an actor `if:` on a required context either**: that leaves the check
permanently **pending** on exactly those PRs, which is worse than red, because nothing says why.

**`no-emdash` (tracked files) IS safe to require**, once it has run on `main`. Nothing outside this
repository can put an em dash into a tracked file: Dependabot writes `package.json` and
`pnpm-lock.yaml`, which are version specifiers and lockfile records, never prose. Fold it into
ruleset `19914044` like every other context here, never into a second ruleset, and read the context
name off a live check run rather than off the workflow's `name:`.

**THE JOB SCANS SURFACES A LOCAL PRE-COMMIT SCAN STRUCTURALLY CANNOT SEE**, and two slices
elsewhere in this ecosystem have lost a review pass to exactly that: a NEW file is untracked, so a
scan of the index does not see it, and no local hook sees a PR body at all. On a squash merge the
PR title and body **become** the commit message, so they are the same surface as the tree.

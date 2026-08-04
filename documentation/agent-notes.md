# @cosyte/transform — agent notes

**What this is.** The long-form narrative that used to live in `CLAUDE.md`: the per-incident
sections, the shipped-phase history, and the long rationales behind the guardrails. It was relocated
here on **2026-08-04** under `CLAUDE-MD-AUDIT`, because `CLAUDE.md` is always-read by every worker
that `cd`s into this repo and the per-worker token cost is paid on every session (umbrella ADR 0023,
amendment 2026-08-04).

**Relocated, not deleted.** The narrative below is the CLAUDE.md text **verbatim** — nothing was
softened, summarised, or dropped. Be precise about what that claim covers, because this file's whole
value is that it does not overstate: **two headings** (`Branch protection…`, `Dependency watching`)
are the originals carried across whole; **four** are new headings over relocated bodies that were
bullets in `CLAUDE.md`'s `Status`, `Engineering Guardrails` and `Standing disciplines` sections; and
**one** — `Publish state, and the stale claim inside it` — is mostly **newly written on 2026-08-04**,
with the relocated original quoted inside it as a blockquote. Every heading is a pointer target from
`CLAUDE.md`.

`CLAUDE.md` keeps the cursor, the rules, and **every** trap as a one-line imperative that points back
here. If a one-liner there and a paragraph here ever disagree, **this file is the measurement** and
the one-liner is the reminder — fix the one-liner, do not weaken this.

**These are things that cost a defect to learn.** Several are refuted claims: a sentence someone
wrote, a refuter measured false, and the correction stayed. Do not re-assert one of them from
reading the code. **Re-measure, or leave it alone.**

---

## Shipped-phase history (Phases 1–6)

**Phases 1–6 shipped** (roadmap `operations/roadmaps/transform.md` §Phase 1–6). Pre-alpha `0.0.x`,
**published on npm** — this line read "not yet published to npm" for several releases after first
publish, which is part of why a `VERSION` constant stuck at `"0.0.0"` went unnoticed on a shipped
package. **Never quote a version here**; `npm view @cosyte/transform version` is the only source of
truth. **Published is not installable here:** the `@cosyte/fhir` peer is not on the registry, so
`npm install @cosyte/transform` fails to resolve. Both halves travel together or neither is
useful. Phase 1: the **six safety-critical datatype converters** (`toFhirDateTime`,
`toFhirIdentifier`, `toFhirCodeableConcept`, `toFhirHumanName`, `toFhirAddress`, `toFhirQuantity`),
the **value-free diagnostic channel** (`ISSUE_CODES`/`FATAL_CODES`, `TransformIssue`,
`toOperationOutcome`), and the minimal **NamingSystem resolver** (`createNamingSystem`). Phase 2: the
first **message-level assembly** — `toFhir(msg)` turns an HL7 v2 **ADT** message into a FHIR R4
**message `Bundle`** (MSH→`MessageHeader`, PID→`Patient`, PV1→`Encounter`, NK1→`RelatedPerson`, with
`urn:uuid:` reference wiring, the HL70001/HL70004 table maps, a segment-assembled fallback for
non-IG-mapped triggers, and a conservative-emit gate against `@cosyte/fhir.validateResource`). Phase
3: the **ORU^R01 → DiagnosticReport + Observation** results graph — OBR→`DiagnosticReport` (status via
HL70123, `DIAGNOSTIC_REPORT_STATUS_MAP`), OBX→`Observation` with **OBX-2 value-type discrimination**
of OBX-5→`value[x]` (NM→`valueQuantity`, CWE→`valueCodeableConcept`, SN→structured, ST/TX→`valueString`),
OBX-8→`interpretation` (HL70078, `HL70078_INTERPRETATION_CODES`), OBX-11→`status` (HL70085,
`OBSERVATION_STATUS_MAP`), with the "never a confident wrong result" fail-safes (a corrected/cancelled
result never emits as `final`; an unmapped status withholds the resource; a precision-exact magnitude
read from the raw OBX-5). Every segment→resource and field→element map is grounded firsthand on the
IG's ConceptMaps and cited. Phases 4–5 added the message-level graphs for **ORM_O01/OML_O21 →
ServiceRequest** and **RXO → MedicationRequest** (Phase 4) and the thin IG singles **VXU_V04 →
Immunization**, **SIU_S12 → Appointment**, **MDM_T02 → DocumentReference** (Phase 5). Phase 6: the
**terminology value-translation** layer — a `$translate`-shaped, additive, fail-safe engine
(`toFhirCodeableConceptVia`) applying the license-clean IG value ConceptMaps (each transcribed +
verified **firsthand against the raw IG JSON**) to the previously structural-only coded fields: RXR
route/site (HL70162 / HL70550), SCH-8 appointment type (HL70277), RXO-9 substitution (HL70161), and
OBR-5 priority (HL70485, `SERVICE_REQUEST_PRIORITY_MAP`). A code in the IG's `(unmapped)` group is
flagged, never coerced; SNOMED-target maps (RXR-4 method, SCH-7 reason) stay structural/BYO — no
SNOMED bundled; and fields with no IG value map (TXA-2, RXA-5) are documented as structural, never
invented.

**Deferred to later phases:** deeper terminology (the full HL7 THO NamingSystem crosswalk beyond the
shipped value maps, consumer-supplied ConceptMap application), the reverse FHIR→v2 direction (Phase 7),
and profiles (Phase 8).

## Publish state, and the stale claim inside it

**Read this whole section before you edit a publish-state sentence anywhere in this repo.** Two
readings of the same fact are on record here. The relocation of 2026-08-04 deliberately carried
**both** across rather than picking one, because picking one is how a stale claim becomes fact.

**The paragraph as it stood in `CLAUDE.md`, verbatim:**

> **Consumes two cosyte siblings** (`@cosyte/hl7`, `@cosyte/fhir`) as **peer dependencies**, vendored
> as `pnpm pack` tarballs in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008) — refresh with
> `pnpm vendor:refresh`. Pinned shas: hl7 `46d50eb`, fhir `7a099b2`. **They are not both unpublished
> — that wording was stale.** `@cosyte/hl7` is on the registry; **`@cosyte/fhir` is not** (npm 404,
> a human-gated publish), and it is the fhir peer alone that makes this package uninstallable from
> npm. Derive it, do not recall it: `npm view @cosyte/hl7 version`, `npm view @cosyte/fhir version`.
> **Third-party runtime deps: zero.**

**That paragraph is itself flagged stale**, in the umbrella backlog, alongside the same claim in
`hl7`, `mllp` and `deid`. It has now been corrected **twice** — first from "both unpublished", then
again below — which is the reason it is quoted rather than silently rewritten. **Relocating a
disputed claim must not launder it into fact.** It is reproduced above as history, not as a
measurement.

**The specific words under dispute are `npm 404, a human-gated publish`, and the two halves are not
equally wrong — say which is which rather than rejecting the line wholesale.** Two different facts
sit behind them and the old wording collapses them into one:

- **The package is absent from the registry**, so `npm view @cosyte/fhir` answers **404** and a
  consumer install of `@cosyte/transform` fails **`E404`** on the missing peer. That half is not the
  defect. **Do not generalise the code across siblings** — `@cosyte/synth` is blocked by the same
  absent peer but fails **`ERESOLVE`**, a different code for the same cause.
- **The publish ATTEMPT is refused with `E403` on `PUT`**, cause unestablished — tracked as
  `FHIR-NPM-NAME`. **This is where `a human-gated publish` misleads.** It reads as a routine approval
  someone has not clicked yet. It is not: CI is green, provenance reaches the transparency log
  *before* the refusal, and the registry rejects at **policy**. The human step on record is
  **escalating a captured trace to npm**, which is a support ticket, not a release gate. Treating it
  as "waiting on a human" invites an agent to go looking for a button to press. **There isn't one.**

The work is staged on `main`; the registry refuses it. The same blockage takes `transform` and
`synth` down with it: both are on the registry and both **fail to install**, because the unpublished
`fhir` peer cannot resolve.

**The `FHIR-NPM-NAME` name is a label, not a diagnosis. The "name-similarity" reading is
RETRACTED.** It implied a rename, and **the error never asked for one**. **DO NOT RENAME ANYTHING**
— not `@cosyte/fhir`, not `@cosyte/transform`, not a scope, not an export — on the strength of that
identifier. The cause is unexplained and staying unexplained is the honest state.

**So do not resolve this from memory, and do not resolve it from this file.** Every reading here has
a date on it and at least one was wrong when read. Derive it:

```bash
npm view @cosyte/transform version
npm view @cosyte/hl7 version
npm view @cosyte/fhir version
```

**Visibility and publish state are independent** — never infer one from the other. And **never move a
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
return 0` — an untyped package is a legitimate npm package, so "no types at all" is a description,
not a problem, and the problem list is never consulted. No `--profile`, `--ignore-rules` or config
setting reaches that early return. For a package that ships types it means the declarations were
**not in the tarball**, which is a broken publish reported as a pass. The invocation here was
never lenient — it was the bare `attw --pack .` on the default strict profile.
**The race only supplies the condition.** Reproduced here on a quiet box with zero concurrency:
`rm -rf dist && attw --pack .`, and `pnpm build && rm -f dist/index.d.*ts && attw --pack .`, both
print the sentence and exit 0. The second is the realistic window — `tsup` emits the bundles in
one pass and the declarations in a later one, so **every** build has an interval where `dist/`
holds `.mjs`/`.cjs` and no `.d.ts`; measured at **1,600 / 1,646 / 2,018 ms** over three
consecutive quiet-box builds, polling every 5 ms. A concurrent build or `clean` in the same
working tree lands `attw` in it. So the answer is **not** a lock, a lease or a build queue: the
gate must be able to say its own inputs were missing, whatever removed them.
`scripts/attw.mjs` carries **two nets, and they catch different things** — a preflight that every
relative path `package.json` promises (`main`, `module`, `types`, `typings`, every string leaf of
`exports`) exists and is non-empty, which catches the build window and _names the missing file_;
and a post-check on `attw`'s untyped sentence, which catches what the preflight structurally
cannot — declarations present on disk but excluded from the tarball by `files`/`.npmignore`.
**No instance of that second case is on record in this repo.** `test/scripts/attw-gate.test.ts`
pins both nets against the real binary, including the upstream exit-0 itself, so an `attw` upgrade
that reworks the wording or fixes the exit code reds the suite instead of letting the net go
quietly slack. It also pins a **negative control** on a well-formed package, and that a real
`attw` failure still fails with `attw`'s own status — a gate that only ever fails is not a gate,
and one that swallows the status is not one either. Reducing the wrapper to the bare CLI reds 10
of its 13 tests; that is how the suite was checked for bite rather than assumed to have it.
**The post-check reads a string, so what would hide that string is refused**, not tolerated.
**Three routes were measured here** to hand back exit 0 over an untyped pack: `--quiet`,
`--format json`, and a `.attw.json` setting either (`readConfig()` applies it after argv).
`--config-path` is refused too, but **by inference, not measurement**. The refusal is **by option
name, wholesale, not by value** — a harmless `--format` value blinds nothing and is refused
anyway, which is the deliberate trade against value-parsing them.
**Two limits of a green here.** A **complete but stale `dist/`** passes both nets (not live today
only because the ladder runs `build` before `attw`); and this package's unpublished
`@cosyte/fhir` peer is **not** something `attw` speaks to — measured, a good pack reports "No
problems found" and exits 0, identically with `node_modules/@cosyte/fhir` moved aside, so `attw`
never resolves that peer. A green `attw` has never meant a consumer can install the peer.
**This is a per-repo script.** It was ported here from `terminology`'s graded fix (terminology#28,
`bf153cb`); siblings that still invoke the CLI directly still carry the defect, and the prose does
**not** port with the code — every number above was re-measured on this package. Derive who is
left rather than writing a count down:
`rg -l --glob '**/package.json' '"attw":' /workspace`.

## The PHI scanner guardrail, in full

**▶ THE PHI SCANNER REFUSES (exit 2) EVERY ENTRY IT ENUMERATES, AND EVERY PATH NAMED DIRECTLY, THAT
IS NOT A REGULAR FILE. THAT IS THE WHOLE CLAIM — "it follows nothing" IS THE LOOSER WORDING, AND
TWO SEPARATE REFUTER PASSES MEASURED IT FALSE.** See the ancestor-component residual below before
you tighten this sentence back up.
Before `PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES` (ported from `terminology#37`, `5f81640`) a symbolic
link was clean on **both** enumerating routes, measured on this repo's own scanner over a link under
`src/` pointing at a name-bearing synthetic payload: all-mode printed `OK — no hits` / exit **0**,
and so did `--staged`. The walk enumerates `Dirent.isFile()`, an **lstat** answer, so a link is
neither a file nor a directory — and a linked _directory_ takes its whole subtree with it.
`--staged` reads `git show :<path>`, and **git stores a link as its TARGET PATH under mode
`120000`**, so that route gets the path text, never the target's bytes.
**Do not "fix" this by following the link.** Following reads bytes the enumeration does not control
(outside the repo, a loop, a device, a FIFO that blocks the gate forever), and git does not carry
them anyway, so a hit on them would be a claim about something no commit contains.
**▶ AND THE THIRD MODE IS THE ONE A DRAFT OF THIS GUARDRAIL GOT WRONG — IT SAID "FOLLOWS NOTHING"
WHILE ONE ROUTE STILL FOLLOWED.** A refuter measured it: the named-`<path>` mode classified with
`statSync`, which **dereferences**, so `pnpm phi-scan src/link.ts` read the TARGET's bytes and
reported hits from them — including a target **outside the repository**, the first hazard the
sentence above says the scanner does not incur. It was never a false clean, which is exactly why
reading the code did not catch it. It lstats now; **if you touch `buildTargetsForPaths`, re-measure
the sentence, do not re-assert it.** A dangling link is reported as the link it is, because
`existsSync` follows and would call it a missing file.
**▶ AND `lstat` ANSWERS FOR THE FINAL COMPONENT ONLY — a second refuter pass measured that too,
after the first fix.** A named path whose **ancestor** is a symlink (`src/linkdir/payload.txt`) is
still followed and still read from wherever that ancestor lands, as is a plain absolute or `../`
argument. The all-mode walk over the same tree **does** refuse that ancestor, so the two routes
disagree about one link. **Pre-existing, disclosed, and deliberately NOT closed:** closing it means
realpath or containment logic, which is a guard growing past the defect it fixes, and neither
commit-gating route (the `--staged` pre-commit hook, the all-mode walk CI runs) reaches it.
**▶ THE ONE-LETTER TRAP: `--diff-filter` MUST KEEP `T`.** Replacing a **tracked** file with a link
is neither an add nor a modify. Measured here, `git diff --cached --raw --diff-filter=AM` printed
**nothing** for that change while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T` —
so under `AM` the record dies before any mode is read and the hook passes a mode-`120000` blob
**green** while the changelog claims it refuses one. `T` also buys the reverse typechange (link →
real file bearing PHI), which must be _scanned_, not refused. The route reads `--raw -z` purely so
the destination mode is visible; `--name-only` cannot see it.
**A refusal never echoes the link target** — that is working-tree text and can itself carry PHI.
Name the entry's own repo-relative path plus a token from the closed `entryKind`/`gitModeKind`
sets, nothing else. **This applies to the prose too**: a diagnostic about a PHI leak is itself a PHI
surface, which is why the docblock writes the dangerous target as a _shape_ and not an example.
**The walk has NO extension scope of its own** — it skips regular `*.md` as documentation and takes
everything else, so a link at `src/leak.json` and a linked directory are refused there too.
`src/**.ts` is the **`--staged`** route's boundary; do not describe the two as one rule.
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
future edit read as though they were. (1) This scanner has **no refuse-a-scan-that-observed-nothing
rule**, so an empty enumeration reports clean. (2) The ancestor-component and absolute/`../` reads
above, on the named-path mode only. (3) **A scan ROOT'S OWN PATH staged as a non-regular entry is
outside the `--staged` route's scope**, because that scope tests `test/fixtures/` and `src/` as
path PREFIXES and an index entry at exactly `src` matches neither. Measured identically on both
trees: `ln -s elsewhere src && git add -A` stages `:000000 120000 0000000 <sha> A src` and
`--staged` reports clean / exit **0**, while the all-mode walk over the same tree exits 1 on the
payload behind it. `dicom`'s copy of this function carries exactly that guard
(`s.path === "test/fixtures" || s.path.startsWith("test/fixtures/")`) and **it did not come across
in the port**. Found by this slice's refuter, pre-existing, and its own item.
**Exit **2** now means every failure to complete, not just a bad invocation.** A throw raised
before or outside `main`'s inner `try` blocks (`loadAllowList()` on a missing
`scripts/phi-allow-list.txt`, `readdirSync` on an unreadable directory under a walk root) left the
process on node's uncaught-exception code, **1**, which is this scanner's code for HITS FOUND. A
caller keying on the code read a gate that never ran as one that ran and fired. `run()` at the foot
of the file is the outermost net and `walk` names an unreadable directory itself; an unexpected
throw still prints its stack, because a gate that swallows its own bugs is harder to fix.
Pinned in `test/scripts/phi-scan.test.ts` against **throwaway git repos under `os.tmpdir()`** — the
scanner roots everything at `process.cwd()`, so never write a link or a violator into this corpus
to test it. **The enumerate-then-read race is deliberately still open here** and is a separate
item: measured on this tree, a real `pnpm build` puts **no** transient under either walk root, and
both temp-using suites `mkdtemp` into `os.tmpdir()`, so it is unreachable by scope — _until a walk
root widens_, which reintroduces it verbatim.

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

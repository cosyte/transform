# The `@cosyte/hl7` refresh record: 0.0.1 to 0.0.10

What moved, what was measured, and what a reviewer reruns to disbelieve any of it.

The deliverable here is not the version number. It is the evidence that the version number is safe:
this package sits in a PHI dataflow and its promise is never a confident wrong FHIR value, so a
nine-versions-stale parser cannot be bumped on the strength of a green suite alone.

- **Date:** 2026-08-21
- **Baseline commit:** `76984bba9dbb852d2854fd82ebd68422b8ad98f3` (`main` at the time; the working
  branch was cut from it)
- **Before:** `@cosyte/hl7@0.0.1`, consumed as `file:vendor/cosyte-hl7-0.0.0.tgz`
- **After:** `@cosyte/hl7@0.0.10`, consumed as a registry devDependency through `pnpm-lock.yaml`
- **Toolchain:** unchanged. `node >=22.0.0`, `packageManager: pnpm@10.0.0`, both as declared before.
- **Headline result:** the compared surface over 128 corpus members is **byte-identical** before and
  after. No emitted FHIR value moved. No diagnostic moved. No call site needed adapting.
- **One test expectation was edited, and it tracks no upstream difference.** It is a repository
  INVENTORY count that this refresh's own required end state moved: deleting the vendored tarball
  took the tree from two declared-binary paths to one. Before and after form, cause and authority:
  section 5b. The count of adopted diagnostic differences is still **zero** and section 5 is
  unchanged by it.

> **On dash characters in this file.** This repository bans the em dash in every spelling. One
> upstream diagnostic quoted below contains an EN dash in a version range; it is written here as
> `[en]` so this file carries neither character, and the verbatim bytes are in
> `documentation/hl7-refresh/surface-pre-refresh.json`, which is where a reader should check the
> quotation rather than trusting this prose.

---

## 1. The adopted version, from the registry

The version to adopt was taken from the registry, not from any expectation recorded elsewhere.

```
$ pnpm view @cosyte/hl7 version
0.0.10
```

The full metadata query (`pnpm view @cosyte/hl7 --json`) reports, among the rest:

- `"version": "0.0.10"`, `"dist-tags": { "latest": "0.0.10" }`
- ten published versions, `0.0.1` through `0.0.10`, `0.0.10` published `2026-08-07T02:35:40.560Z`
- `"dist".."integrity": "sha512-bUVmjMvtqlNw5yv0ozwo+BRQ9Ej141t6wmpzbeN9anrEJhmZCuVJV+OBBznKqdpbDz8vqqvpT5DFEA8+v9F1rA=="`
- `"engines": { "node": ">=22.0.0" }`, which matches this package's own floor

**Discrepancy: none.** The umbrella's interface card for `hl7` carried `v0.0.10` as its expectation
and the registry agrees, so nothing had to be resolved in the registry's favour. The card value is
a generated expectation either way; the query above is the evidence.

**Nine versions stale, confirmed rather than assumed.** The vendored tarball resolved to `0.0.1`
(`pnpm install` reported `+ @cosyte/hl7 0.0.1`), and `0.0.1` is the first of the ten published
versions.

## 2. The required end state, and which branch it started from

**The checkout started from the in-tree-copy branch.** `@cosyte/hl7` was a `file:` devDependency
pointing at `vendor/cosyte-hl7-0.0.0.tgz`, a `pnpm pack` tarball of the sibling repository at
commit `46d50eb775dc6576cec8ca5a2315720a65cb7418`. It is now a registry devDependency (`^0.0.10`),
and the tarball is deleted. Declaring it as a registry dependency IS the end state this refresh
exists to reach; it is not a new external dependency, and no other package was added.

**Half one, the lockfile: exactly one version, and it is the adopted one.**

```
$ grep -n "cosyte/hl7" pnpm-lock.yaml
27:      '@cosyte/hl7':
191:  '@cosyte/hl7@0.0.10':
2007:  '@cosyte/hl7@0.0.10': {}
```

Line 191 onward:

```
  '@cosyte/hl7@0.0.10':
    resolution: {integrity: sha512-bUVmjMvtqlNw5yv0ozwo+BRQ9Ej141t6wmpzbeN9anrEJhmZCuVJV+OBBznKqdpbDz8vqqvpT5DFEA8+v9F1rA==}
    engines: {node: '>=22.0.0'}
```

The integrity hash is the one the registry query in section 1 reported, so the lockfile confirms the
adopted version rather than defining it. One `@cosyte/hl7` entry, no second version arriving
transitively, and therefore no `pnpm.overrides` or `resolutions` entry was written. None was needed
and none would have been acceptable.

**Half two, the tree: no in-tree copy of the library anywhere in the checkout.** Both a tracked-path
inspection and a filesystem inspection, and the filesystem one covers the whole checkout:

```
$ git ls-files vendor
vendor/cosyte-fhir-0.0.0.tgz

$ git ls-files | grep -i hl7
documentation/hl7-refresh/surface-pre-refresh.json
scripts/hl7-refresh-capture.ts
scripts/hl7-refresh-collect-corpus.ts
test/_support/hl7-baseline-corpus.json
test/_support/hl7-corpus-probe.ts
test/_support/hl7-malformed-classes.ts

$ find . -not -path './node_modules/*' -not -path './.git/*' -not -path './dist/*' -iname '*hl7*'
./scripts/hl7-refresh-capture.ts
./scripts/hl7-refresh-collect-corpus.ts
./documentation/hl7-refresh
./test/_support/hl7-malformed-classes.ts
./test/_support/hl7-corpus-probe.ts
./test/_support/hl7-baseline-corpus.json
```

**The exclusion is stated so a reviewer can tell it from an oversight.** The filesystem inspection
excludes `node_modules/`, `dist/` and `.git/`. `node_modules/@cosyte/hl7` is the INSTALLED
dependency: resolving the package from the registry is what materializes it, so a literal
whole-tree reading would make the end state unreachable by its own first half. `dist/` is untracked
build output. `.git/` holds history, which is where the pre-refresh source is deliberately preserved
(section 4). Nothing else is excluded, and every path the inspection did return is this refresh's
own regression harness, named after the dependency rather than a copy of it.

**`@cosyte/fhir` is untouched and still vendored.** It is absent from the registry, so it has no
registry route; that is a separate, disclosed problem and this refresh did not touch it.

## 3. What the refresh consumed: the capability inventory and the regression plan

Every `@cosyte/hl7` capability this package uses, one row each, with the check that establishes it
still behaves the same and the command a reviewer runs.

The single strongest check appears in most rows and is stated once here: `hl7-refresh-capture`
transforms all 128 corpus members and writes the FHIR output plus every diagnostic, and the two
captures are byte-identical. A capability that had changed behaviour on any of the 124 fixtures
would have moved that file.

```
$ pnpm exec tsx scripts/hl7-refresh-capture.ts <label>
$ diff -u documentation/hl7-refresh/surface-pre-refresh.json \
         documentation/hl7-refresh/surface-post-refresh.json
```

| capability | how `transform` uses it | check | command |
|---|---|---|---|
| Message parsing (`parseHL7`) | every message-level test and the whole corpus enter through it | 128 members parse to the same result, refusals included | the capture diff above |
| Parse refusal (`Hl7ParseError`) | `test/reverse/property.test.ts` asserts the never-throw boundary; the malformed and empty classes land here | both refusal messages byte-identical, and asserted value-free | `pnpm exec vitest run test/messages/malformed-classes.test.ts` |
| Message metadata (`Meta`: `messageCode`, `triggerEvent`, `controlId`, `timestamp`, `sendingApp`, `sendingFacility`, `receivingApp`, `receivingFacility`) | `src/messages/message-header.ts`, `to-fhir.ts` dispatch | `MessageHeader` and `Bundle.identifier`/`timestamp` unchanged on every fixture | the capture diff above |
| Typed patient view (`Patient`) | `src/messages/patient.ts` | `Patient` resources unchanged | the capture diff above |
| Typed visit view (`Visit`) | `src/messages/encounter.ts` | `Encounter` resources unchanged | the capture diff above |
| Typed next-of-kin view (`NextOfKin`) | `src/messages/related-person.ts` | `RelatedPerson` resources unchanged | the capture diff above |
| Raw segment traversal (`Hl7Message.allSegments`, `Segment.type`, `Segment.field(n)`) | `src/messages/oru.ts`, `orders.ts`, `immunization.ts`, `appointment.ts`, `document-reference.ts`, `observation.ts` | ORU, order, VXU, SIU and MDM graphs unchanged | the capture diff above |
| Field traversal (`Field.raw`, `Field.repetitions`, `Field.components`) | `src/messages/observation.ts`, `orders.ts` | `Observation.value[x]`, repetitions and components unchanged | the capture diff above |
| Composite datatype views (`CWE`, `CX`, `HD`, `NM`, `TS`, `XAD`, `XPN`) | the six datatype converters in `src/datatypes/` plus `src/terminology/naming-system.ts` | converter suites green, and the composite-derived FHIR unchanged on every fixture | `pnpm run test`, plus the capture diff above |
| Timestamp parsing (`parseDtm`) | `src/messages/appointment.ts`, and `test/datatypes/datetime.test.ts` exercises it directly | `test/datatypes/datetime.test.ts` green; `Appointment.start`/`end` unchanged | `pnpm exec vitest run test/datatypes/datetime.test.ts` |
| Message building (`buildMessage`, `BuildMessageInit`, `RawField`) | `src/reverse/message.ts`, `v2.ts`, `patient.ts`, `observation.ts` | the reverse suites are green and every message they build and parse back is a corpus member, so the built wire form is in the capture diff | `pnpm exec vitest run test/reverse` |
| Delimiter escaping, owned by the serializer | `src/reverse/v2.ts` hands components rather than joined strings | `test/reverse/patient.test.ts` asserts `Do\S\e\F\Public` on the wire | `pnpm exec vitest run test/reverse/patient.test.ts` |

**Not used, so not a row.** The mutation API (`@cosyte/hl7` is a parser, builder, mutator and
serializer; this package mutates nothing, by the immutability guardrail), the ACK, batch, profile,
conformance, charset, streaming and text-rendering surfaces, and every `encode*` helper including
`encodeComposite`. A capability this package does not call cannot regress it.

**Coverage gaps: none, and that is a measurement.** Every capability above has a row with a real
check and a real command, so nothing here is declared unverified. The corpus that establishes it was
COLLECTED rather than transcribed: `scripts/hl7-refresh-collect-corpus.ts` runs the repository's own
fixture suites through `test/_support/hl7-corpus-probe.ts`, which records every raw string handed to
`parseHL7`, and freezes the 124 distinct results into `test/_support/hl7-baseline-corpus.json`.
Property and fuzz suites are excluded from that collection because they GENERATE their inputs; they
still run in `pnpm test` and are still evidence, they are just not fixtures.

**One limit, disclosed rather than found later.** The capture exercises the package through
`toFhir`, and `toFhir` takes an already-parsed message, so `parseHL7` is exercised as its feeder
rather than as a subject in its own right. Warnings the parser can emit through an `onWarning`
callback are NOT captured, because this package never passes one: a diagnostic the system does not
request is not a diagnostic the system emits. If a later change starts consulting parser warnings,
the compared surface has to grow to include them.

## 4. The baseline, and how to reproduce it

**Captured at** `76984bba9dbb852d2854fd82ebd68422b8ad98f3`, **before anything was bumped**, and
committed rather than left in a session.

The four gate commands were run unchanged at that commit and all exited zero: `pnpm run build`,
`pnpm run typecheck`, `pnpm run lint`, `pnpm run test` (29 files, 504 tests, all passing).
`pnpm run phi-scan` printed `[phi-scan] OK: no hits`.

**Both halves of the corpus, and how each was supplied to the build.**

- *The repository's existing fixtures (124).* Collected mechanically at the baseline commit:
  ```
  $ pnpm exec tsx scripts/hl7-refresh-collect-corpus.ts
  [hl7-refresh] wrote 124 distinct fixtures to test/_support/hl7-baseline-corpus.json
  ```
  They were supplied to the build the way the suites supply them, through `parseHL7`, and the probe
  recorded the exact bytes. That is why a fixture assembled by a test helper is captured in its
  final wire form. The file is FROZEN on purpose: some members are messages the reverse path
  serialized, so re-deriving it after the bump would have moved the input as well as the output and
  the comparison would no longer be like for like.
- *The four authored class inputs.* Written at baseline time, before the bump, in
  `test/_support/hl7-malformed-classes.ts`, so each has a measured pre-refresh behaviour to compare
  against. They are supplied to the build by the capture harness, which appends them to the frozen
  corpus, and by `test/messages/malformed-classes.test.ts`.

**The capture, run once on each side:**

```
$ pnpm exec tsx scripts/hl7-refresh-capture.ts pre-refresh    # at the baseline, before the bump
$ pnpm exec tsx scripts/hl7-refresh-capture.ts post-refresh   # after the bump
```

Both outputs are committed: `documentation/hl7-refresh/surface-pre-refresh.json` and
`surface-post-refresh.json`.

**Normalizations applied, identically on both sides, and there are exactly two.**

1. `generateId` is a per-message counter (`urn:uuid:00000000-0000-4000-8000-<n>`), so `fullUrl` and
   every intra-bundle reference are reproducible instead of random. Without it no two captures could
   ever match.
2. The NamingSystem registry is fixed to the single authority the repository's own fixtures register
   (`HOSP` to `urn:oid:1.2.840.114350`), so an identifier system either resolves the same way on
   both sides or is flagged the same way on both sides.

Nothing else is normalized. There is no wall-clock timestamp, no absolute path and no environment
value in the captured surface: `Bundle.timestamp` comes from MSH-7, which is fixture data.

**The pre-refresh library source was preserved BEFORE the bump, and the retrieval was RUN, not just
written down.** The end state destroys the in-tree copy, so the route back is git history:

```
$ git show 76984bba9dbb852d2854fd82ebd68422b8ad98f3:vendor/cosyte-hl7-0.0.0.tgz > <scratch>/cosyte-hl7-pre-refresh.tgz
$ git hash-object <scratch>/cosyte-hl7-pre-refresh.tgz vendor/cosyte-hl7-0.0.0.tgz
97bcf815b0094924b9b5170b205cf81ec251cbdd
97bcf815b0094924b9b5170b205cf81ec251cbdd
```

Identical object ids, so the retrieval reproduces the source exactly. It was then unpacked into a
scratch package OUTSIDE this checkout (`pnpm install` against a one-line `package.json` naming the
tarball) and compared against the tree the baseline actually built on:

```
$ diff -r --brief <scratch>/node_modules/@cosyte/hl7 node_modules/@cosyte/hl7
(no output)
```

That was all done, and its output recorded, before `package.json` was touched. A second, independent
route exists and is recorded because a single route is a single point of failure: `0.0.1` is still
published, so `pnpm add @cosyte/hl7@0.0.1` into a scratch package retrieves the same version from
the registry.

**A reviewer who wants the baseline regenerated rather than read** checks out
`76984bba9dbb852d2854fd82ebd68422b8ad98f3`, copies `scripts/hl7-refresh-capture.ts`,
`test/_support/hl7-malformed-classes.ts` and `test/_support/hl7-baseline-corpus.json` from this
branch onto it, runs `pnpm install --frozen-lockfile` and then the capture. The corpus file is
frozen, both normalizations are in the harness, and the result is byte-identical to the committed
`surface-pre-refresh.json`.

## 5. The comparison: what changed

**Nothing.** The compared surface is byte-identical across all 128 members.

```
$ diff -u documentation/hl7-refresh/surface-pre-refresh.json \
         documentation/hl7-refresh/surface-post-refresh.json
--- surface-pre-refresh.json
+++ surface-post-refresh.json
@@ -1,5 +1,5 @@
 {
-  "label": "pre-refresh",
+  "label": "post-refresh",
   "members": [
```

The only differing line is each file's own name for itself, which is not part of the compared
surface. Every FHIR bundle, every diagnostic, every diagnostic's order, and both parse-refusal
messages are unchanged.

**So the enumeration is empty, and that is the finding.**

- **Differences that move an emitted FHIR value: zero.** Nothing to stop on.
- **Differences that move only diagnostics: zero.** There is no refresh artifact to adopt.
- **Test expectations edited to track an adopted difference: zero.** There was no adopted difference
  to track, so no expected value in any suite was rewritten to follow the dependency. One
  expectation was edited for a different reason entirely, on a separate authority, and section 5b
  states it rather than filing it here: it tracks a change to THIS TREE, not to `@cosyte/hl7`.
- **Causes recorded as undetermined: zero.** The question did not arise.

**Both source trees were consulted, and they were in hand at comparison time.** The pre-refresh tree
is the one section 4 retrieved and verified (`@cosyte/hl7@0.0.1`, unpacked in a scratch package
outside this checkout); the post-refresh tree is `node_modules/@cosyte/hl7` at `0.0.10`, installed
from the registry. The comparison found a large ADDITIVE change upstream (new exports, listed in
section 8) and no change to the behaviour of anything this package calls, which is exactly what a
zero-difference surface predicts.

## 5b. The one test expectation edited: what, why, and on whose authority

Section 5 is the dependency's answer, and it moved nothing. This section is the TREE's answer, where
one thing did move: an assertion whose subject section 2 deleted.

**What the assertion is about.** `.gitattributes` declares `vendor/*.tgz` as `binary`, and the
no-emdash gate exempts a declared-binary path from its content scan and prints how many it skipped.
Two tracked archives matched that glob before this refresh. Deleting `vendor/cosyte-hl7-0.0.0.tgz`
leaves exactly one, `vendor/cosyte-fhir-0.0.0.tgz`, which stays vendored because the registry does
not have it. So the gate now reports, correctly:

```
$ pnpm run check:no-emdash
[no-emdash] OK: 124 tracked file(s) scanned (<N> bytes), 1 declared binary and exempt from the
content scan, 125 filename(s) checked.
```

The byte total is elided as `<N>` deliberately: this file is itself inside the scanned corpus, so a
verbatim total would be stale the moment this paragraph is edited. The load-bearing token is
`1 declared binary`, and `test/scripts/no-emdash-gate.test.ts` pins exactly that. The banner above is
what the assertion reads, so an assertion still claiming two is now simply false.

**BEFORE:**

```ts
    // AND THE SKIP COUNT IS PINNED, NOT MERELY SHAPED. This repository declares
    // exactly two paths binary, both vendored tarballs. A path exclusion added to
    // the gate's skip condition raises this number, and a refuter showed that a
    // shape-only assertion here leaves such an exclusion completely green.
    expect(r.out).toContain("2 declared binary");
```

**AFTER:**

```ts
    // AND THE SKIP COUNT IS PINNED, NOT MERELY SHAPED. This repository declares
    // exactly one path binary, the one vendored tarball left. A path exclusion
    // added to the gate's skip condition raises this number, and a refuter showed
    // that a shape-only assertion here leaves such an exclusion completely green.
    expect(r.out).toContain("1 declared binary");
```

**The cause, stated as what it actually is.** The required end state removed the assertion's subject:
the in-tree copy of the library had to go, checkout-wide, and it was one of the two archives being
counted. This is NOT a difference between `@cosyte/hl7@0.0.1` and `0.0.10`. The two source trees were
compared (section 5) and produced no difference at all, in the FHIR output or in any diagnostic, so
there is no upstream change to name beside this edit and none is invented here. The enumeration in
section 5 stays empty and this edit does not enter it.

**The authority, which is not this record's own reasoning.** The refresh spec permits editing a test
expectation for one reason only, to track a difference adopted under its AC6b, and there is no such
difference to place beside this one. The edit therefore rides a separate, deliberately bounded
ruling: the operator decision of 2026-08-21, recorded beside this refresh's spec as
`operator-decision-ac3-does-not-freeze-a-removed-subject.md`. It holds that AC3's freeze protects
expectations from being bent to make failing behaviour pass, and does not extend to an assertion
whose subject this chore legitimately removed, the count being a fact about the tree and the tree
having changed by design. Its bounds, as written there: ONE literal, in THIS file, `2` to `1`, with
the pin kept as a pin, every other expectation in the suite still frozen, and any second expectation
edit a fresh question rather than a licence already granted.

**What the edit deliberately does not do.** It does not weaken the assertion. The expected value
stays an exact literal rather than becoming a shape, a range, or a count derived from
`.gitattributes`, because the comment beside it records why the number is pinned at all: a refuter
showed that a shape-only assertion here leaves a widened skip condition completely green. That
reasoning holds at one path exactly as it held at two, so the pin keeps its bite. Nothing was
skipped, deleted, retargeted or loosened, and no other expected value anywhere in the suite was
touched.

**The gate commands on the refreshed checkout, after the edit. Every one exits zero.**

| command | result |
|---|---|
| `pnpm run build` | exit 0. ESM, CJS and both `.d.ts` outputs built. |
| `pnpm run typecheck` | exit 0, no diagnostics. |
| `pnpm run lint` | exit 0 at `--max-warnings=0`. |
| `pnpm run test` | exit 0. **31 files, 524 tests, 524 passed, 0 failed.** The baseline ran 29 files and 504 tests; the whole increase is the two suites this refresh ADDED. |
| `pnpm run phi-scan` | exit 0, `[phi-scan] OK: no hits`. |
| `pnpm run check:no-emdash` | exit 0, banner quoted above. |
| `pnpm run check:no-internal-refs` | exit 0, 9 public-surface files and 37 source files scanned. |
| `pnpm run check:agent-notes` | exit 0, 3 files reconciled against `git ls-files` (125 tracked). |
| `pnpm run format:check` | exit 0, all matched files already Prettier-clean. |

**The comparison was re-verified rather than re-asserted after this edit**, since a green suite is
not evidence about the compared surface:

```
$ diff -u documentation/hl7-refresh/surface-pre-refresh.json \
         documentation/hl7-refresh/surface-post-refresh.json
--- surface-pre-refresh.json
+++ surface-post-refresh.json
@@ -1,5 +1,5 @@
 {
-  "label": "pre-refresh",
+  "label": "post-refresh",
   "members": [
```

One hunk, each file's own name for itself, exactly as section 5 records. The capture was also re-run
from scratch on the refreshed dependency into a throwaway label and diffed against the committed
`surface-post-refresh.json`: again one hunk, the label, over all 128 members. The throwaway file was
deleted rather than committed.

**On the runner these numbers were taken with, because a number is worth what its conditions are.**
This session's container carries `node v24.19.0` and `pnpm 11.21.0`, and installing the pinned pnpm
was not available to it. Both are inside what this package declares (`engines.node >=22.0.0`; CI
runs a 22 and 24 matrix), the declarations themselves are untouched (section 10), and the install
was `pnpm install --frozen-lockfile`, which reported the lockfile up to date and skipped resolution,
so the tree the gates ran against is the lockfile's tree and not this runner's opinion of it. One
banner line comes with that runner: pnpm 11 prints that the `pnpm` field in `package.json` is no
longer read, so its `overrides` keys were ignored. That is a property of the runner reading a
pre-existing field, not a warning this refresh introduced, and the premise is checked rather than
asserted: `git show <baseline SHA>:package.json` carries the same `pnpm.overrides` block (the
`esbuild` and `js-yaml` security pins), byte-identical to the one there now, so the same runner has
the same line to print on both sides of the refresh. Under the pinned `pnpm@10.0.0` the field is
read normally and the line does not appear.

## 6. Call sites: what had to be adapted

**Nothing.** `pnpm run build`, `pnpm run typecheck` and `pnpm run lint` all exited zero on the
refreshed dependency with **zero changes to `src/`**. There is no upstream API change to adapt to on
any path this package calls, so there is no adaptation list, and the questions AC8 asks about
transformation logic, mappings and moved FHIR values never arose: `git diff` shows no file under
`src/` touched by this change at all.

## 7. The fail-safe rule over the four malformed classes

**The mechanism this checkout implements, named as found.** The promise (fail-safe behaviour,
value-free diagnostics, never a confident wrong FHIR value) is materialized by three concrete
devices, all of them in `src/`:

1. **An issue entry alongside the output.** `toFhir` returns `{ bundle, issues }`. A `TransformIssue`
   carries a stable code, a per-code severity, a v2 LOCATION (segment name, field or component
   index, repetition number) and a FHIR path, and its message text is drawn from the frozen
   `ISSUE_REGISTRY` rather than interpolated. There is no code path by which field content can reach
   one.
2. **An omitted element.** An element the input did not ground is left ABSENT and flagged
   (`TRANSFORM_ELEMENT_DROPPED`, `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`), never defaulted, padded or
   guessed.
3. **A withheld resource.** Every produced resource passes an emit gate against
   `@cosyte/fhir.validateResource`; one with a structural error is withheld from the bundle entirely
   and flagged `TRANSFORM_RESOURCE_INVALID`, and references that would dangle are dropped with it.

**The reading applied to "no exception escapes the public API".** The public transformation entry
point of this package is `toFhir`, and the only entry point this refresh exercised. It takes an
ALREADY-PARSED message, so an input the parser refuses never reaches it. Where `parseHL7` throws,
the reading applied is: nothing escapes `@cosyte/transform`, because the transform is never entered
and emits nothing, and the refusal is `@cosyte/hl7`'s documented `Hl7ParseError`, which is disclosed
below as pre-existing behaviour rather than counted as a transform-side violation. Both refusals are
byte-identical before and after.

**Pre-refresh behaviour, class by class, measured at the baseline commit.** Byte-identical after the
refresh in every case, so the "not worse" test is trivially satisfied against a measured baseline
rather than an assumed one.

| class | the exact input | pre-refresh behaviour, and against which device | after |
|---|---|---|---|
| malformed | `MSH\|^~\|A\|B\|C\|D\|20260101\|\|ADT^A01\|M1\|P\|2.5.1` (MSH-2 carries two encoding characters where four are required) | `parseHL7` refuses: `Hl7ParseError`, message `MSH-2 encoding characters must be 4 (v2.1[en]v2.6) or 5 (v2.7+ adds truncation) characters (got 2).` Device 2 in its strongest form: NO FHIR output at all. The message names a field POSITION (`MSH-2`), states the rule, and reports a COUNT (`got 2`); it quotes no field content. | identical |
| truncated | `MSH\|^~\\&\|A\|B\|C\|D\|20260101\|\|ADT^A01\|M1\|P\|2.5.1` + CR + `PV1\|1\|I\|ICU^101^` (the stream stops part way through PV1-3) | Parses. `toFhir` does not throw. Device 2: `Encounter.location` is ABSENT with `TRANSFORM_ELEMENT_DROPPED` at `PV1.3`, and with no PID the `Encounter.subject` is absent with `TRANSFORM_ELEMENT_DROPPED` at `PID`. What IS emitted (`Encounter.status`, `Encounter.class` IMP from PV1-2) is grounded in the bytes that did arrive. | identical |
| empty | `""` | `parseHL7` refuses: `Hl7ParseError`, message `Input is empty.` Device 2 in its strongest form: no FHIR output. Nothing to quote and nothing quoted. | identical |
| wrong-version | `MSH\|^~\\&\|A\|B\|C\|D\|20260101\|\|ADT^A01\|M1\|P\|9.9` (MSH-12 outside the releases this package is grounded on) | Parses. `toFhir` does not throw. A `MessageHeader` is emitted from MSH content and nothing else: no Patient, no Encounter, because an MSH-only message grounds neither. Device 2: `MessageHeader.source.endpoint` absent with `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN` at `MSH.3`, `Bundle.timestamp` absent with `TRANSFORM_ELEMENT_DROPPED` at `MSH.7` (a date-only MSH-7 is not a valid FHIR `instant`). | identical |

**Where the supported version set is declared, and it is prose rather than a data structure.** This
package reads MSH-12 for nothing: it is carried into `MessageHeader` only through the message type,
and no code branches on the version. The v2.5.1 grounding is declared in source, at
`src/reverse/message.ts` (the segment attribute tables the required-field rows are extracted from,
with the version-is-load-bearing warning), `src/reverse/patient.ts` and `src/reverse/observation.ts`
(the PID and OBX usage rows), and in the banner of `scripts/phi-scan.ts`. The parser tier owns the
machine-readable notion of a version and a profile (`getDefaultProfile`, `versionMismatch`), which
this package does not consult.

**The wrong-version input is the "outside the set" limb, and the other two limbs were measured
too**, so the choice is visible rather than convenient. All three behave identically, before and
after, and none of them produces any diagnostic mentioning MSH-12 at all:

- absent, `...|P|` (MSH-12 empty): `MessageHeader` emitted, same two issues.
- malformed, `...|P|not-a-version`: `MessageHeader` emitted, same two issues.
- outside the set, `...|P|9.9`: `MessageHeader` emitted, same two issues. **Chosen**, as the limb
  that most directly names the class.

**Properties already violated at the baseline: none found.** All three properties hold for all four
classes at the baseline commit, so there is no pre-existing violation to disclose and none to
refrain from repairing. Two observations are recorded anyway, because "no violation" is a stronger
claim than "nothing noticed":

- The parser refusing an input is not a property-3 violation on the reading stated above, but it IS
  the reason the transform never sees two of the four classes. That is disclosed, not hidden.
- For the wrong-version class the package raises no diagnostic about the version at all. That is
  not a violation of any of the three properties (nothing is guessed, nothing partial is presented
  as confident), but a reader should know the silence is real: MSH-12 is not consulted.

**The tests.** `test/messages/malformed-classes.test.ts` asserts all three properties for each of the
four classes, and adds a corpus-wide sweep: every issue raised by every one of the 124 fixtures is
checked to have a message identical to its `ISSUE_REGISTRY` entry (so never interpolated), a
`v2Location` matching a strictly positional shape, and a `fhirPath` matching a FHIR element-path
shape.

## 8. PHI: the scan, and the diagnostic inspection

**Scope inspected: the whole baseline corpus, both halves.** All 124 fixtures and all four authored
class inputs, through the corpus-wide sweep in `test/messages/malformed-classes.test.ts` and through
the two committed capture files, which record every diagnostic every member raises.

**No HL7 field value appears in any diagnostic, and the mechanism is structural rather than
observed.** `TransformIssue` messages come from a frozen registry keyed by code; the factory takes
only positional metadata. Locators are segment names and indices. The two parse refusals name a
field position and a rule, never content, and the tests assert that directly against the payload
tokens of each authored input.

**The authored fixtures are synthetic by construction.** None of the four carries a name, a date of
birth, an address, a telephone number or an identifier; they are structure and nothing else. That is
why none of them needed an entry in `scripts/phi-allow-list.txt`.

**The scan, as invoked, with its exit status:**

```
$ pnpm run phi-scan
> tsx scripts/phi-scan.ts
[phi-scan] OK: no hits
$ echo $?
0
```

**`phi-scan-overrides.md` is untouched by this change.** It was not edited, relaxed or extended, and
`git diff` shows it unmodified. No `--allow-fixture` bypass was used or needed.

**One scanner edit, and it SUBTRACTS nothing.** `RECONCILE_EXEMPT` in `scripts/phi-scan.ts` listed
`vendor/cosyte-hl7-0.0.0.tgz` as a gzip archive the tracked-corpus reconciliation excuses. That path
no longer exists, so the entry went with it. The set is consulted only for paths `git ls-files`
still returns, so removing an entry for a path git no longer returns changes no detection on any of
the three routes; it removes a line that would otherwise read as an exemption someone still relies
on.

## 9. The three questions this refresh was asked to answer

### 9.1 Is an ADT message builder available? YES.

`@cosyte/hl7@0.0.10` exports `buildAdt`, and the API consulted is:

```ts
declare function buildAdt(event: string, init: BuildAdtInit): Hl7Message;

interface BuildAdtInit extends MessageEnvelope {
  readonly patient: AdtPatient;   // PID content. Required: never fabricated.
  readonly visit?: AdtVisit;      // PV1 content.
  readonly event?: AdtEvent;      // EVN content.
}
```

with `AdtPatient` (PID-3 identifiers, PID-5 name, PID-7 birth date/time, PID-8 administrative sex,
PID-11 address, PID-13 phone), `AdtVisit` (PV1-2 patient class, PV1-3 assigned location, PV1-7
attending, PV1-8 referring, PV1-19 visit number, PV1-44 admit date/time) and `AdtEvent` (EVN-2,
EVN-6) as the typed bodies.

**The evidence is a call that compiles and runs**, not a reading of a type declaration:
`test/upstream-capabilities.test.ts` builds an `ADT^A01` with a PID and a PV1, serializes it, parses
it back with `parseHL7`, and reads `meta.messageCode`, `meta.triggerEvent`, `patient.familyName` and
`visit.patientClass` out of the round trip. Reproduce with:

```
$ pnpm exec vitest run test/upstream-capabilities.test.ts
```

At `0.0.1` the export did not exist: zero occurrences of `buildAdt` in both `dist/index.d.ts` and
`dist/index.mjs` of the vendored package. `0.0.10` adds `buildAdt`, `buildOru`, the `encode*` family
including `encodeComposite`, a conformance namespace, a streaming parser and a text renderer, among
others. All of it is ADDITIVE, which is why nothing this package calls moved.

### 9.2 Is `encodeComposite` usable? YES, and it is deliberately NOT adopted here.

At `0.0.1` the export did not exist at all (zero occurrences in both `dist/index.d.ts` and
`dist/index.mjs`). At `0.0.10`:

```ts
declare function encodeComposite<K extends CompositeKind>(
  kind: K,
  value: CompositeValueByKind[K],
): RawField;

declare function encodeCompositeReps<K extends CompositeKind>(
  kind: K,
  values: readonly CompositeValueByKind[K][],
): RawField;
```

It is usable for this package's composite-encoding needs: it takes exactly the composite kinds the
reverse path builds (`XPN`, `CX`, `XAD` and the rest) and returns exactly the `RawField` that
`buildMessage` already consumes, so the shapes line up with no adapter.
`test/upstream-capabilities.test.ts` calls it and asserts the delimiter-escaping property the
reverse path depends on.

**The workaround currently in force**, and it stays in force: `src/reverse/v2.ts` builds `RawField`
component arrays by hand and hands them to the serializer, which owns escaping. Nothing in
`src/reverse` writes a `^` or a `~`. That is a working mechanism, not a defect, and replacing it
with `encodeComposite` would be a change to transformation logic inside a refresh whose entire claim
is that no emitted FHIR value moved. It belongs to a change that sets out to make it, with its own
before-and-after evidence.

### 9.3 Where does the deferred Patient plus Encounter shape go? A FOLLOW-ON ITEM.

The shape stays deferred here and is routed as a **follow-on item**, not as a re-scope into the work
that deferred it: that work landed on 2026-08-17, so there is nothing left to re-scope into.

The follow-on covers exactly three things:

1. **The shape**, as the deferral names it: producing the `Patient` plus `Encounter` output from an
   ADT message.
2. **The upstream capability it depends on**: the `@cosyte/hl7` ADT builder, `buildAdt`, present at
   the adopted version `0.0.10`, evidenced by section 9.1 (a call that compiles and runs, in
   `test/upstream-capabilities.test.ts`).
3. **The repository it targets**: `transform`.

Nothing about that shape is implemented under this refresh, deliberately.

## 10. Scope: what this refresh did not do

- **No new external dependency.** `@cosyte/hl7` itself moved from a `file:` specifier to a registry
  specifier, which is the end state; nothing else was added, and `dependencies` is still empty.
- **No toolchain change.** `engines.node >=22.0.0` and `packageManager: pnpm@10.0.0` are byte-for-byte
  as they were.
- **No change to any other repository.** `@cosyte/hl7`'s own source was read for the comparison and
  never edited.
- **No `pnpm.overrides` or `resolutions` entry** for `@cosyte/hl7`. The two `pnpm.overrides` entries
  in `package.json` are the pre-existing `esbuild` and `js-yaml` security pins and are untouched.
- **No test skipped or deleted**, and none weakened. Two suites were ADDED
  (`test/messages/malformed-classes.test.ts`, `test/upstream-capabilities.test.ts`). Exactly one
  expected value was edited, a declared-binary path count this refresh's own end state moved from
  two to one; it stayed a pinned literal, it tracks no upstream difference, and section 5b carries
  its before and after form together with the ruling that authorized it.

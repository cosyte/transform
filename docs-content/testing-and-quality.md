---
id: testing-and-quality
title: Testing and quality
sidebar_label: Testing and quality
description: "How we test @cosyte/transform: per-map tests, property tests, a conformance run, baselines, the PHI scan, and what each one cannot catch."
---

# Testing and quality

This page describes how we test `@cosyte/transform`, what each technique catches, and what it
cannot. The rules every Cosyte package follows (the coverage and mutation floors, the property-based
runners, what a pull request must prove) are written down in the testing standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

The failure that matters most here is quiet: a resource that looks valid and says something the
message did not. Most of what follows is aimed at that, or at a value from the message leaking into
a diagnostic.

## What we run, and what each technique catches

| Technique | What it catches | What it cannot catch |
| --- | --- | --- |
| Unit tests | a wrong mapping or a missing refusal in the converters, segment maps, value maps, status maps and the reverse path, run against the source with synthetic messages | a row of the guide nobody wrote a test for |
| Property tests | for generated and hostile inputs (parsed ADT, ORU, order, AL1, DG1, PR1, IN1, OBX and SPM content, and arbitrary FHIR `Patient` and `Observation` resources): a throw, an issue code outside the registry, a value from the input reaching an issue, a `urn:uuid:` reference that points outside the bundle, an emitted `Patient` that fails validation, an allergy code the guide's maps did not produce, and a reverse message that does not parse back | a wrong value that breaks none of those properties |
| Baselines | an unannounced change in output: committed bundles and issue lists for a corpus of messages, compared byte for byte, so that adding a segment or a diagnostic cannot change what a message without it produces | a change to an input the corpus does not hold |
| Conformance run | FHIR that the pinned R4 4.0.1 definitions or the US Core 9.0.0 profiles reject, over the guide's own published test messages; the committed result must match a live run | whether the right v2 field reached the right element; value sets that need a terminology server ([Conformance](./conformance.md)) |
| Upstream probes | a change in what `@cosyte/hl7` exports that this package depends on or has decided around | behavior of the parser that no probe calls |
| Coverage gate | code no test runs: lines, branches, functions and statements, held at a floor overall and for each source folder | a test that runs code without checking what it returns |
| Mutation testing | a test that runs code but would not notice it changing | not set up on this package yet; the numbers below say "not measured" until it is |
| Doc samples | a sample on these pages that no longer matches the code: every TypeScript sample is compiled against the built package's types and run against the built package, its `// =>` values checked, and every link between pages resolved | prose that is wrong beside a sample that is right |
| Examples | a program under `examples/` that stops working against the built package: each one checks its own output | anything the examples do not exercise |
| Package checks | a broken published package: the type declarations checked for both module systems, and the build imported as ESM and required as CommonJS | a runtime other than Node.js |
| PHI scan | a realistic patient identifier in a committed file: an SSN or email floor over every tracked file, these pages included, and a structured pass over named HL7 v2 patient fields, against a declared allow list of synthetic values | a field outside the named set; it finds a value after it is written, it does not prevent one |

## How each one runs

- **Unit tests, property tests, baselines, the conformance check, upstream probes and doc samples**
  run in one Vitest suite on every pull request, on every push to `main` and every night, on
  Node.js 22, 24 and 26.
- **Property tests** run a fixed number of cases per property, from a fresh random seed each run,
  so each night explores inputs the last one did not. A failure prints the seed that replays it.
  The `FUZZ_RUNS` variable raises the count for a local run.
- **The coverage gate** runs with the suite, and a floor that is not met fails the pull request.
- **Examples and package checks** run in CI on every pull request.
- **The PHI scan** runs as a pre-commit hook on the staged files, and in CI on every tracked file.

## Run them yourself

```bash
pnpm install --frozen-lockfile
pnpm test                    # unit, property, baseline, conformance and doc-sample tests
pnpm test:coverage           # the same suite with the coverage gate

# The property tests alone, with more cases each:
FUZZ_RUNS=1000 pnpm exec vitest run test/messages/property.test.ts test/reverse/property.test.ts test/datatypes/boundary.property.test.ts

pnpm run conformance         # regenerate the conformance report from a live run
pnpm phi-scan                # the PHI scan over the repository
pnpm build && pnpm examples  # the examples against the built package
pnpm attw                    # the type declarations for ESM and CommonJS (after pnpm build)
```

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.

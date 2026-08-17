# 0003: The reverse direction ships narrowly, and the visit-carrying ADT is deferred

- **Status:** Accepted (2026-08-14)
- **Scope:** `@cosyte/transform` (`src/reverse`, `toV2Patient`, `toV2Observation`)
- **Relates to:** transform roadmap (`operations/roadmaps/transform.md` §Phase 7), ADR 0001 (the
  transformation tier may depend on the parser tier, and does not re-implement it), umbrella ADR 0018
  (grounded on the published map, never invented).

## Context

Phase 7 scoped three reverse (FHIR to v2) shapes: `Patient` to a message carrying a `PID`,
`Observation` to a message carrying an `OBX`, and `Patient` + `Encounter` to a **visit-carrying ADT**
assembled through the parser tier's own ADT entry point.

Two facts, both measured against the checkout rather than assumed, decided how much of that shipped.

1. **The IG publishes no FHIR-to-v2 map.** `hl7.fhir.uv.v2mappings` maps v2 **to** FHIR. Every row
   used in reverse here is therefore the *inverse* of a published row, and an inverse is only usable
   where the forward row is one-to-one. Several of the rows this package already ships are
   many-to-one: three v2 administrative-sex codes mean `other`, two name types mean `official`, two
   mean `temp`, two address types mean `work`, two mean `postal`, and two result statuses mean
   `entered-in-error`.

2. **The vendored parser exports no ADT assembly entry point.** The `@cosyte/hl7` this repository
   builds and tests against (the `vendor/` tarball, which is a by-hand `pnpm vendor:refresh` job and
   is watched by neither Dependabot route) exports `buildMessage`, `Hl7Message.addSegment` and
   `parseHL7`, and **zero** occurrences of an ADT builder, an ORU builder, or a composite encoder in
   either `dist/index.d.ts` or `dist/index.mjs`.

## Decision

1. **Ship the two shapes that ground out; defer the third, dated, rather than guess it.**
   `toV2Patient` and `toV2Observation` ship. The `Patient` + `Encounter` visit-carrying ADT does not:
   the mapping is not the blocker, the entry point is. Hand-assembling a PID + PV1 message-structure
   layout inside `transform` would be this tier re-implementing what the parser tier owns, which
   inverts ADR 0001's split for no safety gain. Re-measure the vendored parser before picking it up:
   a later parser release may export it.

2. **Where the inverse is not one-to-one, refuse and flag.** `invertCodeMap` keeps a target only when
   exactly one source maps to it. Everything else raises `TRANSFORM_CODE_NOT_INVERTIBLE` and leaves
   the v2 field **absent**. Resolving `other` to Table 0001 `O` because it looks likeliest would be a
   confident wrong value, in the direction where the reader is another clinical system.

3. **The trigger is a required argument, never inferred.** No FHIR resource carries an HL7 v2 message
   trigger, so there is nothing to derive one from. A missing, empty or non-string trigger returns
   `TRANSFORM_MISSING_TRIGGER` on the ordinary `{ value, issues }` channel, **before** any builder
   call. A string that is not a bare trigger (whitespace, or a delimiter that would split MSH-9 into
   further components) returns `TRANSFORM_VALUE_NOT_REPRESENTABLE`, because it cannot be carried into
   MSH-9.2 verbatim and trimming it would emit something the caller did not ask for.

4. **The refusal codes live in `ISSUE_CODES`, not `FATAL_CODES`.** The split between the two
   registries is structural in this package: a `FatalCode` is the type carried by a *thrown* error,
   while `TransformIssue.code` is typed `IssueCode` and `ISSUE_REGISTRY` is exhaustive over
   `ISSUE_CODES`. Since nothing here throws, every reverse refusal is returned, so it is an
   `ISSUE_CODES` addition. Keying them under `FATAL_CODES` would have meant widening
   `TransformIssue.code` and blurring the very split the module documents. Both registries stay
   additions-only: no existing key was renamed or removed.

5. **Emit whole messages, and verify only that they parse back.** Each shape returns the complete
   message (`buildMessage(...).addSegment(...)`), never a bare segment, which the parser would
   fatally reject for having no leading `MSH`. The property suite asserts *parses back under
   `parseHL7` without a fatal error*, and that MSH-9 carries the caller's trigger verbatim. It does
   **not** assert, and no shipped text claims, that a message transformed to FHIR and back equals the
   original: this direction is lossy by construction.

## Consequences

- **Positive.** A consumer who already trusts the forward direction can emit demographics and result
  observations back out, with every loss surfaced as a typed, value-free diagnostic instead of a
  silent approximation. The bijective-subset rule is executable (`invertCodeMap`) rather than a
  comment, so it cannot drift from the forward maps it inverts.
- **Negative / cost.** The reverse output is deliberately thin: an identifier's assigning authority
  appears only when the caller seeds it, several codes are refused outright, and there is no
  visit-carrying ADT at all. Consumers who want a fuller message must supply the missing context
  themselves, and this package will keep refusing to invent it.

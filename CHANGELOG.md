# Changelog

## 0.0.10

### Patch Changes

- 76984bb: Add a narrow reverse path, FHIR to HL7 v2: `toV2Patient(patient, trigger)` emits a complete `ADT` message carrying a `PID`, and `toV2Observation(observation, trigger)` a complete `ORU` message carrying an `OBX` (roadmap §Phase 7, shipped for two of the three scoped shapes).

  Each takes the FHIR resource **plus the v2 trigger the message should carry**, and returns the same `{ value, issues }` envelope the forward direction uses, where `value` is a complete `@cosyte/hl7` message. The trigger is required and is never inferred: no FHIR resource carries an HL7 v2 message trigger, so a missing, empty or non-string one returns no message and a `TRANSFORM_MISSING_TRIGGER` diagnostic without calling the builder at all, and a trigger that is not a bare token (whitespace, or a delimiter that would split MSH-9) returns `TRANSFORM_VALUE_NOT_REPRESENTABLE` rather than being trimmed into something else.

  **This direction is lossy by design and is not a round-trip.** The IG maps v2 to FHIR and publishes no map the other way, so every row here is the inverse of a published row, and an inverse is only usable where the forward row is one-to-one. `invertCodeMap` enforces exactly that, and the many-to-one rows are refused with `TRANSFORM_CODE_NOT_INVERTIBLE` rather than resolved to their likeliest source code: `gender` `other`, name use `official` and `temp`, address use `work`, every `Address.type`, and `Observation.status` `entered-in-error`. An element with no v2 field in this map is flagged `TRANSFORM_NO_V2_TARGET`, a value v2 cannot carry unchanged is left out with `TRANSFORM_VALUE_NOT_REPRESENTABLE`, and a coding system with no v2 mnemonic is flagged `TRANSFORM_CODE_SYSTEM_NOT_V2` rather than written under a borrowed table. Nothing asserts that a message transformed to FHIR and back equals the original; the property suite verifies only that every emitted message parses back under `parseHL7` without a fatal error and carries the caller's trigger verbatim in MSH-9.

  Seven issue codes are added (`TRANSFORM_MISSING_TRIGGER`, `TRANSFORM_UNSUPPORTED_RESOURCE`, `TRANSFORM_RESOURCE_MALFORMED`, `TRANSFORM_NO_V2_TARGET`, `TRANSFORM_VALUE_NOT_REPRESENTABLE`, `TRANSFORM_CODE_NOT_INVERTIBLE`, `TRANSFORM_CODE_SYSTEM_NOT_V2`), additions only: no existing `ISSUE_CODES` or `FATAL_CODES` key is renamed or removed. They are `ISSUE_CODES` entries because they are returned rather than thrown, which is the structural line between the two registries in this package.

  The third scoped shape, a `Patient` + `Encounter` visit-carrying ADT, is deferred with a dated rationale in `documentation/decisions/0003`: the vendored parser exports no ADT assembly entry point, and hand-assembling that message structure here would invert the tier split ADR 0001 draws.

- 09138da: Publish what this library's output conformance actually is, instead of a README sentence that reads
  stronger than the check behind it. The guide's seven published v2 test messages are now carried in
  the repository, transformed, and every resource of every resulting Bundle is validated against pinned
  FHIR R4 4.0.1 definitions and the pinned `hl7.fhir.us.core` 9.0.0 profiles, with the outcome committed
  as `documentation/conformance/report.md` and `documentation/conformance/result.json`.

  **Nothing about the library's output moved.** No mapping, no emitted value, no issue code and no emit
  gate changed, and the package entry point exports exactly what it exported before. This is an
  apparatus, so the result it publishes on day one is a measurement of the library as it stands.

  **The result, stated plainly: none of the seven messages produces a Bundle with zero error-severity
  results** against R4 plus those profiles. Against base R4 4.0.1 alone, six of the seven are clean; the
  exception is the `SIU_S12`, whose `Appointment` is `booked` with no start, which R4's own `app-3`
  invariant forbids. The profile findings are mostly one shape: US Core requires elements the guide's
  segment maps publish no row for, among them `Encounter.type`, `Coverage.relationship`,
  `Observation.category` and `DocumentReference.category`, and this library leaves an ungrounded element
  absent rather than guessing at it. Every finding is in the report with its element path, the profile
  canonical it came from and that profile's version, so a result is reproducible against a pin rather
  than against whatever was current. Each per-message table prints one row per finding per resource
  instance, naming which Bundle entry it came from, so the rows count to the number stated above them
  rather than collapsing sibling resources that fail the same way into one.

  The README's old claim, that every emitted resource "is validated against `@cosyte/fhir` before it
  ships", is gone. What it described is a small internal required-element schema, and the replacement
  says so and points at the measurement. The opening paragraph, where a reader meets the word
  "validated" first, now carries that qualification where they meet it rather than leaving it in a
  section 130 lines down the page.

  Three things keep the number honest. The published result is checked against a hand-written claims
  register on every test run, in BOTH directions: a pair declared conformant that starts failing breaks
  the build, and a pair declared non-conformant that stops failing breaks it too, so the register cannot
  rot into a list of stale excuses. The report states which classes of check were performed and which
  were not, external terminology resolution and mapping correctness among the latter, so it cannot be
  read as a full implementation-guide validator's output. And the two definition packages are carried in
  the repository and verified by digest at run time, with no network fetch and no fallback: an absent,
  unreadable or mismatched package fails the run explicitly rather than reporting a pass, as do an empty
  corpus, a zero-document run, and a corpus message that cannot be parsed or transformed.

  The corpus fixtures carry their own provenance, including the one line the guide's own page mangles
  (an `OBX` whose Base64 component the page emits as markup), which is recorded as published rather than
  repaired with invented v2 content.

- 69fc3a2: Carry the diagnoses, procedures and insurance a v2 admit states into the bundle it produces. A `DG1` now becomes a `Condition`, a `PR1` a `Procedure` and an `IN1` a `Coverage`, each wired to the bundle `Patient` by the guide's own ADT_A01 message-map rows, and each `Condition` is referenced back from `Encounter.diagnosis` when the same message also produced an Encounter. Bundles therefore carry three resource types they did not before, and the completeness diagnostic stops reporting those three names as library gaps wherever their occurrences reach an emitted resource. A message carrying none of the three produces exactly the bundle and the issue list it produced before.

  The elements are the ones the published segment maps ground, and no others. `Condition` takes DG1-3 and DG1-4 as `code` and `code.text`, DG1-5 as `onsetDateTime`, DG1-19 as `recordedDate` and DG1-20 as `identifier`. `Procedure` takes PR1-3 and PR1-4 as `code` and `code.text` (the description only where the coded field carries no original text, per the row's own condition), PR1-6 as `category`, PR1-15 as `reasonCode`, PR1-19 as `identifier`, and PR1-5 with PR1-7 as either `performedDateTime` or a `performedPeriod`. `Coverage` takes IN1-2 as `identifier`, IN1-12 and IN1-13 as `period`, IN1-15 as `type`, and IN1-10 (where its identifier type is `SN`) and IN1-49 as the subscriber-id extension.

  Four refusals matter to a consumer. **`Coverage.status` is never asserted:** no published row grounds a coverage status, and R4's binding has no neutral member, so the element ships value-absent with a `data-absent-reason` of `unknown` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN` issue. Read it as unknown, not as active coverage. **`Coverage.payor` names the insurer without resolving it:** IN1-4.1 becomes a reference `display` with no literal reference, because no `Organization` resource is built, and an `IN1` that names no insurance company is withheld entirely with a diagnostic naming the occurrence, since `payor` is required and nothing else grounds it. **`Procedure.status` is the `unknown` the map's own row directs** where the message context determines none; `completed` is never selected from a message that did not say so. **A DG1-21 of `D` is the only action code that sets `verificationStatus`** (`entered-in-error`, the value the row assigns); every other published Table 0206 code leaves the element absent with a `TRANSFORM_CODE_UNMAPPED`.

  Nothing is dropped without saying so. A diagnosis that grounds neither a code nor a description still becomes a `Condition`, with its empty `code` flagged. With no `Patient` in the bundle every Condition, Procedure and Coverage is withheld and declared per occurrence, naming the reference it could not anchor, so no reference ever points outside the bundle. Every row of the three maps whose target needs a `Practitioner`, `Location` or `Organization` this tier does not build, or resolves by identifier rather than by bundle position, raises a `TRANSFORM_ELEMENT_DROPPED` naming the v2 field and the FHIR path it did not build. One declaration comes from outside those three maps and is scoped to them: a visit that states a financial class (PV1-20), which the guide routes into the same `Coverage` an `IN1` creates, is declared on a message that carries an `IN1`, and never on one that does not. No issue code is added, renamed or removed, and no existing conversion changes.

- 088e29f: Give an ORU consumer the typed value the guide already publishes, instead of a string to re-parse. Five OBX-2 value types that used to degrade to `valueString` plus a dropped-element flag now reach their mapped FHIR target, and an ORU's specimens and per-result comments reach the bundle.

  `DR` becomes `Observation.valuePeriod`, `NR` becomes `valueRange`, `TM` becomes `valueTime`, and `NA` becomes `valueSampledData`. An `ED` whose OBX-5.4 says `Base64` becomes the guide's named `valueAttachment` extension, and its payload is copied from OBX-5.5 **byte-for-byte**: not decoded, not re-encoded, not normalized, not validated, not truncated. A bundle that previously carried a raw string in these five cases now carries a period, a range, a time, a waveform or an attachment, so a consumer reading `value[x]` sees a different shape for the same message.

  The fail-safe floor is unchanged and still reached wherever the map cannot carry the value faithfully: a `DR` neither of whose bounds is a dateTime this library will emit, an `NR` neither of whose bounds is a `decimal` FHIR carries unaltered, a `TM` carrying a UTC offset (an R4 `time` admits none, and discarding one would move the clinical instant), an `NA` carrying a magnitude that would have to be rewritten, and an `ED` under any encoding other than `Base64`, all fall back to the raw OBX-5 text as `valueString` with `TRANSFORM_ELEMENT_DROPPED`. Where the fallback fires for one of these five, it now carries the **whole** OBX-5 rather than its first component, so a two-ended `DR` no longer loses its second bound on the way out. `RP` is deliberately untouched: its extension target carries the guide's own comment that it is unresolved.

  A `SampledData` **never asserts an origin or a period**. R4 makes both required and the guide sources neither, so each ships value-absent with a `data-absent-reason` and a `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`, and the observation still emits. `.dimensions` and `.data` follow the guide's own worked examples, with `E` for a position a repetition did not carry.

  An `SPM` in an ORU now becomes a `Specimen` that the `DiagnosticReport` scoping it references, so it is no longer reported as a segment that reached nothing. A report the emit gate withholds takes its specimens with it: the bundle never carries a `DiagnosticReport.specimen` pointing at an absent resource, nor a `Specimen` entry orphaned by a report that was never emitted. `Specimen.status` is never asserted, because the only row that reaches it does so through a Table 0136 value map this library does not carry, and the parent, collection-quantity and status rows are declared rather than guessed.

  An `NTE` inside an ORU's OBSERVATION group now becomes `Observation.note`, one annotation per comment repetition, with NTE-6 as its time. The PATIENT-level and ORDER_OBSERVATION-level `NTE` rows publish no FHIR target, so neither reaches an observation however close to one it sits, and both are still reported as unread.

  No issue code is added, renamed or removed, and no diagnostic carries a value: not an attachment payload, not a specimen identifier, not a note's text, not an observation magnitude.

- f753c72: Refuse a PHI scan that withdrew a target it had enumerated. `scripts/phi-scan.ts` still requires a whole-file `--allow-fixture <path>` bypass to carry a logged `### <path>` entry in `phi-scan-overrides.md`, and an unlogged one is still rejected before any target is read. What changes is what a logged one buys: an audit trail, and nothing else. The run reads and reports every target it did not withdraw, and then exits `2`, the could-not-complete code, naming what it withdrew. The flag can no longer reach exit `0` in any mode.

  The reason is a false clean that the exit code could not express. A withdrawn target is a file the run enumerated and then never opened, and a scan that did not open a file has no verdict about it. While the bypass was honoured the withdrawal left no trace in the exit code at all, so the same invocation over a corpus whose only violator was withdrawn reported no hits and exited `0`. Nothing about what the scanner detects is narrowed, and no route that passes no bypass moves: the pre-commit hook and the whole-corpus sweep still exit `0` clean and `1` on hits, and the suite pins both as controls alongside the new refusal.

  The dependency override for `js-yaml` moves to the range the advisory now covers, `>=4.0.0 <4.3.0` resolved at `4.3.0`, and the superseded entry beside it is removed rather than left as a second answer to the same question. Install hardening is declared at the repository root, a 24 hour cooldown on newly published versions and a trust policy that fails an install when a package's trust evidence is weaker than an earlier version of the same package. Those two settings need a package manager that knows them, so the pinned `pnpm` is raised to the version that does; without that raise the file would have decorated rather than defended, and the pinned one refused to install with the file present at all.

  The agent instruction file is brought back under its declared size by pointing at the long form it already carries in `documentation/agent-notes.md`, which gains the bypass contract in full. No guidance is dropped, every required heading stays, and the checked contract between the two files stays green.

- 990be26: Corroborate every HL7 v2 field number the PHI scanner reads against a published HL7 v2.5.1, and read seven PHI-bearing fields it previously disclosed as unread (PHI-SCAN-RESIDUALS).

  The segment field list is the detector in this package: the cross-cutting SSN/email floor finds nothing in a corpus whose messages are inline v2 string literals, so a wrong field number is either a missed leak or a false positive on a clinical field. Fifteen numbers had never been checked against any published source (the whole GT1 row, plus PID-6, PID-9, PID-19, PID-20, NK1-30, NK1-33, IN1-18 and IN1-19). All fifteen are now checked against the v2.5.1 segment attribute tables in Chapter 3 (PID 3.4.2, NK1 3.4.5) and Chapter 6 (GT1 6.5.5, IN1 6.5.6), cross-checked against a second version-pinned publication, and none of them was wrong. The GT1 clause citation was: it said 6.5.4.

  Every row in the scanner's coverage table and in the suite's coverage case now carries the v2.5.1 item number the field number was corroborated by, which is the standard's own stable identifier for an element.

  Seven fields that a review had measured as reported-clean are read now, because the same published tables ground them: NK1-26, NK1-31, NK1-32, NK1-37, GT1-2, GT1-4 and IN1-49. This is a union with the previous list rather than a replacement, and the superset is pinned cell by cell: every field that reported before still reports, every deliberate non-field (IN1-17, IN1-7, PID-10, PID-18, NK1-3, GT1-11, PV1-19) still reports nothing, and the tracked corpus stays clean. `PHI_SEGMENTS` is derived from the union of all five field tables instead of one of them, so a segment added to a single table can no longer go silently unlocated.

- 8a2f73f: Carry the allergies an HL7 v2 message states into the bundle it produces. A message that contains an `AL1` segment now yields one `AllergyIntolerance` per occurrence, wired to the `Patient` in the same bundle, so a returned bundle contains a resource type it did not contain before. If you branch on the resource types you receive, or count entries, this is the change to read: an allergy list that used to disappear between the v2 feed and the FHIR record now arrives, and the completeness diagnostic stops reporting an `AL1` it emits.

  Every value is grounded on a published HL7 Version 2 to FHIR ConceptMap, transcribed firsthand from the guide at 1.0.0 (published 2025-10-07, retrieved 2026-08-28) and exported beside `IG_ALLERGY_VALUE_MAPS_VERSION` so a later release of the guide can be told apart from a defect here. `clinicalStatus` is the `active` the guide assigns, for the reason the guide gives: constraint ait-1 requires one and no `AL1` component can state the retraction that would excuse its absence. `AL1-3` becomes `code`, `AL1-5` becomes `reaction.manifestation.text`, one manifestation per repetition.

  `AL1-2` is resolved against two separate maps over Table 0127, one to `category` and one to `type`, independently, because that is what the guide publishes and their unmapped sets differ: `MA` yields the type `allergy` and no category at all, `MC` yields neither, and each absence raises its own `TRANSFORM_CODE_UNMAPPED` rather than borrowing the other map's answer or a neighbouring code. `AL1-4` becomes `criticality` through the Table 0128 map, whose `MO` and `U` have no target: those leave `criticality` absent and flagged. `AllergyIntolerance.reaction.severity` is never populated from that component, because the guide offers it only as a local variation conditioned on a severity that was not used equivalently to criticality, which no v2 message states, and emitting both from one code would assert a clinical grading the message does not carry.

  Whatever those maps do or do not translate, the code the sender wrote survives: the guide's `alternate-codes` extension carries the original `AL1-2` code in `v2-0127` on `category`, and the original `AL1-4` code in `v2-0128` on `criticality`, whether or not the translating map had a target for it. An unmapped category is therefore a `category` element carrying that extension and no code value, not an absent element.

  Two conditions withhold the allergy rather than emit an unsafe one, each with a `TRANSFORM_ELEMENT_DROPPED` naming what could not be grounded: a message with no `Patient` to anchor `patient`, where the alternative would be a reference resolving to nothing; and an `AL1-3` that carries neither an allergen code nor allergen text, where the alternative would be an allergy that never says what it is to. A withheld occurrence keeps its completeness issue, so it is still reported rather than silently absent. `AL1-6` is read as `onsetDateTime` only for a message whose version identifier is readable and earlier than 2.7, the version at which the guide records the field as withdrawn; on 2.7 or later, or when the version cannot be read, it is dropped with a diagnostic rather than read as an onset the sender may not have meant. `IAM`, the guide's other allergy segment, is still not built and still reports `TRANSFORM_SEGMENT_NOT_EMITTED`.

  No new issue code, no new dependency, and no change to any other message family: an `AL1`-free message produces exactly the bundle and the issues list it produced before.

- 673890c: Tell a consumer which segments a message carried that did not reach the returned bundle, instead of leaving the omission to be found by diffing the two by hand. Two new issue codes, `TRANSFORM_SEGMENT_NOT_EMITTED` and `TRANSFORM_SEGMENT_NO_IG_MAP`, are raised once per segment occurrence that contributed nothing to a resource the bundle contains, and they split a gap in this library from a gap in the standard so the two read differently.

  Until now an issues list said nothing about an `AL1`, a `DG1` or an `IN1`, whether the bundle carried it or nobody had looked. The library already refuses to emit a confident wrong FHIR value at the datatype and resource levels; this is the same rule at the segment level, where silence had been reading as completeness. Nothing is transformed that was not transformed before: a flagged segment tells you what is missing, not what it said.

  Reaching means contributing. An occurrence counts as reached only if the assembly took a value or the identity of it into a resource that is present in the returned bundle, so an `RXE` this library counts rather than assembles is reported, an orphan `OBX` is reported, and so is a resource the emit gate withheld. A segment whose values were all dropped downstream is not reported here: the resource built from it did reach the bundle, and those drops already have their own codes.

  The location is the only message-derived thing either code carries, in exactly two shapes: `NAME[k]`, 1-based among the occurrences of that name, when the name passes the HL7 v2 segment-identifier shape; and `[#n]`, the segment's position in the message, when it does not, with no part of the name reproduced. The shape is applied by this library to the value the parser published, as a positive test, rather than by excluding a marker constant of the parser package: the peer range admits any parser version, and an exclusion test would promote an unrecognized value into a rendering the first time that constant moved. A position carrying neither a name nor any field content is the parser's ordinal placeholder for a blank line, and raises nothing wherever it sits, while still counting toward later ordinals so they match the line the sender wrote.

  The split between the two codes comes from a hand transcription of the HL7 Version 2 to FHIR Implementation Guide's Segment Maps index at 1.0.0, published 2025-10-07 and retrieved 2026-08-22, exported as `IG_MAPPED_SEGMENT_NAMES` with its version, publication date, retrieval date and source URL so a later release of the guide can be told apart from a defect here. A name that could not be classified at all takes the no-map code as well, because a damaged identifier is never re-derived from the line; the core concepts documentation states that, and states that these locations are 1-based while the per-occurrence locations the library already emitted are 0-based and have not moved.

  Nothing else changed, and it was measured rather than asserted. Both codes are informational and neither is fatal. Every resource, every value and every issue the library raised before is unchanged, and the new issues are appended after all of them: the Bundle and the full pre-existing issues list were captured for twenty-three inputs from the tree before the diagnostic existed, and both are asserted against those baselines rather than against the new code's own output.

- 76984bb: Declare, rather than merely leave, what the reverse (FHIR to v2) direction cannot supply. Two issue codes are added, additions only: no existing `ISSUE_CODES` or `FATAL_CODES` key is renamed or removed, and no emitted segment content changes.

  `TRANSFORM_V2_REQUIRED_FIELD_ABSENT` is raised once per v2-required field that ends up absent from an emitted segment because the FHIR resource carried no source this map could ground it from. Until now that absence was silent: a `Patient` with neither `identifier` nor `name` emitted an `ADT` whose `PID` carried neither PID-3 (Patient Identifier List) nor PID-5 (Patient Name), and an `Observation` with no `status` emitted an `ORU` whose `OBX` carried no OBX-11 (Observation Result Status), both with an empty `issues` array. The field is still left absent, exactly as before, because a placeholder written to satisfy v2 structure would be a fabricated clinical value; what changes is that the receiver is no longer the first to find out.

  `TRANSFORM_NO_V2_MESSAGE_EMITTED` is raised when a conversion produces no message at all, because nothing in the resource grounded a single field of the target segment. That case previously returned `{ value: undefined, issues: [] }`, which a caller could not tell apart from a successful empty conversion. It is distinct from the refusals that name their own cause (an absent trigger, an unsupported resource type, a structurally malformed resource), each of which still returns its own code.

  Both codes carry an `error` severity, a v2 location and a FHIR path, and no value, in keeping with the value-free diagnostic contract. Callers that branch on severity will now see these two, which is the intent: an emitted message missing a v2-required field is not conformant, and the diagnostic channel is where that is said.

- 64930ef: An order's timing segment now reaches the request it times: a `TQ1` accompanying an `RXO` becomes `MedicationRequest.dosageInstruction.timing`, and a `TQ1` accompanying a service order becomes `ServiceRequest.occurrenceTiming`. Until now a pharmacy order transformed to a drug, a dose range, a route and a dispense request with no schedule at all, so "give 5 mg every 4 hours for 3 days" and "give 5 mg once" arrived as the same resource.

  **What a `TQ1` grounds.** `TQ1-3` (RPT) becomes the `Timing` over four components and only four: `RPT.1` Repeat Pattern Code to `Timing.code`, carried verbatim under the `v2-0335` CodeSystem when the published HL70335 map has a row for it; `RPT.5` Period Quantity to `repeat.period`, precision-exact; `RPT.6` Period Units to `repeat.periodUnit` when it already is one of FHIR's seven `UnitsOfTime` codes; and `RPT.8` Event to `repeat.when` when the published HL70528 map gives it a `v3-TimingEvent` target. `TQ1-7` and `TQ1-8` become `repeat.boundsPeriod.start` and `.end`, and value either one on its own and you get exactly that endpoint. `TQ1-10` is carried verbatim into `dosageInstruction.additionalInstruction.text` and `TQ1-11` into the resource's own `text` narrative, which are two different targets the guide names separately; neither is written to `dosageInstruction.text`, which the guide targets from nothing. Both rows are `TX`, a v2 primitive with no component structure, so both are read **whole**: a raw `^`, `&` or `~` inside a free-text instruction is content, not structure, and a taper written `2 tabs^then 1 tab` arrives with its second half intact instead of truncated at the first delimiter. That includes a delimiter the instruction ends on, which a field's canonical wire form drops as an empty position: on a free-text primitive it is the last character of a clinical instruction, so it is put back. It also includes a row that is nothing _but_ delimiters (`^`, `&~`, `^&~`), which carries the same characters as `^leading` with the letters removed and arrives as the text it is: "valued" on a primitive asks whether the wire put anything in the field, not whether some component position is non-empty, and the composite question would answer no for every one of them. The v2 formatting escapes a narrative carries are resolved on the way in (a delimiter escape to its literal character, a line-break command to a line break); a sequence with no defined rendering is preserved exactly as it stands rather than guessed at.

  **Only a row that carries a value is written.** The HL7 explicit null, the two-character literal `""`, is the wire saying a field carries no value; reading a field whole makes that marker look like text, because the marker _is_ the field's characters. It is read here exactly as an absent field: no `additionalInstruction`, no narrative, no diagnostic about a field that dropped nothing, and a `TQ1` whose only content was a null is still reported as not reaching the bundle. A row that _did_ carry content is different even when nothing can be placed from it: content whose whole projection resolves away (a highlight-boundary pair with nothing between it is display markup, not text), and a `TQ1-11` of nothing but whitespace, which R4's `txt-2` refuses in a narrative ("the narrative SHALL have some non-whitespace content") and which no structural validator here models, each write no element and raise a value-free diagnostic naming the row. `TQ1-10` is not whitespace-tested, because its target is a plain `string` that R4 constrains no further and inventing a rule there would drop text the sender sent.

  **A schedule is fully grounded or absent and flagged, and that is the whole safety claim.** A half-built timing reads to the receiving system as a complete dosing instruction, and a wrong frequency is a dosing error that no re-run undoes. So the whole `Timing` is withheld, with a value-free diagnostic naming what caused it, when: any RPT component outside those four is valued (`RPT.2` calendar alignment, `RPT.7` institution-specified time and `RPT.11` general timing specification have no target row at all; `RPT.3`/`RPT.4` need a day translation with no published table behind it; `RPT.9`/`RPT.10` need a rescale to minutes, which this library never performs; and the test is on whatever position the wire carried, so a component past the eleven the datatype defines is refused too rather than read as absent); a repeat-pattern, event, period or period-unit value cannot be carried without inventing a translation; any of the three bound-table components (`RPT.1`, `RPT.6`, `RPT.8`) declares a coding system that is not the table it is read against, because a site's local `AC` need not mean the published "before meal" concept that shares its spelling and `repeat.when`'s binding is required; a schedule-_narrowing_ field is valued (`TQ1-4`, `TQ1-5`, `TQ1-6`, `TQ1-12`, `TQ1-13`, `TQ1-14`, each of which makes the sent instruction narrower than the one that could be built without it); a bound is valued and yields no FHIR date-time, or the end precedes the start; a period quantity arrives without its period units, or period units arrive without a quantity, or the quantity is written with a minus sign (the test is on the sender's own lexical form, which is what the emitted value preserves, so a negative magnitude too small for a double to tell from zero is refused like any other), each of which produces a `Timing.repeat` that breaks a published R4 invariant (`tim-2` requires period units wherever a period exists, `tim-5` requires the period to be non-negative) and which no structural validator models, so it would otherwise reach a consumer as a grounded repeat with nothing to flag it; or one order carries two `TQ1` segments, or one `TQ1-3` carries two repeat patterns. A repetition of `TQ1-3` that carries no value is not one of them: `TQ1-3` is `0..-1`, so `Q4H~`, `~Q4H` and a second repetition the sender explicitly nulled all arrive in real traffic and each sends exactly one schedule, which is read from whichever repetition carries it. In every one of those cases the request is still emitted, with no timing element and no lone bounds period.

  `TQ1-2` quantity and `TQ1-9` priority behave differently and deliberately: the guide maps them to the dose and the priority, which the `RXO`/`OBR` path already grounds, so they are flagged as dropped, neither field is touched, and the schedule the rest of the segment grounds is still emitted.

  **`occurrence[x]` is a choice, so exactly one member is ever emitted.** A service order that would yield both an `occurrenceDateTime` from `OBR-6` and an `occurrenceTiming` from its `TQ1` emits the timing and flags the dropped `OBR-6`; a refused timing hands the choice back to `OBR-6` unchanged.

  A `TQ1` that contributed a timing, an additional instruction or a narrative is no longer reported as not reaching the bundle; one that was read and refused still is, because it did not. No issue code is added: every diagnostic here is an existing member of `ISSUE_CODES`, and an order carrying no `TQ1` produces a byte-identical bundle and an identical issue list to before, measured against a captured baseline rather than asserted.

- 13750f1: Consume `@cosyte/hl7` from the registry at `0.0.10` instead of a vendored tarball at `0.0.1`, and prove by measurement that nothing this package emits moved with it. No emitted FHIR value changes, no diagnostic changes, no issue code is added, renamed or removed, and no mapping is touched: `src/` is byte-for-byte unchanged by this release.

  The parser was nine published versions behind, pinned to a `pnpm pack` archive committed into the repository, which meant the version the tests exercised was watched by no dependency route and could only move by hand. It is now a plain devDependency resolved through the lockfile, the archive is deleted, and no copy of the library source remains in the tree. `@cosyte/fhir` is unaffected and stays vendored, for the one reason it always was: the registry does not have it.

  Because this package sits in a PHI dataflow and its promise is never a confident wrong FHIR value, a green suite was not accepted as evidence on its own. Every HL7 v2 fixture the repository carries was collected mechanically into a frozen corpus, four synthetic inputs were authored for the malformed, truncated, empty and wrong-version classes, and all of it was transformed once on each side of the bump. The compared surface, meaning the FHIR output plus every diagnostic in emission order, is byte-identical across all 128 members. Both captures are committed beside the record so the comparison can be rerun rather than believed.

  Two suites are added and none is removed or relaxed. One asserts the fail-safe rule class by class for malformed input, and sweeps every diagnostic the whole corpus raises to confirm each carries a registry-static message at a positional locator and no field content. The other records, as a call that compiles and runs, two upstream capabilities whose earlier absence shaped this package: an ADT message builder and a typed composite encoder both exist now. Neither is adopted here. The visit-carrying `Patient` plus `Encounter` output stays deferred, and the reverse path keeps building its fields by hand, because a refresh whose whole claim is that nothing moved cannot also change what is emitted.

## 0.0.9

### Patch Changes

- ad5f2f2: No runtime impact: the repository's own PHI commit-gate read 31 of its 102 tracked files, and it now reads 101 of its 103 and refuses when it cannot account for the rest.

  Both of the gate's enumerating routes covered `test/fixtures/` and `src/` only. Seventy-one tracked files were read by neither of them, twenty-seven of those under `test/`, and eight of those carried inline HL7 v2 patient-identification segments with names, dates of birth and medical record numbers in them. The sharper half is that `test/fixtures/` has never existed in this repository, on any commit: the walk's existence check returned on its first line for that root on every run the gate has ever made, and every one of those runs printed a clean result and exited zero. An unopened root and a clean one are indistinguishable from the outside.

  Neither a file count nor an existence check detects that, and both were considered and rejected: a count counts the roots that did exist, and refusing a missing root leaves an emptied one reporting clean. So the walk now covers every tracked directory plus the files at the repository root, and reconciles what it actually opened against the list of files version control actually carries. A tracked path the walk did not open now refuses, naming each one. A declared root that is a symbolic link, dangling or not, refuses too: the existence check follows a link, so a dangling root read as absent and the whole corpus went unscanned while the run reported success.

  Enumerating more files buys the cross-cutting social security number and email checks and nothing else, and measured on this repository those two find nothing at all in the eight fixture files: they carry no dashed social security number and no email address. What they carry is names, dates of birth, record numbers, one undashed social security number, a street address and two telephone numbers. So a structured pass ships alongside the existing one, never in place of it, reading HL7 v2 patient, next-of-kin, guarantor and insurance segments field by field and component by component. It finds segments inline rather than assuming a file is a message, because this package ships no standalone message file at all: every fixture is a string literal inside TypeScript.

  Every value the structured pass reports is checked against the reviewed synthetic-fixture declaration list, which gains entries for this repository's placeholders. Each was read by hand first and each is named in that file rather than removed, because removing them would destroy the evidence the audit happened. Seventy files are newly read, sixty-nine of which already existed and were read by hand; nothing patient-identifying was found in any of them. The two that stay unread are the vendored compressed archives, whose stored bytes are not the text they carry, and each is declared by its exact path.

  One detection is subtracted and it is the only one. The package manifest carries the publisher's own contact address, which the email check cannot tell from a patient's, so scanning the manifest at all required declaring that one address. It is declared with a path as well as an address, so the same address in any other file still reports and any other address in the manifest still reports, and the cost is that naming the manifest directly no longer reports it. Every other outcome is unchanged or newly caught: a hundred and sixty-eight before-and-after cases, fourteen path shapes by four payload shapes by all three ways the gate can be invoked, with thirty-seven that reported before still reporting, seventy-four newly caught and fifty-six unchanged and quiet.

  Two further blind spots were found while grading this change and were closed rather than written down, because both reported a clean result over content a reader would expect to be caught: a person's name spelled with any character outside the plain English alphabet, and a whole message pasted into a single string with its separators written as escapes. A wrong field position was corrected too, where an insurance segment's relationship code was reported as a telephone number.

  The way the gate's own limits are written changed with them, and that is the more useful half. Grading three times showed that a list of what a scanner does not catch cannot be kept true, because every clause of every segment of the standard would have to appear on it, and both versions of that list were measured incomplete in the direction that flatters the gate. The scanner now states the opposite way round: exactly which fields it reads, with anything not named there not checked. That claim can be checked against the code, and the suite now checks it from both sides in a single run, so a field added to the reader without being added to the statement, or dropped from the reader while the statement keeps promising it, both turn the build red. It also records which of those field numbers are corroborated by something in this repository and which are not, because that is where the remaining risk sits.

  Several limits stay disclosed rather than quietly closed, including that the reconciliation compares path names and not the bytes stored at them, and the complete list of what the gate still cannot see is written at the top of the scanner itself.

## 0.0.8

### Patch Changes

- 9fdde50: No runtime impact: punctuation only, plus a new repository-internal check that keeps it that way.

  The Cosyte brand voice does not use the em dash (U+2014). This package carried 659 of them across
  75 of its 98 tracked files, including the README, every documentation page that publishes to the
  documentation site, and the source doc comments that compile into the shipped type declarations and
  render in an editor on hover. All 609 that were in scope are rewritten with a period, a colon, a
  comma or parentheses, chosen by what each sentence meant rather than by one blanket substitution.

  No exported name, type, issue code, fatal code or documented behaviour changed. Two strings changed
  punctuation and nothing else, and both belong to developer tooling rather than to the published
  package: the PHI scanner's clean-run line, and one diagnostic from the check that verifies this
  repository's own contributor instructions.

  Two files still carry the character and each is an exemption with a written reason. The changelog's
  dated archive below its "Released before this file was generated" heading is a frozen record whose
  entries are byte identical to the tarballs they shipped in, and rewriting it would destroy the
  evidence a changelog exists to hold. The vendored third-party tarball under `vendor/` holds the
  character's bytes by coincidence inside a compressed stream, which no edit can remove.

  The check that enforces the rule lands in the same change as the sweep, on purpose: a check arriving
  before its sweep turns the build red on arrival, and a sweep arriving before its check lets the
  character grow back. It reads bytes directly rather than shelling out, refuses to report a clean
  result whenever it cannot prove it read its subject, and holds its own source to the same rule by
  assembling every banned spelling at runtime instead of writing one down.

## 0.0.7

### Patch Changes

- a9c522a: No runtime impact: a repository-internal CI check now verifies this repository's own contributor instructions, which are not part of the published package.

  The instructions live in two files, one always read and one read on demand, and until now nothing checked that the second one existed, that the sections it declares had any content, or that the cross-references between the two resolved. A new check refuses all three, refuses a cross-reference pointing at a file or path the repository does not carry, and refuses a relocated section that nothing points at any more.

  It also refuses to report a clean run over a corpus it did not actually open: the files it read are reconciled against the list of files tracked by version control, and an empty or unreadable list is treated as a failure to run rather than as nothing to check.

- 9fd8f24: The npm `description` no longer carries an em dash (`EMDASH-CONFORMANCE`).

  The brand rule bans U+2014 on every cosyte surface, and this string is the most visible one the
  package has: it is the subtitle on the npm package page and the one line shown in every npm search
  result. It now reads with a colon, which is what the rule's own remedy list names first.

  The `→` in the same string is U+2192, not an em dash, and it is load-bearing: it names the direction
  of the transformation. It stays.

  Scoped deliberately to the description alone. The full tree sweep for this repo is a separate unit,
  still queued, and lands with the CI gate that keeps it swept.

- 9fb82e8: The README lockup now links to cosyte.com (`ASSETS`).

  The `<picture>` block above the H1 is wrapped in an anchor to https://cosyte.com, per the founder
  requirement of 2026-08-06. Nothing inside the block moved: the `<source>`, the `<img>`, the alt text
  and both tile URLs are byte-identical.

  What the anchor does was measured on both surfaces by `fhir`, not assumed, because fourteen READMEs
  carry this shape. On GitHub the anchor works and the colour-scheme switch keeps working, because the
  `<img>` stays a direct child of `<picture>`, which is the condition the HTML spec puts on `<source>`
  applying at all. On an npm package page the anchor is lost: npm wraps a README image in its own
  anchor to the image file, a nested anchor is not representable, so the parser closes ours early and
  the image ends up linked to the image file rather than to cosyte.com. Shipped anyway by founder
  decision of 2026-08-07: on npm that is no worse than the unlinked lockup it replaces, and GitHub is
  where these READMEs are read.

- 7f4d59b: The published changelog no longer describes its own contents as unreleased: a release now writes its own version heading and its own entry into `CHANGELOG.md`.

  `CHANGELOG.md` ships inside the npm tarball, and for the whole of this package's public history it carried no version heading at all. A single `[Unreleased]` heading spanned everything, and the preamble above it said the first pre-alpha release "will ship" the API surface listed below it, in a tarball that had already shipped that surface several versions earlier. Changesets now generates the changelog, so a release writes the version heading and the entry, and there is no hand-maintained section left to go stale.

  The hand-written history is kept verbatim beneath a `Released before this file was generated` divider, with generated release sections above it, newest first. No entry was reworded, re-sorted or removed. What was dropped was scaffolding for the old hand-written workflow: the file's former header, the `[Unreleased]` heading and its link definition, the note beneath that heading promising a first release which had in fact already shipped, and the empty section stubs that existed to receive the next hand-written entry.

## Released before this file was generated

Every release section above this heading is written by
[Changesets](https://github.com/changesets/changesets) from the changesets in `.changeset/`, newest
release first. The release writes its own version heading, so nothing above this line is maintained
by hand: a change is recorded by adding a changeset, and that changeset's summary is the entry a
reader sees here.

Everything below this heading was maintained by hand. It sat under a single `[Unreleased]` heading
that no release ever rolled over, so it went on describing already-published code as unreleased,
inside the published tarball, for the whole of this package's public history. It is left as it was
written rather than re-sorted into version sections: the file never recorded which release each
entry went out in, and this is the text that installed copies already carry on disk. No entry was
reworded, re-sorted or removed. What was dropped was scaffolding for the hand-written workflow that
no longer runs: the file's former header, the `[Unreleased]` heading and its link definition at the
foot of the file, the note beneath that heading promising a first release which had in fact already
shipped, and the empty section stubs that existed to receive the next hand-written entry.

The entries below follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the generated
sections above use the format Changesets writes, which is a version heading and a list of the
changes that release consumed. Versions follow the cosyte pre-alpha ladder, `0.0.x` until first
alpha, rather than [Semantic Versioning](https://semver.org/spec/v2.0.0.html) alone.

### Fixed

- **A staged rename walked a symbolic link, or a real patient name, straight into a scan root
  without the pre-commit PHI gate ever looking at it** (`PHI-SCAN-RENAME-BLIND-AT-PRECOMMIT`; port of
  the graded fix in `dicom#60`). `R` (rename) and `C` (copy) records are returned by neither `AM` nor
  `AMT`, so the `--staged` route's `--diff-filter=AMT` deleted the whole two-path record before any
  mode or any content was read. Measured on this repo's own scanner before the fix, on both shapes it
  reaches: `git mv notes/leak.txt src/leak.ts` over a link to a name-bearing synthetic payload staged
  as `:120000 120000 <sha> <sha> R100` (`git ls-files --stage` reading `120000` on the destination)
  and reported a clean scan, exiting **0**; `git mv notes/payload.txt src/payload.ts` over an ordinary
  file full of the same payload passed identically. Both are ordinary developer actions, not
  contrived ones.

  **The gap is at PRE-COMMIT.** The hook is `phi-scan --staged`; the all-mode walk CI runs does
  enumerate the renamed entry, so the exposure was "PHI enters a local commit or a pushed branch",
  not "PHI merges". Stated because the containment is the difference between a defect and an
  incident.

  **The remedy is `--no-renames`, and it costs no stride work.** With detection off git cannot emit
  `R` or `C` at all, so the destination arrives as an ordinary single-path `A`
  (`:000000 120000 0000000 <sha> A`) and the source as a `D` the filter drops. No two-path record
  shape is needed, and the enumeration is a strict **superset** of the previous one: re-measured
  under `diff.renames=true|copies|false|1` and `renameLimit=1`, every setting yields that same
  single-path `A`, so the flag also makes the two-field stride **structural** rather than conditional
  on whatever a caller has configured. This repo previously disclosed the residual as "admitting them
  needs the two-path record shape, a scope decision"; **that framing was false**, and it had been
  carried in from a sibling repo rather than measured here.

  **Unmerged (`U`) records were dropped by the same filter and are now refused rather than admitted.**
  A conflicted path has no stage-0 entry, so `git show :<path>` answers
  `fatal: path ... is in the index, but not at stage 0` rather than any content. It now refuses
  (exit 2) through the same closed-set path as a link or a gitlink, naming the path and an
  engine-owned kind and nothing else. The refusal keys on the **status**, not the mode, and that is
  measured rather than assumed: across six conflict flavours (both-modified, add/add, modify/delete,
  delete/modify, rename/rename, symlink/symlink) the status is always `U` and the destination mode
  always `000000`, while the source mode and the set of index stages present both vary.

  **One route this does not close, measured and disclosed rather than quietly left out:** a scan
  root's **own path** staged as a non-regular entry is still outside the `--staged` route's scope,
  because that scope tests `test/fixtures/` and `src/` as path prefixes. Measured on both trees:
  `ln -s elsewhere src && git add -A` stages `:000000 120000 0000000 <sha> A src`, and `--staged`
  reports clean and exits 0 while the all-mode walk over the same tree exits 1 on the payload behind
  it. Pre-existing and unchanged by this slice; the reference implementation this was ported from
  carries a guard for it that did not come across, and closing it is its own item.

  Pinned in `test/scripts/phi-scan.test.ts` against throwaway git repos under `os.tmpdir()`, with the
  premise itself pinned (git really does stage `git mv <link>` as `R100` at mode `120000`, and `AMT`
  really does return nothing for it) so the fix cannot come to rest on a claim about git that stopped
  being true. **Six of the new cases run red against the previous scanner**, including a repo whose
  own `diff.renames` is set to `copies`. Two controls stay green on both trees deliberately: a rename
  landing **outside** a scan root still passes (the fix narrows what the route's existing scope
  admits; it does not widen the scope), and a stage mixing an add, a modify and a rename still
  reports the violator behind them.

- **The PHI scanner exited `1`, its code for HITS FOUND, when it could not run at all.**
  `loadAllowList()` runs outside every `try` in `main`, so a missing `scripts/phi-allow-list.txt`
  threw out of the process and left node's uncaught-exception status, `1`. A `readdirSync` failure
  under a walk root did the same. A caller keying on the exit code therefore read a gate that never
  ran as a gate that ran and fired: the wrong direction to be wrong in. Every failure to complete
  now exits **2**: `run()` at the foot of the file is the outermost net, and `walk` names an
  unreadable directory and its errno itself instead of throwing raw. An unexpected throw still
  prints its stack, deliberately.

- **The exported `VERSION` constant said `"0.0.0"` on a package published as `0.0.4`, and the
  documented install smoke test told an installer to print exactly that constant**
  (`VERSION-CONSTANT-DRIFT`). Measured on the released tarball, not inferred from source:
  `npm pack @cosyte/transform@0.0.4` yields a `dist/index.mjs`, `dist/index.cjs`, `dist/index.d.ts`
  and `dist/index.d.cts` that all carry `"0.0.0"`. It is not one bad release: **every** version ever
  published (`0.0.2`, `0.0.3`, `0.0.4`) ships `"0.0.0"`, so the wrong constant is live on the registry today
  and stays wrong there until the next publish. The constant's own doc comment already claimed it
  was "synced with `package.json#version` by the release tooling" while no such step existed: the
  `version` script ran `changeset version` alone, which rewrites `package.json` and nothing else.
  The fix is structural rather than a hand-bump, because a hand-bumped constant goes stale at the
  very next release. `scripts/sync-version.mjs` (ported from `terminology#12`, `67f73db`, the commit
  that added it there) rewrites the declaration from `package.json` and is wired into the `version` script
  immediately after `changeset version`, so the bump and the constant land in the same
  "Version Packages" commit. The drift guard is `test/sanity.test.ts`, which now compares the export
  against `package.json` instead of asserting shape only; it fails on the unfixed tree
  (`expected '0.0.0' to be '0.0.4'`), which is how it was checked for bite. The declaration also
  gains the `: string` annotation the sync script keys on, which stops the published declaration
  files leaking the literal type `"0.0.0"` into consumers' types (they did — both `dist/index.d.ts`,
  which `exports["."].import.types` points at, and `dist/index.d.cts`).
  This is a known repeat class in the suite: `@cosyte/astm@0.0.1` and `@cosyte/terminology@0.0.1`
  shipped the same defect, the latter with the same install-smoke-test amplifier.
- **`docs-content/installation.md` claimed the package was "not yet published to npm"** and that
  both peers were unpublished. The package is on the registry; `@cosyte/hl7` is too. The page now
  says what is actually true and keeps the two halves together, because either half alone misleads:
  the package **is** published **and** it **cannot be installed from npm**, because the
  `@cosyte/fhir` peer is not on the registry. Measured today:
  `npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir` fails with `ERESOLVE`, `Could not resolve
dependency: peer @cosyte/fhir@">=0.0.0" from @cosyte/transform@0.0.4`.
- **The PHI scanner read a symbolic link as clean on BOTH of its enumerating routes, so a link
  under a scan root pointing at a file full of PHI passed the commit gate**
  (`PHI-SCAN-SYMLINK-BLIND-ON-BOTH-ROUTES`; port of the graded fix in `terminology#37`, `5f81640`).
  Measured on this repo's own scanner before the fix, over a link under `src/` pointing at a
  name-bearing synthetic payload: all-mode printed `OK — no hits` and exited **0**, and `--staged`
  did too. The walk enumerates `Dirent.isFile()`, which is an lstat answer, so a link is neither a
  file nor a directory and fell out of the loop whatever it pointed at — and a linked _directory_
  took its whole subtree with it. `--staged` reads content with `git show :<path>`, and git stores a
  link as its **target path** under mode `120000` (`git ls-files --stage` read `120000` on it), so
  that route was handed the path text and never the target's bytes.

  **The remedy is to narrow the enumeration and follow nothing it enumerates.** Every entry the scan
  enumerates, and every path named directly, is now **refused** if it is not a regular file (exit 2,
  the existing "could not complete" code) rather than being silently skipped. Following such an entry was rejected on purpose: it would read bytes the
  enumeration does not control (outside the repo, a loop, a device, a FIFO that blocks the gate
  forever), and git does not carry those bytes anyway, so a hit on them would be a claim about
  something no commit contains.

  **The third mode — a named `<path>` — was not blind, and it is fixed in the same pass because the
  invariant has to hold for the whole scanner.** It classified with `statSync`, which
  **dereferences**, so `pnpm phi-scan src/link.ts` read the target's bytes and reported the hits it
  found there, including for a target **outside the repository**. That is never a false clean, which
  is why reading the code does not catch it; it made the scanner's stated rule weaker than one of its
  own routes. It lstats now and refuses through the same closed set. A dangling link is reported as
  the link it is rather than as a missing file, because `existsSync` follows.

  **Stated precisely, because a looser wording of it was measured false twice: `lstat` answers for
  the final path component only.** A named path whose **ancestor** component is a symlink is still
  followed and still read, and so is a plain absolute or `../` argument. Both predate this change and
  neither is narrowed by it; they are listed with the other residuals below rather than closed,
  because closing them means realpath or containment logic, which is a guard growing past the defect
  it fixes. Neither of the two routes that gate a commit — the pre-commit hook and the walk CI runs —
  reaches either.

  **`--diff-filter` now admits `T`, and leaving it out is what made the mode check unreachable on a
  tracked file.** Replacing a tracked regular file with a link is neither an add nor a modify:
  measured here, `git diff --cached --raw --diff-filter=AM` printed **nothing** for that change
  while the unfiltered `--raw` printed `:100644 120000 <sha> <sha> T`. Under an `AM` filter the
  record died before any mode could be read and the hook passed a mode-`120000` blob green.
  Admitting `T` also covers the reverse typechange — a tracked link replaced by a real file bearing
  PHI, which is a scan that must happen rather than a refusal. The route reads
  `git diff --cached --raw -z` so the destination mode is visible at all, and a record it cannot
  parse refuses rather than shortening the list silently.

  **A refusal names every offender by its own repo-relative path plus an engine-owned kind token,
  and never the link target.** A target path is working-tree text that can itself carry PHI — a
  target of the shape `<surname>-<given>-<dob>.txt` is the whole reason, written out as a shape
  rather than an example because a diagnostic about a PHI leak is itself a PHI surface. The scope of
  each route is unchanged: the walk still excludes a gitignored entry (so links get no second,
  stricter boundary of their own) and `--staged` still only looks at `test/fixtures/**` and
  `src/**.ts`. This narrows what those scopes admit; it does not widen them. The walk itself has no
  extension scope — it skips regular `*.md` as documentation and takes everything else — so a link at
  `src/leak.json`, and a linked directory, are refused there too.

  **Three residuals are disclosed rather than closed** — the ancestor-component and absolute/`../`
  reads above, plus two inherited from the graded reference and
  re-measured here. `R`/`C` rename and copy records are still not enumerated by `--staged` at all —
  admitting them needs the two-path record shape handled, which is a scope decision of its own; the
  stride desync a stray one would cause refuses rather than mis-parses. That residual is reachable by
  an ordinary action rather than only in principle: `git mv` into a scanned prefix raises `R100`,
  which the filter drops, so the pre-commit hook reports clean over a staged PHI-bearing file — on
  the old scanner and on this one alike. The all-mode walk that CI runs does catch it, so the
  exposure is a local commit or a pushed branch, not a merge. And this scanner has no
  refuse-a-scan-that-observed-nothing rule, so an empty enumeration still reports clean.

  **▶ SUPERSEDED IN THIS SAME RELEASE, AND THE FRAMING ABOVE WAS FALSE.** The `R`/`C` residual is
  closed by `PHI-SCAN-RENAME-BLIND-AT-PRECOMMIT` (the first entry in this section): the remedy is
  `--no-renames`, which needs neither the two-path record shape nor a scope decision. The paragraph
  above is kept as written because the two bullets ship as one release note and a reader will meet
  both; what would mislead is leaving it as the last word. The other two residuals it names stand.

- **The `attw` publish gate passed an untyped pack, so a tarball with no type declarations in it
  would have merged and published as green** (`ATTW-FALSE-GREEN-PORT`; port of the graded fix in
  `terminology#28`, `bf153cb`). `@arethetypeswrong/cli@0.18.4` opens `getExitCode()` with
  `if (!analysis.types) return 0`, returning **before the problem list is read at all** — an untyped
  package is a legitimate npm package, so the CLI treats "no types" as a description rather than a
  problem. No `--profile`, `--ignore-rules` or config setting reaches that early return, which is
  why the remedy is a wrapper (`scripts/attw.mjs`, now what the `attw` script runs) and not a
  stricter invocation. The old invocation here was the bare `attw --pack .`, on the default strict
  profile; it was never lenient.

  **Reproduced on this package, on a quiet box, with zero concurrency** — both `rm -rf dist && attw
--pack .` and `pnpm build && rm -f dist/index.d.ts dist/index.d.cts && attw --pack .` print
  "This package does not contain types." and exit **0**. The second is the realistic trigger: `tsup`
  emits the ESM/CJS bundles in one pass and the declarations in a later pass, so **every** build of
  this package has a window where `dist/` holds JS and no `.d.ts`. Polling `dist/` every 5 ms from
  the start of `pnpm build`, that window measured **1,600 ms, 1,646 ms and 2,018 ms** across three
  consecutive builds. Concurrency only widens the window; it is not the defect, and the remedy is
  therefore **not** a lock, a lease or a build queue (umbrella ADR 0015) — the gate is made able to
  report that its own inputs were missing, whatever removed them.

  Two nets, catching different things. A **preflight** that every relative path `package.json`
  promises (`main`, `module`, `types`, `typings`, every string leaf of `exports` — here
  `./dist/index.{cjs,mjs,d.ts,d.cts}`) exists and is non-empty, which is what catches the build
  window and names the missing file. A **post-check** that promotes `attw`'s untyped sentence to a
  failure, which catches what the preflight structurally cannot: declarations present on disk but
  excluded from the tarball by `files`/`.npmignore`. **No instance of that second case is on record
  in this repo.** Because the post-check reads a printed string it is blindable, so `--quiet`,
  `-f/--format` and `--config-path` are refused **by option name, wholesale, not by value**, along
  with a `.attw.json` setting `quiet` or `format` (`readConfig()` applies those after argv). Three
  of those four routes were measured here to restore the exact exit-0; `--config-path` is refused by
  inference, and says so.

  `test/scripts/attw-gate.test.ts` pins both nets against the real binary — including the upstream
  exit-0 itself, so an `attw` upgrade that fixes the exit code or rewords the sentence reds the
  suite instead of letting the net go quietly slack — plus a **negative control** on a well-formed
  package and a check that a real `attw` failure still exits with `attw`'s own status. Reducing the
  wrapper back to the bare CLI reds 10 of its 13 tests.

  **Two limits, stated rather than left to be discovered.** A **complete but stale `dist/`** passes
  both nets; that is not live today only because the verify ladder runs `build` before `attw`. And
  this package's unpublished `@cosyte/fhir` peer (`FHIR-NPM-NAME`, a separate human gate) does not
  change what `--pack .` can see: a good pack reports "No problems found" and exits 0, and does so
  identically with `node_modules/@cosyte/fhir` moved out of the way, so `attw` is not resolving that
  peer either way. Nothing in this entry says a green `attw` speaks to whether a consumer can
  install the peer; it does not.

  No library code, public API, issue code, mapping or transformed value changes.

### Added

- **A brand image at the top of `README.md`.** The page opens with the Cosyte lockup, served as a
  `<picture>` with a light and a dark source so it follows the reader's theme, and carrying alt text
  that describes the mark for anyone reading with images off or a screen reader on. The block is
  copied byte for byte from the `hl7` README, which is the reference the suite mirrors, so the eight
  repos that carry it stay identical rather than drifting into eight hand-typed variants. Nothing
  else on the page moved: the title, the summary blockquote and every code sample are unchanged, and
  no API, issue code, mapping or transformed value differs.
- **Phase 6 — terminology value translation of coded fields** (roadmap §Phase 6). Coded fields that
  earlier phases carried **structurally** (code preserved, system recognized) are now
  **value-translated** through their IG segment-map `mappedVia` ConceptMaps. Adds a `$translate`-shaped,
  additive, fail-safe engine — `toFhirCodeableConceptVia(cwe, map, ctx?)` — and the license-clean value
  maps it applies, each transcribed and verified **firsthand against the raw published IG ConceptMap
  JSON** (`hl7.fhir.uv.v2mappings`, STU1), down to the nested `TypeInfo → mappedVia` extension rows.
  - **RXR-1 route → `route`/`dosageInstruction.route`** via `table-hl70162-to-v2-0162`
    (`ROUTE_VALUE_MAP`): a 41-code identity group into `v2-0162` plus a 6-code remap into
    `v3-RouteOfAdministration` (`ID→IDINJ`, `IM→IM`, `IV→IVINJ`, `PO→PO`, `SC→SQ`, `TD→TRNSDERM`).
  - **RXR-2 site → `site`/`dosageInstruction.site`** via `table-hl70550-to-v2-0550` (`SITE_VALUE_MAP`):
    the 443-code body-part identity map into `v2-0550`, transcribed verbatim (including the IG's
    as-published `Â` encoding artifacts, preserved for source-fidelity and inert).
  - **SCH-8 appointment type → `appointmentType`** via `table-hl70277-to-v2-0277`
    (`APPOINTMENT_TYPE_VALUE_MAP`).
  - **RXO-9 allow-substitution → `substitution.allowedCodeableConcept`** via `table-hl70161-to-v2-0161`
    (`SUBSTITUTION_VALUE_MAP`, `N`/`G`/`T`), translate-or-withhold — a substitution permission is never
    emitted from an unrecognized code.
  - **OBR-5 priority → `ServiceRequest.priority`** via `table-hl70485-to-request-priority`
    (`SERVICE_REQUEST_PRIORITY_MAP`: `S→stat`, `A→asap`, `R→routine`; every other v2-0485 code — the
    whole `T{S,M,H,D,W,L}<integer>` timing-critical family and `PRN` included — is in the IG's
    `(unmapped)` group → flagged, `priority` left absent).

  **Grounding discipline — no invented targets.** A source code in the IG map's `(unmapped)` group is
  flagged `TRANSFORM_CODE_UNMAPPED` and the raw coding preserved (or the value withheld), never coerced.
  Translation is **additive** (the derived coding is added alongside the preserved raw coding, including
  any CWE.4/5/6 alternate triplet and CWE.7 version) and **bound-table-guarded** — it fires only when the
  field's primary coding is from the source table (CWE.3 absent or naming it); a field declaring a
  _foreign_ coding system is carried structurally + flagged, never asserted as the standard concept. Two
  fields the IG maps into **SNOMED CT** — **RXR-4 method** (`table-hl70165-to-sct`) and **SCH-7 reason**
  (`table-hl70276-to-sct`) — stay structurally carried (BYO ConceptMap): SNOMED is license-encumbered
  and **not bundled** (§5). Two fields the IG ships **no** value ConceptMap for — **TXA-2 document type**
  and **RXA-5 vaccineCode** — are documented as such and left structural, never given an invented
  translation (ADR 0018). Zero encumbered terminology content is bundled. New public surface (additions
  only): `toFhirCodeableConceptVia`, `codeableConceptFromTarget`, `CodedTarget`, `CodedValueMap`,
  `ROUTE_VALUE_MAP`, `SITE_VALUE_MAP`, `APPOINTMENT_TYPE_VALUE_MAP`, `SUBSTITUTION_VALUE_MAP`,
  `SERVICE_REQUEST_PRIORITY_MAP`, and the target-system URI constants. No new issue codes.

- **Phase 5 — the thin IG singles: VXU_V04 → Immunization; SIU_S12 → Appointment; MDM_T02 →
  DocumentReference** (roadmap §Phase 5). `toFhir(msg, opts?)` now assembles the three single-trigger IG
  message families into a FHIR R4 message `Bundle`, alongside the Phase-2 `Patient`/`Encounter`. Every
  segment/field/table/datatype map is grounded firsthand on the published HL7 v2-to-FHIR IG
  (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source. **With Phase 5 the v2→FHIR direction
  is feature-complete for the IG-covered message set.**
  - **VXU_V04: RXA (+ RXR, ORC) → `Immunization`** (IG _Segment RXA/RXR/ORC to Immunization_; per the
    VXU message map each `ORC` creates the Immunization and the `RXA`/`RXR` are incorporated): RXA-5 →
    `vaccineCode`, RXA-3 → `occurrenceDateTime`, RXA-6/7 → `doseQuantity`, RXA-15 → `lotNumber`, RXA-16 →
    `expirationDate`, RXA-18 → `statusReason`, RXA-19 → `reasonCode`, RXA-22/ORC-9 → `recorded`, RXR-1/2
    → `route`/`site`, ORC-2/3 → `identifier` (PLAC/FILL), and `patient`/`encounter` wired to the bundle.
    `status` follows the IG's three conditioned status rows: a delete action (RXA-21 = `D`) → the
    IG-assigned `entered-in-error`, an unvalued RXA-20 → the IG-assigned `completed`, and a valued RXA-20
    → the **`HL70322` → Event Status** ConceptMap (`IMMUNIZATION_STATUS_MAP`); a valued RXA-20 the map has
    no target for is flagged and the Immunization withheld, never guessed. The order-group `OBX`s become
    standalone patient `Observation`s.
  - **SIU_S12: SCH (+ AIS, PID) → `Appointment`** (IG _Segment SCH/AIS/PID to Appointment_ + _Datatype TQ
    to Appointment_): SCH-25 → `status` via the **`HL70278` → AppointmentStatus** ConceptMap
    (`APPOINTMENT_STATUS_MAP`), SCH-1/2 → `identifier`, SCH-8 → `appointmentType`, SCH-7 → `reasonCode`,
    SCH-9/10 → `minutesDuration`, SCH-11 TQ.4/TQ.5 → `start`/`end`, AIS-3 → `serviceType`, and the bundle
    Patient wired as the required `participant`. An IG-unmatched filler status withholds the Appointment;
    the participant's IG-unsourced required `status` is a `data-absent-reason` primitive, never fabricated.
  - **MDM_T02: TXA (+ OBX) → `DocumentReference`** (IG _Segment TXA/OBX to DocumentReference_): TXA-2 →
    `type`, TXA-6 → `date`, TXA-12 → `masterIdentifier`, TXA-16 → `identifier`, TXA-25 → `description`,
    the `OBX` body → `content.attachment` (TX/FT base64-encoded verbatim, RP as a URL), and `subject`
    wired to the Patient. `status` is grounded only for TXA-19 = `AV` → `current` (the IG ships no value
    ConceptMap; `AV` has exactly one faithful `document-reference-status` target); every other
    availability code withholds the resource and TXA-17 → `docStatus` is left absent (no IG value map).
  - Fail-safe throughout: timezone-naked instants (Appointment `start`/`end`, DocumentReference `date`,
    Immunization date fields) are dropped + flagged rather than assigned a fabricated UTC offset; a
    non-mapped VXU/SIU/MDM trigger is segment-assembled + flagged, never invented; every emitted resource
    passes the conservative-emit gate against `@cosyte/fhir` before it ships. New public exports:
    `IMMUNIZATION_STATUS_MAP`, `APPOINTMENT_STATUS_MAP`, `IG_MAPPED_IMMUNIZATION_TRIGGERS`,
    `IG_MAPPED_APPOINTMENT_TRIGGERS`, `IG_MAPPED_DOCUMENT_TRIGGERS`.

- **Phase 4 — ORM_O01 / OML_O21 → ServiceRequest; RXO → MedicationRequest, the order-entry graph**
  (roadmap §Phase 4). `toFhir(msg, opts?)` now assembles order messages into a FHIR R4 message
  `Bundle`: each ORC-anchored order becomes a **`ServiceRequest`** (an `OBR` order detail) or a
  **`MedicationRequest`** (an `RXO` pharmacy detail), alongside the Phase-2 `Patient`/`Encounter`.
  Every segment/field/table map is grounded firsthand on the published HL7 v2-to-FHIR IG
  (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source.
  - **ORC + OBR → `ServiceRequest`** (IG _Segment ORC/OBR to ServiceRequest_; per the ORM_O01/OML_O21
    message maps the `ORC` creates the request and the `OBR` is incorporated into it): ORC-2/3 or
    OBR-2/3 → `identifier` (PLAC/FILL, v2-0203), ORC-1 → `status` via the **`HL70119` → request-status**
    ConceptMap (`REQUEST_STATUS_MAP`, only when ORC-5 is not valued), OBR-4 → `code`, OBR-6 →
    `occurrenceDateTime`, ORC-9 → `authoredOn` (for a `NW` order), OBR-31 → `reasonCode`, and
    `subject`/`encounter` wired to the bundle's Patient/Encounter. `intent` is fixed to the
    `request-intent` code `order` from the order-message context (the IG maps `→ intent` with no value
    table) — a resource-level constant, not a fabricated per-code row.
  - **RXO (+ RXR) → `MedicationRequest`** (IG _Segment RXO/RXR to MedicationRequest_): RXO-1 →
    `medicationCodeableConcept`, RXO-2/3 (+ RXO-4 units) → `dosageInstruction.doseAndRate.doseRange`,
    RXR-1/2/4 → `dosageInstruction.route`/`.site`/`.method`, RXO-11/12 → `dispenseRequest.quantity`,
    RXO-13 → `dispenseRequest.numberOfRepeatsAllowed`, ORC-9 → `authoredOn`. Doses/dispense amounts
    carry the magnitude **precision-exact** and gate units against UCUM (a non-UCUM unit is preserved
    verbatim, `code`/`system` absent + flagged) — never a rescaled magnitude or a fabricated UCUM code.
  - **The fail-safes (never a confident wrong request).** A `ServiceRequest.status` that cannot be
    grounded — an ORC-1 in the IG's HL70119 `(unmapped)` group, or a valued ORC-5 the IG routes through
    an unspecified mapping — is left absent + flagged (`TRANSFORM_CODE_UNMAPPED`) and the required-`status`
    emit gate **withholds** the request rather than guessing. The IG grounds **no** `MedicationRequest`
    status, so it is set to the value-set's own `unknown` (an honest "not known", asserting nothing) +
    flagged (`TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`) — the `request-status` codes the HL70119 table yields
    (`revoked`, …) are **not** valid `medicationrequest-status` codes and are never borrowed. **`RXE` has
    no IG segment map (nor RDE message map) in STU1**, so any `RXE` is flagged (`TRANSFORM_ELEMENT_DROPPED`)
    rather than assembled from a guessed layout, and non-`ORM^O01`/`OML^O21` order families (`OMP`, `OMG`,
    `RDE`, …) are flagged `TRANSFORM_SEGMENT_ASSEMBLED`.
  - New public export: **`REQUEST_STATUS_MAP`** (HL70119 → request-status) and
    **`IG_MAPPED_ORDER_TRIGGERS`**.
- **Phase 3 — ORU^R01 → DiagnosticReport + Observation, the results graph** (roadmap §Phase 3).
  `toFhir(msg, opts?)` now assembles a parsed HL7 v2 **ORU^R01** message into a FHIR R4 message
  `Bundle` carrying a **`DiagnosticReport`** per OBR with its **`Observation`** results, alongside the
  Phase-2 `Patient`/`Encounter`. Every segment/field/table map is grounded firsthand on the published
  HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1) ConceptMaps and cited in-source.
  - **OBR → `DiagnosticReport`** (IG _Segment OBR to DiagnosticReport_): OBR-2/3 → `identifier`
    (PLAC/FILL, v2-0203), OBR-4 → `code`, OBR-7/8 → `effectiveDateTime`/`effectivePeriod`, OBR-22 →
    `issued` (a zoned `instant` only; a naked/date-only value is dropped + flagged), OBR-24 →
    `category` (v2-0074), OBR-25 → `status` via the `HL70123` → diagnostic-report-status ConceptMap
    (`DIAGNOSTIC_REPORT_STATUS_MAP`), and the OBX children → `result` references.
  - **OBX → `Observation`** (IG _Segment OBX to Observation_): **OBX-2 discriminates OBX-5 →
    `value[x]`** (NM → `valueQuantity`, CWE/CE/CF/CNE/IS → `valueCodeableConcept`, SN → structured
    `valueQuantity`/`valueRange`/`valueRatio`, ST/TX/FT → `valueString`; a type with no first-class
    target preserves the raw value as `valueString` + flags it — never a fabricated `Quantity`), OBX-3
    → `code`, OBX-6 → `valueQuantity` units (UCUM-gated), OBX-7 → `referenceRange.text`, OBX-8 →
    `interpretation` via the `HL70078` ConceptMap (`HL70078_INTERPRETATION_CODES`), OBX-11 → `status`
    via the `HL70085` → observation-status ConceptMap (`OBSERVATION_STATUS_MAP`), OBX-14 →
    `effectiveDateTime`.
  - **The "never a confident wrong result" fail-safes.** A **corrected (`C`) / cancelled (`X`)** result
    is modelled exactly and **never emitted as `final`**; an OBX-11/OBR-25 status the IG map has **no
    target** for leaves `status` absent + flagged (`TRANSFORM_CODE_UNMAPPED`) and the required-`status`
    emit gate **withholds** the resource (`TRANSFORM_RESOURCE_INVALID`) rather than guessing; an
    **unrecognized abnormal flag** is surfaced and dropped, never coerced to normal; a numeric
    magnitude is carried through **precision-exact** (read from the raw OBX-5, not a lossy JS `number`).
  - New public surface: `IG_MAPPED_ORU_TRIGGERS`, `DIAGNOSTIC_REPORT_STATUS_MAP`,
    `OBSERVATION_STATUS_MAP`, `HL70078_INTERPRETATION_CODES`. No new issue codes — the existing
    `TRANSFORM_CODE_UNMAPPED` now also covers a table code with no IG-ConceptMap target (its message was
    generalized accordingly), and `TRANSFORM_ELEMENT_DROPPED` covers a deferred richer `value[x]` type.
- **Phase 2 — ADT → Patient + Encounter, the first message-level assembly** (roadmap §Phase 2). The
  top-level entry `toFhir(msg, opts?)` assembles a parsed HL7 v2 **ADT** message into a FHIR R4
  **message `Bundle`** (a `MessageHeader` first, then the focal resources), establishing the
  message-map → resource-graph pattern later phases reuse. Every segment→resource and field→element
  map is grounded firsthand on the published HL7 v2-to-FHIR IG (`hl7.fhir.uv.v2mappings`, STU1)
  ConceptMaps and cited in-source.
  - **PID → `Patient`** (IG _Segment PID to Patient_): PID-3 → `identifier` (via `toFhirIdentifier`),
    PID-5 → `name`, PID-7 → `birthDate` (reduced to `date` precision; a birth time is dropped +
    flagged), PID-8 → `gender` via the `HL70001` → administrative-gender ConceptMap
    (`ADMINISTRATIVE_GENDER_MAP`; an unmapped sex code leaves `gender` absent, never guessed),
    PID-11 → `address`.
  - **PV1 → `Encounter`** (IG _Segment PV1 to Encounter_ + both `HL70004` tables): PV1-2 → `class` via
    `HL70004` → V3 ActCode (`ENCOUNTER_CLASS_V3_MAP`; the self-mapped classes stay in v2-0004), PV1-2/
    PV1-45 → `status` via `HL70004` → Encounter Status (`ENCOUNTER_STATUS_MAP`; a valued discharge is
    `finished`), PV1-19 → `identifier` (type `VN`), PV1-44/45 → `period`. `Encounter.subject` is wired
    to the bundle Patient.
  - **NK1 → `RelatedPerson`** (IG _Segment NK1 to RelatedPerson_): NK1-2 → `name`, NK1-3 →
    `relationship`, NK1-4 → `address`, `patient` wired to the bundle Patient.
  - **MSH → `MessageHeader`** + the `Bundle` envelope: MSH-9 → `eventCoding` (v2-0003), MSH-3 →
    `source` (the required-but-underivable `source.endpoint` URL is emitted with a `data-absent-reason`
    extension, never fabricated), MSH-7 → `Bundle.timestamp` (only a fully-zoned instant qualifies),
    MSH-10 → `Bundle.identifier`; `MessageHeader.focus` and every intra-bundle reference wire to
    `urn:uuid:` fullUrls that always resolve within the bundle.
  - **Two message-level fail-safes.** A non-IG-mapped trigger is assembled from the reusable segment
    maps and flagged `TRANSFORM_SEGMENT_ASSEMBLED` (never a fabricated message map); every produced
    resource passes a **conservative-emit gate** against `@cosyte/fhir.validateResource` (`Patient`
    strict against the built-in schema; the other types against minimal required-cardinality schemas
    in lenient mode) and a structurally-invalid one — e.g. an Encounter with no `class`/`status` from
    an unmapped patient class — is withheld + flagged `TRANSFORM_RESOURCE_INVALID`, never shipped invalid.
  - New public surface: `toFhir`, `TransformResult`, `IG_MAPPED_ADT_TRIGGERS`, and the exported table
    maps. New **additions-only** issue codes: `TRANSFORM_SEGMENT_ASSEMBLED`, `TRANSFORM_RESOURCE_INVALID`,
    `TRANSFORM_REQUIRED_ELEMENT_UNKNOWN`. `TransformOptions` gains `namingSystem` and a `generateId`
    allocator (for reproducible fullUrls). Property + fuzz coverage over the message boundary
    (never-throw, value-free registered issues, references resolve, every Patient validates strict).
- **Phase 1 — the datatype foundation + the value-free diagnostic channel** (roadmap §Phase 1).
  `@cosyte/transform` is the HL7 v2 → FHIR R4 **transformation** tier (a consumer of `@cosyte/hl7` +
  `@cosyte/fhir`), not a parser. Every mapping is grounded firsthand on the published HL7 v2-to-FHIR
  Implementation Guide (`hl7.fhir.uv.v2mappings`, STU Edition 1) datatype/table ConceptMaps.
  - The six safety-critical datatype converters, each fail-safe and IG-grounded:
    `toFhirDateTime` (DTM/TS → `dateTime`; a timezone-less time is reduced to date precision, never a
    guessed UTC), `toFhirIdentifier` (CX → `Identifier`; the assigning authority resolves via a
    NamingSystem registry, **never** synthesized from HD.1 alone), `toFhirCodeableConcept` (CWE/CE →
    `CodeableConcept`; an unmapped code is preserved + flagged, never coerced),
    `toFhirHumanName` (XPN → `HumanName`; HL70200 → name-use), `toFhirAddress` (XAD → `Address`; the
    value-conditional XAD.7 split over HL70190 → address-use/type), `toFhirQuantity` (NM + units →
    `Quantity`; magnitude carried precision-exact, non-UCUM unit preserved verbatim, never converted).
  - The `OperationOutcome`-shaped, **value-free** diagnostic channel: `TransformIssue`, the stable
    `ISSUE_CODES` + `FATAL_CODES` registries (`key === value`; renaming/removing one is breaking),
    the `issue` factory, and `toOperationOutcome(issues)`.
  - The minimal NamingSystem resolver: `createNamingSystem`, `DEFAULT_V2_CODE_SYSTEMS`,
    `V2_0203_SYSTEM` — HD → `Identifier.system` (safe OID/UUID auto-derivation only) and v2 Table 0396
    mnemonic → canonical URI (FHIR-core-fixed systems only; full THO crosswalk deferred to Phase 6).
  - Property + fuzz coverage over the datatype boundary (never-throw, registered value-free issues,
    and an emit gate against `@cosyte/fhir.validateResource`).
- **`@cosyte/hl7` + `@cosyte/fhir` as peer dependencies**, consumed as vendored `pnpm pack` tarballs
  in `vendor/` for dev/test (ADR 0001 + umbrella ADR 0008), with `scripts/vendor-refresh.sh`. Pinned
  sibling commits: `@cosyte/hl7` `46d50eb`, `@cosyte/fhir` `7a099b2`. **Third-party runtime deps: 0.**
- Two architecture ADRs (`documentation/decisions/`): `0001` — the transformation tier may depend on
  the parser tier; third-party runtime deps stay zero. `0002` — terminology is a separate
  `@cosyte/terminology` sibling; value translation is BYO-ConceptMap.

### Changed

- **CI-REQUIRED-CHECKS: the build checks now BIND on `main`, and DEPENDABOT-PR-QUEUE: dependencies
  are watched.** Until `PUBLIC-SURFACE-HYGIENE` (#11) this repo had **no ruleset at all**; that
  change created `19914044` requiring exactly one context, `no-internal-refs`. The result is the
  shape worth naming: **a repo can have a ruleset and still not bind its build.** `ci / verify` on
  both matrix legs, `ci / actionlint` and `codeql / analyze` all stayed advisory, so any of them
  could be red and the merge would still land on the branch that publishes. The four contexts are
  now **folded into `19914044`** (renamed `ci-required-checks`) rather than added as a second
  ruleset, deliberately: `ncpdp` is the cautionary case, where a correctly pinned base ruleset sat
  beside two later rulesets that pinned nothing and the repo read as "pinned" because one of its
  rulesets was. One ruleset per repo is one place to audit. Final state, read back live: five
  contexts, each pinned to `integration_id: 15368`; `bypass_actors: []`; `~DEFAULT_BRANCH`; plus
  `deletion` and `non_fast_forward`.
  - **The context names were read off real check runs**, never off a workflow `name:` field.
    Provenance stated exactly, because "two heads" is not true of all five: the four build contexts
    were read off **two** independent `pull_request` heads (`66715e5b`, head of #11; `460bfcf8`,
    head of #7); `no-internal-refs` could only be read off `66715e5b`, since `460bfcf8` predates the
    workflow that emits it. All five were then confirmed together on this change's own PR (#12,
    first head `57a62b2`), which read `BLOCKED` until they landed and `CLEAN` after, on that head
    and on every later one. The
    workflow named `Public-surface gate` emits the context `no-internal-refs`, and requiring a name
    nothing emits leaves every PR **pending**, not failing, forever. `scorecard / analysis` and
    `release / release` are excluded because neither has a `pull_request` trigger; the Advanced
    Security `CodeQL` check (app `57789`) is excluded because it reports **alert state**, not
    whether the analysis ran. No workflow here carries a `paths:` filter.
  - **What the ruleset still does not protect, measured rather than asserted.** A required _job_
    gates its _steps_, but the suites that job runs are chosen by the `include` glob in
    `vitest.config.ts`, and the shared `@cosyte/vitest-config` sets no `test.include` of its own, so
    that line decides today. It is not the only lever: the `test`/`test:coverage` script bodies in
    `package.json` are plain `vitest run` invocations, and a path argument or `--exclude` added
    there drops suites without touching the glob. Narrow either and
    `test/messages/property.test.ts` stops running with the job green. Coverage is a thin,
    incidental backstop: excluding that one file takes
    `src/messages/**` branch coverage from **90.11% to 88.82%**, breaching the `>= 90` gate, so the
    deletion is caught today, by 1.29 points, over the incidental fact that the property run is the
    only thing reaching some branches, and never for the loss of the properties themselves. Banners
    on `ci.yml` and `vitest.config.ts` say so.
  - **The cost, expected and measured.** Requiring a context blocks any open PR that cannot emit it.
    **PR #10 ("Version Packages", head `2996df7`) has zero check runs and reports `BLOCKED`**, and it is
    the structural case, since Changesets opens it as `github-actions[bot]` on the default
    `GITHUB_TOKEN` and GitHub starts no workflow runs for that token's events. The escape (one empty
    commit onto `changeset-release/main`) is written on `release.yml`; a bypass actor is refused.
  - **`.github/dependabot.yml` added** (weekly `npm` + `github-actions`, limit 5, dev-dependency
    group). Zero open Dependabot PRs here meant nothing was looking. Two limits are stated in the
    file rather than left to be discovered: `dependabot_security_updates` reads `disabled` on this
    repo, so an advisory opens no fix PR; and Dependabot resolves neither the `file:vendor/*.tgz`
    specifiers nor a peer dependency's registry move, so **both routes to `@cosyte/hl7` and
    `@cosyte/fhir` are unwatched** and stay a `pnpm vendor:refresh` job by hand. Whether the pnpm
    updater tolerates that `file:` shape at all is recorded as unobserved.
  - **Nothing inside this repo can observe its own ruleset.** Delete it and the suite stays green,
    `verify.sh` stays green, and the docs keep asserting protection. `CLAUDE.md` gained a "Branch
    protection (and the limits of this claim)" section that says so and gives the `gh api` calls,
    including `?includes_parents=true`, because checking one ruleset is how `ncpdp` was missed.
  - **The changeset for this entry is deliberately not consumer-facing.** None of the above is
    observable by someone installing the package, so its headline names `CodeQL`, `actionlint` and
    `Dependabot`, which the shared `cosyte/.github` release-note renderer classifies as internal-only
    and **drops from the published release body** rather than rewording into it. Verified by running
    that renderer's `collectHeadlines` over this repo's eight pending changesets: seven kept, this
    one dropped. Recorded because the earlier wording said the same thing in words the classifier
    does not know, and would have published it.
  - **Also noted, not fixed here:** three of the five required names
    (`ci / verify (22|24, ubuntu-latest)`, `ci / actionlint`) are produced by the DEFAULT inputs of
    `cosyte/.github/.github/workflows/ci.yml@main`, a different repo on a floating ref. Changing a
    default there strands every PR in every repo pinning this set. Fails closed, ecosystem-wide,
    and written into `CLAUDE.md`.
- **PUBLIC-SURFACE-HYGIENE: internal project bookkeeping removed from every surface a consumer
  reads, and a gate added under it.** Founder directive, 2026-07-27: a README, a docs page, an npm
  description, a JSDoc block a consumer's editor renders, and a message their log prints say what
  the software does and what changed, never which internal item, phase or roadmap section produced
  it. Measured on `e6c4531` with the rule set that ships in this change, because a count taken
  against different rules is a different count: **32** violating lines across the public markdown
  surface (`README.md`, `docs-content/intro.md`, `concepts-archetype.md`, `quickstart.md`,
  `guides-overview.md`, `troubleshooting.md`, all of them "Phase N" framing; **zero** item
  identifiers, and zero on the npm metadata) and **54** `src/` doc-comment lines plus **29** blocks
  that matched only once reflowed across their line wraps. The built `dist/index.d.ts` went from
  **45** violating lines to **0**, and `dist/index.d.cts` and the ESM/CJS bundles with it.
  Separately, and **not** found by any rule: one runtime message string, where
  `TRANSFORM_ELEMENT_DROPPED` told a reader an element's conversion was "deferred to a later phase".
  It ends its clause at `phase`, which is the shape the rules deliberately do not cover, so it was a
  reviewer catch. **51** `src/` doc-comment lines carried a roadmap-section citation
  (`(roadmap §4.5)`, `(roadmap §Phase 5)`, or the bare `(§4.7)`) and were cleared by hand; 23 of
  those overlap the 54 counted above, so the union of the two sweeps is 82 lines, not 105. Of the
  51 citations, 20 name the roadmap explicitly and a rule now catches them, 4 read `§Phase N` and
  are caught by the ordinary phase rule, and the remaining **28** are bare section numbers that
  nothing guards; that non-catch is deliberate and its reasoning is recorded in the script. Two `§`
  citations remain in `//` comments, which this convention keeps out of scope.
- **`pnpm check:no-internal-refs` + its own CI workflow now gate that rule.** Four passes over the
  README, `LICENSE`, `docs-content/`, the npm `description`/`keywords`, `src/` doc comments and
  `src/` string literals, each scanned line by line and again paragraph-joined so a violation that
  straddles a line wrap cannot hide. It is `hl7`'s gate ported shape-first, with `ncpdp`'s
  string-literal fourth pass; the prefix list is `hl7`'s character for character, and the three rule
  widenings on top of it (`phases?`, `/` in the ADR separator, `roadmap §N`) are each named in the
  script and pinned by their own self-test. **The gate raises the floor; it does not seal the
  category,** and the script writes down thirteen numbered residuals plus the boundaries stated at
  each pass, rather than implying otherwise. The four worth knowing here: `phase` ending a clause
  ("deferred to a later phase);") is not covered; a bare `(§4.7)` is a deliberate non-catch; a doc
  comment that does not open its own line is invisible to the doc-comment extractor (residual (xi),
  inherited from `hl7`) and a violation split across a template literal's line breaks is invisible
  to the string-literal extractor (stated at that pass, which comes from `ncpdp` rather than `hl7`),
  neither of them reachable on this tree today; and prose about our process stays a reviewer's
  catch. `CHANGELOG.md` is excluded on purpose even though it ships inside the npm
  tarball: this convention names it as one of the places identifiers belong. That contradiction is
  ecosystem-wide and is recorded rather than settled here.
- **Replaced the parser-template scaffold** with the transformation shape: removed the placeholder
  `parseTransform` / `WARNING_CODES` / `FATAL_CODES` parser stubs and the round-trip property test;
  rewrote `docs-content/`, `README`, and this repo's `CLAUDE.md` for the transformation library.

### Fixed

- **The README no longer says this package is unpublished.** It is on npm, and the sentence sat a
  few lines above the page's own `npm install` instructions, so the page contradicted itself and a
  reader had no way to tell which half was current. On the npm page it was worse: the same sentence
  rendered directly beneath npm's own header, which shows the version being served. The replacement
  names no version deliberately. A version written into prose is the part that goes stale, and the
  registry is the only thing that knows which one is current.

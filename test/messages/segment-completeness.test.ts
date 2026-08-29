/**
 * The message-level completeness diagnostic: what the bundle did NOT represent, told once per
 * segment occurrence, value-free, and without moving a single resource or existing issue.
 *
 * Every input here is recorded in `test/_support/completeness-fixtures.ts` and every baseline in
 * `test/_support/completeness-goldens.json`, captured from the tree as it stood before this
 * diagnostic existed. Two assertions run over the whole corpus and are the reason the baselines
 * exist: the Bundle each input produces is byte-identical to the one it produced then, and every
 * issue the library already raised is still there, first, in the order it raised it.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";

import {
  ISSUE_CODES,
  ISSUE_REGISTRY,
  IG_MAPPED_SEGMENT_NAMES,
  IG_SEGMENT_MAPS_PUBLISHED,
  IG_SEGMENT_MAPS_RETRIEVED,
  IG_SEGMENT_MAPS_SOURCE,
  IG_SEGMENT_MAPS_VERSION,
  SegmentReachLedger,
  enumerateSegmentOccurrences,
  fhirIssueTypeFor,
  isIgMappedSegmentName,
  isWellFormedSegmentName,
  segmentOccurrenceLocation,
  toFhir,
  toOperationOutcome,
  createNamingSystem,
  type IssueCode,
  type TransformIssue,
  type TransformResult,
} from "../../src/index.js";
import {
  COMPLETENESS_FIXTURES,
  UNIQUE_FIELD_TOKENS,
  fixtureRaw,
  runCompletenessFixture,
} from "../_support/completeness-fixtures.js";

const LIBRARY_GAP = ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED;
const STANDARD_GAP = ISSUE_CODES.TRANSFORM_SEGMENT_NO_IG_MAP;
const NEW_CODES: ReadonlySet<string> = new Set([LIBRARY_GAP, STANDARD_GAP]);

/**
 * The recorded inputs whose baseline this tree has since **superseded**, with the change that did
 * it. The baselines in `completeness-goldens.json` are a capture of one commit and are never
 * recaptured: recapturing from a tree that already carries the change would launder the very
 * evidence they exist to be. So a later change that legitimately alters what one of these inputs
 * produces is declared here instead, and the two whole-corpus baseline assertions below prove the
 * difference is exactly that change rather than skipping the input.
 *
 * `AL1` to `AllergyIntolerance` is the first such change: an AL1 that used to reach nothing now
 * builds a resource, so every input carrying one gains an entry, and the entries after it shift by
 * one identity. Nothing else about these inputs moved, and that is what is asserted.
 */
const ALLERGY_SUPERSEDED: ReadonlyMap<string, string> = new Map([
  ["ig-mapped-unhandled", "its AL1 now becomes an AllergyIntolerance"],
  ["eleven-silent-segments", "its AL1 now becomes an AllergyIntolerance"],
  ["unique-field-tokens", "its AL1 now becomes an AllergyIntolerance"],
]);

interface RawBundleEntry {
  fullUrl?: string;
  resource?: { resourceType?: string; focus?: { reference?: string }[] };
}

/**
 * The same bundle with every `AllergyIntolerance` entry, and every reference to one, removed: what
 * the input produced before this library read AL1 at all.
 */
function withoutAllergies(bundleJson: string): string {
  const bundle = JSON.parse(bundleJson) as { entry?: RawBundleEntry[] };
  const all = bundle.entry ?? [];
  const removed = new Set(
    all
      .filter((e) => e.resource?.resourceType === "AllergyIntolerance")
      .map((e) => e.fullUrl ?? ""),
  );
  if (removed.size === 0) return bundleJson;
  const kept = all.filter((e) => !removed.has(e.fullUrl ?? ""));
  for (const entry of kept) {
    const focus = entry.resource?.focus;
    if (entry.resource !== undefined && focus !== undefined) {
      entry.resource.focus = focus.filter((f) => !removed.has(f.reference ?? ""));
    }
  }
  bundle.entry = kept;
  return JSON.stringify(bundle);
}

/**
 * The same bundle with its `urn:uuid:` identities renumbered by order of first appearance, so two
 * bundles that differ only in how many identities were minted before each one still compare. The
 * identities are opaque by construction; their VALUES carry no meaning to preserve here, only their
 * agreement between a reference and the entry it points at, which renumbering keeps exactly.
 */
function canonicalIdentities(bundleJson: string): string {
  const seen = new Map<string, string>();
  return bundleJson.replace(/urn:uuid:[0-9a-fA-F-]+/g, (id) => {
    const already = seen.get(id);
    if (already !== undefined) return already;
    const token = `urn:uuid:#${String(seen.size + 1)}`;
    seen.set(id, token);
    return token;
  });
}

/** Whether `sub` appears in `all` in order, with anything at all between the entries. */
function isSubsequence(sub: readonly string[], all: readonly string[]): boolean {
  let i = 0;
  for (const item of all) if (i < sub.length && item === sub[i]) i++;
  return i === sub.length;
}

interface GoldenIssue {
  readonly code: string;
  readonly severity: string;
  readonly v2Location: string;
  readonly fhirPath?: string;
}
interface GoldenFile {
  readonly capturedAtCommit: string;
  readonly fixtures: Readonly<
    Record<string, { readonly bundle: string; readonly issues: readonly GoldenIssue[] }>
  >;
}

const GOLDENS = JSON.parse(
  readFileSync(new URL("../_support/completeness-goldens.json", import.meta.url), "utf8"),
) as GoldenFile;

function run(id: string): TransformResult {
  return runCompletenessFixture(fixtureRaw(id));
}

/** Only the issues this change introduces, in the order the transform emitted them. */
function added(result: TransformResult): readonly TransformIssue[] {
  return result.issues.filter((i) => NEW_CODES.has(i.code));
}

/** `CODE@location` for each new issue: the shape every expectation below is written in. */
function addedLabels(result: TransformResult): string[] {
  return added(result).map((i) => `${i.code}@${i.v2Location}`);
}

/** Everything a consumer could read the issues out of: the list itself and its rendered form. */
function renderedText(result: TransformResult): string {
  return JSON.stringify(result.issues) + serializeResource(toOperationOutcome(result.issues));
}

function goldenFor(id: string): { bundle: string; issues: readonly GoldenIssue[] } {
  const g = GOLDENS.fixtures[id];
  if (g === undefined) throw new Error(`no captured baseline for fixture ${id}`);
  return { bundle: g.bundle, issues: g.issues };
}

// ── The rendering guard, with no message at all (AC-30) ─────────────────────────────────────────

describe("well-formedness is a shape test on the name value itself", () => {
  it("admits exactly one of the six values a damaged line can publish", () => {
    const table: readonly (readonly [string, boolean])[] = [
      ["", false],
      ["<withheld>", false],
      ["DOE^JOHN^Q", false],
      ["202", false],
      ["AL11", false],
      ["ZAL", true],
    ];
    for (const [value, wellFormed] of table) {
      expect([value, isWellFormedSegmentName(value)]).toEqual([value, wellFormed]);
    }
  });

  it("refuses a lowercase, a four-character and a leading-digit name, and accepts a digit tail", () => {
    expect(isWellFormedSegmentName("pid")).toBe(false);
    expect(isWellFormedSegmentName("PIDX")).toBe(false);
    expect(isWellFormedSegmentName("1ID")).toBe(false);
    expect(isWellFormedSegmentName("AL1")).toBe(true);
    expect(isWellFormedSegmentName("Z01")).toBe(true);
  });

  it("is decided by no marker literal anywhere in the shipped source", () => {
    // An exclusion of the parser's own marker would pass every message-level fixture in this file
    // while admitting any seventh value the parser might publish, and would couple this library to
    // one release of a package whose peer range admits all of them.
    const marker = ["<", "withheld", ">"].join("");
    for (const file of [
      "../../src/messages/segment-completeness.ts",
      "../../src/messages/to-fhir.ts",
      "../../src/messages/ig-segment-maps.ts",
      "../../src/diagnostics/codes.ts",
      "../../src/diagnostics/issue.ts",
    ]) {
      const text = readFileSync(new URL(file, import.meta.url), "utf8");
      expect([file, text.includes(marker)]).toEqual([file, false]);
    }
  });
});

// ── The transcribed IG mapped-name set (AC-18, AC-21) ───────────────────────────────────────────

describe("the IG mapped-name set, transcribed once and asserted as hand-written literals", () => {
  it("records the guide version, its publication date, the retrieval date and the source", () => {
    expect(IG_SEGMENT_MAPS_VERSION).toBe("1.0.0");
    expect(IG_SEGMENT_MAPS_PUBLISHED).toBe("2025-10-07");
    expect(IG_SEGMENT_MAPS_RETRIEVED).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(IG_SEGMENT_MAPS_SOURCE).toBe("https://hl7.org/fhir/uv/v2mappings/segment_maps.html");
  });

  it("is exactly the thirty-three names read off the Segment Maps index", () => {
    // Written out by hand at transcription time, chapter by chapter, so a later regeneration that
    // changed a name fails here instead of silently agreeing with itself.
    expect([...IG_MAPPED_SEGMENT_NAMES].sort()).toEqual([
      "AIG",
      "AIL",
      "AIP",
      "AIS",
      "AL1",
      "DG1",
      "EVN",
      "IAM",
      "IN1",
      "IN3",
      "MRG",
      "MSA",
      "MSH",
      "NK1",
      "NTE",
      "OBR",
      "OBX",
      "ORC",
      "PD1",
      "PID",
      "PR1",
      "PRT",
      "PV1",
      "PV2",
      "ROL",
      "RXA",
      "RXO",
      "RXR",
      "SCH",
      "SFT",
      "SPM",
      "TQ1",
      "TXA",
    ]);
  });

  it("classifies every name the criteria name, as a literal expectation per name", () => {
    // The eleven silent names, the two absences a reader is most likely to check, the names no
    // manifest file mentions, and two Z-segments. Each expected value is written here by hand.
    const expected: readonly (readonly [string, boolean])[] = [
      ["AL1", true],
      ["IAM", true],
      ["DG1", true],
      ["PR1", true],
      ["IN1", true],
      ["IN3", true],
      ["SPM", true],
      ["PRT", true],
      ["ROL", true],
      ["SFT", true],
      ["EVN", true],
      ["OBX", true],
      ["PV2", true],
      ["MRG", true],
      ["TXA", true],
      ["RXA", true],
      ["PD1", true],
      ["GT1", false],
      ["RXE", false],
      ["ZAL", false],
      ["ZQQ", false],
    ];
    for (const [name, mapped] of expected) {
      expect([name, isIgMappedSegmentName(name)]).toEqual([name, mapped]);
    }
  });
});

// ── The ledger on its own, including the marks that select nothing ──────────────────────────────

describe("the reach ledger", () => {
  it("reports every occurrence when nothing is marked, in message order", () => {
    const ledger = new SegmentReachLedger(parseHL7(fixtureRaw("three-dg1")));
    expect(ledger.reportable().map(segmentOccurrenceLocation)).toEqual([
      "MSH[1]",
      "PID[1]",
      "DG1[1]",
      "DG1[2]",
      "DG1[3]",
    ]);
    expect(ledger.issues().map((i) => i.v2Location)).toEqual([
      "MSH[1]",
      "PID[1]",
      "DG1[1]",
      "DG1[2]",
      "DG1[3]",
    ]);
  });

  it("ignores an undefined segment and a mark for a name or index the message does not carry", () => {
    const ledger = new SegmentReachLedger(parseHL7(fixtureRaw("three-dg1")));
    ledger.mark(undefined);
    ledger.markFirstOfType("ZZZ");
    ledger.markNthOfType("DG1", 9);
    ledger.markNthOfType("ZZZ", 0);
    expect(ledger.reportable()).toHaveLength(5);
  });

  it("marks the nth occurrence of a name, counted among that name's occurrences only", () => {
    const ledger = new SegmentReachLedger(parseHL7(fixtureRaw("three-dg1")));
    ledger.markNthOfType("DG1", 1);
    expect(ledger.reportable().map(segmentOccurrenceLocation)).toEqual([
      "MSH[1]",
      "PID[1]",
      "DG1[1]",
      "DG1[3]",
    ]);
  });
});

// ── Enumeration: which positions become occurrences at all (AC-29) ──────────────────────────────

describe("enumeration excludes a position that carries no segment, wherever it sits", () => {
  it("skips a message-internal blank line and still counts it toward later ordinals", () => {
    const occurrences = enumerateSegmentOccurrences(
      parseHL7(fixtureRaw("blank-line-then-malformed")),
    );
    expect(occurrences.map((o) => o.ordinal)).toEqual([1, 2, 4]);
    expect(occurrences.map(segmentOccurrenceLocation)).toEqual(["MSH[1]", "PID[1]", "[#4]"]);
  });

  it("skips a trailing empty position produced by a doubled terminator", () => {
    const occurrences = enumerateSegmentOccurrences(
      parseHL7(fixtureRaw("all-reaching-doubled-terminator")),
    );
    expect(occurrences.map(segmentOccurrenceLocation)).toEqual(["MSH[1]", "PID[1]", "PV1[1]"]);
  });

  it("keeps a position that carries field content even when its name is empty", () => {
    const occurrences = enumerateSegmentOccurrences(parseHL7(fixtureRaw("separator-leading-line")));
    expect(occurrences.map(segmentOccurrenceLocation)).toEqual(["MSH[1]", "PID[1]", "[#3]"]);
  });

  it("keeps a damaged line that carries no field separator at all", () => {
    const occurrences = enumerateSegmentOccurrences(
      parseHL7(fixtureRaw("separator-free-malformed")),
    );
    expect(occurrences.map(segmentOccurrenceLocation)).toEqual(["MSH[1]", "PID[1]", "[#3]"]);
  });

  it("numbers repeats of one name 1-based among all occurrences of that name", () => {
    const occurrences = enumerateSegmentOccurrences(parseHL7(fixtureRaw("three-dg1")));
    expect(occurrences.filter((o) => o.name === "DG1").map(segmentOccurrenceLocation)).toEqual([
      "DG1[1]",
      "DG1[2]",
      "DG1[3]",
    ]);
  });
});

// ── The trigger predicate and the two codes ─────────────────────────────────────────────────────

describe("a segment the IG maps that reached nothing is a library gap", () => {
  it("reports the DG1 the assembly never reads, and not the AL1 it now emits", () => {
    // The AL1 of this input became an AllergyIntolerance in the bundle, so it reached a resource
    // and is no longer a gap. The DG1 still reaches nothing and still reports.
    expect(addedLabels(run("ig-mapped-unhandled"))).toEqual([`${LIBRARY_GAP}@DG1[1]`]);
  });

  it("reports an ADT OBX although the library emits Observation on another path", () => {
    expect(addedLabels(run("adt-obx"))).toEqual([`${LIBRARY_GAP}@OBX[1]`]);
  });

  it("reports the ten names the assembly still never reads, in message order", () => {
    // Ten of the eleven: the AL1 of this input now reaches an AllergyIntolerance. The IAM beside it
    // does not, and is the one the guide maps and this library still does not build.
    expect(addedLabels(run("eleven-silent-segments"))).toEqual([
      `${LIBRARY_GAP}@SFT[1]`,
      `${LIBRARY_GAP}@EVN[1]`,
      `${LIBRARY_GAP}@IAM[1]`,
      `${LIBRARY_GAP}@DG1[1]`,
      `${LIBRARY_GAP}@PR1[1]`,
      `${LIBRARY_GAP}@IN1[1]`,
      `${LIBRARY_GAP}@IN3[1]`,
      `${LIBRARY_GAP}@SPM[1]`,
      `${LIBRARY_GAP}@PRT[1]`,
      `${LIBRARY_GAP}@ROL[1]`,
    ]);
  });

  it("raises one issue per occurrence and never collapses repeats", () => {
    expect(addedLabels(run("three-dg1"))).toEqual([
      `${LIBRARY_GAP}@DG1[1]`,
      `${LIBRARY_GAP}@DG1[2]`,
      `${LIBRARY_GAP}@DG1[3]`,
    ]);
  });
});

describe("a name the IG publishes no map for, or none that could be classified, is a standard gap", () => {
  it("separates a Z-segment from three damaged identifiers, and reproduces none of them", () => {
    const result = run("unclassifiable-names");
    expect(addedLabels(result)).toEqual([
      `${STANDARD_GAP}@ZAL[1]`,
      `${STANDARD_GAP}@[#4]`,
      `${STANDARD_GAP}@[#5]`,
      `${STANDARD_GAP}@[#6]`,
    ]);
    expect(added(result).every((i) => i.code !== LIBRARY_GAP)).toBe(true);

    const text = renderedText(result);
    for (const forbidden of ["DOE", "JOHN", "DOE^JOHN^Q", "202[", "AL11", "20260721143000"]) {
      expect([forbidden, text.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("reports a damaged line with no field separator at all, positionally", () => {
    const result = run("separator-free-malformed");
    expect(addedLabels(result)).toEqual([`${STANDARD_GAP}@[#3]`]);
    expect(renderedText(result)).not.toContain("202[");
  });

  it("reports a line whose identifier was eaten but whose data survived, and leaks none of it", () => {
    const result = run("separator-leading-line");
    expect(addedLabels(result)).toEqual([`${STANDARD_GAP}@[#3]`]);
    const text = renderedText(result);
    expect(text).not.toContain("SMITH");
    expect(text).not.toContain("JOHN");
  });

  it("never throws on any damaged input", () => {
    for (const id of [
      "unclassifiable-names",
      "separator-free-malformed",
      "separator-leading-line",
    ]) {
      expect(() => run(id)).not.toThrow();
    }
  });
});

// ── Reaching, and the two ways an occurrence can fail to (AC-3, AC-5, AC-13, AC-14, AC-27) ──────

describe("an occurrence that reached an emitted resource raises neither code", () => {
  it("stays silent when every value the occurrence carried was dropped downstream", () => {
    const result = run("consumed-values-dropped");
    expect(added(result)).toEqual([]);
    expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("stays silent whether or not the message is terminated the conventional way", () => {
    for (const id of [
      "all-reaching-terminated",
      "all-reaching-unterminated",
      "all-reaching-doubled-terminator",
    ]) {
      expect([id, addedLabels(run(id))]).toEqual([id, []]);
    }
  });

  it("stays silent on a blank line between two segments that both reach", () => {
    const result = run("blank-line-between-reaching");
    expect(added(result)).toEqual([]);
    expect(result.issues.every((i) => !i.v2Location.startsWith("[#"))).toBe(true);
  });

  it("reports a segment after a blank line, and its ordinal counts the blank", () => {
    expect(addedLabels(run("blank-line-then-named"))).toEqual([`${LIBRARY_GAP}@DG1[1]`]);
    expect(addedLabels(run("blank-line-then-malformed"))).toEqual([`${STANDARD_GAP}@[#4]`]);
  });

  it("emits a MessageHeader for the minimal message, so a bare MSH reports nothing", () => {
    const result = run("bare-msh");
    expect(added(result)).toEqual([]);
    expect(serializeResource(result.bundle)).toContain('"resourceType":"MessageHeader"');
  });
});

describe("read and refused is not reached, and neither is built and then withheld", () => {
  it("reports an RXE the assembly counted, beside the issue that already named it", () => {
    const result = run("orm-read-and-refused");
    expect(addedLabels(result)).toEqual([`${STANDARD_GAP}@RXE[1]`]);
    const dropped = result.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.v2Location === "RXE",
    );
    expect(dropped).toHaveLength(1);
    // The ORC and the RXO built the request that is in the bundle: neither is reported.
    expect(addedLabels(result).some((l) => l.includes("ORC[") || l.includes("RXO["))).toBe(false);
  });

  it("adds a second issue for a second RXE while the count-based issue stays at one", () => {
    const result = run("orm-two-refused");
    expect(addedLabels(result)).toEqual([`${STANDARD_GAP}@RXE[1]`, `${STANDARD_GAP}@RXE[2]`]);
    expect(
      result.issues.filter(
        (i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.v2Location === "RXE",
      ),
    ).toHaveLength(1);
  });

  it("reports an orphan OBX on the library-gap code, beside the issue that already named it", () => {
    const result = run("oru-orphan-obx");
    expect(addedLabels(result)).toEqual([`${LIBRARY_GAP}@OBX[1]`]);
    expect(
      result.issues.filter(
        (i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.v2Location === "OBX",
      ),
    ).toHaveLength(1);
  });

  it("adds a second issue for a second orphan OBX while the count-based issue stays at one", () => {
    const result = run("oru-two-orphan-obx");
    expect(addedLabels(result)).toEqual([`${LIBRARY_GAP}@OBX[1]`, `${LIBRARY_GAP}@OBX[2]`]);
    expect(
      result.issues.filter(
        (i) => i.code === ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED && i.v2Location === "OBX",
      ),
    ).toHaveLength(1);
  });

  it("reports a PV1 whose Encounter the emit gate withheld, beside the withholding issue", () => {
    const result = run("encounter-withheld");
    expect(addedLabels(result)).toEqual([`${LIBRARY_GAP}@PV1[1]`]);
    expect(
      result.issues.some(
        (i) => i.code === ISSUE_CODES.TRANSFORM_RESOURCE_INVALID && i.v2Location === "PV1",
      ),
    ).toBe(true);
  });

  it("reports every occurrence when no resource at all is emitted", () => {
    const result = run("nothing-emitted");
    expect(serializeResource(result.bundle)).not.toContain('"entry"');
    expect(addedLabels(result)).toEqual([`${LIBRARY_GAP}@MSH[1]`, `${LIBRARY_GAP}@DG1[1]`]);
  });

  it("numbers among ALL occurrences of the name, never among the reported ones", () => {
    // Two NK1: the first yields a RelatedPerson in the bundle, the second yields none at all. An
    // implementation numbering the reported occurrences 1..M answers NK1[1] here and passes every
    // other fixture in this file.
    const result = run("two-nk1-second-unbuilt");
    expect(addedLabels(result)).toEqual([`${LIBRARY_GAP}@NK1[2]`]);
    expect(serializeResource(result.bundle).match(/"resourceType":"RelatedPerson"/g)).toHaveLength(
      1,
    );
  });
});

// ── The value-free and single-shape invariants (AC-7, AC-8, AC-12, AC-23, AC-26) ────────────────

describe("the invariants that hold across the whole corpus", () => {
  it("renders every new location as NAME[k] or [#n], and never any other shape", () => {
    const shape = /^(?:[A-Z][A-Za-z0-9]{2}\[\d+\]|\[#\d+\])$/;
    for (const fixture of COMPLETENESS_FIXTURES) {
      for (const i of added(run(fixture.id))) {
        expect([fixture.id, i.v2Location, shape.test(i.v2Location)]).toEqual([
          fixture.id,
          i.v2Location,
          true,
        ]);
      }
    }
  });

  it("raises exactly one new issue per reported occurrence, never two", () => {
    for (const fixture of COMPLETENESS_FIXTURES) {
      const labels = added(run(fixture.id)).map((i) => i.v2Location);
      expect([fixture.id, labels.length]).toEqual([fixture.id, new Set(labels).size]);
    }
  });

  it("carries no field, component or subcomponent value into any issue or its rendering", () => {
    const result = run("unique-field-tokens");
    expect(added(result).length).toBeGreaterThan(0);
    const text = renderedText(result);
    for (const token of UNIQUE_FIELD_TOKENS) {
      expect([token, text.includes(token)]).toEqual([token, false]);
    }
  });

  it("carries the library's standard envelope and nothing message-derived beyond the location", () => {
    const first = added(run("ig-mapped-unhandled"))[0];
    expect(first).toBeDefined();
    const i = first as TransformIssue;
    expect(i.code).toBe(LIBRARY_GAP);
    expect(i.severity).toBe("information");
    expect(i.message).toBe(ISSUE_REGISTRY[LIBRARY_GAP].message);
    expect(i.fhirPath).toBeUndefined();
    expect(i.v2Location).toBe("DG1[1]");

    const rendered = serializeResource(toOperationOutcome([i]));
    expect(rendered).toContain(`"code":"${LIBRARY_GAP}"`);
    expect(rendered).toContain(`"code":"${fhirIssueTypeFor(LIBRARY_GAP)}"`);
    expect(rendered).toContain('"severity":"information"');
    expect(rendered).toContain('"diagnostics":"DG1[1]"');
  });

  it("produces identical issue sequences for identical input bytes", () => {
    const raw = fixtureRaw("unclassifiable-names");
    const a = runCompletenessFixture(raw);
    const b = runCompletenessFixture(raw);
    expect(a.issues).toEqual(b.issues);
    expect(serializeResource(a.bundle)).toBe(serializeResource(b.bundle));
  });

  it("orders the new issues among themselves by the position of their occurrences", () => {
    const result = run("eleven-silent-segments");
    const occurrences = enumerateSegmentOccurrences(parseHL7(fixtureRaw("eleven-silent-segments")));
    const order = new Map(occurrences.map((o) => [segmentOccurrenceLocation(o), o.ordinal]));
    const ordinals = added(result).map((i) => order.get(i.v2Location) ?? -1);
    expect(ordinals).toEqual([...ordinals].sort((x, y) => x - y));
  });

  it("takes the name solely from the parser's published type, never from the raw line", () => {
    // The raw name of the damaged lines is `DOE^JOHN^Q`, `202` and `AL11`; the parser publishes none
    // of those as a type, and the transform never reaches for `raw.name` to recover one.
    const occurrences = enumerateSegmentOccurrences(parseHL7(fixtureRaw("unclassifiable-names")));
    for (const o of occurrences) {
      if (o.name !== undefined) expect(o.name).toBe(o.segment.type);
    }
    const src = readFileSync(
      new URL("../../src/messages/segment-completeness.ts", import.meta.url),
      "utf8",
    );
    expect(src).not.toContain(".raw.name");
    expect(src).not.toContain("rawSegments");
  });
});

// ── The baselines: nothing moved (AC-9, AC-10, AC-24) ───────────────────────────────────────────

describe("the pre-change baselines still hold for every recorded input", () => {
  it("covers every recorded input with a captured baseline, taken at the pinned commit", () => {
    expect(GOLDENS.capturedAtCommit).toBe("13750f18665df32dd3892e01e439a011d29f0352");
    for (const fixture of COMPLETENESS_FIXTURES) {
      expect([fixture.id, GOLDENS.fixtures[fixture.id] !== undefined]).toEqual([fixture.id, true]);
    }
  });

  it("returns the same resources with the same contents for every recorded input", () => {
    for (const fixture of COMPLETENESS_FIXTURES) {
      if (ALLERGY_SUPERSEDED.has(fixture.id)) continue;
      const result = run(fixture.id);
      expect([fixture.id, serializeResource(result.bundle)]).toEqual([
        fixture.id,
        goldenFor(fixture.id).bundle,
      ]);
    }
  });

  it("returns a superseded input's baseline bundle exactly, once its allergies are removed", () => {
    for (const id of ALLERGY_SUPERSEDED.keys()) {
      const produced = withoutAllergies(serializeResource(run(id).bundle));
      expect([id, canonicalIdentities(produced)]).toEqual([
        id,
        canonicalIdentities(goldenFor(id).bundle),
      ]);
    }
  });

  it("keeps every pre-existing issue first, in its recorded order, with the new ones appended", () => {
    for (const fixture of COMPLETENESS_FIXTURES) {
      if (ALLERGY_SUPERSEDED.has(fixture.id)) continue;
      const result = run(fixture.id);
      const baseline = goldenFor(fixture.id).issues;
      const head = result.issues.slice(0, baseline.length).map((i) => {
        const base = {
          code: i.code as string,
          severity: i.severity as string,
          v2Location: i.v2Location,
        };
        return i.fhirPath === undefined ? base : { ...base, fhirPath: i.fhirPath };
      });
      expect([fixture.id, head]).toEqual([fixture.id, [...baseline]]);
      const tail = result.issues.slice(baseline.length);
      expect([fixture.id, tail.every((i) => NEW_CODES.has(i.code))]).toEqual([fixture.id, true]);
    }
  });

  it("keeps every recorded issue of a superseded input, in its recorded order", () => {
    // Reading an AL1 raises the datatype diagnostics of the components it reads, so a superseded
    // input's new issues interleave rather than append. Every recorded one is still there, still in
    // order: none was dropped, replaced or reordered by the resource that now gets built.
    const label = (i: {
      code: string;
      severity: string;
      v2Location: string;
      fhirPath?: string;
    }): string => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}@${i.severity}`;
    for (const id of ALLERGY_SUPERSEDED.keys()) {
      const produced = run(id).issues.map(label);
      expect([id, isSubsequence(goldenFor(id).issues.map(label), produced)]).toEqual([id, true]);
    }
  });

  it("adds exactly the allergy diagnostics to a superseded input, and nothing else", () => {
    // The whole delta, written out rather than characterized, so a later change to it is reviewed.
    const added: Readonly<Record<string, readonly string[]>> = {
      "ig-mapped-unhandled": [`${ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED}@CWE.3`],
      "eleven-silent-segments": [`${ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED}@CWE.3`],
      // Its AL1-2 is a token in no v2 table, so both Table 0127 maps refuse it (one issue each)
      // and the identity map behind the alternate-codes extension refuses it too (the CWE.1 one).
      "unique-field-tokens": [
        `${ISSUE_CODES.TRANSFORM_CODE_SYSTEM_UNRESOLVED}@CWE.3`,
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.2`,
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@CWE.1`,
        `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@AL1.2`,
      ],
    };
    for (const id of ALLERGY_SUPERSEDED.keys()) {
      const recorded = goldenFor(id).issues.map((i) => `${i.code}@${i.v2Location}`);
      const produced = run(id)
        .issues.filter((i) => !NEW_CODES.has(i.code))
        .map((i) => `${i.code}@${i.v2Location}`);
      const delta = [...produced];
      for (const one of recorded) {
        const at = delta.indexOf(one);
        if (at >= 0) delta.splice(at, 1);
      }
      expect([id, delta]).toEqual([id, added[id]]);
    }
  });

  it("never treats a new issue as fatal: the transform still succeeds and still returns a Bundle", () => {
    for (const fixture of COMPLETENESS_FIXTURES) {
      const result = run(fixture.id);
      expect([
        fixture.id,
        serializeResource(result.bundle).startsWith('{"resourceType":"Bundle"'),
      ]).toEqual([fixture.id, true]);
    }
  });
});

// ── The documentation the codes are only usable with (AC-18, AC-28) ─────────────────────────────

describe("the consumer documentation states what a reader needs to read a location correctly", () => {
  const doc = readFileSync(
    new URL("../../docs-content/concepts-archetype.md", import.meta.url),
    "utf8",
  );

  it("names both codes", () => {
    expect(doc).toContain("TRANSFORM_SEGMENT_NOT_EMITTED");
    expect(doc).toContain("TRANSFORM_SEGMENT_NO_IG_MAP");
  });

  it("names the guide version and the retrieval date the mapped-name set came from", () => {
    expect(doc).toContain(IG_SEGMENT_MAPS_VERSION);
    expect(doc).toContain(IG_SEGMENT_MAPS_PUBLISHED);
    expect(doc).toContain(IG_SEGMENT_MAPS_RETRIEVED);
  });

  it("states both index conventions, because two now coexist on one issues list", () => {
    expect(doc).toContain("1-based");
    expect(doc).toContain("0-based");
  });

  it("states that the standard-gap code also covers a name that could not be classified", () => {
    expect(doc.toLowerCase()).toContain("could not be classified");
    expect(doc).toContain("AL11");
  });

  it("states the severity and the FHIR issue type both codes carry", () => {
    expect(doc).toContain("informational");
  });
});

// ── A last cross-check that the diagnostic did not change the assembly (AC-9) ───────────────────

describe("the diagnostic observes the assembly and does not steer it", () => {
  it("produces the same bundle whichever way the caller reaches the transform", () => {
    const raw = fixtureRaw("eleven-silent-segments");
    let n = 0;
    const direct = toFhir(parseHL7(raw), {
      namingSystem: createNamingSystem(),
      generateId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
    });
    // A superseded input (its AL1 is an AllergyIntolerance now), so the baseline is recovered the
    // way the corpus assertions above recover it, not by recapturing it.
    expect(canonicalIdentities(withoutAllergies(serializeResource(direct.bundle)))).toBe(
      canonicalIdentities(goldenFor("eleven-silent-segments").bundle),
    );
  });

  it("registers both codes so the property suite's registered-code check still passes", () => {
    const codes: readonly IssueCode[] = [LIBRARY_GAP, STANDARD_GAP];
    for (const code of codes) expect(ISSUE_REGISTRY[code]).toBeDefined();
  });
});

/**
 * TQ1 → the schedule an order's request carries: `MedicationRequest.dosageInstruction.timing`,
 * `ServiceRequest.occurrenceTiming`, the two free-text rows, and the refusal that keeps a
 * half-grounded schedule out of a resource entirely.
 *
 * Every TQ1 row below traces to the IG pages this work was grounded on
 * (`ConceptMap-segment-tq1-to-medicationrequest`, `ConceptMap-segment-tq1-to-servicerequest`,
 * `ConceptMap-datatype-rpt-to-timing`, `ConceptMap-table-hl70335-to-v2-0335`,
 * `ConceptMap-table-hl70528-to-v3-timingevent`), and the no-TQ1 regression baseline in
 * `test/_support/tq1-baseline.json` was captured from the tree as it stood before any TQ1 reached a
 * resource (see `scripts/capture-tq1-baseline.ts`), so "unchanged" is measured, not asserted.
 */

import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";
import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  parseResource,
  resourceType,
  serializeResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import { DEFAULT_ENCODING_CHARACTERS, type RawRepetition } from "@cosyte/hl7";

import { ISSUE_CODES, type TransformIssue, type TransformResult } from "../../src/index.js";
import { isRepeatPatternCode } from "../../src/terminology/concept-map.js";
import {
  endPrecedesStart,
  escapeXml,
  restoreStructuralEmpties,
  UNITS_OF_TIME,
} from "../../src/messages/tq1-timing.js";
import { NO_TQ1_ORDER, runOrderFixture } from "../_support/tq1-fixtures.js";

// ── fixture plumbing ─────────────────────────────────────────────────────────────────────────────

/** Build a segment string placing values at their 1-indexed HL7 field positions. */
function seg(type: string, fields: Readonly<Record<number, string>>): string {
  const max = Math.max(...Object.keys(fields).map(Number));
  const parts = [type];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

const HEADER = (code: string) =>
  `MSH|^~\\&|CPOE|HOSP|LAB|HOSP|20260721150000-0500||${code}|MSGTQ1|P|2.5.1`;
const PID = "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F";
const PV1 = "PV1|1|O";
const ORC = "ORC|NW|PLACER1|FILLER1||||||20260721140000-0500";
const RXO =
  "RXO|197361^Amoxicillin 250 MG Oral Tablet^RXNORM|250|500|mg^milligram^UCUM|||||G||30|tab^tablet^UCUM|2";
const RXR = "RXR|PO^Oral^HL70162";

/** A pharmacy order (`OMP^O09`, segment-assembled) whose ORC-anchored group carries the given TQ1s. */
function pharmacyOrder(...tq1s: readonly string[]): TransformResult {
  return runOrderFixture([HEADER("OMP^O09"), PID, PV1, ORC, ...tq1s, RXO, RXR]);
}

/** A service order (`OMG^O19`, segment-assembled) whose ORC-anchored group carries the given TQ1s. */
function serviceOrder(obr: string, ...tq1s: readonly string[]): TransformResult {
  return runOrderFixture([HEADER("OMG^O19"), PID, PV1, ORC, ...tq1s, obr]);
}

const OBR_NO_OCCURRENCE = seg("OBR", { 1: "1", 4: "24331-1^Lipid Panel^LN", 5: "R" });
const OBR_WITH_OCCURRENCE = seg("OBR", {
  1: "1",
  4: "24331-1^Lipid Panel^LN",
  5: "R",
  6: "20260722080000-0500",
});

// ── FHIR navigation ──────────────────────────────────────────────────────────────────────────────

/** The first resource of `type` in the emitted bundle, re-read from its serialized form. */
function resourceOf(result: TransformResult, type: string): FhirComplex | undefined {
  const entry = getProperty(parseResource(serializeResource(result.bundle)).resource, "entry");
  if (entry === undefined || !isList(entry)) return undefined;
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    if (res !== undefined && isComplex(res) && resourceType(res) === type) return res;
  }
  return undefined;
}

/** Walk a dotted path; a numeric step indexes a list, a name step reads a property (list → first). */
function at(node: FhirNode | undefined, path: string): FhirNode | undefined {
  let cur = node;
  for (const step of path.split(".")) {
    if (cur === undefined) return undefined;
    if (/^[0-9]+$/.test(step)) {
      cur = isList(cur) ? cur.items[Number(step)] : undefined;
      continue;
    }
    if (isList(cur)) cur = cur.items[0];
    if (cur === undefined || !isComplex(cur)) return undefined;
    cur = getProperty(cur, step);
  }
  return cur;
}

/** The scalar at a dotted path, as a string, or `undefined` when it is absent or not a primitive. */
function value(node: FhirNode | undefined, path: string): string | undefined {
  const found = at(node, path);
  if (found === undefined || !isPrimitive(found) || found.value === undefined) return undefined;
  return String(found.value);
}

/** The property names a complex node carries, in order (so "and no other element" is checkable). */
function names(node: FhirNode | undefined): readonly string[] {
  return node !== undefined && isComplex(node) ? node.properties.map((p) => p.name) : [];
}

/** Whether a dotted path resolves to anything at all. */
function present(node: FhirNode | undefined, path: string): boolean {
  return at(node, path) !== undefined;
}

function issuesAt(result: TransformResult, v2Location: string): readonly TransformIssue[] {
  return result.issues.filter((i) => i.v2Location === v2Location);
}

/** Every issue the TQ1 *reading* raised, i.e. excluding the completeness ledger's `TQ1[k]` report. */
function tq1Issues(result: TransformResult): readonly TransformIssue[] {
  return result.issues.filter((i) => i.v2Location === "TQ1" || i.v2Location.startsWith("TQ1."));
}

const medication = (r: TransformResult) => resourceOf(r, "MedicationRequest");
const service = (r: TransformResult) => resourceOf(r, "ServiceRequest");
const dosage = (r: TransformResult) => at(medication(r), "dosageInstruction.0");

// The four expressible RPT components, in RPT position order:
// RPT.1 pattern code, RPT.5 period quantity, RPT.6 period units, RPT.8 event.
const RPT_EXPRESSIBLE = "Q4H^^^^6^h^^AC";

// ── criterion 1: the expressible RPT components, and nothing else ────────────────────────────────

describe("an RXO paired with one fully expressible TQ1", () => {
  const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE }));
  const timing = at(dosage(result), "timing");

  it("emits exactly one dosageInstruction.timing", () => {
    const list = at(medication(result), "dosageInstruction");
    expect(list !== undefined && isList(list) ? list.items.length : 0).toBe(1);
    expect(timing).toBeDefined();
  });

  it("carries Timing.code from RPT.1 verbatim under the v2-0335 CodeSystem", () => {
    expect(value(timing, "code.coding.system")).toBe(
      "http://terminology.hl7.org/CodeSystem/v2-0335",
    );
    expect(value(timing, "code.coding.code")).toBe("Q4H");
    // One coding, and no derived second one: the IG map's mapped rows are identity in the code.
    const coding = at(timing, "code.coding");
    expect(coding !== undefined && isList(coding) ? coding.items.length : 0).toBe(1);
  });

  it("carries repeat.period from RPT.5, repeat.periodUnit from RPT.6 and repeat.when from RPT.8", () => {
    expect(value(timing, "repeat.period")).toBe("6");
    expect(value(timing, "repeat.periodUnit")).toBe("h");
    expect(value(timing, "repeat.when.0")).toBe("AC");
  });

  it("emits no other Timing element", () => {
    expect(names(timing)).toEqual(["repeat", "code"]);
    expect(names(at(timing, "repeat"))).toEqual(["period", "periodUnit", "when"]);
  });

  it("raises no issue about the TQ1 at all", () => {
    expect(tq1Issues(result)).toEqual([]);
  });
});

// ── criterion 2: TQ1-7 / TQ1-8 bounds, including a bounds-only timing ────────────────────────────

describe("TQ1-7 and TQ1-8 bounds", () => {
  it("sets boundsPeriod.start from TQ1-7 and .end from TQ1-8", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "20260721", 8: "20260724" }),
    );
    const timing = at(dosage(result), "timing");
    expect(value(timing, "repeat.boundsPeriod.start")).toBe("2026-07-21");
    expect(value(timing, "repeat.boundsPeriod.end")).toBe("2026-07-24");
  });

  it("emits only the endpoint the message valued", () => {
    const startOnly = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "20260721" }));
    expect(names(at(dosage(startOnly), "timing.repeat.boundsPeriod"))).toEqual(["start"]);
    const endOnly = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 8: "20260724" }));
    expect(names(at(dosage(endOnly), "timing.repeat.boundsPeriod"))).toEqual(["end"]);
  });

  it("emits a bounds-only timing when TQ1-3 is empty and a bound is valued", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 7: "20260721", 8: "20260724" }));
    const timing = at(dosage(result), "timing");
    expect(timing).toBeDefined();
    expect(names(timing)).toEqual(["repeat"]);
    expect(names(at(timing, "repeat"))).toEqual(["boundsPeriod"]);
    expect(value(timing, "repeat.boundsPeriod.start")).toBe("2026-07-21");
  });

  it("emits no timing at all, and no refusal, when the TQ1 grounds nothing", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1" }));
    expect(present(dosage(result), "timing")).toBe(false);
    // Nothing was refused, because nothing was claimed: the only report is the ledger's, which is
    // right, since the occurrence did reach no resource.
    expect(tq1Issues(result)).toEqual([]);
    expect(issuesAt(result, "TQ1[1]").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED,
    ]);
  });
});

// ── criterion 3: an RPT component outside the expressible set ────────────────────────────────────

describe("an RPT component the published map cannot ground", () => {
  // RPT.2 Calendar Alignment / RPT.7 Institution Specified Time / RPT.11 General Timing
  // Specification have no target row at all; RPT.3 / RPT.4 need "/translate number to day/";
  // RPT.9 / RPT.10 need "/convert to minutes based on RPT.10/".
  const cases: readonly (readonly [component: number, rpt: string])[] = [
    [2, "Q4H^DW"],
    [3, "Q4H^^2"],
    [4, "Q4H^^^5"],
    [7, "Q4H^^^^^^Y"],
    [9, "Q4H^^^^^^^^30"],
    [10, "Q4H^^^^^^^^^min"],
    [11, "Q4H^^^^^^^^^^GTS"],
  ];

  for (const [component, rpt] of cases) {
    it(`refuses the whole timing and names RPT.${String(component)}`, () => {
      const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: rpt, 7: "20260721" }));
      // No partial Timing AND no boundsPeriod, even though TQ1-7 alone would have grounded one.
      expect(present(dosage(result), "timing")).toBe(false);
      const raised = issuesAt(result, `TQ1.3.${String(component)}`);
      expect(raised.length).toBe(1);
      expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    });
  }

  it("refuses an RPT.1 code with no HL70335 row", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "ZZZ" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3.1")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("refuses an RPT.1 code that declares a foreign coding system", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H&every 4h&99LOCAL" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3.1")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("refuses an RPT.8 code the HL70528 map gives no v3-TimingEvent target for", () => {
    // IC / ICM / ICD / ICV sit in the map's SECOND group, which targets v2-0528 back onto itself:
    // they are not EventTiming members, so repeat.when cannot carry them.
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^^^^IC" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3.8")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("refuses an RPT.6 outside FHIR's required-bound UnitsOfTime", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^6^hr" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3.6")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED);
  });

  it("refuses an RPT.5 that is not a faithful FHIR decimal", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^+6^h" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3.5")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID);
  });

  it("refuses a second TQ1-3 repetition rather than mapping the first", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H~QHS" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.3")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });
});

// ── criterion 3, continued: an RPT.5 / RPT.6 shape a FHIR Timing cannot legally hold ─────────────

describe("an RPT.5 / RPT.6 pair R4's own Timing invariants reject", () => {
  // RPT.5 and RPT.6 are 0..1 each, so a period with no units, and a unit with no period, are both
  // shapes the wire produces from components that are individually inside the expressible set. R4
  // constrains Timing.repeat beyond its element types: `tim-2` ("if there's a period, there needs
  // to be period units", `period.empty() or periodUnit.exists()`) and `tim-5` ("period SHALL be a
  // non-negative value"). @cosyte/fhir models no Timing constraint at all, so neither the
  // conservative-emit gate nor the property suite's validateResource can see one of these: the
  // refusal happens here or it does not happen, and {"period":6} reads to a receiving system as a
  // grounded repeat it will compute against.

  it("refuses an RPT.5 that arrived with no RPT.6, rather than a repeat that breaks tim-2", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^6", 7: "20260721" }));
    // No partial Timing AND no boundsPeriod, even though TQ1-7 alone would have grounded one.
    expect(present(dosage(result), "timing")).toBe(false);
    const raised = issuesAt(result, "TQ1.3.5");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    expect(raised[0]?.fhirPath).toBe("MedicationRequest.dosageInstruction.timing.repeat.period");
  });

  it("refuses an RPT.6 that arrived with no RPT.5, which grounds no interval at all", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^^h" }));
    expect(present(dosage(result), "timing")).toBe(false);
    const raised = issuesAt(result, "TQ1.3.6");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    expect(raised[0]?.fhirPath).toBe(
      "MedicationRequest.dosageInstruction.timing.repeat.periodUnit",
    );
  });

  it("refuses a negative RPT.5, which tim-5 forbids however faithfully it is written", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^-6^h" }));
    expect(present(dosage(result), "timing")).toBe(false);
    const raised = issuesAt(result, "TQ1.3.5");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID);
  });

  it("carries a zero RPT.5, which tim-5 admits, rather than altering the sender's magnitude", () => {
    const timing = at(dosage(pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^0^h" }))), "timing");
    expect(value(timing, "repeat.period")).toBe("0");
    expect(value(timing, "repeat.periodUnit")).toBe("h");
  });

  it("refuses a negative RPT.5 whose magnitude no double distinguishes from zero", () => {
    // `Number(raw) < 0` is not the test this needs. IEEE-754 underflows any negative magnitude
    // below about 5e-324 to `-0`, which is not less than zero, so `-1e-400` passes it; and
    // @cosyte/fhir's decimal preserves the sender's lexical form, so what reaches the wire is a
    // literally negative period. The assertion is on the SERIALIZED bytes because JSON.parse
    // normalizes `-1e-400` to `0`: a parsed probe cannot see this at all.
    for (const raw of ["-1e-400", "-1e-999", `-0.${"0".repeat(400)}1`, "-0", "-0.0e-400"]) {
      const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: `Q4H^^^^${raw}^h` }));
      expect(serializeResource(result.bundle)).not.toContain('"period"');
      expect(issuesAt(result, "TQ1.3.5").map((i) => i.code)).toEqual([
        ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID,
      ]);
    }
    // Not vacuous: an unsigned magnitude, zero included, still reaches the wire unaltered.
    expect(
      serializeResource(pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^6^h" })).bundle),
    ).toContain('"period":6');
    expect(
      serializeResource(pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^0^h" })).bundle),
    ).toContain('"period":0');
  });

  it("raises one issue, not two, when the half that arrived is unusable on its own terms", () => {
    // "+6" is not a faithful FHIR decimal and "hr" is not a UnitsOfTime code, so each component is
    // already refused by name: the pairing rule must not stack a second issue on the same one.
    const badPeriod = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^+6" }));
    expect(present(dosage(badPeriod), "timing")).toBe(false);
    expect(issuesAt(badPeriod, "TQ1.3.5").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID,
    ]);
    const badUnit = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^^^^^hr" }));
    expect(present(dosage(badUnit), "timing")).toBe(false);
    expect(issuesAt(badUnit, "TQ1.3.6").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_CODE_UNMAPPED,
    ]);
  });

  it("refuses all three shapes on the ServiceRequest path too", () => {
    for (const rpt of ["Q4H^^^^6", "Q4H^^^^^h", "Q4H^^^^-6^h"]) {
      const result = serviceOrder(OBR_NO_OCCURRENCE, seg("TQ1", { 1: "1", 3: rpt }));
      expect(present(service(result), "occurrenceTiming")).toBe(false);
      expect(tq1Issues(result).length).toBe(1);
      expect(tq1Issues(result)[0]?.fhirPath).toMatch(/^ServiceRequest\.occurrenceTiming\.repeat\./);
    }
  });
});

// ── criterion 4: the six schedule-narrowing fields ───────────────────────────────────────────────

describe("a schedule-narrowing TQ1 field", () => {
  const narrowing: readonly (readonly [field: number, raw: string])[] = [
    [4, "0800"],
    [5, "30^min"],
    [6, "3^d"],
    [12, "S"],
    [13, "30^min"],
    [14, "12"],
  ];

  for (const [field, raw] of narrowing) {
    it(`refuses the timing and names TQ1-${String(field)}`, () => {
      const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, [field]: raw }));
      expect(present(dosage(result), "timing")).toBe(false);
      const raised = issuesAt(result, `TQ1.${String(field)}`);
      expect(raised.length).toBe(1);
      expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    });
  }

  it("raises one issue per valued field when several are valued", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 4: "0800", 12: "S", 14: "12" }),
    );
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.4").length).toBe(1);
    expect(issuesAt(result, "TQ1.12").length).toBe(1);
    expect(issuesAt(result, "TQ1.14").length).toBe(1);
  });

  it("names the R4 element each dropped field would have reached", () => {
    const timing = "MedicationRequest.dosageInstruction.timing";
    const expected: readonly (readonly [field: number, raw: string, path: string])[] = [
      [4, "0800", `${timing}.event`],
      [5, "30^min", `${timing}.repeat.offset`],
      // R4 puts every `bounds[x]` on Timing.repeat, so `timing.boundsDuration` resolves to nothing
      // and a consumer routing on fhirPath would be sent to an element that does not exist.
      [6, "3^d", `${timing}.repeat.boundsDuration`],
      [12, "S", timing],
      [13, "30^min", `${timing}.repeat.duration`],
      [14, "12", `${timing}.repeat.countMax`],
    ];
    for (const [field, raw, path] of expected) {
      const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, [field]: raw }));
      expect(issuesAt(result, `TQ1.${String(field)}`)[0]?.fhirPath).toBe(path);
    }
  });
});

// ── criterion 5: TQ1-2 and TQ1-9 are dropped, never withhold, never overwrite ────────────────────

describe("TQ1-2 quantity and TQ1-9 priority", () => {
  const result = pharmacyOrder(
    seg("TQ1", { 1: "1", 2: "2^tab", 3: RPT_EXPRESSIBLE, 9: "S^Stat^HL70485" }),
  );

  it("still emits the timing its expressible components ground", () => {
    expect(value(at(dosage(result), "timing"), "code.coding.code")).toBe("Q4H");
  });

  it("raises one dropped issue per valued field", () => {
    expect(issuesAt(result, "TQ1.2").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
    expect(issuesAt(result, "TQ1.9").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
  });

  it("leaves doseAndRate and priority exactly as the RXO path produced them", () => {
    // RXO-2/RXO-3 with RXO-4 units, untouched by the TQ1-2 dose the IG would have mapped.
    expect(value(dosage(result), "doseAndRate.0.doseRange.low.value")).toBe("250");
    expect(value(dosage(result), "doseAndRate.0.doseRange.high.value")).toBe("500");
    expect(present(dosage(result), "doseAndRate.0.doseQuantity")).toBe(false);
    // MedicationRequest.priority has no RXO source and stays absent: TQ1-9 never fills it.
    expect(present(medication(result), "priority")).toBe(false);
  });
});

// ── criterion 6: more than one TQ1 on one order ──────────────────────────────────────────────────

describe("two TQ1 segments on one order", () => {
  const result = pharmacyOrder(
    seg("TQ1", { 1: "1", 3: "Q4H", 10: "with food" }),
    seg("TQ1", { 1: "2", 3: "QHS" }),
  );

  it("emits no timing rather than mapping one occurrence and discarding the other", () => {
    expect(present(dosage(result), "timing")).toBe(false);
  });

  it("carries nothing from either occurrence, so neither is half-applied", () => {
    expect(present(dosage(result), "additionalInstruction")).toBe(false);
    expect(present(medication(result), "text")).toBe(false);
  });

  it("raises one value-free issue naming the segment", () => {
    const raised = issuesAt(result, "TQ1");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });
});

// ── criteria 7 and 8: the two free-text rows go to two different places ──────────────────────────

describe("TQ1-10 condition text and TQ1-11 text instruction", () => {
  it("carries TQ1-10 verbatim into dosageInstruction.additionalInstruction.text", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 10: "if pain persists" }),
    );
    expect(value(dosage(result), "additionalInstruction.0.text")).toBe("if pain persists");
    expect(present(medication(result), "text")).toBe(false);
  });

  it("carries TQ1-10 whether or not a timing was emitted", () => {
    // RPT.2 is inexpressible, so the schedule is refused: the condition text still arrives.
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^DW", 10: "if pain persists" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(value(dosage(result), "additionalInstruction.0.text")).toBe("if pain persists");
  });

  it("carries TQ1-11 into MedicationRequest.text as an additional Narrative", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 11: "take with a full glass of water" }),
    );
    expect(value(medication(result), "text.status")).toBe("additional");
    expect(value(medication(result), "text.div")).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">take with a full glass of water</div>',
    );
    // The IG targets dosageInstruction.text from nothing, so nothing is written there.
    expect(present(dosage(result), "text")).toBe(false);
    expect(present(dosage(result), "additionalInstruction")).toBe(false);
  });

  it("escapes XML metacharacters and alters nothing else", () => {
    // `\T\` is the v2 escape for the subcomponent separator; the parser decodes it to a bare `&`,
    // which is exactly the character an XHTML div may not carry raw.
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 11: "hold if HR < 50 \\T\\ BP > 90" }));
    expect(value(medication(result), "text.div")).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">hold if HR &lt; 50 &amp; BP &gt; 90</div>',
    );
  });

  it("carries a raw v2 delimiter inside either row as content, never truncating at it", () => {
    // TQ1-10 and TQ1-11 are TX: a v2 PRIMITIVE with no component structure, so a raw `^`, `&` or
    // `~` inside one is content by definition. Reading only the first subcomponent would deliver
    // "2 tabs" for a taper, and "hold if HR " for a hold rule, with nothing at all to say so.
    const raw = "2 tabs^then 1 tab & hold if HR & BP low~unless febrile";
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: raw, 11: raw }));
    expect(value(dosage(result), "additionalInstruction.0.text")).toBe(raw);
    expect(value(medication(result), "text.div")).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">' +
        "2 tabs^then 1 tab &amp; hold if HR &amp; BP low~unless febrile</div>",
    );
  });

  it("escapes the XML metacharacters that follow a raw delimiter, not just the ones before it", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 11: 'give <2 mg & note "stop"' }));
    expect(value(medication(result), "text.div")).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">give &lt;2 mg &amp; note &quot;stop&quot;</div>',
    );
  });

  it("resolves the v2 formatting escapes a narrative carries and fabricates nothing for the rest", () => {
    // `\.br\` is a line break and `\H\`/`\N\` are highlight boundaries: v2 section 2.7 display
    // markup, not content, and a raw sentinel reaching a human in a FHIR narrative is misread. A
    // vendor `\Z99\` has no defined rendering, so its literal characters are preserved as they
    // stand rather than guessed at or dropped.
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 10: "line1\\.br\\line2", 11: "see \\H\\NOW\\N\\ then \\Z99\\" }),
    );
    expect(value(dosage(result), "additionalInstruction.0.text")).toBe("line1\nline2");
    expect(value(medication(result), "text.div")).toBe(
      '<div xmlns="http://www.w3.org/1999/xhtml">see NOW then \\Z99\\</div>',
    );
  });

  it("keeps a delimiter the field's canonical form drops, wherever it sits", () => {
    // A field's canonical wire text is structurally normalized: each component's trailing empty
    // subcomponents and each repetition's trailing empty components are dropped, so `2 tabs^`
    // projects as `2 tabs` and `a&^b` as `a^b`. On a composite field those are absent positions;
    // on a TX primitive they are characters of a clinical instruction, and "verbatim" covers the
    // last one as much as the first. A trailing `~` was never dropped, so the loss was not even
    // uniform across the three delimiters.
    for (const raw of ["2 tabs^", "with food&", "a&b&", "with food~", "a&^b", "^leading"]) {
      const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: raw, 11: raw }));
      expect(value(dosage(result), "additionalInstruction.0.text")).toBe(raw);
      expect(value(medication(result), "text.div")).toBe(
        `<div xmlns="http://www.w3.org/1999/xhtml">${escapeXml(raw)}</div>`,
      );
    }
  });

  it("sends the two rows to their two distinct targets at once", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 10: "if pain persists", 11: "with water" }),
    );
    expect(value(dosage(result), "additionalInstruction.0.text")).toBe("if pain persists");
    expect(value(medication(result), "text.div")).toContain("with water");
  });
});

// ── criteria 7, 8 and 13: an HL7 explicit null is not a value ────────────────────────────────────

describe("an HL7 explicit null in TQ1-10 or TQ1-11", () => {
  // `""` (two literal quotation marks) is the wire saying this field carries NO value: it is not
  // text, and reading a field whole makes it look like text, because the marker IS the field's
  // characters. AC7 and AC8 are both conditioned on the row being "valued", so neither authorises
  // a write here, and what would be written is not the sender's instruction but the null marker,
  // into the narrative a viewer renders before any structured element.
  const NULL = '""';

  it("writes nothing to either target", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: NULL, 11: NULL }));
    expect(present(dosage(result), "additionalInstruction")).toBe(false);
    expect(present(medication(result), "text")).toBe(false);
    expect(serializeResource(result.bundle)).not.toContain('\\"\\"');
  });

  it("raises no diagnostic, because a field that carries nothing dropped nothing", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: NULL, 11: NULL }));
    expect(tq1Issues(result)).toEqual([]);
    // The same TQ1 read for a ServiceRequest agrees: one isValued test, one answer, both arms.
    const svc = serviceOrder(OBR_NO_OCCURRENCE, seg("TQ1", { 1: "1", 10: NULL, 11: NULL }));
    expect(tq1Issues(svc)).toEqual([]);
  });

  it("reports the TQ1 unreached when a null was all it carried", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: NULL, 11: NULL }));
    expect(
      result.issues
        .filter((i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED)
        .map((i) => i.v2Location),
    ).toEqual(["TQ1[1]"]);
  });

  it("leaves a schedule the same TQ1 did ground exactly as it was", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 10: NULL, 11: NULL }));
    expect(present(dosage(result), "timing")).toBe(true);
    expect(present(dosage(result), "additionalInstruction")).toBe(false);
    expect(present(medication(result), "text")).toBe(false);
  });

  it("still carries a valued row beside a null one, and text that merely contains quotes", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 10: NULL, 11: "give 2 tabs" }));
    expect(present(dosage(result), "additionalInstruction")).toBe(false);
    expect(value(medication(result), "text.div")).toContain("give 2 tabs");
    // `""x` is not the null marker: it is a field whose content begins with two quotation marks.
    const quoted = pharmacyOrder(seg("TQ1", { 1: "1", 10: '""x' }));
    expect(value(dosage(quoted), "additionalInstruction.0.text")).toBe('""x');
  });
});

describe("restoreStructuralEmpties", () => {
  const enc = DEFAULT_ENCODING_CHARACTERS;
  const rep = (...components: readonly (readonly string[])[]): RawRepetition => ({
    components: components.map((subcomponents) => ({ subcomponents })),
  });

  it("pads a component back to the subcomponent count the wire carried", () => {
    expect(restoreStructuralEmpties("a^b", [rep(["a", ""], ["b"])], enc)).toBe("a&^b");
    expect(restoreStructuralEmpties("a", [rep(["a", "", ""])], enc)).toBe("a&&");
  });

  it("puts back a component the canonical form dropped whole, with its own subcomponents", () => {
    expect(restoreStructuralEmpties("2 tabs", [rep(["2 tabs"], [""])], enc)).toBe("2 tabs^");
    expect(restoreStructuralEmpties("", [rep([""], ["", ""])], enc)).toBe("^&");
  });

  it("adds nothing when the text already carries every empty the tree records", () => {
    expect(restoreStructuralEmpties("a~b", [rep(["a"]), rep(["b"])], enc)).toBe("a~b");
    expect(restoreStructuralEmpties("a~", [rep(["a"]), rep([""])], enc)).toBe("a~");
  });

  it("leaves a stretch of text a shorter tree cannot account for exactly as it stands", () => {
    // Only delimiters are ever added and content is copied across, so a tree that does not line up
    // with the text (nothing observed produces one) can never cost a character of the message.
    expect(restoreStructuralEmpties("a~b~c", [rep(["a"])], enc)).toBe("a~b~c");
    expect(restoreStructuralEmpties("a^b", [], enc)).toBe("a^b");
  });
});

// ── criteria 9 and 10: the service-order path and the occurrence[x] choice ───────────────────────

describe("a service order group with one TQ1", () => {
  it("emits occurrenceTiming carrying the same content as the dosageInstruction timing", () => {
    const result = serviceOrder(
      OBR_NO_OCCURRENCE,
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "20260721", 8: "20260724" }),
    );
    const timing = at(service(result), "occurrenceTiming");
    expect(value(timing, "code.coding.system")).toBe(
      "http://terminology.hl7.org/CodeSystem/v2-0335",
    );
    expect(value(timing, "code.coding.code")).toBe("Q4H");
    expect(value(timing, "repeat.period")).toBe("6");
    expect(value(timing, "repeat.periodUnit")).toBe("h");
    expect(value(timing, "repeat.when.0")).toBe("AC");
    expect(value(timing, "repeat.boundsPeriod.start")).toBe("2026-07-21");
    expect(value(timing, "repeat.boundsPeriod.end")).toBe("2026-07-24");
    expect(present(service(result), "occurrenceDateTime")).toBe(false);
  });

  it("emits exactly one occurrence[x] and flags the dropped OBR-6 when both would ground one", () => {
    const result = serviceOrder(OBR_WITH_OCCURRENCE, seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE }));
    const request = service(result);
    expect(present(request, "occurrenceTiming")).toBe(true);
    expect(present(request, "occurrenceDateTime")).toBe(false);
    expect(names(request).filter((n) => n.startsWith("occurrence"))).toEqual(["occurrenceTiming"]);
    const raised = issuesAt(result, "OBR.6");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
    expect(raised[0]?.fhirPath).toBe("ServiceRequest.occurrenceDateTime");
  });

  it("leaves occurrenceDateTime in place, unflagged, when the TQ1 timing is refused", () => {
    const result = serviceOrder(OBR_WITH_OCCURRENCE, seg("TQ1", { 1: "1", 3: "Q4H^DW" }));
    expect(value(service(result), "occurrenceDateTime")).toBe("2026-07-22T08:00:00-05:00");
    expect(present(service(result), "occurrenceTiming")).toBe(false);
    expect(issuesAt(result, "OBR.6")).toEqual([]);
  });

  it("flags TQ1-10 and TQ1-11 as dropped on the service path rather than discarding them silently", () => {
    const result = serviceOrder(
      OBR_NO_OCCURRENCE,
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 10: "fasting", 11: "bring prior results" }),
    );
    expect(issuesAt(result, "TQ1.10").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
    expect(issuesAt(result, "TQ1.11").map((i) => i.code)).toEqual([
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
    ]);
    expect(present(service(result), "text")).toBe(false);
  });
});

// ── criterion 11: a bound that is lost or inverted ───────────────────────────────────────────────

describe("a TQ1-7 or TQ1-8 that cannot be carried", () => {
  it("refuses the timing when a valued TQ1-7 yields no FHIR dateTime", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "notadate" }));
    expect(present(dosage(result), "timing")).toBe(false);
    const raised = issuesAt(result, "TQ1.7");
    expect(raised.length).toBe(1);
    expect(raised[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("refuses the timing when a valued TQ1-8 yields no FHIR dateTime", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 8: "20261332" }));
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.8")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("refuses the timing when the end precedes the start", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "20260724", 8: "20260721" }),
    );
    expect(present(dosage(result), "timing")).toBe(false);
    expect(issuesAt(result, "TQ1.8")[0]?.code).toBe(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED);
  });

  it("refuses an inverted pair of fully-zoned instants on the same day", () => {
    const result = pharmacyOrder(
      seg("TQ1", {
        1: "1",
        3: RPT_EXPRESSIBLE,
        7: "20260721140000-0500",
        8: "20260721100000-0500",
      }),
    );
    expect(present(dosage(result), "timing")).toBe(false);
  });

  it("accepts a same-day pair where one endpoint reduced to date precision", () => {
    // TQ1-8 has a time of day and no zone, so it reduces to a date: comparing it as an instant
    // against the zoned start would be reading a precision it does not carry.
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE, 7: "20260721140000-0500", 8: "20260721100000" }),
    );
    expect(present(dosage(result), "timing")).toBe(true);
  });
});

describe("endPrecedesStart", () => {
  it("compares two fully-zoned datetimes as instants", () => {
    expect(endPrecedesStart("2026-07-21T10:00:00-05:00", "2026-07-21T09:00:00-05:00")).toBe(true);
    expect(endPrecedesStart("2026-07-21T09:00:00-05:00", "2026-07-21T10:00:00-05:00")).toBe(false);
  });

  it("compares anything else at day granularity, widening a partial date to its whole span", () => {
    expect(endPrecedesStart("2026-07-21", "2026-07-20")).toBe(true);
    expect(endPrecedesStart("2026-07-21", "2026-07-21")).toBe(false);
    expect(endPrecedesStart("2026-07-21T10:00:00-05:00", "2026-07-21")).toBe(false);
    expect(endPrecedesStart("2026-02", "2026")).toBe(false);
    expect(endPrecedesStart("2027", "2026")).toBe(true);
    expect(endPrecedesStart("2026-07-21", "2026")).toBe(false);
  });

  it("treats an unparseable zoned lexical form as not comparable as an instant", () => {
    expect(endPrecedesStart("2026-07-21TXX", "2026-07-20")).toBe(true);
  });
});

// ── criterion 12: an order with no TQ1 is byte-identical to the pinned tree ──────────────────────

describe("an order group carrying no TQ1", () => {
  const baseline = JSON.parse(
    readFileSync(new URL("../_support/tq1-baseline.json", import.meta.url), "utf8"),
  ) as {
    readonly capturedAtCommit: string;
    readonly bundle: string;
    readonly issues: readonly {
      readonly code: string;
      readonly severity: string;
      readonly v2Location: string;
      readonly fhirPath?: string;
    }[];
  };

  const result = runOrderFixture(NO_TQ1_ORDER);

  it("was measured against the tree the spec pins, not against itself", () => {
    expect(baseline.capturedAtCommit).toBe("b4e29f2741263a3a8a0cee4588b91e1ca8aef2f5");
  });

  it("emits a byte-identical bundle", () => {
    expect(serializeResource(result.bundle)).toBe(baseline.bundle);
  });

  it("emits an identical issue list", () => {
    expect(
      result.issues.map((i) => {
        const base = { code: i.code, severity: i.severity, v2Location: i.v2Location };
        return i.fhirPath === undefined ? base : { ...base, fhirPath: i.fhirPath };
      }),
    ).toEqual(baseline.issues);
  });
});

// ── criterion 13: the completeness ledger ────────────────────────────────────────────────────────

describe("segment-level completeness for a TQ1", () => {
  const notEmitted = (r: TransformResult) =>
    r.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_SEGMENT_NOT_EMITTED && i.v2Location.startsWith("TQ1"),
    );

  it("does not report a TQ1 that contributed a timing", () => {
    expect(notEmitted(pharmacyOrder(seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE })))).toEqual([]);
  });

  it("does not report a TQ1 that contributed only an additionalInstruction", () => {
    expect(notEmitted(pharmacyOrder(seg("TQ1", { 1: "1", 10: "if pain persists" })))).toEqual([]);
  });

  it("does not report a TQ1 that contributed only a narrative", () => {
    expect(notEmitted(pharmacyOrder(seg("TQ1", { 1: "1", 11: "with water" })))).toEqual([]);
  });

  it("does not report a TQ1 that contributed an occurrenceTiming to a ServiceRequest", () => {
    expect(
      notEmitted(serviceOrder(OBR_NO_OCCURRENCE, seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE }))),
    ).toEqual([]);
  });

  it("still reports a TQ1 that was read and refused", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "Q4H^DW" }));
    expect(notEmitted(result).map((i) => i.v2Location)).toEqual(["TQ1[1]"]);
  });

  it("reports every occurrence when two TQ1s made the order inexpressible", () => {
    const result = pharmacyOrder(
      seg("TQ1", { 1: "1", 3: "Q4H" }),
      seg("TQ1", { 1: "2", 3: "QHS" }),
    );
    expect(notEmitted(result).map((i) => i.v2Location)).toEqual(["TQ1[1]", "TQ1[2]"]);
  });

  it("reports a TQ1 that no order group could anchor", () => {
    const result = runOrderFixture([
      HEADER("OMP^O09"),
      PID,
      PV1,
      seg("TQ1", { 1: "1", 3: RPT_EXPRESSIBLE }),
      ORC,
      RXO,
      RXR,
    ]);
    expect(notEmitted(result).map((i) => i.v2Location)).toEqual(["TQ1[1]"]);
  });
});

// ── the HL70335 recognizer, row by published row ─────────────────────────────────────────────────

describe("the HL70335 repeat-pattern rows", () => {
  it("recognizes each literal row", () => {
    for (const code of [
      "QAM",
      "QSHIFT",
      "QHS",
      "QPM",
      "C",
      "PRN",
      "Once",
      "A",
      "P",
      "I",
      "M",
      "D",
      "V",
      "BID",
      "TID",
      "QID",
      "QOD",
    ]) {
      expect(isRepeatPatternCode(code)).toBe(true);
    }
  });

  it("recognizes each parameterized row at an instantiation of it", () => {
    for (const code of ["Q1S", "Q30M", "Q4H", "Q2D", "Q3W", "Q1L", "Q1J3", "5ID", "12ID"]) {
      expect(isRepeatPatternCode(code)).toBe(true);
    }
    expect(isRepeatPatternCode("U 0 8 * * *")).toBe(true);
    expect(isRepeatPatternCode("ACM")).toBe(true);
    expect(isRepeatPatternCode("PCV")).toBe(true);
    expect(isRepeatPatternCode("PRNQ4H")).toBe(true);
  });

  it("recognizes nothing else, so an unpublished code is never asserted as a table concept", () => {
    for (const code of ["", "ZZZ", "Q4X", "QH", "4ID", "1ID", "U", "PRNZZZ", "ACX", "q4h"]) {
      expect(isRepeatPatternCode(code)).toBe(false);
    }
  });
});

describe("the UnitsOfTime binding and the XML escape", () => {
  it("carries exactly FHIR's seven UnitsOfTime codes", () => {
    expect([...UNITS_OF_TIME].sort()).toEqual(["a", "d", "h", "min", "mo", "s", "wk"]);
  });

  it("escapes the five XML predefined entities and nothing else", () => {
    expect(escapeXml(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    expect(escapeXml("plain text, unchanged")).toBe("plain text, unchanged");
  });
});

// ── every issue this work raises stays value-free ────────────────────────────────────────────────

describe("the diagnostics this work raises", () => {
  it("never interpolate a value from the message", () => {
    const result = pharmacyOrder(
      seg("TQ1", {
        1: "1",
        2: "2^tab",
        3: "SECRETPATTERN^DW^^^+6^SECRETUNIT^^SECRETEVENT^30^SECRETOFFSET^GTS",
        4: "0800",
        7: "SECRETSTART",
        9: "S",
        10: "SECRETCONDITION",
        12: "S",
      }),
    );
    const serialized = JSON.stringify(result.issues);
    for (const secret of [
      "SECRETPATTERN",
      "SECRETUNIT",
      "SECRETEVENT",
      "SECRETOFFSET",
      "SECRETSTART",
      "SECRETCONDITION",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("carries a parseable HL7 location on every TQ1 issue it raises", () => {
    const result = pharmacyOrder(seg("TQ1", { 1: "1", 3: "ZZZ^DW", 4: "0800" }));
    const raised = result.issues.filter((i) => i.v2Location.startsWith("TQ1."));
    expect(raised.length).toBeGreaterThan(0);
    for (const i of raised) expect(i.v2Location).toMatch(/^TQ1\.[0-9]+(\.[0-9]+)?$/);
  });
});

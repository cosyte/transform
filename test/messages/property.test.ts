/**
 * Property + fuzz coverage over the **message boundary** (roadmap §6). For arbitrary (including
 * hostile) parsed ADT messages, `toFhir` must:
 *   1. **never throw** (the fail-safe rule at the message level);
 *   2. raise only **registered**, **value-free** issue codes (a sentinel threaded through every PID/
 *      PV1/NK1/AL1 value must never reach the diagnostic channel);
 *   3. produce a bundle whose **references all resolve within it** (no dangling `urn:uuid:`); and
 *   4. emit only **structurally-valid** focal resources, every `Patient` entry validates strict under
 *      `@cosyte/fhir` (an invalid one is withheld, never shipped).
 *
 * The AL1 boundary carries a fifth, because an allergy is acted on clinically: no emitted
 * `AllergyIntolerance` may carry a `category`, `type` or `criticality` code the IG maps did not
 * produce. A malformed AL1 must cost the element or the resource, never buy a guessed value.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseHL7 } from "@cosyte/hl7";
import {
  parseResource,
  serializeResource,
  validateResource,
  getProperty,
  isList,
  isComplex,
  isPrimitive,
  type FhirComplex,
} from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  ISSUE_REGISTRY,
  type TransformResult,
} from "../../src/index.js";
import { EMIT_SCHEMAS } from "../../src/messages/emit-schemas.js";

const SENTINEL = "PHIZZ";
const registeredCodes = new Set<string>(Object.values(ISSUE_CODES));
const numRuns = Number(process.env["FUZZ_RUNS"] ?? "300");

/** A safe HL7 field token: no delimiters, always carrying the leak sentinel. */
const token = fc.stringMatching(/^[A-Za-z0-9 ]{0,8}$/).map((s) => SENTINEL + s);
const optToken = fc.option(token, { nil: undefined });
/**
 * A free-text token for a `TX` row (TQ1-10 / TQ1-11). `TX` is a v2 **primitive** with no component
 * structure, so a raw `^`, `&` or `~` inside one is content and must reach the resource rather than
 * truncate it; the escape sequences exercise the render path (a delimiter escape, a formatting
 * command, a highlight boundary, an unrenderable vendor sequence, a dangling escape character). The
 * field separator is still excluded: it would end the field and change the message's shape.
 */
const freeTextToken = fc
  .tuple(
    fc.stringMatching(/^[A-Za-z0-9 ]{0,6}$/),
    fc.constantFrom("", "^", "&", "~", "<&>", "\\T\\", "\\.br\\", "\\H\\", "\\Z9\\", "\\"),
    fc.stringMatching(/^[A-Za-z0-9 ]{0,6}$/),
  )
  .map(([head, delim, tail]) => `${SENTINEL}${head}${delim}${tail}`);
/**
 * A `TX` row whose WHOLE content is raw v2 delimiters. It carries no sentinel deliberately: every
 * one of these produces nothing but empty component and subcomponent positions, so the composite
 * "is some subcomponent non-empty" question answers no for all of them while the datatype's own
 * rule calls them content. They must reach the resource exactly as `^leading` does.
 */
const delimiterOnlyText = fc.constantFrom("^", "&", "~", "^^", "&&", "^&~", "~^&");
/**
 * The three of them together, plus the HL7 **explicit null** (`""`): the wire saying a field carries
 * no value. It is generated because it is the one free-text input that must reach NO resource
 * element at all, and it carries no sentinel, so only the null-marker invariant below can see it.
 */
const optFreeText = fc.option(fc.oneof(freeTextToken, fc.constant('""'), delimiterOnlyText), {
  nil: undefined,
});
const sexCode = fc.constantFrom("F", "M", "O", "U", "A", "N", "ZZ", "", "X");
const classCode = fc.constantFrom("I", "O", "E", "P", "R", "B", "C", "N", "U", "Z", "");
const trigger = fc.constantFrom("A01", "A02", "A05", "A08", "A31", "A40");

let counter = 0;
function seqId(): string {
  return `00000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`;
}

interface Parts {
  readonly trig: string;
  readonly family: string | undefined;
  readonly given: string | undefined;
  readonly mrn: string | undefined;
  readonly sex: string;
  readonly cls: string;
  readonly visit: string | undefined;
  readonly nkName: string | undefined;
  readonly nkRel: string | undefined;
}

function build(p: Parts): string {
  const pid5 = `${p.family ?? ""}^${p.given ?? ""}`;
  const pid3 = p.mrn === undefined ? "" : `${p.mrn}^^^HOSP^MR`;
  const lines = [
    `MSH|^~\\&|APP|FAC|RCV|RFAC|20260101120000-0500||ADT^${p.trig}|MSGID1|P|2.5.1`,
    `PID|1||${pid3}||${pid5}||19900101|${p.sex}`,
    `PV1|1|${p.cls}|||||||||||||||||${p.visit ?? ""}`,
  ];
  if (p.nkName !== undefined || p.nkRel !== undefined) {
    lines.push(`NK1|1|${p.nkName ?? ""}^X|${p.nkRel ?? ""}`);
  }
  return lines.join("\r");
}

/** The string value of a primitive property of `node`, or `undefined` when it carries none. */
function readString(node: FhirComplex, name: string): string | undefined {
  const found = getProperty(node, name);
  if (found === undefined || !isPrimitive(found)) return undefined;
  return typeof found.value === "string" ? found.value : undefined;
}

/** Every `reference` and every `fullUrl` string in the serialized bundle. */
function refsAndUrls(result: TransformResult): { refs: string[]; urls: Set<string> } {
  const json = serializeResource(result.bundle);
  const refs = [...json.matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1] ?? "");
  const urls = new Set([...json.matchAll(/"fullUrl":"([^"]+)"/g)].map((m) => m[1] ?? ""));
  return { refs, urls };
}

function assertResult(result: TransformResult): void {
  // (2) value-free + registered
  const serialized = JSON.stringify(result.issues);
  expect(serialized).not.toContain(SENTINEL);
  for (const i of result.issues) {
    expect(registeredCodes.has(i.code)).toBe(true);
    expect(i.v2Location.length).toBeGreaterThan(0);
    expect(i.message).toBe(ISSUE_REGISTRY[i.code].message);
  }
  // (3) references resolve within the bundle
  const { refs, urls } = refsAndUrls(result);
  for (const r of refs) expect(urls.has(r)).toBe(true);
  // (4) every emitted resource is structurally valid: Patient strict, the rest against the emit
  // schemas (lenient), so a resource that would fail R4 required-cardinality is never in the bundle.
  const parsed = parseResource(serializeResource(result.bundle)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry !== undefined && isList(entry)) {
    for (const e of entry.items) {
      const res = isComplex(e) ? getProperty(e, "resource") : undefined;
      if (res === undefined || !isComplex(res)) continue;
      const rt = getProperty(res, "resourceType");
      const type = rt !== undefined && "value" in rt ? (rt as { value: unknown }).value : undefined;
      const check =
        type === "Patient"
          ? validateResource(res, { mode: "strict" })
          : validateResource(res, { mode: "lenient", schemas: EMIT_SCHEMAS });
      expect(check.valid).toBe(true);
    }
  }
}

describe("message boundary: fail-safe, value-free, references resolve, Patient validates", () => {
  const registry = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.3.4" } });

  it("never throws and holds every invariant over structured ADT messages", () => {
    const arb = fc.record({
      trig: trigger,
      family: optToken,
      given: optToken,
      mrn: optToken,
      sex: sexCode,
      cls: classCode,
      visit: optToken,
      nkName: optToken,
      nkRel: fc.option(fc.constantFrom("SPO", "FTH", "MTH", "CHD", ""), { nil: undefined }),
    });
    fc.assert(
      fc.property(arb, (p) => {
        let result: TransformResult;
        try {
          result = toFhir(parseHL7(build(p)), { namingSystem: registry, generateId: seqId });
        } catch (err) {
          throw new Error("toFhir threw (message-level fail-safe violated)", { cause: err });
        }
        assertResult(result);
      }),
      { numRuns },
    );
  });

  it("never throws and holds every invariant over ORU^R01 result messages", () => {
    const valueType = fc.constantFrom("NM", "SN", "CWE", "CE", "ST", "TX", "DT", "NA", "ZZ");
    const statusCode = fc.constantFrom("F", "C", "X", "P", "R", "N", "ZZ", "");
    const flag = fc.constantFrom("H", "HH", "L", "N", "A", "ZZ", "");
    const obxArb = fc.record({
      vt: valueType,
      id: optToken,
      val: optToken,
      units: optToken,
      status: statusCode,
      flag,
    });
    const arb = fc.record({
      trig: fc.constantFrom("R01", "R30"),
      mrn: optToken,
      obrStatus: statusCode,
      obrCode: optToken,
      obx: fc.array(obxArb, { maxLength: 5 }),
    });
    fc.assert(
      fc.property(arb, (p) => {
        const lines = [
          `MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^${p.trig}|MSGID1|P|2.5.1`,
          `PID|1||${p.mrn === undefined ? "" : `${p.mrn}^^^HOSP^MR`}||Doe^Jane||19900101|F`,
          `OBR|1||FILL1|${p.obrCode ?? ""}^Test^LN|||||||||||||||||||||${p.obrStatus}`,
        ];
        for (let i = 0; i < p.obx.length; i++) {
          const o = p.obx[i];
          if (o === undefined) continue;
          lines.push(
            `OBX|${String(i + 1)}|${o.vt}|${o.id ?? ""}^N^LN||${o.val ?? ""}|${o.units ?? ""}^u^UCUM||${o.flag}|||${o.status}`,
          );
        }
        let result: TransformResult;
        try {
          result = toFhir(parseHL7(lines.join("\r")), {
            namingSystem: registry,
            generateId: seqId,
          });
        } catch (err) {
          throw new Error("toFhir threw on an ORU message (message-level fail-safe violated)", {
            cause: err,
          });
        }
        assertResult(result);
      }),
      { numRuns },
    );
  });

  it("never throws and grounds every allergy element over structurally hostile AL1 segments", () => {
    // The IG target sets, in full: the only values an emitted AllergyIntolerance may carry in these
    // three elements. Anything else would be a guess, whatever the AL1 looked like.
    const CATEGORIES = new Set(["food", "medication", "environment", "biologic"]);
    const TYPES = new Set(["allergy", "intolerance"]);
    const CRITICALITIES = new Set(["low", "high", "unable-to-assess"]);
    // Table 0127 / 0128 codes, near-misses, a foreign coding system, and shapes the parser
    // publishes for a damaged field: an empty component structure, a bare separator, repetitions.
    const al1Field = fc.constantFrom(
      "DA",
      "MA",
      "MC",
      "ZZ",
      "SV",
      "MO",
      "",
      "^",
      "^^",
      "^^^",
      "~",
      "DA^^99LOCAL",
      "^Text only",
      `${SENTINEL}^${SENTINEL}^${SENTINEL}`,
      "DA~FA",
      "20240115",
      "not-a-date",
    );
    const arb = fc.record({
      hasPid: fc.boolean(),
      version: fc.constantFrom("2.5.1", "2.7", "2.3", "", "V2", "2.7.1"),
      al1s: fc.array(
        fc.record({
          type: al1Field,
          allergen: al1Field,
          severity: al1Field,
          reaction: al1Field,
          onset: al1Field,
          trailing: fc.constantFrom("", "|", "|||||||"),
        }),
        { maxLength: 3 },
      ),
    });
    fc.assert(
      fc.property(arb, (p) => {
        const lines = [
          `MSH|^~\\&|APP|FAC|RCV|RFAC|20260101120000-0500||ADT^A01|MSGID1|P|${p.version}`,
        ];
        if (p.hasPid) lines.push(`PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F`);
        for (const [i, a] of p.al1s.entries()) {
          lines.push(
            `AL1|${String(i + 1)}|${a.type}|${a.allergen}|${a.severity}|${a.reaction}|${a.onset}${a.trailing}`,
          );
        }
        lines.push("AL1"); // an AL1 with no fields at all
        let result: TransformResult;
        try {
          result = toFhir(parseHL7(lines.join("\r")), {
            namingSystem: registry,
            generateId: seqId,
          });
        } catch (err) {
          throw new Error("toFhir threw on an AL1-carrying message", { cause: err });
        }
        assertResult(result);

        const parsed = parseResource(serializeResource(result.bundle)).resource;
        const entry = getProperty(parsed, "entry");
        if (entry === undefined || !isList(entry)) return;
        for (const e of entry.items) {
          const res = isComplex(e) ? getProperty(e, "resource") : undefined;
          if (res === undefined || !isComplex(res)) continue;
          if (readString(res, "resourceType") !== "AllergyIntolerance") continue;
          // Every coded element the maps fill is either absent or an IG target, never a guess.
          const type = readString(res, "type");
          if (type !== undefined) expect(TYPES.has(type)).toBe(true);
          const criticality = readString(res, "criticality");
          if (criticality !== undefined) expect(CRITICALITIES.has(criticality)).toBe(true);
          const category = getProperty(res, "category");
          const items =
            category === undefined ? [] : isList(category) ? category.items : [category];
          for (const item of items) {
            if (!isPrimitive(item)) continue;
            if (typeof item.value === "string") expect(CATEGORIES.has(item.value)).toBe(true);
          }
          // An emitted allergy always says what it is to, and always resolves to a patient.
          expect(getProperty(res, "code")).toBeDefined();
          expect(getProperty(res, "patient")).toBeDefined();
        }
      }),
      { numRuns },
    );
  });

  it("never throws and holds every invariant over order messages carrying a TQ1", () => {
    // The TQ1 rows are generated across the whole space the schedule path branches on: expressible
    // and unpublished repeat-pattern codes, in-binding and out-of-binding period units, both
    // HL70528 groups under a declared bound table and under a foreign one, a non-conformant twelfth
    // RPT component, faithful and unfaithful decimals, valid/invalid/inverted bounds, the six
    // schedule-narrowing fields, every repetition shape TQ1-3's `0..-1` cardinality produces, and
    // free text carrying the leak sentinel (or nothing but raw delimiters) into the two rows that
    // DO reach the resource. What must hold is the same four invariants: never throw, only
    // registered value-free codes, references resolve, and every emitted resource is valid.
    const patternCode = fc.constantFrom(
      "Q4H",
      "BID",
      "PRN",
      "ACM",
      "5ID",
      "U 0 8 * * *",
      "",
      "ZZZ",
    );
    const periodUnit = fc.constantFrom("h", "d", "min", "hr", "HOURS", "");
    const eventCode = fc.constantFrom("AC", "PCV", "HS", "IC", "ICM", "ZZ", "");
    // The coding system a sender declares on a bound-table component (CWE.3, the third
    // SUBCOMPONENT). A foreign one must never be read as the bound table: `AC` under a site's own
    // table need not be the published v3-TimingEvent concept that shares its spelling.
    const codingSystem = fc.constantFrom("", "&&HL70528", "&&LOCAL", "&&99RPT");
    // A twelfth RPT component: non-conformant (RPT publishes eleven), and still content the wire
    // carried, so it must be flagged rather than read as absent.
    const twelfth = fc.constantFrom("", "ZZZ");
    // How the generated RPT sits inside TQ1-3, which is `0..-1`. A trailing separator, a leading
    // one and an explicitly nulled second repetition all arrive in real traffic and none of them is
    // a second schedule; `~QHS` is one, and must still withhold the whole Timing.
    const repetitionShape = fc.constantFrom("one", "trailing", "leading", "nulled", "second");
    // "-6" and the independent "" on units cover the two shapes R4's tim-5 and tim-2 reject: a
    // negative period, and a period or a unit arriving without its pair. "-1e-400" and "-0" are the
    // negatives no double distinguishes from zero, so a numeric sign test lets them through.
    const period = fc.constantFrom("6", "0.5", "0", "-6", "-0", "-1e-400", "+6", "007", "", "abc");
    const stamp = fc.constantFrom(
      "20260721",
      "20260724140000-0500",
      "20260721140000",
      "notadate",
      "",
    );
    const narrowing = fc.constantFrom("", "0800", "30^min", "S", "12");
    const tq1Arb = fc.record({
      quantity: fc.constantFrom("", "2^tab"),
      pattern: patternCode,
      alignment: fc.constantFrom("", "DW"),
      period,
      units: periodUnit,
      event: eventCode,
      eventSystem: codingSystem,
      twelfth,
      repetitionShape,
      explicitTime: narrowing,
      start: stamp,
      end: stamp,
      priority: fc.constantFrom("", "S", "ZZ"),
      condition: optFreeText,
      instruction: optFreeText,
      conjunction: fc.constantFrom("", "S"),
      count: fc.constantFrom("", "12"),
    });
    const arb = fc.record({
      code: fc.constantFrom("OMP^O09", "OMG^O19", "ORM^O01", "OML^O21"),
      detail: fc.constantFrom("RXO", "OBR"),
      obr6: stamp,
      tq1s: fc.array(tq1Arb, { maxLength: 2 }),
    });

    fc.assert(
      fc.property(arb, (p) => {
        const lines = [
          `MSH|^~\\&|CPOE|F|LAB|H|20260101120000-0500||${p.code}|MSGID1|P|2.5.1`,
          "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
          "ORC|NW|PLAC1|FILL1||||||20260101110000-0500",
        ];
        for (const t of p.tq1s) {
          const rpt = [
            t.pattern,
            t.alignment,
            "",
            "",
            t.period,
            t.units,
            "",
            `${t.event}${t.eventSystem}`,
            "",
            "",
            "",
            t.twelfth,
          ].join("^");
          const field3 = {
            one: rpt,
            trailing: `${rpt}~`,
            leading: `~${rpt}`,
            nulled: `${rpt}~""`,
            second: `${rpt}~QHS`,
          }[t.repetitionShape];
          lines.push(
            [
              "TQ1",
              "1",
              t.quantity,
              field3,
              t.explicitTime,
              "",
              "",
              t.start,
              t.end,
              t.priority,
              t.condition ?? "",
              t.instruction ?? "",
              t.conjunction,
              "",
              t.count,
            ].join("|"),
          );
        }
        lines.push(
          p.detail === "RXO"
            ? "RXO|197361^Amox^RXNORM|250|500|mg^milligram^UCUM"
            : `OBR|1|||24331-1^Panel^LN|R|${p.obr6}`,
        );
        let result: TransformResult;
        try {
          result = toFhir(parseHL7(lines.join("\r")), {
            namingSystem: registry,
            generateId: seqId,
          });
        } catch (err) {
          throw new Error("toFhir threw on an order message with a TQ1 (fail-safe violated)", {
            cause: err,
          });
        }
        assertResult(result);
        // Two invariants only the SERIALIZED bytes can carry, because parsing hides both. JSON.parse
        // normalizes `-1e-400` to `0`, so a parsed probe cannot see a lexically negative period at
        // all. And no generated token carries a quotation mark, so an adjacent PAIR of them in the
        // emitted text (escaped in JSON, entity-escaped in the XHTML narrative) can only be an HL7
        // explicit null read as though it were a clinical instruction.
        const wire = serializeResource(result.bundle);
        expect(wire).not.toContain('\\"\\"');
        expect(wire).not.toContain("&quot;&quot;");
        expect(wire).not.toContain('"period":-');
      }),
      { numRuns },
    );
  });

  it("never throws and grounds every element over structurally hostile DG1/PR1/IN1 segments", () => {
    // The value sets a Condition, a Procedure and a Coverage may carry in their coded and fixed
    // elements: anything else would be a guess, whatever the segment looked like.
    const VERIFICATION_STATUSES = new Set(["entered-in-error"]);
    const PROCEDURE_STATUSES = new Set(["unknown"]);
    // Table 0206 action codes, near-misses, and shapes the parser publishes for a damaged field:
    // an empty component structure, a bare separator, repetitions, escapes, and out-of-range dates.
    const hostileField = fc.constantFrom(
      "",
      "^",
      "^^",
      "^^^^",
      "~",
      "~~",
      '""',
      "\\F\\",
      "\\T\\",
      "\\.br\\",
      "\\Z9\\",
      "\\",
      "&",
      "^&~",
      `${SENTINEL}^${SENTINEL}^${SENTINEL}`,
      "250.00^Diab^I9",
      "250.00^Diab^I9^ALT^AltText^SCT^^^Original",
      "A~B",
      "20260721103000-0500",
      "20260721",
      "202607211030",
      "99999999999999",
      "20261332250000-0500",
      "0000",
      "not-a-date",
      "-1",
      "1e9",
      "SN",
      "D",
    );
    const arb = fc.record({
      hasPid: fc.boolean(),
      hasPv1: fc.boolean(),
      dg1: fc.array(fc.array(hostileField, { minLength: 0, maxLength: 22 }), { maxLength: 3 }),
      pr1: fc.array(fc.array(hostileField, { minLength: 0, maxLength: 25 }), { maxLength: 3 }),
      in1: fc.array(fc.array(hostileField, { minLength: 0, maxLength: 49 }), { maxLength: 3 }),
    });
    fc.assert(
      fc.property(arb, (p) => {
        const lines = ["MSH|^~\\&|APP|FAC|RCV|RFAC|20260101120000-0500||ADT^A01|MSGID1|P|2.5.1"];
        if (p.hasPid) lines.push("PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F");
        if (p.hasPv1) lines.push("PV1|1|I");
        for (const [name, rows] of [
          ["DG1", p.dg1],
          ["PR1", p.pr1],
          ["IN1", p.in1],
        ] as const) {
          for (const fields of rows) lines.push([name, ...fields].join("|"));
          // One occurrence of each name with no fields at all.
          lines.push(name);
        }
        let result: TransformResult;
        try {
          result = toFhir(parseHL7(lines.join("\r")), {
            namingSystem: registry,
            generateId: seqId,
          });
        } catch (err) {
          throw new Error("toFhir threw on a DG1/PR1/IN1-carrying message", { cause: err });
        }
        assertResult(result);

        const parsed = parseResource(serializeResource(result.bundle)).resource;
        const entry = getProperty(parsed, "entry");
        if (entry === undefined || !isList(entry)) return;
        for (const e of entry.items) {
          const res = isComplex(e) ? getProperty(e, "resource") : undefined;
          if (res === undefined || !isComplex(res)) continue;
          const type = readString(res, "resourceType");
          if (type === "Condition") {
            // Anchored, and never carrying a verification status the map has no assignment for.
            expect(getProperty(res, "subject")).toBeDefined();
            const verification = getProperty(res, "verificationStatus");
            if (verification !== undefined && isComplex(verification)) {
              const coding = getProperty(verification, "coding");
              const items = coding !== undefined && isList(coding) ? coding.items : [];
              for (const item of items) {
                if (!isComplex(item)) continue;
                const code = readString(item, "code");
                if (code !== undefined) expect(VERIFICATION_STATUSES.has(code)).toBe(true);
              }
            }
          }
          if (type === "Procedure") {
            expect(getProperty(res, "subject")).toBeDefined();
            const status = readString(res, "status");
            expect(status !== undefined && PROCEDURE_STATUSES.has(status)).toBe(true);
          }
          if (type === "Coverage") {
            // Anchored, paid by someone the message named, and never asserting a status.
            expect(getProperty(res, "beneficiary")).toBeDefined();
            expect(getProperty(res, "payor")).toBeDefined();
            expect(readString(res, "status")).toBeUndefined();
          }
        }
      }),
      { numRuns },
    );
  });

  it("never throws and keeps every diagnostic value-free over the structured OBX value types, SPM and NTE", () => {
    // The paths that carry the richest content into a bundle are the ones a diagnostic must say the
    // least about: an attachment payload, a specimen identifier, a note's text, and an observation
    // magnitude. Every generated value below carries the leak sentinel except the magnitudes, which
    // are checked by their own literal, and `assertResult` holds the four standing invariants.
    const MAGNITUDES = ["987654321.125", "-987654321.125"] as const;
    const composite = fc.constantFrom(
      // DR: both bounds, one bound, an end alone (invisible to `Field.value`), and unparseable ones.
      "20260721143000-0500^20260722153000-0500",
      "20260721143000-0500",
      "^20260722153000-0500",
      `${SENTINEL}^${SENTINEL}`,
      "20260721143000",
      // NR / NA magnitudes, faithful and not, plus the array shapes the chapter's examples use.
      `${MAGNITUDES[0]}^${MAGNITUDES[1]}`,
      "+7^007",
      "1.2^-3.5^5.2~2.0^3.1^-6.2~3.5^7.8^-1.3",
      "^2^3^4~5^^^8~9^10~~17^18^19^20",
      `1^${SENTINEL}^3`,
      // TM, zoned and partial.
      "143000",
      "143000-0500",
      "1430",
      // ED, with and without the Base64 condition and with and without a subtype.
      `APP^AP^application/pdf^Base64^${SENTINEL}QkFTRTY0`,
      `APP^AP^^Base64^${SENTINEL}QkFTRTY0`,
      `APP^AP^application/pdf^Hex^${SENTINEL}QkFTRTY0`,
      // The shapes a damaged line publishes.
      "",
      "^",
      "^^^^",
      "~",
      '""',
      "\\T\\",
      SENTINEL,
    );
    const arb = fc.record({
      obrStatus: fc.constantFrom("F", "M", ""),
      obx: fc.array(
        fc.record({
          vt: fc.constantFrom("DR", "NR", "TM", "NA", "ED", "RP", "NM", "ZZ"),
          val: composite,
          status: fc.constantFrom("F", "R", ""),
          notes: fc.array(fc.oneof(token, freeTextToken, delimiterOnlyText), { maxLength: 2 }),
        }),
        { maxLength: 3 },
      ),
      leadingNote: fc.option(token, { nil: undefined }),
      spm: fc.array(
        fc.record({
          id: optToken,
          type: optToken,
          collected: fc.constantFrom("", "20260721143000-0500^20260721150000-0500", SENTINEL),
          description: optToken,
          parent: optToken,
          availability: optToken,
        }),
        { maxLength: 2 },
      ),
    });

    fc.assert(
      fc.property(arb, (p) => {
        const lines = [
          "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|MSGID1|P|2.5.1",
          "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
        ];
        // A PATIENT-level NTE: the ORU map publishes no target for it, so it must reach nothing.
        if (p.leadingNote !== undefined) lines.push(`NTE|1|L|${p.leadingNote}`);
        lines.push(`OBR|1||FILL1|T^Test^LN${"|".repeat(21)}${p.obrStatus}`);
        for (const [i, o] of p.obx.entries()) {
          lines.push(`OBX|${String(i + 1)}|${o.vt}|C^Code^LN||${o.val}|u^u^UCUM|||||${o.status}`);
          for (const [j, n] of o.notes.entries()) {
            lines.push(
              `NTE|${String(j + 1)}|L|${n}|GI^General^HL70364|W^Who^Wrote|20260721170000-0500`,
            );
          }
        }
        for (const [i, s] of p.spm.entries()) {
          lines.push(
            [
              "SPM",
              String(i + 1),
              s.id ?? "",
              s.parent ?? "",
              s.type ?? "",
              ...Array.from({ length: 9 }, () => ""),
              s.description ?? "",
              "",
              "",
              s.collected,
              "",
              s.availability ?? "",
            ].join("|"),
          );
        }
        lines.push("SPM"); // an SPM with no fields at all

        let result: TransformResult;
        try {
          result = toFhir(parseHL7(lines.join("\r")), {
            namingSystem: registry,
            generateId: seqId,
          });
        } catch (err) {
          throw new Error("toFhir threw on an ORU carrying SPM/NTE and structured OBX values", {
            cause: err,
          });
        }
        assertResult(result);

        // No observation magnitude reaches a diagnostic either, and no magnitude carries a sentinel
        // for `assertResult` to have caught: these two literals are the whole check.
        const serialized = JSON.stringify(result.issues);
        for (const magnitude of MAGNITUDES) expect(serialized).not.toContain(magnitude);

        // A specimen the bundle does not contain is never referenced by a report that it does, and
        // a report the gate withheld leaves no specimen entry behind: both directions, on the wire.
        const wire = serializeResource(result.bundle);
        if (!wire.includes('"resourceType":"Specimen"')) {
          expect(wire).not.toContain('"specimen"');
        }
      }),
      { numRuns },
    );
  });

  it("never throws on hostile arbitrary input that still parses as HL7", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 400 }), (raw) => {
        let msg;
        try {
          msg = parseHL7(raw);
        } catch {
          return; // parser rejected it: that is @cosyte/hl7's contract, not ours
        }
        let result: TransformResult;
        try {
          result = toFhir(msg, { generateId: seqId });
        } catch (err) {
          throw new Error("toFhir threw on parseable input", { cause: err });
        }
        for (const i of result.issues) expect(registeredCodes.has(i.code)).toBe(true);
      }),
      { numRuns },
    );
  });
});

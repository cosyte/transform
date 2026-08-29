/**
 * Property + fuzz coverage over the **message boundary** (roadmap §6). For arbitrary (including
 * hostile) parsed ADT messages, `toFhir` must:
 *   1. **never throw** (the fail-safe rule at the message level);
 *   2. raise only **registered**, **value-free** issue codes (a sentinel threaded through every PID/
 *      PV1/NK1 value must never reach the diagnostic channel);
 *   3. produce a bundle whose **references all resolve within it** (no dangling `urn:uuid:`); and
 *   4. emit only **structurally-valid** focal resources, every `Patient` entry validates strict under
 *      `@cosyte/fhir` (an invalid one is withheld, never shipped).
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
const optFreeText = fc.option(freeTextToken, { nil: undefined });
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

  it("never throws and holds every invariant over order messages carrying a TQ1", () => {
    // The TQ1 rows are generated across the whole space the schedule path branches on: expressible
    // and unpublished repeat-pattern codes, in-binding and out-of-binding period units, both
    // HL70528 groups, faithful and unfaithful decimals, valid/invalid/inverted bounds, the six
    // schedule-narrowing fields, and free text carrying the leak sentinel into the two rows that
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
    // "-6" and the independent "" on units cover the two shapes R4's tim-5 and tim-2 reject: a
    // negative period, and a period or a unit arriving without its pair.
    const period = fc.constantFrom("6", "0.5", "0", "-6", "+6", "007", "", "abc");
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
            t.event,
            "",
            "",
            "",
          ].join("^");
          lines.push(
            [
              "TQ1",
              "1",
              t.quantity,
              rpt,
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

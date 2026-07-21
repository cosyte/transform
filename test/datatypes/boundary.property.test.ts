/**
 * Property + fuzz coverage over the whole v2→FHIR **datatype boundary** (roadmap §6 fuzz #1).
 *
 * For arbitrary — including hostile — parsed-v2 composites, every converter must:
 *   1. **never throw** (the fail-safe rule: ambiguity becomes an issue, not an exception);
 *   2. raise only **registered** issue codes, each with a positional `v2Location` and a static message;
 *   3. keep the diagnostic channel **value-free** — no input field value ever reaches an issue (proven
 *      by threading a sentinel through every generated field and asserting no issue carries it);
 *   4. produce output that, when embedded in a host resource, **validates under `@cosyte/fhir`**.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseDtm, type CWE, type CX, type HD, type NM, type XAD, type XPN } from "@cosyte/hl7";
import { primitive } from "@cosyte/fhir";

import {
  toFhirDateTime,
  toFhirIdentifier,
  toFhirCodeableConcept,
  toFhirHumanName,
  toFhirAddress,
  toFhirQuantity,
  createNamingSystem,
  ISSUE_CODES,
  ISSUE_REGISTRY,
  type TransformIssue,
} from "../../src/index.js";
import { embedAndValidate, one } from "../_support/fhir.js";

const SENTINEL = "PHIZZ";
const registeredCodes = new Set<string>(Object.values(ISSUE_CODES));
const numRuns = Number(process.env["FUZZ_RUNS"] ?? "300");
const ctx = { namingSystem: createNamingSystem() };

/**
 * Drop keys whose value is `undefined`, mirroring how `@cosyte/hl7` omits absent composite fields
 * (the parser never sets a present-but-undefined property). Yields an `exactOptionalPropertyTypes`-
 * clean object assignable to the composite interface.
 */
function compact<T>(obj: Record<string, unknown>): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
  return out as T;
}

/** A string field that always carries the sentinel, so any leak into an issue is detectable. */
const optStr = fc.option(
  fc.string({ maxLength: 10 }).map((s) => SENTINEL + s),
  { nil: undefined },
);
const mnemonic = fc.option(fc.constantFrom("LN", "SCT", "UCUM", "99LOCAL", "", "ISO"), {
  nil: undefined,
});

const hdArb: fc.Arbitrary<HD> = fc
  .record({
    namespaceId: optStr,
    universalId: fc.option(fc.oneof(fc.constantFrom("1.2.840.114350", "1.2.3"), optStr), {
      nil: undefined,
    }),
    universalIdType: fc.option(fc.constantFrom("ISO", "UUID", "DNS", ""), { nil: undefined }),
  })
  .map((r) => compact<HD>(r));

/** Assert an issue list is well-formed and value-free. */
function assertIssues(issues: readonly TransformIssue[]): void {
  const serialized = JSON.stringify(issues);
  expect(serialized).not.toContain(SENTINEL); // no input value ever reaches the channel
  for (const i of issues) {
    expect(registeredCodes.has(i.code)).toBe(true);
    expect(i.v2Location.length).toBeGreaterThan(0);
    expect(i.message).toBe(ISSUE_REGISTRY[i.code].message); // static, never interpolated
    expect(["error", "warning", "information"]).toContain(i.severity);
  }
}

/** Run one converter, guarding against any throw. */
function guard<T>(fn: () => { value: T | undefined; issues: readonly TransformIssue[] }): {
  value: T | undefined;
  issues: readonly TransformIssue[];
} {
  try {
    return fn();
  } catch (err) {
    throw new Error("converter threw (fail-safe violated)", { cause: err });
  }
}

describe("datatype boundary — fail-safe, value-free, validates", () => {
  it("toFhirDateTime never throws and never fabricates a zone", () => {
    const tsArb = fc.oneof(
      fc.constantFrom(
        "2026",
        "202607",
        "20260721",
        "20260721143000",
        "20260721143000-0500",
        "2026072114",
        "20260721143000.5-0500",
      ),
      fc.string({ maxLength: 16 }).map((s) => SENTINEL + s),
    );
    fc.assert(
      fc.property(
        tsArb,
        fc.option(fc.integer({ min: -720, max: 840 }), { nil: undefined }),
        (raw, off) => {
          const { value, issues } = guard(() =>
            toFhirDateTime(
              parseDtm(raw),
              off === undefined ? {} : { assumeTimezoneOffsetMinutes: off },
            ),
          );
          assertIssues(issues);
          if (value !== undefined) {
            // If there is no offset in the string, the emitted value must not carry a zone.
            if (!/[+-]\d{4}/.test(raw)) expect(value).not.toMatch(/[Zz]$/);
            expect(embedAndValidate([["effectiveDateTime", primitive(value)]])).toEqual([]);
          }
        },
      ),
      { numRuns },
    );
  });

  it("toFhirIdentifier never synthesizes a system and stays value-free", () => {
    const cxArb = fc
      .record({
        idNumber: optStr,
        checkDigit: optStr,
        assigningAuthority: fc.option(hdArb, { nil: undefined }),
        identifierTypeCode: optStr,
        assigningJurisdiction: optStr,
        assigningAgencyOrDepartment: optStr,
      })
      .map((r) => compact<CX>(r));
    fc.assert(
      fc.property(cxArb, (cx) => {
        const { value, issues } = guard(() => toFhirIdentifier(cx, ctx));
        assertIssues(issues);
        if (value !== undefined) expect(embedAndValidate([["identifier", one(value)]])).toEqual([]);
      }),
      { numRuns },
    );
  });

  it("toFhirCodeableConcept preserves codes and never invents a system", () => {
    const cweArb = fc
      .record({
        identifier: optStr,
        text: optStr,
        nameOfCodingSystem: mnemonic,
        alternateIdentifier: optStr,
        alternateText: optStr,
        nameOfAlternateCodingSystem: mnemonic,
        codingSystemVersionId: optStr,
        alternateCodingSystemVersionId: optStr,
        originalText: optStr,
      })
      .map((r) => compact<CWE>(r));
    fc.assert(
      fc.property(cweArb, (cwe) => {
        const { value, issues } = guard(() => toFhirCodeableConcept(cwe, ctx));
        assertIssues(issues);
        if (value !== undefined) expect(embedAndValidate([["code", value]])).toEqual([]);
      }),
      { numRuns },
    );
  });

  it("toFhirHumanName never guesses a name-use", () => {
    const xpnArb = fc
      .record({
        familyName: optStr,
        givenName: optStr,
        secondName: optStr,
        suffix: optStr,
        prefix: optStr,
        degree: optStr,
        professionalSuffix: optStr,
        nameTypeCode: fc.option(fc.constantFrom("L", "D", "M", "N", "B", "ZZ", ""), {
          nil: undefined,
        }),
        effectiveDate: optStr,
        expirationDate: optStr,
      })
      .map((r) => compact<XPN>(r));
    fc.assert(
      fc.property(xpnArb, (xpn) => {
        const { value, issues } = guard(() => toFhirHumanName(xpn));
        assertIssues(issues);
        if (value !== undefined) expect(embedAndValidate([["name", one(value)]])).toEqual([]);
      }),
      { numRuns },
    );
  });

  it("toFhirAddress never guesses use/type", () => {
    const xadArb = fc
      .record({
        street: optStr,
        otherDesignation: optStr,
        city: optStr,
        stateOrProvince: optStr,
        zipOrPostalCode: optStr,
        country: optStr,
        addressType: fc.option(fc.constantFrom("H", "O", "M", "SH", "HV", "ZZ", ""), {
          nil: undefined,
        }),
        otherGeographicDesignation: optStr,
        countyParishCode: optStr,
      })
      .map((r) => compact<XAD>(r));
    fc.assert(
      fc.property(xadArb, (xad) => {
        const { value, issues } = guard(() => toFhirAddress(xad));
        assertIssues(issues);
        if (value !== undefined) expect(embedAndValidate([["address", one(value)]])).toEqual([]);
      }),
      { numRuns },
    );
  });

  it("toFhirQuantity carries magnitude exactly and never fabricates a UCUM code", () => {
    const nmArb: fc.Arbitrary<NM> = fc.oneof(
      fc.record({
        raw: fc.constant("POSITIVE"),
        value: fc.constant<number | undefined>(undefined),
      }),
      fc
        .double({ min: -1e6, max: 1e6, noNaN: true, noDefaultInfinity: true })
        .map((n) => ({ raw: String(n), value: n })),
      // v2 NM lexical forms that `Number()` accepts but the FHIR `decimal` literal rejects — leading
      // `+`, leading zeros, a trailing dot. These are the inputs that made an unguarded decimal() throw.
      fc
        .constantFrom("+5", "05", "007", "5.", "+0.5", "-0", "+.5", "0.010", "1e3", "  5")
        .map((raw) => ({ raw, value: Number(raw) })),
    );
    const unitArb = fc
      .record({
        identifier: fc.option(
          fc.oneof(fc.constantFrom("mg/dL", "kg", "mg dL", "x10E3/uL"), optStr),
          { nil: undefined },
        ),
        text: optStr,
        nameOfCodingSystem: mnemonic,
      })
      .map((r) => compact<CWE>(r));
    fc.assert(
      fc.property(nmArb, unitArb, (nm, units) => {
        const { value, issues } = guard(() => toFhirQuantity(nm, units, ctx));
        assertIssues(issues);
        if (value !== undefined) expect(embedAndValidate([["valueQuantity", value]])).toEqual([]);
      }),
      { numRuns },
    );
  });
});

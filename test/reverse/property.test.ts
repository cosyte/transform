/**
 * Property + fuzz coverage over the **reverse boundary**. For arbitrary (including hostile) FHIR
 * resources and triggers, `toV2Patient` / `toV2Observation` must:
 *   1. **never throw** (the fail-safe rule, in the other direction);
 *   2. raise only **registered**, **value-free** issue codes (a sentinel threaded through every
 *      mapped value, and through `resourceType` itself, must never reach the diagnostic channel);
 *   3. emit a **complete message** that `@cosyte/hl7`'s own parser accepts without a fatal error
 *      (never a bare segment: a segment with no MSH is not parseable HL7);
 *   4. carry the caller's trigger **verbatim** in MSH-9, under the message code the shape fixes; and
 *   5. build **no message at all** when the required trigger is missing, empty, or not bare.
 *
 * (3) is a parses-back check, not a round-trip claim: nothing here asserts that the emitted message
 * equals, or transforms back to, any original.
 */

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { parseHL7, Hl7ParseError } from "@cosyte/hl7";
import { parseResource } from "@cosyte/fhir";

import {
  toV2Patient,
  toV2Observation,
  ISSUE_CODES,
  ISSUE_REGISTRY,
  type ReverseResult,
} from "../../src/index.js";

const SENTINEL = "PHIZZ";
const registeredCodes = new Set<string>(Object.values(ISSUE_CODES));
const numRuns = Number(process.env["FUZZ_RUNS"] ?? "300");

/** A token that always carries the leak sentinel, and may carry HL7 delimiters. */
const token = fc.stringMatching(/^[A-Za-z0-9 |^~\\&]{0,8}$/).map((s) => SENTINEL + s);
const optToken = fc.option(token, { nil: undefined });
const trigger = fc.constantFrom("A01", "A08", "A28", "A31", "R01", "R30", "a08", " A01 ", "^", "|");
const gender = fc.constantFrom("female", "male", "other", "unknown", "PHIZZ", "");
const status = fc.constantFrom("final", "corrected", "entered-in-error", "registered", "PHIZZ", "");

/** Assert the invariants that hold for every reverse result, whatever it was handed. */
function assertResult(result: ReverseResult, messageCode: string, trig: string): void {
  // (2) registered + value-free
  expect(JSON.stringify(result.issues)).not.toContain(SENTINEL);
  for (const raised of result.issues) {
    expect(registeredCodes.has(raised.code)).toBe(true);
    expect(raised.v2Location.length).toBeGreaterThan(0);
    expect(raised.message).toBe(ISSUE_REGISTRY[raised.code].message);
  }
  if (result.value === undefined) return;
  // (3) a complete message the parser accepts, never a bare segment
  const wire = result.value.toString();
  expect(wire.startsWith("MSH|")).toBe(true);
  const round = parseHL7(wire);
  // (4) the trigger, verbatim, under the shape's own message code
  expect(round.meta.type).toBe(`${messageCode}^${trig}`);
}

describe("reverse boundary: fail-safe, value-free, parses back, trigger verbatim", () => {
  it("never throws and holds every invariant over arbitrary Patient resources", () => {
    const arb = fc.record({
      trig: trigger,
      family: optToken,
      given: fc.array(token, { maxLength: 3 }),
      mrn: optToken,
      system: fc.option(fc.constantFrom("urn:oid:1.2.3", "http://example.org/x"), {
        nil: undefined,
      }),
      sex: gender,
      use: fc.constantFrom("official", "maiden", "temp", "PHIZZ", ""),
      birthDate: fc.constantFrom("1980-01-15", "1980-01", "1980", "PHIZZ", "1980-01-15T10:00:00Z"),
      city: optToken,
    });
    fc.assert(
      fc.property(arb, (p) => {
        const resource = parseResource(
          JSON.stringify({
            resourceType: "Patient",
            identifier: p.mrn === undefined ? undefined : [{ value: p.mrn, system: p.system }],
            name: [{ use: p.use, family: p.family, given: p.given }],
            birthDate: p.birthDate,
            gender: p.sex,
            address: [{ city: p.city }],
          }),
        ).resource;
        let result: ReverseResult;
        try {
          result = toV2Patient(resource, p.trig, {
            assigningAuthorities: { "urn:oid:1.2.3": "HOSP" },
          });
        } catch (err) {
          throw new Error("toV2Patient threw (reverse fail-safe violated)", { cause: err });
        }
        assertResult(result, "ADT", p.trig);
      }),
      { numRuns },
    );
  });

  it("never throws and holds every invariant over arbitrary Observation resources", () => {
    const arb = fc.record({
      trig: trigger,
      code: optToken,
      system: fc.constantFrom("http://loinc.org", "http://example.org/local", ""),
      state: status,
      magnitude: fc.constantFrom(120.5, 0, -3, 1),
      unit: optToken,
      text: optToken,
      flag: fc.constantFrom("H", "ZZ", "PHIZZ", ""),
      effective: fc.constantFrom("2026-01-02T10:15:00-05:00", "2026-01-02", "PHIZZ"),
    });
    fc.assert(
      fc.property(arb, fc.boolean(), (p, coded) => {
        const value = coded
          ? { valueCodeableConcept: { coding: [{ system: p.system, code: p.code }] } }
          : { valueQuantity: { value: p.magnitude, unit: p.unit } };
        const resource = parseResource(
          JSON.stringify({
            resourceType: "Observation",
            status: p.state,
            code: { coding: [{ system: p.system, code: p.code }], text: p.text },
            effectiveDateTime: p.effective,
            interpretation: [
              {
                coding: [
                  {
                    system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                    code: p.flag,
                  },
                ],
              },
            ],
            ...value,
          }),
        ).resource;
        let result: ReverseResult;
        try {
          result = toV2Observation(resource, p.trig);
        } catch (err) {
          throw new Error("toV2Observation threw (reverse fail-safe violated)", { cause: err });
        }
        assertResult(result, "ORU", p.trig);
      }),
      { numRuns },
    );
  });

  it("never throws, and never emits, on a hostile resourceType or an unusable trigger", () => {
    const hostileType = fc.stringMatching(/^[A-Za-z0-9]{0,12}$/).map((s) => SENTINEL + s);
    fc.assert(
      fc.property(hostileType, fc.constantFrom("", "   ", "A^28", "A 28", "A28"), (type, trig) => {
        const resource = parseResource(
          JSON.stringify({ resourceType: type, gender: "female" }),
        ).resource;
        const result = toV2Patient(resource, trig);
        // A rejected type never reaches a diagnostic: it is reported as the generic Resource.
        expect(JSON.stringify(result.issues)).not.toContain(SENTINEL);
        for (const raised of result.issues) expect(registeredCodes.has(raised.code)).toBe(true);
        expect(result.value).toBeUndefined();
        if (trig.trim() === "") {
          expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_MISSING_TRIGGER);
        }
      }),
      { numRuns },
    );
  });

  it("refuses a trigger that is not bare, rather than writing something else into MSH-9", () => {
    for (const trig of ["A^28", "A 28", "A|28", "A~28"]) {
      const result = toV2Patient(
        parseResource('{"resourceType":"Patient","gender":"female"}').resource,
        trig,
      );
      expect(result.value).toBeUndefined();
      expect(result.issues.map((i) => i.code)).toEqual([
        ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE,
      ]);
    }
  });

  it("emits nothing a v2 parser would fatally reject", () => {
    // The one shape that is guaranteed to fail: a bare segment with no MSH. Asserted here so the
    // parses-back property above is known to have teeth.
    expect(() => parseHL7("PID|||MRN1||Public^Jane")).toThrow(Hl7ParseError);
  });
});

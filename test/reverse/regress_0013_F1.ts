/**
 * Regress evidence for spec S0013-transform-advance, impl-gate finding F1.
 *
 * Acceptance criterion 15 (quoted):
 *
 *   "IF an in-scope FHIR resource is missing data that a v2-mandatory field would otherwise carry,
 *    with no safe default available, THEN THE SYSTEM SHALL leave that v2 field absent (per v2
 *    optionality rules) AND FLAG IT, never fabricate a placeholder value to satisfy v2 structure."
 *
 * The implementation satisfies the "leave absent / never fabricate" half and does not satisfy the
 * "and flag it" half: a `Patient` with no `identifier` and no `name` yields a complete `ADT` message
 * whose `PID` carries neither PID-3 (Patient Identifier List, v2.5.1 usage R) nor PID-5 (Patient
 * Name, usage R), with an EMPTY `issues` array; an `Observation` with no `status` yields an `ORU`
 * whose `OBX` carries no OBX-11 (Observation Result Status, usage R), also with an empty `issues`
 * array. A resource with nothing mappable at all returns `{ value: undefined, issues: [] }`, which a
 * caller cannot distinguish from a successful empty conversion.
 *
 * These tests FAIL against commit e5482a2. They document the gap; fixing it is upstream's job.
 */

import { describe, it, expect } from "vitest";
import { parseHL7 } from "@cosyte/hl7";
import { parseResource } from "@cosyte/fhir";

import { toV2Patient, toV2Observation } from "../../src/index.js";

const node = (json: string) => parseResource(json).resource;

describe("S0013 F1: a v2-mandatory field with no FHIR source must be flagged, not silently absent", () => {
  it("flags PID-3 and PID-5 when the Patient carries neither identifier nor name", () => {
    const result = toV2Patient(node('{"resourceType":"Patient","gender":"female"}'), "A28");
    const wire = String(result.value);
    const parsed = parseHL7(wire);

    // The "leave absent, never fabricate" half holds: no placeholder is written.
    expect(parsed.get("PID.3")).toBeUndefined();
    expect(parsed.get("PID.5")).toBeUndefined();

    // The "and flag it" half does not: the message ships with no diagnostic at all.
    expect(result.issues).not.toEqual([]);
  });

  it("flags OBX-11 when the Observation carries no status", () => {
    const result = toV2Observation(
      node(
        '{"resourceType":"Observation","code":{"coding":[{"system":"http://loinc.org","code":"789-8"}]}}',
      ),
      "R01",
    );
    const parsed = parseHL7(String(result.value));

    expect(parsed.get("OBX.11")).toBeUndefined();
    expect(result.issues).not.toEqual([]);
  });

  it("says something when it declines to emit any message at all", () => {
    const result = toV2Patient(node('{"resourceType":"Patient"}'), "A28");

    expect(result.value).toBeUndefined();
    // A silent `{ value: undefined, issues: [] }` tells the caller nothing about why.
    expect(result.issues).not.toEqual([]);
  });
});

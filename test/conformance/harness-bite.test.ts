/**
 * The harness's own test: a known-bad Bundle that must fail and a known-good one that must pass.
 *
 * ▶ A VALIDATOR THAT HAS NEVER BEEN SEEN TO REFUSE IS NOT EVIDENCE OF ANYTHING. Every number the
 * published result carries rests on this file: if the checks below cannot be shown to bite, a clean
 * measurement is indistinguishable from a validator that was never wired up. Each case names the
 * class of check it exercises, and each is paired with the same resource, conformant, so a refusal
 * cannot be an artifact of the resource shape.
 */

import { parseResource, type FhirComplex } from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import {
  bundleResources,
  errorFindings,
  validateOne,
  type Finding,
} from "../../scripts/conformance/harness.js";
import { definitions } from "../_support/conformance.js";

const US_CORE_PATIENT = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient";
const US_CORE_LAB = "http://hl7.org/fhir/us/core/StructureDefinition/us-core-observation-lab";

/** A Patient that satisfies the US Core patient profile: measured, not assumed (see below). */
const CONFORMANT_PATIENT = {
  resourceType: "Patient",
  id: "conformant",
  identifier: [
    {
      type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
      system: "urn:oid:1.2.3.4.5",
      value: "1032702",
    },
  ],
  name: [{ family: "Everywoman", given: ["Eve"] }],
  gender: "female",
  birthDate: "1970-06-01",
} as const;

function model(resource: unknown): FhirComplex {
  return parseResource(JSON.stringify(resource)).resource;
}

/** Wrap resources in a message Bundle, the shape the harness actually walks. */
function bundle(...resources: unknown[]): FhirComplex {
  return model({
    resourceType: "Bundle",
    id: "bite",
    type: "message",
    entry: resources.map((resource, i) => ({
      fullUrl: `urn:uuid:00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      resource,
    })),
  });
}

/** Validate every entry of a Bundle against one profile, the way a run does. */
function validateBundle(b: FhirComplex, profile: string | null): Finding[] {
  const defs = definitions();
  return bundleResources(b).flatMap((entry) => validateOne(entry.resource, defs, profile));
}

describe("D1: the harness bites on a profile violation, and stays quiet on a conformant resource", () => {
  it("a Bundle whose Patient satisfies the profile produces NO error-severity result", () => {
    const findings = validateBundle(bundle(CONFORMANT_PATIENT), US_CORE_PATIENT);
    expect(errorFindings(findings)).toEqual([]);
    // Not vacuous: the profile WAS applied, and it had things to say at lower severities.
    expect(findings.length).toBeGreaterThan(0);
  });

  it("a Bundle whose Patient breaks a profile cardinality produces an error naming the element", () => {
    const violating = {
      ...CONFORMANT_PATIENT,
      id: "violating",
      // US Core requires `Patient.identifier.system`; base R4 does not.
      identifier: [{ type: CONFORMANT_PATIENT.identifier[0].type, value: "1032702" }],
    };
    const errors = errorFindings(validateBundle(bundle(violating), US_CORE_PATIENT));
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.map((f) => f.path)).toContain("Patient.identifier.system");
    expect(errors.map((f) => f.code)).toContain("CARDINALITY_MIN");

    // The SAME resource against base R4 alone is clean, which is what makes this a PROFILE finding
    // rather than a resource that was broken in some other way.
    expect(errorFindings(validateBundle(bundle(violating), null))).toEqual([]);
  });

  it("a Bundle whose Observation is missing a profile-required slice produces an error", () => {
    const observation = {
      resourceType: "Observation",
      id: "no-category",
      status: "final",
      code: { coding: [{ system: "http://loinc.org", code: "6153-1" }] },
      subject: { reference: "urn:uuid:00000000-0000-4000-8000-000000000000" },
      valueQuantity: {
        value: 3.9,
        unit: "kU/L",
        system: "http://unitsofmeasure.org",
        code: "kU/L",
      },
    };
    const errors = errorFindings(validateBundle(bundle(observation), US_CORE_LAB));
    expect(errors.map((f) => f.path)).toContain("Observation.category");
    expect(errors.some((f) => f.path.includes("Observation.category:"))).toBe(true);
  });

  it("the base R4 layer bites too: an out-of-binding code, a bad primitive, an unknown element", () => {
    // The finding's code and its path are compared as a pair, never joined into one string: a
    // `CODE@Path` join reads as an email address to this repository's own PHI scanner, which reads
    // every tracked file including this one.
    const has = (findings: readonly Finding[], code: string, path: string): boolean =>
      findings.some((f) => f.code === code && f.path === path);

    const badCode = errorFindings(
      validateBundle(bundle({ ...CONFORMANT_PATIENT, gender: "masculine" }), null),
    );
    expect(has(badCode, "CODE_INVALID", "Patient.gender")).toBe(true);

    const badPrimitive = errorFindings(
      validateBundle(bundle({ ...CONFORMANT_PATIENT, birthDate: "not-a-date" }), null),
    );
    expect(has(badPrimitive, "PRIMITIVE_INVALID", "Patient.birthDate")).toBe(true);

    const unknownElement = errorFindings(
      validateBundle(bundle({ ...CONFORMANT_PATIENT, notAnR4Element: "x" }), null),
    );
    expect(unknownElement.map((f) => f.code)).toContain("UNKNOWN_ELEMENT");

    // And the same Patient with none of those three defects is clean, so each assertion above is a
    // measurement of the defect and not of the resource.
    expect(errorFindings(validateBundle(bundle(CONFORMANT_PATIENT), null))).toEqual([]);
  });

  it("the base R4 invariant layer bites: a booked Appointment with no start violates app-3", () => {
    const appointment = {
      resourceType: "Appointment",
      id: "no-start",
      status: "booked",
      participant: [{ status: "accepted", actor: { display: "someone" } }],
    };
    const errors = errorFindings(validateBundle(bundle(appointment), null));
    expect(errors.map((f) => f.constraint)).toContain("app-3");

    // Give it the start and end R4 asks for and the same invariant goes quiet.
    const fixed = {
      ...appointment,
      id: "started",
      start: "2015-06-13T14:00:00Z",
      end: "2015-06-13T14:15:00Z",
    };
    expect(
      errorFindings(validateBundle(bundle(fixed), null)).map((f) => f.constraint),
    ).not.toContain("app-3");
  });

  it("refuses to validate against a profile the pinned package does not publish", () => {
    expect(() =>
      validateOne(model(CONFORMANT_PATIENT), definitions(), "http://example.invalid/not-a-profile"),
    ).toThrow(/publishes no/);
  });
});

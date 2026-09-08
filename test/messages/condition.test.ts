/**
 * DG1 to `Condition`, against the committed IG **DG1 to Condition** segment map and the **ADT_A01
 * to Bundle** message map: one fixture per implemented row, the deferred rows, the codeless
 * occurrence, the unmapped action code, the withhold path when no Patient anchors the diagnosis,
 * and the emit gate that decides whether a produced Condition may ship at all.
 */

import { describe, expect, it } from "vitest";

import { complex, primitive, validateResource, type FhirComplex } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

import {
  CONDITION_ENTERED_IN_ERROR,
  CONDITION_VERIFICATION_STATUS_SYSTEM,
  DG1_RETRACTION_ACTION_CODE,
  ISSUE_CODES,
  buildCondition,
  collectDiagnoses,
  deferredDiagnosisIssues,
  emitEncounterDiagnosis,
  withEncounterDiagnosis,
} from "../../src/index.js";
import { EMIT_SCHEMAS } from "../../src/messages/emit-schemas.js";
import {
  MSH_ADT_A01,
  PID_JANE,
  PV1_INPATIENT,
  entryTypes,
  fullUrls,
  fullUrlsOfType,
  labels,
  references,
  resourcesOfType,
  run,
  segment,
} from "../_support/clinical-fixtures.js";

const DROPPED = ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED;
const UNMAPPED = ISSUE_CODES.TRANSFORM_CODE_UNMAPPED;

/** A DG1 valuing every row this library implements, plus the two rows it defers. */
const DG1_FULL = segment("DG1", {
  1: "1",
  2: "I9",
  3: "250.00^Diabetes mellitus^I9",
  4: "Type 2 diabetes, stated",
  5: "20260720120000-0500",
  16: "1234^Attending^A",
  19: "20260721090000-0500",
  20: "DIAG1^HOSP^1.2.3^ISO",
  21: "D",
  22: "PARENT1",
});

/** The first `DG1` of a message, for the direct-builder tests. */
function firstDiagnosis(lines: readonly string[]) {
  const found = collectDiagnoses(parseHL7(lines.join("\r")))[0];
  if (found === undefined) throw new Error("fixture carries no DG1");
  return found;
}

describe("a DG1 becomes a Condition wired to the bundle Patient", () => {
  it("emits one Condition per DG1, subject-resolved inside the bundle", () => {
    const result = run([MSH_ADT_A01, PID_JANE, DG1_FULL]);
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "Condition"]);

    const [patientUrl] = fullUrlsOfType(result, "Patient");
    const [condition] = resourcesOfType(result, "Condition");
    expect(condition?.["subject"]).toEqual({ reference: patientUrl });

    // The reference is not merely present: it resolves to an entry of this same bundle.
    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });

  it("populates the five element rows the map grounds, and leaves each absent when unvalued", () => {
    const rich = resourcesOfType(run([MSH_ADT_A01, PID_JANE, DG1_FULL]), "Condition")[0];
    expect(rich).toMatchObject({
      identifier: [{ value: "DIAG1" }],
      code: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-9-cm",
            code: "250.00",
            display: "Diabetes mellitus",
          },
        ],
        text: "Type 2 diabetes, stated",
      },
      onsetDateTime: "2026-07-20T12:00:00-05:00",
      recordedDate: "2026-07-21T09:00:00-05:00",
    });

    // The same rows, none of them valued: every element is absent rather than defaulted.
    const bare = resourcesOfType(
      run([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1", 3: "250.00^Diab^I9" })]),
      "Condition",
    )[0];
    expect(bare).toBeDefined();
    for (const absent of ["identifier", "onsetDateTime", "recordedDate", "verificationStatus"]) {
      expect([absent, Object.hasOwn(bare ?? {}, absent)]).toEqual([absent, false]);
    }
    expect((bare?.["code"] as Record<string, unknown> | undefined)?.["text"]).toBeUndefined();
  });

  it("lets DG1-4 supply code.text, and keeps the coded field's own text when DG1-4 is absent", () => {
    const withDescription = resourcesOfType(
      run([
        MSH_ADT_A01,
        PID_JANE,
        segment("DG1", { 1: "1", 3: "250.00^Diab^I9^^^^^^Original text", 4: "Described" }),
      ]),
      "Condition",
    )[0];
    expect((withDescription?.["code"] as Record<string, unknown>)["text"]).toBe("Described");

    const withoutDescription = resourcesOfType(
      run([
        MSH_ADT_A01,
        PID_JANE,
        segment("DG1", { 1: "1", 3: "250.00^Diab^I9^^^^^^Original text" }),
      ]),
      "Condition",
    )[0];
    expect((withoutDescription?.["code"] as Record<string, unknown>)["text"]).toBe("Original text");
  });

  it("carries an EI identifier's value and never a system synthesized from its authority", () => {
    const result = run([MSH_ADT_A01, PID_JANE, DG1_FULL]);
    const identifiers = resourcesOfType(result, "Condition")[0]?.["identifier"] as
      | Record<string, unknown>[]
      | undefined;
    expect(identifiers).toEqual([{ value: "DIAG1" }]);
    expect(labels(result)).toContain(`${DROPPED}@DG1.20#Condition.identifier.system`);
  });
});

describe("DG1-21 grounds exactly one verification status", () => {
  it("assigns entered-in-error for the one action code the map's assignment covers", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("DG1", { 1: "1", 3: "250.00^Diab^I9", 21: DG1_RETRACTION_ACTION_CODE }),
    ]);
    expect(resourcesOfType(result, "Condition")[0]?.["verificationStatus"]).toEqual({
      coding: [{ system: CONDITION_VERIFICATION_STATUS_SYSTEM, code: CONDITION_ENTERED_IN_ERROR }],
    });
    expect(labels(result).some((l) => l.includes("Condition.verificationStatus"))).toBe(false);
  });

  it("leaves the status absent and flags every other published action code, never a neighbour", () => {
    // The Table 0206 codes the guide publishes beside `D`, each one asserted on its own.
    for (const action of ["A", "S", "U", "X"]) {
      const result = run([
        MSH_ADT_A01,
        PID_JANE,
        segment("DG1", { 1: "1", 3: "250.00^Diab^I9", 21: action }),
      ]);
      const condition = resourcesOfType(result, "Condition")[0];
      expect([action, Object.hasOwn(condition ?? {}, "verificationStatus")]).toEqual([
        action,
        false,
      ]);
      expect([action, labels(result)]).toEqual([
        action,
        expect.arrayContaining([`${UNMAPPED}@DG1.21#Condition.verificationStatus`]),
      ]);
    }
  });
});

describe("a diagnosis that names nothing is emitted and declared, never silently empty", () => {
  it("emits the Condition and flags its empty code when neither DG1-3 nor DG1-4 is valued", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1", 2: "I9" })]);
    const condition = resourcesOfType(result, "Condition")[0];
    expect(condition).toBeDefined();
    expect(Object.hasOwn(condition ?? {}, "code")).toBe(false);
    expect(labels(result)).toContain(`${DROPPED}@DG1[0]#Condition.code`);
  });

  it("does not flag the code of a DG1 that carries only a description", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1", 4: "Text only" })]);
    expect(resourcesOfType(result, "Condition")[0]?.["code"]).toEqual({ text: "Text only" });
    expect(labels(result)).not.toContain(`${DROPPED}@DG1[0]#Condition.code`);
  });
});

describe("the Encounter back-reference", () => {
  it("adds one diagnosis entry per emitted Condition, pointing at its fullUrl", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      PV1_INPATIENT,
      segment("DG1", { 1: "1", 3: "250.00^Diab^I9" }),
      segment("DG1", { 1: "2", 3: "401.9^Hyp^I9" }),
    ]);
    const conditionUrls = fullUrlsOfType(result, "Condition");
    expect(conditionUrls).toHaveLength(2);
    expect(resourcesOfType(result, "Encounter")[0]?.["diagnosis"]).toEqual(
      conditionUrls.map((url) => ({ condition: { reference: url } })),
    );
  });

  it("emits the Conditions with no Encounter wiring, and no issue, when no Encounter was emitted", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1", 3: "250.00^Diab^I9" })]);
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "Condition"]);
    expect(labels(result).some((l) => l.includes("Encounter.diagnosis"))).toBe(false);
  });

  it("adds no diagnosis entry to an Encounter whose message carried no DG1", () => {
    const result = run([MSH_ADT_A01, PID_JANE, PV1_INPATIENT]);
    expect(Object.hasOwn(resourcesOfType(result, "Encounter")[0] ?? {}, "diagnosis")).toBe(false);
  });

  it("keeps the Encounter and declares the link when the gate refuses the linked draft", () => {
    // A detail must never cost the visit: with the gate refusing, the original Encounter is what
    // stays in the bundle and the link it did not make is declared rather than silently absent.
    const encounter = complex([
      { name: "resourceType", value: primitive("Encounter") },
      { name: "status", value: primitive("in-progress") },
    ]);
    const refused = emitEncounterDiagnosis(encounter, ["urn:uuid:cond-1"], () => false);
    expect(refused.value).toBe(encounter);
    expect(refused.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`)).toEqual([
      `${DROPPED}@DG1#Encounter.diagnosis`,
    ]);

    const accepted = emitEncounterDiagnosis(encounter, ["urn:uuid:cond-1"], () => true);
    expect(accepted.issues).toEqual([]);
    expect(withEncounterDiagnosis(encounter, [])).toBe(encounter);
  });
});

describe("the deferred DG1 rows are declared, never silently absent", () => {
  it("raises one issue per valued deferred row, naming the row and the path it did not build", () => {
    const result = run([MSH_ADT_A01, PID_JANE, DG1_FULL]);
    expect(labels(result)).toEqual(
      expect.arrayContaining([
        `${DROPPED}@DG1.16#Condition.asserter`,
        `${DROPPED}@DG1.22#Condition.extension[condition-dueTo].valueReference`,
        `${DROPPED}@DG1#EpisodeOfCare`,
      ]),
    );
  });

  it("raises none of them for a DG1 that values none of those rows", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1", 3: "250.00^Diab^I9" })]);
    expect(labels(result)).not.toContain(`${DROPPED}@DG1.16#Condition.asserter`);
    expect(labels(result)).not.toContain(
      `${DROPPED}@DG1.22#Condition.extension[condition-dueTo].valueReference`,
    );
    // The EpisodeOfCare target is unbuilt for every DG1, so it is declared once for the message.
    expect(labels(result).filter((l) => l === `${DROPPED}@DG1#EpisodeOfCare`)).toHaveLength(1);
  });

  it("declares the unbuilt EpisodeOfCare once, however many DG1 occurrences the message carries", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("DG1", { 1: "1", 3: "250.00^Diab^I9" }),
      segment("DG1", { 1: "2", 3: "401.9^Hyp^I9" }),
      segment("DG1", { 1: "3", 3: "272.0^Chol^I9" }),
    ]);
    expect(labels(result).filter((l) => l === `${DROPPED}@DG1#EpisodeOfCare`)).toHaveLength(1);
  });

  it("declares the deferred rows even for an occurrence whose Condition is withheld", () => {
    const result = run([MSH_ADT_A01, DG1_FULL]);
    expect(resourcesOfType(result, "Condition")).toHaveLength(0);
    expect(labels(result)).toContain(`${DROPPED}@DG1.16#Condition.asserter`);
  });
});

describe("no Patient means no diagnosis, and the withholding is declared", () => {
  it("withholds every Condition and names each occurrence and the subject it could not anchor", () => {
    const result = run([
      MSH_ADT_A01,
      segment("DG1", { 1: "1", 3: "250.00^Diab^I9" }),
      segment("DG1", { 1: "2", 3: "401.9^Hyp^I9" }),
    ]);
    expect(resourcesOfType(result, "Condition")).toHaveLength(0);
    expect(labels(result)).toEqual(
      expect.arrayContaining([
        `${DROPPED}@DG1[0]#Condition.subject`,
        `${DROPPED}@DG1[1]#Condition.subject`,
      ]),
    );
    // Nothing in the bundle points at a patient the bundle does not carry.
    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });
});

describe("repeated DG1 occurrences", () => {
  it("emits one Condition per occurrence, in message order, never collapsing repeats", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("DG1", { 1: "1", 3: "250.00^Diab^I9" }),
      segment("DG1", { 1: "2", 3: "401.9^Hyp^I9" }),
      segment("DG1", { 1: "3", 3: "250.00^Diab^I9" }),
    ]);
    const conditions = resourcesOfType(result, "Condition");
    expect(conditions).toHaveLength(3);
    expect(
      conditions.map(
        (c) => ((c["code"] as { coding?: { code?: string }[] }).coding ?? [])[0]?.code ?? "",
      ),
    ).toEqual(["250.00", "401.9", "250.00"]);
    // Three distinct identities: the third repeat is its own resource, not the first reused.
    expect(new Set(fullUrlsOfType(result, "Condition")).size).toBe(3);
  });
});

describe("the conservative-emit gate decides whether a produced Condition may ship", () => {
  const built = buildCondition(
    firstDiagnosis([MSH_ADT_A01, PID_JANE, DG1_FULL]),
    "urn:uuid:pat",
    {},
    "DG1[0]",
  );

  it("passes the Condition this library produces", () => {
    expect(built.value).toBeDefined();
    expect(
      validateResource(built.value as FhirComplex, { mode: "lenient", schemas: EMIT_SCHEMAS })
        .valid,
    ).toBe(true);
  });

  it("REFUSES the same Condition with its required subject removed", () => {
    // The mutation the schema entry exists to catch: without it the gate waves this through, so
    // this expectation is what proves the check can fail rather than merely being present.
    const subjectless = complex(
      (built.value as FhirComplex).properties.filter((p) => p.name !== "subject"),
    );
    const withEntry = validateResource(subjectless, {
      mode: "lenient",
      schemas: EMIT_SCHEMAS,
    });
    expect(withEntry.valid).toBe(false);
    expect(withEntry.issues.map((i) => i.expression)).toContain("Condition.subject");

    const withoutEntry = validateResource(subjectless, {
      mode: "lenient",
      schemas: EMIT_SCHEMAS.filter((s) => s.type !== "Condition"),
    });
    expect(withoutEntry.valid).toBe(true);
  });
});

describe("the builder called directly", () => {
  it("returns the deferred-row issues for the occurrence, independently of the resource", () => {
    const dg1 = firstDiagnosis([MSH_ADT_A01, PID_JANE, DG1_FULL]);
    expect(deferredDiagnosisIssues(dg1).map((i) => `${i.code}@${i.v2Location}`)).toEqual([
      `${DROPPED}@DG1.16`,
      `${DROPPED}@DG1.22`,
    ]);
  });

  it("never carries a field value into an issue", () => {
    const dg1 = firstDiagnosis([MSH_ADT_A01, PID_JANE, DG1_FULL]);
    const result = buildCondition(dg1, "urn:uuid:pat", {}, "DG1[0]");
    const rendered = JSON.stringify(result.issues);
    for (const token of ["DIAG1", "250.00", "Diabetes", "PARENT1", "Attending"]) {
      expect([token, rendered.includes(token)]).toEqual([token, false]);
    }
  });

  it("builds a Condition whose only required element is the subject it was handed", () => {
    const dg1 = firstDiagnosis([MSH_ADT_A01, PID_JANE, segment("DG1", { 1: "1" })]);
    const result = buildCondition(dg1, "urn:uuid:pat", {}, "DG1[0]");
    expect(result.value).toEqual(
      complex([
        { name: "resourceType", value: primitive("Condition") },
        {
          name: "subject",
          value: complex([{ name: "reference", value: primitive("urn:uuid:pat") }]),
        },
      ]),
    );
  });
});

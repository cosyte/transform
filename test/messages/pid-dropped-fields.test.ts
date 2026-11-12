/**
 * The PID fields `Patient` does not carry are reported, never lost without a word, and each report
 * names the field the value came from.
 *
 * PID-10 race, PID-15 primary language, PID-19 SSN, PID-22 ethnic group, PID-29 death date and time
 * and PID-30 death indicator have no conversion here. Each one that is valued raises one
 * `TRANSFORM_ELEMENT_DROPPED` at its own field, with the FHIR element the IG's PID to Patient map
 * sends it to (none for race and ethnic group, which that map gives no row). PID-13 home and PID-14
 * business telecom are reported the same way, each at its own field, and so are the animal fields
 * PID-37 strain and PID-38 production class, on an ADT and an ORU. PID-35 species and PID-36 breed
 * are carried instead, in the FHIR R4 core `patient-animal` extension, and are reported only when a
 * value cannot be carried there.
 *
 * Every fixture is synthetic; every person-identifying literal comes from the PHI allow-list.
 */

import { parseHL7 } from "@cosyte/hl7";
import { validateResource } from "@cosyte/fhir";
import { describe, expect, it } from "vitest";

import { buildPatient } from "../../src/messages/patient.js";

import {
  MSH_ADT_A01,
  issuesAt,
  labels,
  resourcesOfType,
  run,
  segment,
} from "../_support/clinical-fixtures.js";

/** The fields of the shared Jane PID, so a fixture can add one field to it by position. */
const JANE: Readonly<Record<number, string>> = {
  1: "1",
  3: "MRN12345^^^HOSP^MR",
  5: "Public^Jane^Q",
  7: "19800115",
  8: "F",
};

/** The shared Jane PID with the given fields added at their 1-indexed positions. */
function pid(extra: Readonly<Record<number, string>>): string {
  return segment("PID", { ...JANE, ...extra });
}

/** The `TRANSFORM_ELEMENT_DROPPED` labels among the result's issues, in order. */
function drops(lines: readonly string[]): string[] {
  return labels(run(lines)).filter((l) => l.startsWith("TRANSFORM_ELEMENT_DROPPED@PID."));
}

/** The single Patient the message produced. */
function patientOf(lines: readonly string[]): Record<string, unknown> {
  const found = resourcesOfType(run(lines), "Patient");
  expect(found, "exactly one Patient").toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

describe("PID fields with no conversion raise TRANSFORM_ELEMENT_DROPPED", () => {
  it("raises nothing for the Jane PID, which values none of them", () => {
    expect(drops([MSH_ADT_A01, pid({})])).toEqual([]);
  });

  it("reports each of the six fields at its own location with its IG target", () => {
    const lines = [
      MSH_ADT_A01,
      pid({
        10: "2106-3^White^CDCREC",
        15: "en^English^ISO639",
        19: "999887777",
        22: "2186-5^Not Hispanic or Latino^CDCREC",
        29: "20260115",
        30: "Y",
      }),
    ];
    expect(drops(lines)).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.10#",
      "TRANSFORM_ELEMENT_DROPPED@PID.15#Patient.communication.language",
      "TRANSFORM_ELEMENT_DROPPED@PID.19#Patient.identifier",
      "TRANSFORM_ELEMENT_DROPPED@PID.22#",
      "TRANSFORM_ELEMENT_DROPPED@PID.29#Patient.deceasedDateTime",
      "TRANSFORM_ELEMENT_DROPPED@PID.30#Patient.deceasedBoolean",
    ]);
  });

  it("still writes no deceased element and no SSN identifier: the report is all that changes", () => {
    const patient = patientOf([MSH_ADT_A01, pid({ 19: "999887777", 29: "20260115", 30: "Y" })]);
    expect(Object.keys(patient).filter((k) => k.startsWith("deceased"))).toEqual([]);
    expect(patient["identifier"]).toEqual(patientOf([MSH_ADT_A01, pid({})])["identifier"]);
  });

  it("reports a death indicator of N too: the field is valued, whatever it says", () => {
    expect(drops([MSH_ADT_A01, pid({ 30: "N" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.30#Patient.deceasedBoolean",
    ]);
  });

  it("reports a field valued only past its first component", () => {
    expect(drops([MSH_ADT_A01, pid({ 10: "^White^CDCREC" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.10#",
    ]);
  });

  it("reports a field valued only in a later repetition once", () => {
    expect(drops([MSH_ADT_A01, pid({ 22: "~2186-5^Not Hispanic or Latino^CDCREC" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.22#",
    ]);
  });

  it('raises nothing for a field sent as the HL7 null ""', () => {
    expect(drops([MSH_ADT_A01, pid({ 10: '""', 19: '""', 29: '""', 30: '""' })])).toEqual([]);
  });

  it("carries no field value into an issue", () => {
    const result = run([MSH_ADT_A01, pid({ 19: "999887777", 29: "20260115" })]);
    expect(JSON.stringify(result.issues)).not.toContain("999887777");
    expect(JSON.stringify(result.issues)).not.toContain("20260115");
  });
});

describe("dropped telecom is reported at the field it came from", () => {
  it("a PID-13 home phone is reported at PID.13", () => {
    expect(drops([MSH_ADT_A01, pid({ 13: "555-1234" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.13#Patient.telecom",
    ]);
  });

  it("a PID-14 business phone is reported at PID.14, not PID.13", () => {
    const result = run([MSH_ADT_A01, pid({ 14: "555-9999" })]);
    expect(issuesAt(result, "PID.13")).toEqual([]);
    expect(drops([MSH_ADT_A01, pid({ 14: "555-9999" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.14#Patient.telecom",
    ]);
  });

  it("both fields valued raise one report each, in field order", () => {
    expect(drops([MSH_ADT_A01, pid({ 13: "555-1234~555-8473", 14: "555-9999" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.13#Patient.telecom",
      "TRANSFORM_ELEMENT_DROPPED@PID.14#Patient.telecom",
    ]);
  });

  it("a phone carried only in XTN-4, the email component, is still reported", () => {
    expect(drops([MSH_ADT_A01, pid({ 14: "^NET^Internet^jane@example.com" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.14#Patient.telecom",
    ]);
  });

  it('raises nothing for telecom sent as the HL7 null ""', () => {
    expect(drops([MSH_ADT_A01, pid({ 13: '""', 14: '""' })])).toEqual([]);
  });
});

/** An `ORU^R01` MSH, so the animal fields are checked on a result message as well as an ADT. */
const MSH_ORU_R01 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ORU^R01^ORU_R01|MSG00002|P|2.5.1";

/** PID-35 species, PID-36 breed, PID-37 strain and PID-38 production class, each plainly fake. */
const ANIMAL: Readonly<Record<number, string>> = {
  35: "ZZSPECIES1^Synthetic species one^L",
  36: "ZZBREED1^Synthetic breed one^L",
  37: "ZZSTRAIN1",
  38: "ZZPROD1^Synthetic production class one^L",
};

/** The canonical URL of the FHIR R4 core extension an animal patient's species and breed go to. */
const PATIENT_ANIMAL = "http://hl7.org/fhir/StructureDefinition/patient-animal";

/** The `Patient.extension` the transform wrote, or `undefined`. */
function extensionOf(lines: readonly string[]): unknown {
  return patientOf(lines)["extension"];
}

/** The patient-animal extension a species and an optional breed CWE are expected to become. */
function animal(
  species: Record<string, unknown>,
  breed?: Record<string, unknown>,
): Record<string, unknown>[] {
  const parts: Record<string, unknown>[] = [{ url: "species", valueCodeableConcept: species }];
  if (breed !== undefined) parts.push({ url: "breed", valueCodeableConcept: breed });
  return [{ url: PATIENT_ANIMAL, extension: parts }];
}

const SPECIES_ONE = { coding: [{ code: "ZZSPECIES1", display: "Synthetic species one" }] };
const BREED_ONE = { coding: [{ code: "ZZBREED1", display: "Synthetic breed one" }] };

describe("PID-35 species and PID-36 breed map to the patient-animal extension", () => {
  for (const [name, msh] of [
    ["ADT^A01", MSH_ADT_A01],
    ["ORU^R01", MSH_ORU_R01],
  ] as const) {
    it(`writes species and breed as CodeableConcepts from the CWE, in ${name}`, () => {
      expect(extensionOf([msh, pid(ANIMAL)])).toEqual(animal(SPECIES_ONE, BREED_ONE));
    });

    it(`flags only PID-37 and PID-38 as dropped, each at its own field, in ${name}`, () => {
      const result = run([msh, pid(ANIMAL)]);
      expect(drops([msh, pid(ANIMAL)])).toEqual([
        "TRANSFORM_ELEMENT_DROPPED@PID.37#",
        "TRANSFORM_ELEMENT_DROPPED@PID.38#",
      ]);
      expect(issuesAt(result, "PID.35")).toEqual([]);
      expect(issuesAt(result, "PID.36")).toEqual([]);
      for (const field of [37, 38]) {
        const at = issuesAt(result, `PID.${field}`);
        expect(at, `one issue at PID.${field}`).toHaveLength(1);
        expect(at[0]?.severity).toBe("information");
      }
    });

    it(`carries no animal field value into an issue, in ${name}`, () => {
      const text = JSON.stringify(run([msh, pid(ANIMAL)]).issues);
      for (const value of ["ZZSPECIES1", "ZZBREED1", "ZZSTRAIN1", "ZZPROD1", "Synthetic"]) {
        expect(text).not.toContain(value);
      }
    });
  }

  it("resolves a known coding system and keeps the alternate coding and original text", () => {
    const lines = [
      MSH_ADT_A01,
      pid({
        35: "ZZSPECIES2^Synthetic species two^SCT^ZZALT2^Synthetic alternate two^L^^^Fake text",
      }),
    ];
    expect(extensionOf(lines)).toEqual(
      animal({
        coding: [
          {
            system: "http://snomed.info/sct",
            code: "ZZSPECIES2",
            display: "Synthetic species two",
          },
          { code: "ZZALT2", display: "Synthetic alternate two" },
        ],
        text: "Fake text",
      }),
    );
  });

  it("flags an unresolved coding system the way any CWE does, never inventing one", () => {
    const result = run([MSH_ADT_A01, pid({ 35: "ZZSPECIES1^Synthetic species one^L" })]);
    expect(labels(result)).toContain("TRANSFORM_CODE_SYSTEM_UNRESOLVED@CWE.3#Coding.system");
  });

  it("writes species alone when PID-36 is not valued", () => {
    expect(extensionOf([MSH_ADT_A01, pid({ 35: ANIMAL[35] ?? "" })])).toEqual(animal(SPECIES_ONE));
  });

  it("drops a breed with no species, since the extension requires species, and flags it", () => {
    const lines = [MSH_ADT_A01, pid({ 36: ANIMAL[36] ?? "" })];
    expect(extensionOf(lines)).toBeUndefined();
    expect(drops(lines)).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.36#Patient.extension[patient-animal].extension[breed]",
    ]);
  });

  it("flags a species valued only where the CWE has no code or text, and drops its breed too", () => {
    const lines = [MSH_ADT_A01, pid({ 35: "^^^^^^ZZVERSION1", 36: ANIMAL[36] ?? "" })];
    expect(extensionOf(lines)).toBeUndefined();
    expect(drops(lines)).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.35#Patient.extension[patient-animal].extension[species]",
      "TRANSFORM_ELEMENT_DROPPED@PID.36#Patient.extension[patient-animal].extension[breed]",
    ]);
  });

  it("flags a breed valued only where the CWE has no code or text, keeping the species", () => {
    const lines = [MSH_ADT_A01, pid({ 35: ANIMAL[35] ?? "", 36: "^^^^^^ZZVERSION1" })];
    expect(extensionOf(lines)).toEqual(animal(SPECIES_ONE));
    expect(drops(lines)).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.36#Patient.extension[patient-animal].extension[breed]",
    ]);
  });

  it("flags a repetition after the first, which the one species and one breed cannot hold", () => {
    const lines = [
      MSH_ADT_A01,
      pid({ 35: `${ANIMAL[35] ?? ""}~ZZSPECIES3`, 36: `${ANIMAL[36] ?? ""}~ZZBREED3` }),
    ];
    expect(extensionOf(lines)).toEqual(animal(SPECIES_ONE, BREED_ONE));
    expect(drops(lines)).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.35#Patient.extension[patient-animal].extension[species]",
      "TRANSFORM_ELEMENT_DROPPED@PID.36#Patient.extension[patient-animal].extension[breed]",
    ]);
  });

  it("never infers genderStatus from PID-8", () => {
    for (const sex of ["F", "M", "O", "U", "A", "N"]) {
      const lines = [MSH_ADT_A01, pid({ 8: sex, ...ANIMAL })];
      expect(JSON.stringify(patientOf(lines))).not.toContain("genderStatus");
      expect(extensionOf(lines)).toEqual(animal(SPECIES_ONE, BREED_ONE));
    }
  });

  it("builds a Patient from a PID that carries only a species", () => {
    const lines = [MSH_ADT_A01, segment("PID", { 1: "1", 35: ANIMAL[35] ?? "" })];
    expect(patientOf(lines)).toEqual({
      resourceType: "Patient",
      extension: animal(SPECIES_ONE),
    });
  });

  it("emits a Patient that @cosyte/fhir validates in strict mode", () => {
    const msg = parseHL7([MSH_ADT_A01, pid(ANIMAL)].join("\r"));
    const view = msg.patient;
    if (view === undefined) throw new Error("expected a PID view");
    const built = buildPatient(view, {}, msg.segments("PID")[0]).value;
    if (built === undefined) throw new Error("expected a Patient");
    const result = validateResource(built, { mode: "strict" });
    const errors = result.issues.filter((i) => i.severity === "error" || i.severity === "fatal");
    expect(errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it("reports only the animal field that is valued", () => {
    expect(drops([MSH_ADT_A01, pid({ 37: "ZZSTRAIN1" })])).toEqual([
      "TRANSFORM_ELEMENT_DROPPED@PID.37#",
    ]);
  });

  it('writes and raises nothing for animal fields sent as the HL7 null ""', () => {
    const lines = [MSH_ADT_A01, pid({ 35: '""', 36: '""', 37: '""', 38: '""' })];
    expect(drops(lines)).toEqual([]);
    expect(extensionOf(lines)).toBeUndefined();
  });

  it("changes nothing else in the Patient: only the extension is added", () => {
    const withAnimal = { ...patientOf([MSH_ADT_A01, pid(ANIMAL)]) };
    delete withAnimal["extension"];
    expect(withAnimal).toEqual(patientOf([MSH_ADT_A01, pid({})]));
  });

  it("writes no extension for a PID with no animal field", () => {
    expect(extensionOf([MSH_ADT_A01, pid({})])).toBeUndefined();
  });
});

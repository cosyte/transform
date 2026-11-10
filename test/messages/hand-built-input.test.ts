/**
 * Input a JavaScript caller builds by hand rather than parses: a `RawField` handed to
 * `Hl7Message.addSegment` whose repetition has no components, or whose component has no
 * subcomponents, and a message whose typed views (`patient`, `visit`, `nextOfKin()`) carry what the
 * parser itself never would. Each must be read as the absence it is, never as a value, and never
 * crash the transform.
 *
 * Every fixture is synthetic; every person-identifying literal comes from the PHI allow-list.
 */

import { describe, expect, it } from "vitest";

import { parseDtm, parseHL7, type Hl7Message, type RawField } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";

import { createNamingSystem, ISSUE_CODES, toFhir, type TransformResult } from "../../src/index.js";
import {
  MSH_ADT_A01,
  PID_JANE,
  PV1_INPATIENT,
  resourcesOfType,
  sequentialIds,
} from "../_support/clinical-fixtures.js";

const MSH_ORU = MSH_ADT_A01.replace("ADT^A01^ADT_A01", "ORU^R01^ORU_R01");
const OBR = "OBR|1|||24331-1^Lipid panel^LN|||||||||||||||||||||F";

/** A field from repetitions, each a list of components, each a list of subcomponents. */
function field(...repetitions: readonly (readonly (readonly string[])[])[]): RawField {
  return {
    isNull: false,
    repetitions: repetitions.map((components) => ({
      components: components.map((subcomponents) => ({ subcomponents })),
    })),
  };
}

/** A repetition with no components at all, which no parse produces and `addSegment` accepts. */
const NO_COMPONENTS: readonly (readonly string[])[] = [];

function transform(msg: Hl7Message): TransformResult {
  return toFhir(msg, {
    namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
    generateId: sequentialIds(),
  });
}

function only(result: TransformResult, type: string): Record<string, unknown> {
  const found = resourcesOfType(result, type);
  expect(found, `exactly one ${type}`).toHaveLength(1);
  return found[0] as Record<string, unknown>;
}

describe("a hand-built field with empty structure is read as absent", () => {
  it("an AL1-5 repetition with no components adds no reaction manifestation", () => {
    const msg = parseHL7([MSH_ADT_A01, PID_JANE].join("\r")).addSegment("AL1", [
      "1",
      "DA",
      "PCN^Penicillin^L",
      "",
      field(NO_COMPONENTS, [["Hives"]], [[]]),
    ]);
    const allergy = only(transform(msg), "AllergyIntolerance");
    expect(allergy["reaction"]).toEqual([{ manifestation: [{ text: "Hives" }] }]);
  });

  it("an AL1-5 whose only repetition has no components adds no reaction at all", () => {
    const msg = parseHL7([MSH_ADT_A01, PID_JANE].join("\r")).addSegment("AL1", [
      "1",
      "DA",
      "PCN^Penicillin^L",
      "",
      field(NO_COMPONENTS),
    ]);
    expect(only(transform(msg), "AllergyIntolerance")["reaction"]).toBeUndefined();
  });

  it("an OBX-8 repetition with no components is no abnormal flag", () => {
    const msg = parseHL7([MSH_ORU, PID_JANE, OBR].join("\r")).addSegment("OBX", [
      "1",
      "NM",
      "2093-3^Cholesterol^LN",
      "",
      "250",
      "mg/dL^mg/dL^UCUM",
      "",
      field(NO_COMPONENTS, [["H"]]),
      "",
      "",
      "F",
    ]);
    const result = transform(msg);
    const interpretation = only(result, "Observation")["interpretation"] as {
      coding: { code: string }[];
    }[];
    expect(interpretation.flatMap((c) => c.coding.map((x) => x.code))).toEqual(["H"]);
    expect(result.issues.map((i) => i.v2Location)).not.toContain("OBX.8");
  });

  it("an NA component with no subcomponents is an absent point, never a zero", () => {
    const msg = parseHL7([MSH_ORU, PID_JANE, OBR].join("\r")).addSegment("OBX", [
      "1",
      "NA",
      "8867-4^Heart rate^LN",
      "",
      field([["60"], [], ["62"]]),
      "",
      "",
      "",
      "",
      "",
      "F",
    ]);
    const sampled = only(transform(msg), "Observation")["valueSampledData"] as Record<
      string,
      unknown
    >;
    expect(sampled["data"]).toBe("60 E 62");
    expect(sampled["dimensions"]).toBe(1);
  });

  it("an SPM-14 repetition with no components adds no note", () => {
    const fields: (string | RawField)[] = ["1", "SPEC1", "", "BLD^Blood^HL70487"];
    while (fields.length < 13) fields.push("");
    fields.push(field(NO_COMPONENTS, [["Gross exam normal"]]));
    const msg = parseHL7([MSH_ORU, PID_JANE, OBR].join("\r")).addSegment("SPM", fields);
    expect(only(transform(msg), "Specimen")["note"]).toEqual([{ text: "Gross exam normal" }]);
  });
});

describe("a message whose typed views a caller replaced", () => {
  /** A parsed message with one typed view swapped for a hand-built one, as a caller could do. */
  function withView(
    lines: readonly string[],
    name: "meta" | "patient" | "visit",
    patch: object,
  ): Hl7Message {
    const msg = parseHL7(lines.join("\r"));
    Object.defineProperty(msg, name, { value: { ...msg[name], ...patch } });
    return msg;
  }

  it("an invalid PID-7 timestamp on the patient view leaves birthDate absent and is flagged", () => {
    const result = transform(
      withView([MSH_ADT_A01, PID_JANE], "patient", { dateOfBirth: parseDtm("20261399") }),
    );
    const patient = only(result, "Patient");
    expect(patient["birthDate"]).toBeUndefined();
    expect(patient["gender"]).toBe("female");
    expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
  });

  it("invalid PV1-44 and PV1-45 timestamps on the visit view leave the period absent", () => {
    const invalid = parseDtm("20261399");
    const result = transform(
      withView([MSH_ADT_A01, PID_JANE, PV1_INPATIENT], "visit", {
        admitDateTime: invalid,
        dischargeDateTime: invalid,
      }),
    );
    const encounter = only(result, "Encounter");
    expect(encounter["period"]).toBeUndefined();
    expect(encounter["class"]).toBeDefined();
    const invalidIssues = result.issues.filter(
      (i) => i.code === ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID,
    );
    expect(invalidIssues).toHaveLength(2);
  });

  it("an invalid MSH-7 timestamp on the meta view gives the Bundle no timestamp and is flagged", () => {
    const result = transform(
      withView([MSH_ADT_A01, PID_JANE], "meta", { timestamp: parseDtm("20261399") }),
    );
    const bundle = JSON.parse(serializeResource(result.bundle)) as Record<string, unknown>;
    expect(bundle["timestamp"]).toBeUndefined();
    expect(bundle["identifier"]).toEqual({ value: "MSG00001" });
    expect(result.issues.map((i) => i.code)).toContain(ISSUE_CODES.TRANSFORM_TIMESTAMP_INVALID);
    expect(result.issues.map((i) => i.fhirPath)).not.toContain("Bundle.timestamp");
  });

  it("a patient view on a message with no PID segment reports no PID field as dropped", () => {
    // The view comes from a PID valuing PID-14 and PID-29, but the message it is placed on has no
    // PID at all, so there is no field to point a report at and none is raised.
    const source = parseHL7(
      [MSH_ADT_A01, `${PID_JANE}||||||555-9999|||||||||||||||20260115`].join("\r"),
    );
    expect(source.patient?.phoneNumbers).toHaveLength(1);
    const msg = parseHL7(MSH_ADT_A01);
    Object.defineProperty(msg, "patient", { value: source.patient });
    expect(msg.segments("PID")).toEqual([]);
    const result = transform(msg);
    expect(only(result, "Patient")["gender"]).toBe("female");
    expect(result.issues.filter((i) => i.v2Location.startsWith("PID."))).toEqual([]);
  });

  it("an empty slot in nextOfKin() is skipped: no RelatedPerson, no crash", () => {
    const msg = parseHL7([MSH_ADT_A01, PID_JANE].join("\r"));
    Object.defineProperty(msg, "nextOfKin", { value: () => [undefined] });
    const result = transform(msg);
    expect(resourcesOfType(result, "RelatedPerson")).toEqual([]);
    expect(resourcesOfType(result, "Patient")).toHaveLength(1);
    expect(result.issues.map((i) => i.fhirPath)).not.toContain("RelatedPerson.patient");
  });
});

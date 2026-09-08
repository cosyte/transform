/**
 * PR1 to `Procedure`, against the committed IG **PR1 to Procedure** segment map and the **ADT_A01
 * to Bundle** message map: the fixed status the map's own narrative row directs, one fixture per
 * implemented row, the three performed-date branches, the deferred rows, the withhold path when no
 * Patient anchors the procedure, and the emit gate that decides whether one may ship at all.
 */

import { describe, expect, it } from "vitest";

import { complex, primitive, validateResource, type FhirComplex } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

import {
  ISSUE_CODES,
  PROCEDURE_STATUS_UNKNOWN,
  addMinutes,
  buildProcedure,
  collectProcedures,
  deferredProcedureIssues,
} from "../../src/index.js";
import { EMIT_SCHEMAS } from "../../src/messages/emit-schemas.js";
import {
  MSH_ADT_A01,
  PID_JANE,
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

/** A PR1 valuing every row this library implements, plus the six rows it defers. */
const PR1_FULL = segment("PR1", {
  1: "1",
  3: "4491^Repair of tendon^I9",
  4: "Tendon repair, stated",
  5: "20260721103000-0500",
  6: "SUR^Surgical^I9",
  7: "45",
  8: "9999^Anaesthetist^A",
  11: "8888^Surgeon^S",
  12: "7777^Practitioner^P",
  15: "V57.1^Rehabilitation^I9",
  16: "MOD1",
  19: "PROC1^HOSP^1.2.3^ISO",
  23: "ICU^101^A",
  25: "PARENTPROC",
});

/** The first `PR1` of a message, for the direct-builder tests. */
function firstProcedure(lines: readonly string[]) {
  const found = collectProcedures(parseHL7(lines.join("\r")))[0];
  if (found === undefined) throw new Error("fixture carries no PR1");
  return found;
}

describe("a PR1 becomes a Procedure wired to the bundle Patient", () => {
  it("emits one Procedure per PR1, subject-resolved inside the bundle", () => {
    const result = run([MSH_ADT_A01, PID_JANE, PR1_FULL]);
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "Procedure"]);

    const [patientUrl] = fullUrlsOfType(result, "Patient");
    expect(resourcesOfType(result, "Procedure")[0]?.["subject"]).toEqual({
      reference: patientUrl,
    });

    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });

  it("carries the status the map's own row directs, and never an event status the message did not state", () => {
    // Every PR1 shape gets the same answer: no component of this segment states a procedure status.
    for (const pr1 of [
      PR1_FULL,
      segment("PR1", { 1: "1" }),
      segment("PR1", { 1: "1", 3: "4491^Repair^I9", 20: "A" }),
    ]) {
      const procedure = resourcesOfType(run([MSH_ADT_A01, PID_JANE, pr1]), "Procedure")[0];
      expect([pr1, procedure?.["status"]]).toEqual([pr1, PROCEDURE_STATUS_UNKNOWN]);
    }
    expect(PROCEDURE_STATUS_UNKNOWN).toBe("unknown");
    expect(["completed", "in-progress", "preparation"]).not.toContain(PROCEDURE_STATUS_UNKNOWN);
  });

  it("populates the element rows the map grounds, and leaves each absent when unvalued", () => {
    const rich = resourcesOfType(run([MSH_ADT_A01, PID_JANE, PR1_FULL]), "Procedure")[0];
    expect(rich).toMatchObject({
      identifier: [{ value: "PROC1" }],
      category: {
        coding: [{ system: "http://hl7.org/fhir/sid/icd-9-cm", code: "SUR", display: "Surgical" }],
      },
      code: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-9-cm",
            code: "4491",
            display: "Repair of tendon",
          },
        ],
        text: "Tendon repair, stated",
      },
      reasonCode: [
        {
          coding: [
            {
              system: "http://hl7.org/fhir/sid/icd-9-cm",
              code: "V57.1",
              display: "Rehabilitation",
            },
          ],
        },
      ],
    });

    const bare = resourcesOfType(
      run([MSH_ADT_A01, PID_JANE, segment("PR1", { 1: "1", 3: "4491^Repair^I9" })]),
      "Procedure",
    )[0];
    for (const absent of ["identifier", "category", "reasonCode", "performedDateTime"]) {
      expect([absent, Object.hasOwn(bare ?? {}, absent)]).toEqual([absent, false]);
    }
  });

  it("honours the PR1-4 row's condition: an original text in the coded field wins", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9^^^^^^Coded original text", 4: "Described" }),
    ]);
    expect(
      (resourcesOfType(result, "Procedure")[0]?.["code"] as Record<string, unknown>)["text"],
    ).toBe("Coded original text");
    expect(labels(result)).toContain(`${DROPPED}@PR1.4#Procedure.code.text`);
  });

  it("uses PR1-4 as the code text when the coded field carries no original text", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9", 4: "Described" }),
    ]);
    expect(
      (resourcesOfType(result, "Procedure")[0]?.["code"] as Record<string, unknown>)["text"],
    ).toBe("Described");
    expect(labels(result)).not.toContain(`${DROPPED}@PR1.4#Procedure.code.text`);
  });
});

describe("PR1-5 and PR1-7 decide performedDateTime or performedPeriod", () => {
  it("carries PR1-5 as performedDateTime when PR1-7 is not valued", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9", 5: "20260721103000-0500" }),
    ]);
    const procedure = resourcesOfType(result, "Procedure")[0];
    expect(procedure?.["performedDateTime"]).toBe("2026-07-21T10:30:00-05:00");
    expect(Object.hasOwn(procedure ?? {}, "performedPeriod")).toBe(false);
    expect(labels(result).some((l) => l.includes("performedPeriod"))).toBe(false);
  });

  it("builds the period from PR1-5 plus PR1-7 minutes when the start carries a time", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9", 5: "20260721103000-0500", 7: "45" }),
    ]);
    const procedure = resourcesOfType(result, "Procedure")[0];
    expect(procedure?.["performedPeriod"]).toEqual({
      start: "2026-07-21T10:30:00-05:00",
      end: "2026-07-21T11:15:00-05:00",
    });
    expect(Object.hasOwn(procedure ?? {}, "performedDateTime")).toBe(false);
  });

  it("rolls the end over hour, day, month and year boundaries in the start's own offset", () => {
    const cases: readonly (readonly [string, string, string])[] = [
      ["20261231233000-0500", "45", "2027-01-01T00:15:00-05:00"],
      ["20260228235900+0100", "2", "2026-03-01T00:01:00+01:00"],
      ["20260721103000+0000", "1440", "2026-07-22T10:30:00+00:00"],
      ["20260721103000-0500", "0", "2026-07-21T10:30:00-05:00"],
    ];
    for (const [stamp, minutes, expected] of cases) {
      const result = run([
        MSH_ADT_A01,
        PID_JANE,
        segment("PR1", { 1: "1", 3: "4491^Repair^I9", 5: stamp, 7: minutes }),
      ]);
      const period = resourcesOfType(result, "Procedure")[0]?.["performedPeriod"] as
        | Record<string, string>
        | undefined;
      expect([stamp, minutes, period?.["end"]]).toEqual([stamp, minutes, expected]);
    }
  });

  it("refuses to add minutes to a start that is not one, and declares the end it did not build", () => {
    // A date-only PR1-5, and a minute-precision one the conversion cannot carry as a time: both are
    // starts a duration cannot be added to without inventing the missing precision.
    for (const stamp of ["20260721", "202607211030-0500", "20260721103000"]) {
      const result = run([
        MSH_ADT_A01,
        PID_JANE,
        segment("PR1", { 1: "1", 3: "4491^Repair^I9", 5: stamp, 7: "45" }),
      ]);
      const procedure = resourcesOfType(result, "Procedure")[0];
      expect([stamp, Object.hasOwn(procedure ?? {}, "performedPeriod")]).toEqual([stamp, false]);
      expect([stamp, procedure?.["performedDateTime"]]).toEqual([stamp, "2026-07-21"]);
      expect([stamp, labels(result)]).toEqual([
        stamp,
        expect.arrayContaining([`${DROPPED}@PR1.7#Procedure.performedPeriod.end`]),
      ]);
    }
  });

  it("refuses a PR1-7 that is not a number of minutes rather than guessing one", () => {
    // The last one is a whole number of minutes that carries the end past any representable date:
    // a duration the calendar cannot express is refused rather than wrapped.
    for (const minutes of ["abc", "-30", "4.5", "+45", "99999999999999999"]) {
      const result = run([
        MSH_ADT_A01,
        PID_JANE,
        segment("PR1", { 1: "1", 3: "4491^Repair^I9", 5: "20260721103000-0500", 7: minutes }),
      ]);
      const procedure = resourcesOfType(result, "Procedure")[0];
      expect([minutes, Object.hasOwn(procedure ?? {}, "performedPeriod")]).toEqual([
        minutes,
        false,
      ]);
      expect([minutes, labels(result)]).toEqual([
        minutes,
        expect.arrayContaining([`${DROPPED}@PR1.7#Procedure.performedPeriod.end`]),
      ]);
    }
  });

  it("adds minutes only to a full zoned timestamp, whatever else is handed to it", () => {
    expect(addMinutes("2026-01-15T10:30:00-05:00", 45)).toBe("2026-01-15T11:15:00-05:00");
    expect(addMinutes("2026-01-15T10:30:00.250-05:00", 45)).toBe("2026-01-15T11:15:00.250-05:00");
    expect(addMinutes("0001-01-15T10:30:00Z", 45)).toBe("0001-01-15T11:15:00Z");
    expect(addMinutes("2026-01-15", 45)).toBeUndefined();
    expect(addMinutes("2026-01-15T10:30-05:00", 45)).toBeUndefined();
    expect(addMinutes("2026-01-15T10:30:00", 45)).toBeUndefined();
  });
});

describe("the deferred PR1 rows are declared, never silently absent", () => {
  it("raises one issue per valued deferred row, naming the row and the path it did not build", () => {
    expect(labels(run([MSH_ADT_A01, PID_JANE, PR1_FULL]))).toEqual(
      expect.arrayContaining([
        `${DROPPED}@PR1.8#Procedure.performer.actor`,
        `${DROPPED}@PR1.11#Procedure.performer.actor`,
        `${DROPPED}@PR1.12#Procedure.performer.actor`,
        `${DROPPED}@PR1.16#Procedure.code.value`,
        `${DROPPED}@PR1.23#Procedure.location`,
        `${DROPPED}@PR1.25#Procedure.partOf`,
      ]),
    );
  });

  it("raises none of them for a PR1 that values none of those rows", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("PR1", { 1: "1", 3: "4491^Repair^I9" })]);
    expect(labels(result).some((l) => l.startsWith(`${DROPPED}@PR1.`))).toBe(false);
  });

  it("declares them even for an occurrence whose Procedure is withheld", () => {
    const result = run([MSH_ADT_A01, PR1_FULL]);
    expect(resourcesOfType(result, "Procedure")).toHaveLength(0);
    expect(labels(result)).toContain(`${DROPPED}@PR1.23#Procedure.location`);
  });
});

describe("no Patient means no procedure, and the withholding is declared", () => {
  it("withholds every Procedure and names each occurrence and the subject it could not anchor", () => {
    const result = run([
      MSH_ADT_A01,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9" }),
      segment("PR1", { 1: "2", 3: "4492^Other^I9" }),
    ]);
    expect(resourcesOfType(result, "Procedure")).toHaveLength(0);
    expect(labels(result)).toEqual(
      expect.arrayContaining([
        `${DROPPED}@PR1[0]#Procedure.subject`,
        `${DROPPED}@PR1[1]#Procedure.subject`,
      ]),
    );
    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });
});

describe("repeated PR1 occurrences", () => {
  it("emits one Procedure per occurrence, in message order, never collapsing repeats", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PR1", { 1: "1", 3: "4491^Repair^I9" }),
      segment("PR1", { 1: "2", 3: "4492^Other^I9" }),
      segment("PR1", { 1: "3", 3: "4491^Repair^I9" }),
    ]);
    const procedures = resourcesOfType(result, "Procedure");
    expect(procedures).toHaveLength(3);
    expect(
      procedures.map(
        (p) => ((p["code"] as { coding?: { code?: string }[] }).coding ?? [])[0]?.code ?? "",
      ),
    ).toEqual(["4491", "4492", "4491"]);
    expect(new Set(fullUrlsOfType(result, "Procedure")).size).toBe(3);
  });
});

describe("the conservative-emit gate decides whether a produced Procedure may ship", () => {
  const built = buildProcedure(
    firstProcedure([MSH_ADT_A01, PID_JANE, PR1_FULL]),
    "urn:uuid:pat",
    {},
  );

  it("passes the Procedure this library produces", () => {
    expect(built.value).toBeDefined();
    expect(
      validateResource(built.value as FhirComplex, { mode: "lenient", schemas: EMIT_SCHEMAS })
        .valid,
    ).toBe(true);
  });

  it("REFUSES the same Procedure with its required subject or status removed", () => {
    for (const required of ["subject", "status"]) {
      const stripped = complex(
        (built.value as FhirComplex).properties.filter((p) => p.name !== required),
      );
      const withEntry = validateResource(stripped, { mode: "lenient", schemas: EMIT_SCHEMAS });
      expect([required, withEntry.valid]).toEqual([required, false]);
      expect([required, withEntry.issues.map((i) => i.expression)]).toEqual([
        required,
        expect.arrayContaining([`Procedure.${required}`]),
      ]);

      // Without the schema entry the same resource passes: the check can fail, and this is why.
      const withoutEntry = validateResource(stripped, {
        mode: "lenient",
        schemas: EMIT_SCHEMAS.filter((s) => s.type !== "Procedure"),
      });
      expect([required, withoutEntry.valid]).toEqual([required, true]);
    }
  });

  it("REFUSES a Procedure whose status is outside R4's required event-status binding", () => {
    const wrongStatus = complex(
      (built.value as FhirComplex).properties.map((p) =>
        p.name === "status" ? { name: "status", value: primitive("nearly-done") } : p,
      ),
    );
    expect(validateResource(wrongStatus, { mode: "lenient", schemas: EMIT_SCHEMAS }).valid).toBe(
      false,
    );
  });
});

describe("the builder called directly", () => {
  it("returns the deferred-row issues for the occurrence, independently of the resource", () => {
    const pr1 = firstProcedure([MSH_ADT_A01, PID_JANE, PR1_FULL]);
    expect(deferredProcedureIssues(pr1).map((i) => i.v2Location)).toEqual([
      "PR1.8",
      "PR1.11",
      "PR1.12",
      "PR1.16",
      "PR1.23",
      "PR1.25",
    ]);
  });

  it("never carries a field value into an issue", () => {
    const pr1 = firstProcedure([MSH_ADT_A01, PID_JANE, PR1_FULL]);
    const result = buildProcedure(pr1, "urn:uuid:pat", {});
    const rendered = JSON.stringify(result.issues);
    for (const token of ["PROC1", "4491", "Repair", "PARENTPROC", "Surgeon"]) {
      expect([token, rendered.includes(token)]).toEqual([token, false]);
    }
  });
});

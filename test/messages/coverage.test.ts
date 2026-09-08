/**
 * IN1 to `Coverage`, against the committed IG **IN1 to Coverage** segment map and the **ADT_A01 to
 * Bundle** message map: one fixture per implemented row, the value-absent status no published row
 * grounds, the payor branch including the withhold, the deferred rows, the withhold path when no
 * Patient anchors the coverage, and the emit gate that decides whether one may ship at all.
 */

import { describe, expect, it } from "vitest";

import { complex, primitive, validateResource, type FhirComplex } from "@cosyte/fhir";
import { parseHL7 } from "@cosyte/hl7";

import {
  COVERAGE_STATUS_UNKNOWN,
  COVERAGE_SUBSCRIBER_ID_EXTENSION_URL,
  ISSUE_CODES,
  IN1_SUBSCRIBER_NUMBER_TYPE,
  buildCoverage,
  collectCoverages,
  deferredCoverageIssues,
  insuranceCompanyName,
} from "../../src/index.js";
import { EMIT_SCHEMAS } from "../../src/messages/emit-schemas.js";
import {
  MSH_ADT_A01,
  PID_JANE,
  bundleJson,
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
const REQUIRED_UNKNOWN = ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN;
const V2_0203 = "http://terminology.hl7.org/CodeSystem/v2-0203";

/** An IN1 valuing every row this library implements, plus the five rows it defers. */
const IN1_FULL = segment("IN1", {
  1: "1",
  2: "PLAN1^Gold Plan^I9",
  3: "INSCO1",
  4: "Acme Insurance Co",
  5: "1 St^^Boston^MA^02101",
  10: "GRPEMP1^^^^SN",
  11: "Group Employer Co",
  12: "20260101",
  13: "20261231",
  15: "EPO^Preferred provider^I9",
  16: "Public^Jane",
  17: "SEL",
  49: "SUBID1^^^^SN",
});

/** The minimum an IN1 needs to produce a Coverage at all: the payer name. */
const IN1_MINIMAL = segment("IN1", { 1: "1", 4: "Acme Insurance Co" });

/** The first `IN1` of a message, for the direct-builder tests. */
function firstCoverage(lines: readonly string[]) {
  const found = collectCoverages(parseHL7(lines.join("\r")))[0];
  if (found === undefined) throw new Error("fixture carries no IN1");
  return found;
}

describe("an IN1 becomes a Coverage wired to the bundle Patient", () => {
  it("emits one Coverage per IN1, beneficiary-resolved inside the bundle", () => {
    const result = run([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    expect(entryTypes(result)).toEqual(["MessageHeader", "Patient", "Coverage"]);

    const [patientUrl] = fullUrlsOfType(result, "Patient");
    expect(resourcesOfType(result, "Coverage")[0]?.["beneficiary"]).toEqual({
      reference: patientUrl,
    });

    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });

  it("populates the element rows the map grounds, and leaves each absent when unvalued", () => {
    const rich = resourcesOfType(run([MSH_ADT_A01, PID_JANE, IN1_FULL]), "Coverage")[0];
    expect(rich).toMatchObject({
      identifier: [{ value: "PLAN1" }],
      type: {
        coding: [
          {
            system: "http://hl7.org/fhir/sid/icd-9-cm",
            code: "EPO",
            display: "Preferred provider",
          },
        ],
      },
      period: { start: "2026-01-01", end: "2026-12-31" },
    });

    const bare = resourcesOfType(run([MSH_ADT_A01, PID_JANE, IN1_MINIMAL]), "Coverage")[0];
    for (const absent of ["identifier", "type", "period", "extension"]) {
      expect([absent, Object.hasOwn(bare ?? {}, absent)]).toEqual([absent, false]);
    }
  });

  it("carries a period end alone when only the expiration date is valued", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("IN1", { 1: "1", 4: "Acme Insurance Co", 13: "20261231" }),
    ]);
    expect(resourcesOfType(result, "Coverage")[0]?.["period"]).toEqual({ end: "2026-12-31" });
  });

  it("keeps a health plan id's value and never invents a system from its coding mnemonic", () => {
    const result = run([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    expect(resourcesOfType(result, "Coverage")[0]?.["identifier"]).toEqual([{ value: "PLAN1" }]);
    expect(labels(result)).toContain(`${DROPPED}@IN1.2#Coverage.identifier.system`);
  });
});

describe("the subscriber-id extension", () => {
  it("carries IN1-49 through the CX to Identifier map", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("IN1", { 1: "1", 4: "Acme Insurance Co", 49: "SUBID1^^^^SN" }),
    ]);
    expect(resourcesOfType(result, "Coverage")[0]?.["extension"]).toEqual([
      {
        url: COVERAGE_SUBSCRIBER_ID_EXTENSION_URL,
        valueIdentifier: {
          type: { coding: [{ system: V2_0203, code: IN1_SUBSCRIBER_NUMBER_TYPE }] },
          value: "SUBID1",
        },
      },
    ]);
  });

  it("carries IN1-10 only when its CX.5 is the subscriber-number type the row conditions on", () => {
    const withSn = resourcesOfType(
      run([
        MSH_ADT_A01,
        PID_JANE,
        segment("IN1", { 1: "1", 4: "Acme Insurance Co", 10: "GRPEMP1^^^^SN" }),
      ]),
      "Coverage",
    )[0];
    expect(
      (withSn?.["extension"] as { valueIdentifier?: { value?: string } }[])[0]?.valueIdentifier
        ?.value,
    ).toBe("GRPEMP1");

    for (const otherType of ["", "MR", "PN"]) {
      const result = run([
        MSH_ADT_A01,
        PID_JANE,
        segment("IN1", { 1: "1", 4: "Acme Insurance Co", 10: `GRPEMP1^^^^${otherType}` }),
      ]);
      const coverage = resourcesOfType(result, "Coverage")[0];
      expect([otherType, Object.hasOwn(coverage ?? {}, "extension")]).toEqual([otherType, false]);
      // The row that is NOT conditioned still applies: the policy holder is declared either way.
      expect([otherType, labels(result)]).toEqual([
        otherType,
        expect.arrayContaining([`${DROPPED}@IN1.10#Coverage.policyHolder`]),
      ]);
    }
  });

  it("carries both sources when both are valued, in the map's own row order", () => {
    const coverage = resourcesOfType(run([MSH_ADT_A01, PID_JANE, IN1_FULL]), "Coverage")[0];
    expect(
      (coverage?.["extension"] as { valueIdentifier?: { value?: string } }[]).map(
        (e) => e.valueIdentifier?.value,
      ),
    ).toEqual(["GRPEMP1", "SUBID1"]);
  });
});

describe("Coverage.status is never asserted, because no published row grounds one", () => {
  it("emits a value-absent status carrying data-absent-reason unknown, and declares it", () => {
    const result = run([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    const coverage = resourcesOfType(result, "Coverage")[0];

    // The wire shape of a value-absent primitive: the `_status` sibling, and no `status` value.
    expect(Object.hasOwn(coverage ?? {}, "status")).toBe(false);
    expect(coverage?.["_status"]).toEqual({
      extension: [
        {
          url: "http://hl7.org/fhir/StructureDefinition/data-absent-reason",
          valueCode: COVERAGE_STATUS_UNKNOWN,
        },
      ],
    });

    expect(labels(result)).toContain(`${REQUIRED_UNKNOWN}@IN1[0]#Coverage.status`);
  });

  it("never writes a financial-status code anywhere in the bundle", () => {
    const wire = JSON.stringify(bundleJson(run([MSH_ADT_A01, PID_JANE, IN1_FULL])));
    for (const forbidden of ['"status":"active"', '"status":"cancelled"', '"status":"draft"']) {
      expect([forbidden, wire.includes(forbidden)]).toEqual([forbidden, false]);
    }
  });

  it("raises one status issue per emitted Coverage, never one for a withheld occurrence", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      IN1_MINIMAL,
      segment("IN1", { 1: "2", 4: "Second Insurer" }),
      segment("IN1", { 1: "3", 2: "PLAN3^Third^I9" }),
    ]);
    expect(labels(result).filter((l) => l.endsWith("#Coverage.status"))).toEqual([
      `${REQUIRED_UNKNOWN}@IN1[0]#Coverage.status`,
      `${REQUIRED_UNKNOWN}@IN1[1]#Coverage.status`,
    ]);
  });
});

describe("the payor names the insurer and resolves to no Organization", () => {
  it("carries IN1-4.1 verbatim as a display, with no literal reference, and declares the gap", () => {
    const result = run([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    expect(resourcesOfType(result, "Coverage")[0]?.["payor"]).toEqual([
      { display: "Acme Insurance Co" },
    ]);
    expect(labels(result)).toContain(`${DROPPED}@IN1.4#Coverage.payor`);
    expect(insuranceCompanyName(firstCoverage([MSH_ADT_A01, PID_JANE, IN1_FULL]))).toBe(
      "Acme Insurance Co",
    );
  });

  it("withholds the whole Coverage and names the occurrence when IN1-4.1 is not valued", () => {
    for (const in1 of [
      segment("IN1", { 1: "1", 2: "PLAN1^Gold^I9", 12: "20260101" }),
      segment("IN1", { 1: "1", 4: "^^^Only later components" }),
    ]) {
      const result = run([MSH_ADT_A01, PID_JANE, in1]);
      expect([in1, resourcesOfType(result, "Coverage").length]).toEqual([in1, 0]);
      expect([in1, labels(result)]).toEqual([
        in1,
        expect.arrayContaining([`${DROPPED}@IN1[0]#Coverage.payor`]),
      ]);
      // Nothing else about the withheld occurrence leaks into the bundle.
      expect([in1, labels(result).some((l) => l.endsWith("#Coverage.status"))]).toEqual([
        in1,
        false,
      ]);
    }
  });
});

describe("the deferred IN1 rows are declared, never silently absent", () => {
  it("raises one issue per valued deferred row, naming the row and the path it did not build", () => {
    expect(labels(run([MSH_ADT_A01, PID_JANE, IN1_FULL]))).toEqual(
      expect.arrayContaining([
        `${DROPPED}@IN1.5#Coverage.payer`,
        `${DROPPED}@IN1.10#Coverage.policyHolder`,
        `${DROPPED}@IN1.11#Coverage.policyHolder`,
        `${DROPPED}@IN1.16#Coverage.subscriber`,
        `${DROPPED}@IN1.17#Coverage.relationship`,
      ]),
    );
  });

  it("never translates IN1-17 into a relationship code", () => {
    const coverage = resourcesOfType(run([MSH_ADT_A01, PID_JANE, IN1_FULL]), "Coverage")[0];
    expect(Object.hasOwn(coverage ?? {}, "relationship")).toBe(false);
  });

  it("raises none of them for an IN1 that values none of those rows", () => {
    const result = run([MSH_ADT_A01, PID_JANE, IN1_MINIMAL]);
    expect(
      labels(result).some(
        (l) => l.startsWith(`${DROPPED}@IN1.`) && !l.startsWith(`${DROPPED}@IN1.4#`),
      ),
    ).toBe(false);
  });

  it("declares them even for an occurrence whose Coverage is withheld", () => {
    const result = run([MSH_ADT_A01, PID_JANE, segment("IN1", { 1: "1", 17: "SEL" })]);
    expect(resourcesOfType(result, "Coverage")).toHaveLength(0);
    expect(labels(result)).toContain(`${DROPPED}@IN1.17#Coverage.relationship`);
  });

  it("declares the PV1-20 financial class against the Coverage the insurance segment created", () => {
    const withFinancialClass = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PV1", { 1: "1", 2: "I", 20: "SELF" }),
      IN1_MINIMAL,
    ]);
    expect(resourcesOfType(withFinancialClass, "Coverage")).toHaveLength(1);
    expect(labels(withFinancialClass)).toContain(`${DROPPED}@PV1.20#Coverage`);

    const without = run([MSH_ADT_A01, PID_JANE, segment("PV1", { 1: "1", 2: "I" }), IN1_MINIMAL]);
    expect(labels(without)).not.toContain(`${DROPPED}@PV1.20#Coverage`);
  });

  it("declares it for an insured message whose Coverage the payor branch withheld", () => {
    // The row is about the Coverage[1] the IN1 rows create, and an occurrence whose resource was
    // withheld is still an insurance segment the message carried: same shape as the IN1 rows above.
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PV1", { 1: "1", 2: "I", 20: "SELF" }),
      segment("IN1", { 1: "1" }),
    ]);
    expect(resourcesOfType(result, "Coverage")).toHaveLength(0);
    expect(labels(result)).toContain(`${DROPPED}@PV1.20#Coverage`);
  });

  it("says nothing about PV1-20 on a message that carries no insurance segment at all", () => {
    // This reading covers DG1, PR1 and IN1, and a message carrying none of them must produce what
    // it produced before the three were read. The PV1[Coverage] segment map, which is that
    // message's only route to a Coverage, is not read here, so the financial class stays as
    // unhandled as it always was. The byte-identical half of this is in to-fhir.test.ts.
    const noInsurance = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("PV1", { 1: "1", 2: "I", 20: "SELF" }),
    ]);
    expect(labels(noInsurance)).not.toContain(`${DROPPED}@PV1.20#Coverage`);
    expect(labels(noInsurance).some((l) => l.includes("@PV1.20#"))).toBe(false);
  });
});

describe("no Patient means no coverage, and the withholding is declared", () => {
  it("withholds every Coverage and names each occurrence and the beneficiary it could not anchor", () => {
    const result = run([MSH_ADT_A01, IN1_MINIMAL, segment("IN1", { 1: "2", 4: "Second Insurer" })]);
    expect(resourcesOfType(result, "Coverage")).toHaveLength(0);
    expect(labels(result)).toEqual(
      expect.arrayContaining([
        `${DROPPED}@IN1[0]#Coverage.beneficiary`,
        `${DROPPED}@IN1[1]#Coverage.beneficiary`,
      ]),
    );
    const urls = fullUrls(result);
    for (const ref of references(result)) expect(urls.has(ref)).toBe(true);
  });
});

describe("repeated IN1 occurrences", () => {
  it("emits one Coverage per occurrence, in message order, never collapsing repeats", () => {
    const result = run([
      MSH_ADT_A01,
      PID_JANE,
      segment("IN1", { 1: "1", 4: "Acme Insurance Co" }),
      segment("IN1", { 1: "2", 4: "Second Insurer" }),
      segment("IN1", { 1: "3", 4: "Acme Insurance Co" }),
    ]);
    const coverages = resourcesOfType(result, "Coverage");
    expect(coverages).toHaveLength(3);
    expect(coverages.map((c) => (c["payor"] as { display?: string }[])[0]?.display)).toEqual([
      "Acme Insurance Co",
      "Second Insurer",
      "Acme Insurance Co",
    ]);
    expect(new Set(fullUrlsOfType(result, "Coverage")).size).toBe(3);
  });
});

describe("the conservative-emit gate decides whether a produced Coverage may ship", () => {
  const built = buildCoverage(
    firstCoverage([MSH_ADT_A01, PID_JANE, IN1_FULL]),
    "urn:uuid:pat",
    {},
    "IN1[0]",
  );

  it("passes the Coverage this library produces, value-absent status and all", () => {
    expect(built.value).toBeDefined();
    expect(
      validateResource(built.value as FhirComplex, { mode: "lenient", schemas: EMIT_SCHEMAS })
        .valid,
    ).toBe(true);
  });

  it("REFUSES the same Coverage with any of its three required elements removed", () => {
    for (const required of ["status", "beneficiary", "payor"]) {
      const stripped = complex(
        (built.value as FhirComplex).properties.filter((p) => p.name !== required),
      );
      const withEntry = validateResource(stripped, { mode: "lenient", schemas: EMIT_SCHEMAS });
      expect([required, withEntry.valid]).toEqual([required, false]);
      expect([required, withEntry.issues.map((i) => i.expression)]).toEqual([
        required,
        expect.arrayContaining([`Coverage.${required}`]),
      ]);

      // Without the schema entry the same resource passes: the check can fail, and this is why.
      const withoutEntry = validateResource(stripped, {
        mode: "lenient",
        schemas: EMIT_SCHEMAS.filter((s) => s.type !== "Coverage"),
      });
      expect([required, withoutEntry.valid]).toEqual([required, true]);
    }
  });
});

describe("the builder called directly", () => {
  it("returns the deferred-row issues for the occurrence, independently of the resource", () => {
    const in1 = firstCoverage([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    expect(deferredCoverageIssues(in1).map((i) => i.v2Location)).toEqual([
      "IN1.5",
      "IN1.10",
      "IN1.11",
      "IN1.16",
      "IN1.17",
    ]);
  });

  it("never carries a field value into an issue", () => {
    const in1 = firstCoverage([MSH_ADT_A01, PID_JANE, IN1_FULL]);
    const result = buildCoverage(in1, "urn:uuid:pat", {}, "IN1[0]");
    const rendered = JSON.stringify(result.issues);
    for (const token of ["PLAN1", "Acme", "GRPEMP1", "SUBID1", "Public"]) {
      expect([token, rendered.includes(token)]).toEqual([token, false]);
    }
  });

  it("builds the minimum a Coverage needs when only the payer name is valued", () => {
    const in1 = firstCoverage([MSH_ADT_A01, PID_JANE, IN1_MINIMAL]);
    const result = buildCoverage(in1, "urn:uuid:pat", {}, "IN1[0]");
    expect((result.value as FhirComplex).properties.map((p) => p.name)).toEqual([
      "resourceType",
      "status",
      "beneficiary",
      "payor",
    ]);
    expect((result.value as FhirComplex).properties.find((p) => p.name === "resourceType")).toEqual(
      { name: "resourceType", value: primitive("Coverage") },
    );
  });
});

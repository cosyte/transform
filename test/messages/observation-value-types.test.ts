/**
 * The OBX-2 value types the IG maps to a **structured** `Observation.value[x]` and this library used
 * to hand back as a string: `DR` → `valuePeriod`, `NR` → `valueRange`, `TM` → `valueTime`, `NA` →
 * `valueSampledData`, and `ED` (under the map's `OBX-5.4 = "Base64"` condition) → the IG-named
 * `valueAttachment` extension.
 *
 * Every expectation here is written against the published maps
 * (`ConceptMap-segment-obx-to-observation.html` and the four datatype maps behind its rows) plus the
 * "Numeric Array to Sampled Data Mapping" section of the Implementation Considerations chapter, and
 * every one of them has a matching negative: the fail-safe floor is a raw string plus a declared
 * drop, and it must still be reached wherever the map cannot carry the value faithfully.
 */

import { describe, expect, it } from "vitest";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import {
  toFhir,
  createNamingSystem,
  ISSUE_CODES,
  OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL,
  ED_BASE64_ENCODING,
  SAMPLED_DATA_ABSENT_POINT,
  SAMPLED_DATA_UNGROUNDED,
  type TransformResult,
} from "../../src/index.js";

/** A deterministic urn:uuid generator so fullUrls/reference wiring can be asserted exactly. */
function seq(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

const registry = createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } });

/**
 * One ORU carrying one OBX of the given value type and value, everything else fixed and valid so a
 * difference in the bundle can only come from the value-type discrimination.
 *
 * OBX-14 is deliberately a timestamp unlike any test value, and MSH-7 another: a bound this library
 * fabricated from either would be visible.
 */
const OBSERVATION_TIME = "20261111111111-0500";
const OBSERVATION_TIME_FHIR = "2026-11-11T11:11:11-05:00";

function run(
  valueType: string,
  value: string,
  extra: { units?: string; observationTime?: boolean } = {},
): TransformResult {
  const obx = [
    "OBX",
    "1",
    valueType,
    "V^Value^LN",
    "",
    value,
    extra.units ?? "",
    "",
    "",
    "",
    "",
    "F",
    "",
    "",
    extra.observationTime === false ? "" : OBSERVATION_TIME,
  ].join("|");
  const raw = [
    "MSH|^~\\&|LAB|F|EHR|H|20260101120000-0500||ORU^R01|M1|P|2.5.1",
    "PID|1||MRN1^^^HOSP^MR||Doe^Jane||19900101|F",
    "OBR|1||FILLER1|T^Test^LN||||||||||||||||||||||F",
    obx,
  ].join("\r");
  return toFhir(parseHL7(raw), { namingSystem: registry, generateId: seq() });
}

function wire(result: TransformResult): string {
  return serializeResource(result.bundle);
}

/** The serialized JSON of the single `Observation` in the bundle, or `""` when none was emitted. */
function observationJson(result: TransformResult): string {
  const parsed = parseResource(wire(result)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry === undefined || !isList(entry)) return "";
  for (const e of entry.items) {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    if (res === undefined || !isComplex(res)) continue;
    const rt = getProperty(res, "resourceType");
    const type = rt !== undefined && "value" in rt ? (rt as { value: unknown }).value : undefined;
    if (type === "Observation") return serializeResource(res);
  }
  return "";
}

/** `CODE@fhirPath` for each issue: the shape the expectations below are written in. */
function issueLabels(result: TransformResult): string[] {
  return result.issues.map((i) => `${i.code}@${i.fhirPath ?? ""}`);
}

const DROPPED_VALUE = `${ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED}@Observation.value[x]`;

// ── DR → Period (AC-1, AC-4, AC-5, AC-6) ────────────────────────────────────────────────────────

describe("OBX-2 = DR → Observation.valuePeriod (DR[Period])", () => {
  it("carries DR.1 to Period.start and DR.2 to Period.end, and no longer a valueString", () => {
    const result = run("DR", "20260721143000-0500^20260722153000-0500");
    expect(observationJson(result)).toContain(
      '"valuePeriod":{"start":"2026-07-21T14:30:00-05:00","end":"2026-07-22T15:30:00-05:00"}',
    );
    expect(observationJson(result)).not.toContain("valueString");
    expect(issueLabels(result)).not.toContain(DROPPED_VALUE);
  });

  it("emits a start and NO end from a one-ended DR, substituting nothing for the missing bound", () => {
    const result = run("DR", "20260721143000-0500");
    const observation = observationJson(result);
    // Exactly a start. Written as a whole-object match so an `end` borrowed from anywhere fails.
    expect(observation).toContain('"valuePeriod":{"start":"2026-07-21T14:30:00-05:00"}');
    // The observation time IS in the resource, as `effectiveDateTime`, and is not the period's end.
    expect(observation).toContain(`"effectiveDateTime":"${OBSERVATION_TIME_FHIR}"`);
    expect(observation).not.toContain(`"end":"${OBSERVATION_TIME_FHIR}"`);
    // Nor the message timestamp, nor the start echoed into the end.
    expect(observation).not.toContain('"end":"2026-01-01T12:00:00-05:00"');
    expect(observation).not.toContain('"end":"2026-07-21T14:30:00-05:00"');
  });

  it("emits an end and no start when only DR.2 is valued, which Field.value cannot even see", () => {
    const result = run("DR", "^20260722153000-0500");
    expect(observationJson(result)).toContain('"valuePeriod":{"end":"2026-07-22T15:30:00-05:00"}');
  });

  it("falls back to the WHOLE raw OBX-5 text when neither bound is a dateTime it will emit", () => {
    const result = run("DR", "NOTADATE^ALSONOTADATE");
    const observation = observationJson(result);
    expect(observation).not.toContain("valuePeriod");
    // The whole field, not the first component: a truncating fallback would read `"NOTADATE"`.
    expect(observation).toContain('"valueString":"NOTADATE^ALSONOTADATE"');
    expect(issueLabels(result)).toContain(DROPPED_VALUE);
  });
});

// ── NR → Range (AC-1, AC-4, AC-7, AC-8) ─────────────────────────────────────────────────────────

describe("OBX-2 = NR → Observation.valueRange (NR[Range])", () => {
  it("carries both magnitudes at their exact lexical precision and grounds no unit at all", () => {
    // OBX-6 IS valued, and the NR map grounds no unit, code or system on either bound: the whole
    // valueRange is asserted as one object so a borrowed OBX-6 unit cannot hide inside it.
    const result = run("NR", "1.50^2.50", { units: "mg/dL^mg/dL^UCUM" });
    const observation = observationJson(result);
    expect(observation).toContain('"valueRange":{"low":{"value":1.50},"high":{"value":2.50}}');
    expect(observation).not.toContain("mg/dL");
    expect(observation).not.toContain("unitsofmeasure.org");
    expect(observation).not.toContain("valueString");
  });

  it("keeps a one-sided NR one-sided, and declares the bound it could not carry", () => {
    const result = run("NR", "1.5^2O");
    expect(observationJson(result)).toContain('"valueRange":{"low":{"value":1.5}}');
    expect(issueLabels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID}@Range.high.value`,
    );
    expect(issueLabels(result)).not.toContain(DROPPED_VALUE);
  });

  it("falls back when neither bound is a decimal it will emit, and never rescales one", () => {
    const result = run("NR", "1O^2O");
    const observation = observationJson(result);
    expect(observation).not.toContain("valueRange");
    expect(observation).toContain('"valueString":"1O^2O"');
    expect(issueLabels(result)).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID}@Range.low.value`,
        `${ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID}@Range.high.value`,
        DROPPED_VALUE,
      ]),
    );
  });

  it("refuses a v2 magnitude FHIR decimal cannot carry unaltered, rather than canonicalizing it", () => {
    // `+7` and `007` are legal v2 NM and illegal FHIR decimal literals. Emitting `7` for either
    // would be a rewritten magnitude on a reference range.
    const result = run("NR", "+7^007");
    expect(observationJson(result)).toContain('"valueString":"+7^007"');
    expect(observationJson(result)).not.toContain('"value":7');
  });
});

// ── TM → time (AC-1, AC-4, AC-9) ────────────────────────────────────────────────────────────────

describe("OBX-2 = TM → Observation.valueTime", () => {
  it("carries a full-precision unzoned TM, including fractional seconds", () => {
    expect(observationJson(run("TM", "143000"))).toContain('"valueTime":"14:30:00"');
    expect(observationJson(run("TM", "143000.25"))).toContain('"valueTime":"14:30:00.25"');
  });

  it("refuses a TM carrying a UTC offset, and never emits the time with the offset discarded", () => {
    for (const raw of ["143000-0500", "143000+0530", "143000+0000"]) {
      const result = run("TM", raw);
      const observation = observationJson(result);
      expect([raw, observation.includes("valueTime")]).toEqual([raw, false]);
      // The whole point: a `14:30:00` here would be the sent instant moved by hours in silence.
      expect([raw, observation.includes("14:30:00")]).toEqual([raw, false]);
      expect([raw, observation]).toEqual([raw, expect.stringContaining(`"valueString":"${raw}"`)]);
      expect([raw, issueLabels(result).includes(DROPPED_VALUE)]).toEqual([raw, true]);
    }
  });

  it("refuses a partial-precision TM rather than padding the seconds FHIR requires", () => {
    // `14:30:00` from `1430`, or `14:00:00` from `14`, would each be a precision the sender never
    // sent, so neither may appear anywhere in the resource.
    for (const [raw, padded] of [
      ["1430", "14:30:00"],
      ["14", "14:00:00"],
    ] as const) {
      const observation = observationJson(run("TM", raw));
      expect([raw, observation.includes("valueTime")]).toEqual([raw, false]);
      expect([raw, observation.includes(padded)]).toEqual([raw, false]);
      expect([raw, observation]).toEqual([raw, expect.stringContaining(`"valueString":"${raw}"`)]);
    }
  });

  it("refuses a shaped-but-out-of-domain TM, because @cosyte/fhir decides the time domain", () => {
    for (const raw of ["253000", "146000", "999999"]) {
      expect([raw, observationJson(run("TM", raw)).includes("valueTime")]).toEqual([raw, false]);
    }
  });
});

// ── NA → SampledData (AC-1, AC-10, AC-11) ───────────────────────────────────────────────────────

describe("OBX-2 = NA → Observation.valueSampledData (NA[SampledData])", () => {
  it("emits the R4 element name, NOT the `valueSampedData` typo the published OBX row carries", () => {
    const observation = observationJson(run("NA", "1^2^3"));
    expect(observation).toContain('"valueSampledData"');
    expect(observation).not.toContain("valueSamped");
  });

  it("reproduces all three worked examples of the Considerations chapter, dimensions and data", () => {
    // Each row is the chapter's own example text and its own stated `.dimensions`.
    const examples: readonly (readonly [string, number, string])[] = [
      ["125^34^-22^-234^569^442^-212^6", 1, "125 34 -22 -234 569 442 -212 6"],
      ["1.2^-3.5^5.2~2.0^3.1^-6.2~3.5^7.8^-1.3", 3, "1.2 -3.5 5.2 2.0 3.1 -6.2 3.5 7.8 -1.3"],
      ["^2^3^4~5^^^8~9^10~~17^18^19^20", 4, "E 2 3 4 5 E E 8 9 10 E E E E E E 17 18 19 20"],
    ];
    for (const [value, dimensions, data] of examples) {
      const observation = observationJson(run("NA", value));
      expect([value, observation]).toEqual([
        value,
        expect.stringContaining(`"dimensions":${String(dimensions)},"data":"${data}"`),
      ]);
    }
  });

  it("uses the chapter's `E` for a position no repetition carried, in the positions it names", () => {
    // The chapter's third example enumerates the absent positions: (1,1), (2,2), (2,3), (3,3),
    // (3,4), and the whole of row 4. That is nine `E`s and exactly nine.
    const data = observationJson(run("NA", "^2^3^4~5^^^8~9^10~~17^18^19^20"));
    const points = /"data":"([^"]+)"/.exec(data)?.[1]?.split(" ") ?? [];
    expect(points).toHaveLength(20);
    expect(points.filter((p) => p === SAMPLED_DATA_ABSENT_POINT)).toHaveLength(9);
  });

  it("asserts no magnitude for origin or period, declares both, and still clears the emit gate", () => {
    const result = run("NA", "1^2^3");
    const observation = observationJson(result);
    const absent = `{"extension":[{"url":"http://hl7.org/fhir/StructureDefinition/data-absent-reason","valueCode":"${SAMPLED_DATA_UNGROUNDED}"}]}`;
    expect(observation).toContain(`"origin":${absent}`);
    // A value-absent primitive serializes into the FHIR `_`-sibling; either way, no magnitude.
    expect(observation).toContain(`"_period":${absent}`);
    expect(observation).not.toMatch(/"origin":\{"value"/);
    expect(observation).not.toMatch(/"period":-?\d/);

    expect(issueLabels(result)).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}@SampledData.origin`,
        `${ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}@SampledData.period`,
      ]),
    );
    // AC-11's other half: the Observation is IN the bundle, not withheld by the gate.
    expect(observation).not.toBe("");
    expect(issueLabels(result)).not.toContain(
      `${ISSUE_CODES.TRANSFORM_RESOURCE_INVALID}@Observation`,
    );
  });

  it("refuses the whole array when a value that DID arrive is not a faithful decimal", () => {
    const result = run("NA", "1^PENDING^3");
    const observation = observationJson(result);
    expect(observation).not.toContain("valueSampledData");
    expect(observation).toContain('"valueString":"1^PENDING^3"');
    expect(issueLabels(result)).toEqual(
      expect.arrayContaining([
        `${ISSUE_CODES.TRANSFORM_QUANTITY_VALUE_INVALID}@SampledData.data`,
        DROPPED_VALUE,
      ]),
    );
    // A refused array never declares the two ungrounded elements of a datatype it did not emit.
    expect(issueLabels(result)).not.toContain(
      `${ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}@SampledData.origin`,
    );
  });
});

// ── ED → the IG-named valueAttachment extension (AC-2, AC-12, AC-13, AC-14) ─────────────────────

describe("OBX-2 = ED with OBX-5.4 = Base64 → the valueAttachment extension (ED[Attachment])", () => {
  const PAYLOAD = "JVBERi0xLjQK+/8AAQIDBAUGBwgJ==";

  it("uses the URL the OBX map fixes, and carries OBX-5.3 into Attachment.contentType", () => {
    const result = run("ED", `LAB^AP^application/pdf^${ED_BASE64_ENCODING}^${PAYLOAD}`);
    const observation = observationJson(result);
    expect(observation).toContain(
      `"extension":[{"url":"${OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL}","valueAttachment":{"contentType":"application/pdf","data":"${PAYLOAD}"}}]`,
    );
    expect(observation).not.toContain("valueString");
    expect(OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL).toBe(
      "https://hl7.org/fhir/5.0/StructureDefinition/extension-Observation.valueAttachment",
    );
  });

  it("carries the payload byte-for-byte: not decoded, not re-encoded, not validated, not truncated", () => {
    // Three payloads a library that decoded, re-encoded or validated would change or refuse: one
    // with the full base64 alphabet, one that is not decodable base64 at all, and a long one.
    const payloads = [PAYLOAD, "!!!not-base64-at-all!!!", "A".repeat(4096)];
    for (const payload of payloads) {
      const result = run("ED", `LAB^AP^application/pdf^${ED_BASE64_ENCODING}^${payload}`);
      const observation = observationJson(result);
      const carried = /"data":"([^"]*)"/.exec(observation)?.[1];
      expect([payload.length, carried]).toEqual([payload.length, payload]);
      // Nothing was said ABOUT the payload either: no drop, and no value in any diagnostic.
      expect([payload.length, issueLabels(result).includes(DROPPED_VALUE)]).toEqual([
        payload.length,
        false,
      ]);
      expect(JSON.stringify(result.issues)).not.toContain(payload.slice(0, 12));
    }
  });

  it("carries ED.2 as an alternate-codes extension ONLY when ED.3 is unvalued", () => {
    const withSubtype = observationJson(
      run("ED", `LAB^AP^application/pdf^${ED_BASE64_ENCODING}^${PAYLOAD}`),
    );
    expect(withSubtype).not.toContain("alternate-codes");

    const result = run("ED", `LAB^AP^^${ED_BASE64_ENCODING}^${PAYLOAD}`);
    const observation = observationJson(result);
    expect(observation).toContain(
      '{"url":"http://hl7.org/fhir/StructureDefinition/alternate-codes","valueCodeableConcept":{"coding":[{"code":"AP"}]}}',
    );
    expect(observation).not.toContain('"contentType"');
    expect(issueLabels(result)).toContain(
      `${ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}@Attachment.contentType`,
    );
  });

  it("emits no attachment at all when OBX-5.4 is not Base64, because both ED rows condition on it", () => {
    for (const encoding of ["A", "Hex", "base64", ""]) {
      const result = run("ED", `LAB^AP^application/pdf^${encoding}^${PAYLOAD}`);
      const observation = observationJson(result);
      expect([encoding, observation.includes("valueAttachment")]).toEqual([encoding, false]);
      expect([encoding, observation]).toEqual([
        encoding,
        expect.stringContaining('"valueString":"LAB^AP^application/pdf'),
      ]);
      expect([encoding, issueLabels(result).includes(DROPPED_VALUE)]).toEqual([encoding, true]);
    }
  });

  it("emits nothing when the Base64 condition holds but OBX-5.5 carries no payload", () => {
    const result = run("ED", `LAB^AP^application/pdf^${ED_BASE64_ENCODING}`);
    const observation = observationJson(result);
    expect(observation).not.toContain("valueAttachment");
    expect(observation).toContain('"valueString":"LAB^AP^application/pdf^Base64"');
  });

  it("leaves OBX-2 = RP exactly where it was: valueString + a declared drop, never an attachment", () => {
    // The RP row nominates the same extension and the guide's own comment on it reads "To be
    // resolved when we resolve DocumentReference and valueAttachment", so it is deliberately unbuilt.
    const result = run("RP", `http://x/1^LAB^application/pdf^${ED_BASE64_ENCODING}`);
    const observation = observationJson(result);
    expect(observation).not.toContain("valueAttachment");
    expect(observation).not.toContain(OBSERVATION_VALUE_ATTACHMENT_EXTENSION_URL);
    // Unchanged behaviour means unchanged behaviour: the FIRST component, as `Field.value` reads it.
    expect(observation).toContain('"valueString":"http://x/1"');
    expect(issueLabels(result)).toContain(DROPPED_VALUE);
  });
});

// ── An empty OBX-5 (AC-15) ──────────────────────────────────────────────────────────────────────

describe("an empty OBX-5 emits no value[x] and raises no drop, for every newly mapped type", () => {
  it("holds for DR, NR, TM, NA and ED alike, matching the already-mapped value types", () => {
    for (const valueType of ["DR", "NR", "TM", "NA", "ED"]) {
      const result = run(valueType, "");
      const observation = observationJson(result);
      // The Observation is still emitted (OBX-3 and OBX-11 ground it); it just carries no value.
      expect([valueType, observation.includes('"resourceType":"Observation"')]).toEqual([
        valueType,
        true,
      ]);
      expect([valueType, /"value[A-Z]/.test(observation)]).toEqual([valueType, false]);
      expect([valueType, observation.includes('"extension"')]).toEqual([valueType, false]);
      expect([valueType, issueLabels(result).includes(DROPPED_VALUE)]).toEqual([valueType, false]);
    }
  });

  it("treats an OBX-5 of nothing but delimiters as empty too, and still says nothing about it", () => {
    for (const valueType of ["DR", "NR", "NA", "ED"]) {
      const result = run(valueType, "^^^");
      expect([valueType, /"value[A-Z]/.test(observationJson(result))]).toEqual([valueType, false]);
      expect([valueType, issueLabels(result).includes(DROPPED_VALUE)]).toEqual([valueType, false]);
    }
  });
});

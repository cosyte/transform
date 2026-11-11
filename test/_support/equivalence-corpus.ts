/**
 * The output-equivalence corpus and the record of everything a caller can observe from one input.
 *
 * Two consumers read this module, and they must read the same bytes:
 *
 * - `scripts/capture-output-digests.ts`, which ran every input through the tree a change starts from
 *   and wrote one SHA-256 per input to `output-digests.json`; and
 * - `test/output-equivalence.test.ts`, which runs the same inputs through the tree under test and
 *   requires every digest to match.
 *
 * So a change that means to keep every output identical proves it here, and a change that means to
 * move one names the input and the reason in the test. Nothing in this module reads a file or the
 * clock: every input is synthetic and built in code, from the fixtures the other suites already use,
 * the bench shapes at small sizes, and seeded edits of both drawn from a fixed pseudo-random
 * sequence, so two runs on two trees build the same corpus. It imports only what the tree a change
 * starts from already has.
 */

import { createHash } from "node:crypto";

import { parseHL7, splitBatch, type Hl7Message } from "@cosyte/hl7";
import { parseResource, type FhirComplex } from "@cosyte/fhir";

import {
  createNamingSystem,
  toFhir,
  toOperationOutcome,
  toV2Observation,
  toV2Patient,
  type ReverseOptions,
  type TransformOptions,
} from "../../src/index.js";
import {
  AUTHORITIES,
  REVERSE_OPTIONS,
  admission,
  admissionBatch,
  labResult,
  longNote,
  observationBundle,
  patientJson,
  reportWithPdf,
} from "../../bench/shapes.mjs";
import { COMPLETENESS_FIXTURES } from "./completeness-fixtures.js";
import { MALFORMED_CLASS_INPUTS } from "./hl7-malformed-classes.js";
import { NO_TQ1_ORDER } from "./tq1-fixtures.js";
import IG_CORPUS from "./ig-corpus/messages.json" with { type: "json" };
import { segmentsFromPublishedBlock } from "../../scripts/conformance/corpus.js";

/** One v2 wire text the forward path maps. */
export interface ForwardInput {
  readonly id: string;
  readonly raw: string;
}

/** One FHIR JSON text the reverse path writes back to v2. */
export interface ReverseInput {
  readonly id: string;
  readonly kind: "Observation" | "Patient";
  readonly json: string;
}

/** A small deterministic pseudo-random sequence (mulberry32), so a seed names one corpus forever. */
function sequence(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

/**
 * Field values a seeded edit writes: empty and null markers, codes from the tables the maps read and
 * codes outside them, timestamps at every precision and some that are not timestamps, numbers and
 * comparators, repetitions, components, subcomponents and escape sequences. All synthetic.
 */
const FIELD_VALUES: readonly string[] = [
  "",
  '""',
  "F",
  "M",
  "U",
  "X",
  "I",
  "O",
  "E",
  "P",
  "A",
  "D",
  "C",
  "N",
  "H",
  "L",
  "R",
  "Z9",
  "NW",
  "CA",
  "SC",
  "2026",
  "202607",
  "20260721",
  "2026072114",
  "202607211430",
  "20260721143000",
  "20260721143000.123",
  "20260721143000-0500",
  "20260721143000+0130",
  "202607211430-0500",
  "20261341",
  "2026-07-21",
  "notadate",
  "12.5",
  "-3",
  "0",
  "<5",
  ">=10^",
  "1^:^5",
  "abc",
  "NM",
  "ST",
  "CWE",
  "CE",
  "TX",
  "FT",
  "SN",
  "ED",
  "DT",
  "TS",
  "NA",
  "mg^milligram^UCUM",
  "mmol/L^^UCUM",
  "24331-1^Lipid Panel^LN",
  "789-8^Erythrocytes^LN^LOCAL1^Local RBC^99LOC",
  "I10^Hypertension^I10",
  "PO^Oral^HL70162",
  "DA^Drug allergy^HL70127",
  "SV^Severe^HL70128",
  "MRN12345^^^HOSP^MR",
  "MRN1^^^HOSP^MR~ALT9^^^INSCO1^PI",
  "Public^Jane^Q^^Dr^^L",
  "Public^Jane~Doe^John^^^^^A",
  "123 Main St^Apt 4^Boston^MA^02101^USA^H",
  "^^^^^^^^",
  "a~b~c",
  "x^y^z^^w",
  "a&b&c^d",
  "\\T\\",
  "\\.br\\",
  "\\H\\bold\\N\\",
  "\\Zvendor\\",
  "\\",
  "&",
  "^",
  "~",
  "Specimen received",
  "1",
  "2",
  "99",
  "Y",
  "S",
  "B",
  "T",
  "V",
  "ARM^Arm^HL70550",
  "INSCO1^^^INSCO1",
  "SUB123",
  "SEL",
  "Application^Text^PDF^Base64^SGVsbG8=",
  "^^PDF^Base64^SGVsbG8=",
];

/** Split a wire text into its segment lines, dropping a trailing empty line. */
function linesOf(raw: string): string[] {
  const lines = raw.split(/\r\n|\r|\n/);
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/**
 * One seeded edit of a v2 message: a field set to a value from {@link FIELD_VALUES}, a segment
 * duplicated or removed, or a field emptied. MSH is never removed, and MSH-1 and MSH-2 never
 * change, so the edit is of a message the parser still reads.
 */
function editMessage(next: () => number, lines: string[]): string[] {
  const out = [...lines];
  const kind = next();
  const index = Math.floor(next() * out.length);
  const line = out[index] ?? "";
  const isMsh = line.startsWith("MSH");
  if (kind < 0.08 && out.length > 1 && !isMsh) {
    out.splice(index, 1);
    return out;
  }
  if (kind < 0.16) {
    out.splice(index + 1, 0, isMsh ? (out[1] ?? line) : line);
    if (isMsh && out.length > 2) return out;
    return out;
  }
  const fields = line.split("|");
  const lowest = isMsh ? 3 : 1;
  const position = lowest + Math.floor(next() * Math.max(1, fields.length + 2 - lowest));
  while (fields.length <= position) fields.push("");
  fields[position] = kind < 0.24 ? "" : pick(next, FIELD_VALUES);
  out[index] = fields.join("|");
  return out;
}

/**
 * The IG's published messages as wire text: the page text the conformance corpus keeps, unescaped and
 * split the way the conformance run reads it.
 */
function igMessages(): ForwardInput[] {
  return IG_CORPUS.messages.map((m) => ({
    id: `ig/${m.name}`,
    raw: segmentsFromPublishedBlock(m.publishedLines).join("\r"),
  }));
}

/** The v2 texts every seeded edit starts from: fixtures from the suites and the bench shapes. */
function forwardSeeds(): ForwardInput[] {
  const seeds: ForwardInput[] = [
    ...igMessages(),
    ...COMPLETENESS_FIXTURES.map((f) => ({ id: `completeness/${f.id}`, raw: f.raw })),
    ...MALFORMED_CLASS_INPUTS.map((m) => ({ id: `malformed/${m.id}`, raw: m.raw })),
    { id: "tq1/no-tq1-order", raw: NO_TQ1_ORDER.join("\r") },
  ];
  for (let i = 0; i < 4; i++) {
    seeds.push({ id: `bench/admission/${String(i)}`, raw: admission(i) });
    seeds.push({ id: `bench/lab-result-10/${String(i)}`, raw: labResult(i, 10) });
    seeds.push({ id: `bench/long-note-20/${String(i)}`, raw: longNote(i, 20) });
  }
  seeds.push({ id: "bench/lab-result-60", raw: labResult(7, 60) });
  seeds.push({ id: "bench/long-note-200", raw: longNote(7, 200) });
  seeds.push({ id: "bench/admission-batch-3", raw: admissionBatch(1, 3) });
  seeds.push({ id: "bench/report-pdf-2k", raw: reportWithPdf(1, 2048) });
  return seeds;
}

/** How many seeded edits each forward seed gets, and how many edits each one makes. */
const FORWARD_VARIANTS = 12;

/**
 * The forward corpus: every seed as it is, then {@link FORWARD_VARIANTS} seeded variants of each,
 * each one to four edits away from its seed.
 */
export function forwardCorpus(): ForwardInput[] {
  const seeds = forwardSeeds();
  const out: ForwardInput[] = [...seeds];
  const next = sequence(0x7a11);
  for (const seed of seeds) {
    if (seed.raw.startsWith("FHS") || seed.raw.startsWith("BHS")) continue;
    for (let v = 0; v < FORWARD_VARIANTS; v++) {
      let lines = linesOf(seed.raw);
      const edits = 1 + Math.floor(next() * 4);
      for (let e = 0; e < edits; e++) lines = editMessage(next, lines);
      out.push({ id: `${seed.id}~${String(v)}`, raw: lines.join("\r") });
    }
  }
  return out;
}

/** JSON values a seeded edit writes into a FHIR resource: wrong types, unknown codes, and nulls. */
const JSON_VALUES: readonly unknown[] = [
  "",
  "final",
  "preliminary",
  "amended",
  "corrected",
  "cancelled",
  "entered-in-error",
  "registered",
  "unknown",
  "male",
  "female",
  "other",
  "official",
  "usual",
  "nickname",
  "old",
  "home",
  "work",
  "temp",
  "billing",
  "2026",
  "2026-07",
  "2026-07-21",
  "2026-07-21T14:30:00-05:00",
  "2026-07-21T14:30:00Z",
  "2026-07-21T14:30",
  "not-a-date",
  "http://loinc.org",
  "http://snomed.info/sct",
  "http://unitsofmeasure.org",
  "http://example.org/unknown",
  "urn:oid:2.16.840.1.113883.19",
  "urn:oid:2.16.840.1.113883.99",
  12.5,
  0,
  -1,
  true,
  false,
  null,
  [],
  {},
  ["Jane", "Q"],
  { value: 5.4, unit: "mmol/L", system: "http://unitsofmeasure.org", code: "mmol/L" },
  { value: 7, comparator: "<", unit: "mg" },
  { coding: [{ system: "http://loinc.org", code: "789-8", display: "Erythrocytes" }] },
  { coding: [{ system: "http://example.org/unknown", code: "X1" }], text: "Local" },
  { text: "Free text only" },
  { start: "2026-07-21", end: "2026-07-22T10:00:00Z" },
  { low: { value: 1 }, high: { value: 5 } },
  { numerator: { value: 1 }, denominator: { value: 2 } },
  "line one\nline two | with ^ and ~ and & and \\",
];

/** Every key path of a JSON value whose parent is an object, as a list of keys and indexes. */
function keyPaths(value: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => keyPaths(item, [...at, i]));
  }
  if (value !== null && typeof value === "object") {
    const out: (string | number)[][] = [];
    for (const [key, child] of Object.entries(value)) {
      if (at.length === 0 && key === "resourceType") continue;
      out.push([...at, key]);
      out.push(...keyPaths(child, [...at, key]));
    }
    return out;
  }
  return [];
}

/** Keys an edit may add at the root of a resource, beside the ones the shape already has. */
const ADDED_KEYS: Readonly<Record<ReverseInput["kind"], readonly string[]>> = {
  Observation: [
    "valueString",
    "valueQuantity",
    "valueCodeableConcept",
    "valueDateTime",
    "valuePeriod",
    "valueRange",
    "valueRatio",
    "valueInteger",
    "valueBoolean",
    "effectivePeriod",
    "effectiveInstant",
    "issued",
    "interpretation",
    "referenceRange",
    "method",
    "bodySite",
    "note",
    "dataAbsentReason",
  ],
  Patient: [
    "deceasedBoolean",
    "deceasedDateTime",
    "telecom",
    "maritalStatus",
    "multipleBirthBoolean",
    "multipleBirthInteger",
    "communication",
    "active",
  ],
};

/** One seeded edit of a FHIR resource: a key set, removed, or added with a value from the pool. */
function editResource(next: () => number, resource: unknown, kind: ReverseInput["kind"]): unknown {
  const copy = structuredClone(resource) as Record<string, unknown>;
  const paths = keyPaths(copy);
  const choice = next();
  if (choice < 0.2 || paths.length === 0) {
    copy[pick(next, ADDED_KEYS[kind])] = structuredClone(pick(next, JSON_VALUES));
    return copy;
  }
  const path = pick(next, paths);
  let parent: unknown = copy;
  for (const key of path.slice(0, -1)) parent = (parent as Record<string, unknown>)[key];
  const last = path[path.length - 1] as string | number;
  const holder = parent as Record<string | number, unknown>;
  if (choice < 0.4) {
    if (Array.isArray(holder) && typeof last === "number") holder.splice(last, 1);
    else delete holder[last];
  } else {
    holder[last] = structuredClone(pick(next, JSON_VALUES));
  }
  return copy;
}

/** How many seeded edits each reverse seed gets. */
const REVERSE_VARIANTS = 30;

/** The FHIR resources every reverse edit starts from: the bench shapes, one per entry. */
function reverseSeeds(): ReverseInput[] {
  const seeds: ReverseInput[] = [];
  for (let i = 0; i < 2; i++) {
    const bundle = JSON.parse(observationBundle(i, 6)) as {
      entry: { resource: unknown }[];
    };
    bundle.entry.forEach((entry, k) => {
      seeds.push({
        id: `bench/observation/${String(i)}/${String(k)}`,
        kind: "Observation",
        json: JSON.stringify(entry.resource),
      });
    });
    seeds.push({ id: `bench/patient/${String(i)}`, kind: "Patient", json: patientJson(i) });
  }
  return seeds;
}

/**
 * The reverse corpus: every seed as it is, then {@link REVERSE_VARIANTS} seeded variants of each,
 * each one to three edits away from its seed.
 */
export function reverseCorpus(): ReverseInput[] {
  const seeds = reverseSeeds();
  const out: ReverseInput[] = [...seeds];
  const next = sequence(0x2e7e);
  for (const seed of seeds) {
    const variants = seed.kind === "Patient" ? REVERSE_VARIANTS * 3 : REVERSE_VARIANTS;
    for (let v = 0; v < variants; v++) {
      let value: unknown = JSON.parse(seed.json);
      const edits = 1 + Math.floor(next() * 3);
      for (let e = 0; e < edits; e++) value = editResource(next, value, seed.kind);
      out.push({ id: `${seed.id}~${String(v)}`, kind: seed.kind, json: JSON.stringify(value) });
    }
  }
  return out;
}

/**
 * A plain, ordered rendering of any value a call returns: every own enumerable key of every object,
 * in a fixed order, with `undefined`, functions and class names kept visible. Two values render the
 * same exactly when a caller reading them could not tell them apart by their data.
 */
export function render(value: unknown): unknown {
  if (value === undefined) return { undefined: true };
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return { number: String(value) };
  if (typeof value === "bigint") return { bigint: String(value) };
  if (typeof value === "function") return { function: value.name };
  if (Array.isArray(value)) return value.map(render);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = render((value as Record<string, unknown>)[key]);
    }
    return { object: out };
  }
  return { other: typeof value };
}

/** What a call threw, or returned. */
function attempt(call: () => unknown): unknown {
  try {
    return { returned: call() };
  } catch (error) {
    return error instanceof Error
      ? { threw: error.name, message: error.message }
      : { threw: String(error) };
  }
}

/** A deterministic `urn:uuid` allocator, so two trees allocate the same fullUrls. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/** The parsed messages of one wire text: a batch's every message, or the one message. */
function messagesOf(raw: string): Hl7Message[] {
  if (!raw.startsWith("FHS") && !raw.startsWith("BHS")) return [parseHL7(raw)];
  return splitBatch(raw).messages.flatMap((entry) => (entry.ok ? [entry.message] : []));
}

/** The forward option sets every message is run under. */
function forwardOptions(): TransformOptions[] {
  return [
    { namingSystem: createNamingSystem(AUTHORITIES), generateId: sequentialIds() },
    {
      namingSystem: createNamingSystem(),
      assumeTimezoneOffsetMinutes: -300,
      generateId: sequentialIds(),
    },
  ];
}

/**
 * Everything a caller sees from one forward input: for each message and each option set, the
 * Bundle, every issue, and the issues as an OperationOutcome, or what the call threw.
 */
export function observeForward(input: ForwardInput): unknown {
  // A text the parser refuses never reaches the transform. Only the refusal's class is kept: its
  // wording is the parser's, and moving the parser to a newer release may reword it.
  const parsed = attempt(() => messagesOf(input.raw));
  if (!("returned" in (parsed as object))) return { parse: (parsed as { threw: string }).threw };
  const messages = (parsed as { returned: Hl7Message[] }).returned;
  return messages.map((msg) =>
    forwardOptions().map((options) =>
      attempt(() => {
        const result = toFhir(msg, options);
        return render({
          bundle: result.bundle,
          issues: result.issues,
          outcome: toOperationOutcome(result.issues),
        });
      }),
    ),
  );
}

/** A fixed MSH envelope, so the reverse path never reads the clock or draws a control id. */
const ENVELOPE = { controlId: "CTRL0001", timestamp: "20260721143000-0500" } as const;

/** The reverse option sets every resource is written back under. */
const REVERSE_OPTION_SETS: readonly ReverseOptions[] = [
  { envelope: ENVELOPE },
  { ...REVERSE_OPTIONS, envelope: { ...REVERSE_OPTIONS.envelope, ...ENVELOPE } },
  {
    envelope: ENVELOPE,
    codeSystems: { LOCAL1: "http://example.org/unknown", LN: "http://loinc.org" },
    assigningAuthorities: { "urn:oid:2.16.840.1.113883.99": "OTHER" },
  },
];

/** The triggers each reverse shape is asked for: its usual one and one it may not support. */
const TRIGGERS: Readonly<Record<ReverseInput["kind"], readonly string[]>> = {
  Observation: ["R01", "R30"],
  Patient: ["A28", "A31"],
};

/**
 * Everything a caller sees from one reverse input: for each trigger and option set, the v2 message
 * written (its wire text and its segments' data) and every issue, or what the call threw.
 */
export function observeReverse(input: ReverseInput): unknown {
  const parsed = attempt(() => parseResource(input.json).resource);
  if (!("returned" in (parsed as object))) return { parse: (parsed as { threw: string }).threw };
  const resource = (parsed as { returned: FhirComplex }).returned;
  const convert = input.kind === "Patient" ? toV2Patient : toV2Observation;
  return TRIGGERS[input.kind].map((trigger) =>
    REVERSE_OPTION_SETS.map((options) =>
      attempt(() => {
        const result = convert(resource, trigger, options);
        return render({
          text: result.value?.toString(),
          json: result.value?.toJSON(),
          issues: result.issues,
        });
      }),
    ),
  );
}

/** The SHA-256 of an observation's JSON text. */
export function digest(observation: unknown): string {
  return createHash("sha256").update(JSON.stringify(observation)).digest("hex");
}

/** Every input's digest, keyed `forward/<id>` and `reverse/<id>`, in corpus order. */
export function corpusDigests(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const input of forwardCorpus()) out[`forward/${input.id}`] = digest(observeForward(input));
  for (const input of reverseCorpus()) out[`reverse/${input.id}`] = digest(observeReverse(input));
  return out;
}

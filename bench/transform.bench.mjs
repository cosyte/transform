// Benchmarks for @cosyte/transform, on @cosyte/bench, against the built entry a consumer imports.
//
// A reading of this build (throughput, latency p50/p95/p99, allocations, peak heap, a long run for
// leaks, and the cold import with every file it loads and its gzip size):
//   pnpm build && pnpm bench:reading --out bench-results/reading.json
// One benchmark or one case only (as `<benchmark> / <size>` in the results):
//   pnpm bench:reading --only "toFhir: ORU^R01 lab result"
// A base against head comparison, the base built in another checkout:
//   pnpm bench:compare --base <base checkout>/dist/index.mjs --head dist/index.mjs
// The budgets and the CPU and heap profile of the hottest paths:
//   node bench/budgets.mjs bench-results/reading.json
//   node --enable-source-maps bench/profile.mjs dist/index.mjs
// On a pull request CI runs the comparison in its bench-compare job, and the bench-reading workflow
// takes a reading and a profile on a GitHub-hosted runner. Both are advisory: they post their numbers
// and fail nothing.
//
// The suite is handed the module under test rather than importing it, so one file measures both
// builds. What it times is the transform alone: each input is parsed by @cosyte/hl7 or read by
// @cosyte/fhir once, when its corpus is built, and never inside a timed region. The byte counts are
// the wire text's, so a throughput is in bytes of v2 or FHIR JSON a second. Every input is synthetic
// and built in code by bench/shapes.mjs: no file is read.

import { defineBenchmark, defineSuite } from "@cosyte/bench";
import { getProperty, isComplex, isList, parseResource } from "@cosyte/fhir";
import { parseHL7, splitBatch } from "@cosyte/hl7";

import {
  AUTHORITIES,
  KIB,
  REVERSE_OPTIONS,
  admission,
  admissionBatch,
  labResult,
  longNote,
  observationBundle,
  patientJson,
  reportWithPdf,
} from "./shapes.mjs";

/** The parsed messages of one wire text: a batch's every message, or the one message. */
function messagesOf(raw) {
  if (!raw.startsWith("FHS") && !raw.startsWith("BHS")) return [parseHL7(raw)];
  return splitBatch(raw).messages.map((entry) => {
    if (!entry.ok) throw new Error("a synthetic batch message did not parse");
    return entry.message;
  });
}

/** The resources of a Bundle's entries, read once. */
function entryResources(text) {
  const entries = getProperty(parseResource(text).resource, "entry");
  if (entries === undefined || !isList(entries)) return [];
  return entries.items.flatMap((entry) => {
    const resource = isComplex(entry) ? getProperty(entry, "resource") : undefined;
    return resource === undefined ? [] : [resource];
  });
}

/**
 * The sizes of a v2 shape as @cosyte/bench takes them: each wire text built in code and parsed once,
 * outside every timed region, with its bytes.
 */
function v2Sizes(sizes) {
  return sizes.map((size) => ({
    label: size.label,
    compare: size.compare ?? false,
    build: () => {
      const texts = Array.from({ length: size.inputs }, (_v, i) => size.build(i));
      return {
        inputs: texts.map(messagesOf),
        bytes: texts.reduce((n, text) => n + Buffer.byteLength(text), 0),
      };
    },
  }));
}

/** The sizes of a FHIR shape: each JSON text built in code and read once, with its bytes. */
function fhirSizes(sizes, read) {
  return sizes.map((size) => ({
    label: size.label,
    compare: size.compare ?? false,
    build: () => {
      const texts = Array.from({ length: size.inputs }, (_v, i) => size.build(i));
      return {
        inputs: texts.map(read),
        bytes: texts.reduce((n, text) => n + Buffer.byteLength(text), 0),
      };
    },
  }));
}

/** Map every message of one input to FHIR; the weight is every issue and every entry. */
function bindToFhir(transform) {
  const namingSystem = transform.createNamingSystem(AUTHORITIES);
  return (messages) => {
    let weight = 0;
    for (const msg of messages) {
      const result = transform.toFhir(msg, { namingSystem });
      weight += result.issues.length + 1;
    }
    return weight;
  };
}

const weighCount = (n) => n;

// The shapes, each at the size real traffic has and at a size well past it. The largest sizes stop
// where one call takes seconds: an admission takes milliseconds to map and an OBX about half of one,
// so a 1 MiB batch is already several seconds a call. The pull request comparison runs only the
// sizes marked `compare`: one admission, the report with a 64 KiB PDF (which maps an ORU^R01 and its
// Observations) and the 100 entry Bundle. A comparison runs every case 24 times in fresh processes
// within a 600 second budget, and a toFhir case's warmup alone can take seconds. A reading measures
// every size.
const benchmarks = [
  defineBenchmark({
    // The feed: ADT^A01 admissions one at a time, then the batch files that carry thousands.
    name: "toFhir: ADT^A01 batch",
    sizes: v2Sizes([
      { label: "1 message, 1 KiB", inputs: 16, build: (i) => admission(i), compare: true },
      { label: "100 messages, 99 KiB", inputs: 1, build: (i) => admissionBatch(i, 100) },
      { label: "1,000 messages, 0.97 MiB", inputs: 1, build: (i) => admissionBatch(i, 1_000) },
    ]),
    bind: bindToFhir,
    weigh: weighCount,
  }),
  defineBenchmark({
    // The dense large message: one lab result with many OBX lines, each an Observation.
    name: "toFhir: ORU^R01 lab result",
    sizes: v2Sizes([
      { label: "10 results, 1.2 KiB", inputs: 16, build: (i) => labResult(i, 10) },
      { label: "500 results, 43 KiB", inputs: 1, build: (i) => labResult(i, 500) },
      { label: "5,000 results, 0.4 MiB", inputs: 1, build: (i) => labResult(i, 5_000) },
    ]),
    bind: bindToFhir,
    weigh: weighCount,
  }),
  defineBenchmark({
    // A long clinical document: an MDM^T02 note of many OBX TX lines, one DocumentReference.
    name: "toFhir: MDM^T02 long note",
    sizes: v2Sizes([
      { label: "20 lines, 3.2 KiB", inputs: 16, build: (i) => longNote(i, 20) },
      { label: "1,000 lines, 144 KiB", inputs: 2, build: (i) => longNote(i, 1_000) },
      { label: "20,000 lines, 2.9 MiB", inputs: 1, build: (i) => longNote(i, 20_000) },
    ]),
    bind: bindToFhir,
    weigh: weighCount,
  }),
  defineBenchmark({
    // The large opaque payload: one base64 PDF in an OBX of type ED, carried to Attachment.data.
    name: "toFhir: ORU^R01 base64 PDF",
    sizes: v2Sizes([
      {
        label: "64 KiB PDF, 86 KiB",
        inputs: 4,
        build: (i) => reportWithPdf(i, 64 * KIB),
        compare: true,
      },
      { label: "4 MiB PDF, 5.3 MiB", inputs: 1, build: (i) => reportWithPdf(i, 4096 * KIB) },
    ]),
    bind: bindToFhir,
    weigh: weighCount,
  }),
  defineBenchmark({
    // FHIR back to v2: every Observation of a searchset Bundle written back to an ORU^R01 OBX.
    name: "toV2Observation: searchset Bundle",
    sizes: fhirSizes(
      [
        { label: "1 Observation, 0.6 KiB", inputs: 64, build: (i) => observationBundle(i, 1) },
        {
          label: "100 entries, 43 KiB",
          inputs: 4,
          build: (i) => observationBundle(i, 100),
          compare: true,
        },
        { label: "1,000 entries, 0.4 MiB", inputs: 1, build: (i) => observationBundle(i, 1_000) },
        { label: "5,000 entries, 2.1 MiB", inputs: 1, build: (i) => observationBundle(i, 5_000) },
      ],
      entryResources,
    ),
    bind: (transform) => (resources) => {
      let weight = 0;
      for (const resource of resources) {
        const result = transform.toV2Observation(resource, "R01", REVERSE_OPTIONS);
        weight += result.issues.length + (result.value === undefined ? 0 : 1);
      }
      return weight;
    },
    weigh: weighCount,
  }),
  defineBenchmark({
    // FHIR back to v2: one Patient to an ADT^A28, the reverse path's other shape.
    name: "toV2Patient: Patient",
    sizes: fhirSizes(
      [{ label: "1 Patient, 0.4 KiB", inputs: 64, build: (i) => patientJson(i) }],
      (text) => parseResource(text).resource,
    ),
    bind: (transform) => (resource) => {
      const result = transform.toV2Patient(resource, "A28", REVERSE_OPTIONS);
      return result.issues.length + (result.value === undefined ? 0 : 1);
    },
    weigh: weighCount,
  }),
];

export default defineSuite({ name: "@cosyte/transform", benchmarks });

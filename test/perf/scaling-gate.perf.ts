/**
 * The scaling gates for the v2 to FHIR transform and the FHIR to v2 path, from
 * `@cosyte/test-utils/perf`, run by `pnpm test:perf` and never under coverage (see
 * `vitest.perf.config.ts`).
 *
 * Each asks one question: does the cost grow faster than the input? On the count axis, 4 times the
 * inputs; on the size axis, inputs 4 times longer. Each ratio must stay inside the band the shared
 * contract fixes. A gate does not see a constant-factor slowdown: a transform 10% slower everywhere
 * passes, and always will. The base against head comparison on a pull request
 * (`bench/transform.bench.mjs`) is the instrument for that.
 *
 * - `toFhir`, a lab result: ADT^A01 admissions on the count axis, an ORU^R01 with 4 times the OBX
 *   lines on the size axis, each line an Observation in the Bundle.
 * - `toFhir`, a long note: MDM^T02 notes on the count axis, a note with 4 times the OBX TX lines on
 *   the size axis, all of them one DocumentReference's text: the shape a long document reaches v2 in.
 * - `toV2Observation`: single Observations on the count axis, the Observations of a searchset Bundle
 *   4 times as long on the size axis, each written back in turn as a caller would.
 *
 * The sizes are small because the transform is not cheap: an admission takes milliseconds, an OBX
 * about half of one (the bench has the numbers). A quadratic cost only shows once it is as large as
 * the linear one, so each self-check's regression does real work per pair, and the fixtures are
 * sized so that it clears the ceiling while a regressed pass stays short enough to warm up:
 * - a lab result: the emit gate run again over every Observation already in the Bundle each time
 *   one joins it, which is how a check over the whole Bundle would slip into the per-resource loop;
 * - a long note: the note's text rebuilt from its first line for every line;
 * - the reverse path: every Observation compared with every one before it through its serialized
 *   form, serializing again each time.
 * Every input is synthetic and built in code by `bench/shapes.mjs`, the same code the benchmarks
 * use, and parsed outside every timed phase.
 */

import {
  getProperty,
  isComplex,
  isList,
  parseResource,
  serializeResource,
  validateResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";
import { parseHL7, type Hl7Message } from "@cosyte/hl7";
import {
  assertScalingGateFires,
  scalingGate,
  type ScalingGateOptions,
} from "@cosyte/test-utils/perf";
import { describe, expect, it } from "vitest";

import {
  createNamingSystem,
  toFhir,
  toV2Observation,
  type ReverseResult,
  type TransformResult,
} from "../../src/index.js";
import {
  AUTHORITIES,
  REVERSE_OPTIONS,
  admission,
  labResult,
  longNote,
  observationBundle,
} from "../../bench/shapes.mjs";

const namingSystem = createNamingSystem(AUTHORITIES);

/**
 * The fixtures are sized for room over the gate's 4 ms phase floor, not to clear it: one runner can
 * be twice as fast as another on the same code, and a phase under the floor skips, which this file
 * counts as a failure. Each axis's clean base phase is aimed at 12 ms or more on the fastest runner
 * measured (about 20 ms on a typical one), and {@link MIN_BASE_PHASE_MS} holds every axis to 8 ms, so
 * a fixture that drifts toward the floor fails here first, with its numbers. Only input counts grow;
 * the floor, the ceiling and the repetitions are the shared contract's.
 *
 * Admissions on the count axis: 32 measured 3.37 ms on the fastest runner once the emit gate reused
 * one schema registry per type on `@cosyte/fhir` 0.1.12.
 */
const ADMISSIONS = 128;
/** OBX lines in the size axis's base messages; the scaled phase's have 4 times as many. */
const RESULTS = 24;
/** Lab results in each size-axis phase: 8 of 24 lines measured 3.61 ms on the fastest runner. */
const LAB_MESSAGES = 32;
/** Notes on the long note's count axis, each of 20 lines: 64 measured 3.27 ms on the fastest runner. */
const NOTES = 256;
/** Long notes in each size-axis phase: one note of 2,000 lines measured 2.6 ms. */
const NOTE_MESSAGES = 6;
/** TX lines in the long note's base message. */
const NOTE_LINES = 2_000;
/** Observations on the reverse path's count axis: 1,000 measured 11.2 ms on a slower runner. */
const OBSERVATIONS = 3_000;
/**
 * Entries in each of the reverse path's base Bundles, and the Bundles in a phase: an Observation
 * takes tens of microseconds to write back, and 24 Bundles of 32 measured 3.05 ms on the fastest
 * runner. The self-check's quadratic regression needs the entries spread over several short Bundles
 * to keep a regressed pass short enough to warm up, so the Bundles grow, not the entries.
 */
const ENTRIES = 32;
const BUNDLES = 120;

const transform = (msg: Hl7Message): TransformResult => toFhir(msg, { namingSystem });

/** The resources of a Bundle's entries. */
function entryResources(bundle: FhirNode): FhirComplex[] {
  const entries = isComplex(bundle) ? getProperty(bundle, "entry") : undefined;
  if (entries === undefined || !isList(entries)) return [];
  return entries.items.flatMap((entry) => {
    const resource = isComplex(entry) ? getProperty(entry, "resource") : undefined;
    return resource !== undefined && isComplex(resource) ? [resource] : [];
  });
}

/**
 * Compare each resource with every one before it through its serialized form, serializing again
 * each time: quadratic in the count. Returns how many pairs matched, so the work is used.
 */
function countEqualPairsQuadratically(resources: readonly FhirComplex[]): number {
  let equal = 0;
  for (let k = 0; k < resources.length; k++) {
    const current = resources[k];
    if (current === undefined) continue;
    const text = serializeResource(current);
    for (let j = 0; j < k; j++) {
      const earlier = resources[j];
      if (earlier !== undefined && serializeResource(earlier) === text) equal++;
    }
  }
  return equal;
}

/**
 * The transform, then the emit gate run again over every Observation already in the Bundle each
 * time one joins it: quadratic in the OBX count. It counts the findings, so the work is used.
 */
function transformRevalidating(msg: Hl7Message): TransformResult {
  const result = transform(msg);
  const resources = entryResources(result.bundle);
  let findings = 0;
  for (let k = 0; k < resources.length; k++) {
    for (let j = 0; j <= k; j++) {
      const earlier = resources[j];
      if (earlier !== undefined) findings += validateResource(earlier).issues.length;
    }
  }
  if (findings < 0) throw new Error("unreachable");
  return result;
}

/**
 * The note's text rebuilt from its first line for every line, the way a careless assembly grows a
 * string: quadratic in the line count. Throws if a rebuilt text is shorter than its last line.
 */
function transformRebuildingNote(msg: Hl7Message): TransformResult {
  const lines = msg.segments("OBX").map((obx) => obx.field(5).value);
  for (let k = 1; k <= lines.length; k++) {
    const text = lines.slice(0, k).join("\n");
    if (text.length < (lines[k - 1] ?? "").length) throw new Error("a line was lost");
  }
  return transform(msg);
}

/** The issue codes of a result: what each self-check holds equal between the two transforms. */
const sameIssues = (a: { issues: readonly { code: string }[] }, b: typeof a): boolean =>
  a.issues.map((i) => i.code).join() === b.issues.map((i) => i.code).join();

function labOptions(): ScalingGateOptions<Hl7Message, TransformResult> {
  return {
    name: "@cosyte/transform toFhir",
    parse: transform,
    weigh: (result) => result.issues.length + 1,
    count: { n: ADMISSIONS, generate: (i) => parseHL7(admission(i)) },
    size: {
      inputs: LAB_MESSAGES,
      size: RESULTS,
      generate: (i, size) => parseHL7(labResult(i, size)),
    },
  };
}

function noteOptions(): ScalingGateOptions<Hl7Message, TransformResult> {
  return {
    name: "@cosyte/transform toFhir, a long note",
    parse: transform,
    weigh: (result) => result.issues.length + 1,
    count: { n: NOTES, generate: (i) => parseHL7(longNote(i, 20)) },
    size: {
      inputs: NOTE_MESSAGES,
      size: NOTE_LINES,
      generate: (i, size) => parseHL7(longNote(i, size)),
    },
  };
}

/** The Observations of a synthetic searchset Bundle, read once outside every timed phase. */
const observations = (i: number, entries: number): FhirComplex[] =>
  entryResources(parseResource(observationBundle(i, entries)).resource);

/** Every Observation written back to v2, in order, as a caller holding a Bundle would. */
function reverseAll(resources: readonly FhirComplex[]): ReverseResult[] {
  return resources.map((r) => toV2Observation(r, "R01", REVERSE_OPTIONS));
}

const reverseOptions: ScalingGateOptions<readonly FhirComplex[], ReverseResult[]> = {
  name: "@cosyte/transform toV2Observation",
  parse: reverseAll,
  weigh: (results) => results.length,
  count: { n: OBSERVATIONS, generate: (i) => observations(i, 1) },
  size: { inputs: BUNDLES, size: ENTRIES, generate: observations },
};

/** Write one line to the run's output, where a passing run's numbers are kept. */
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

/**
 * The least a clean base phase may measure, in milliseconds: twice the shared contract's 4 ms floor,
 * so an axis whose fixture drifts toward the floor fails here, by name, before it starts skipping.
 */
const MIN_BASE_PHASE_MS = 8;

/**
 * A skip is not a pass: a gate that could not measure says so here, rather than reading green. Each
 * axis's ratio and both phase times are printed on a pass too, so every run's headroom is on record.
 */
function expectMeasured(report: ReturnType<typeof scalingGate>): void {
  for (const axis of [report.count, report.size]) {
    expect(axis.status, axis.diagnostic).toBe("measured");
    if (axis.status !== "measured") continue;
    print(
      `${report.name}, ${axis.axis} axis: ratio ${axis.ratio.toFixed(3)}, ` +
        `base min ${axis.base.min.toFixed(2)} ms, scaled min ${axis.scaled.min.toFixed(2)} ms`,
    );
    expect(axis.base.min, `${report.name}, ${axis.axis} axis base phase`).toBeGreaterThanOrEqual(
      MIN_BASE_PHASE_MS,
    );
  }
}

/** Print what a self-check measured: the regressed signal, its margin over the ceiling, the clean bases. */
function printSelfCheck(report: ReturnType<typeof assertScalingGateFires>): void {
  print(
    `${report.name}, self-check on the ${report.axis} axis: signal ${report.signal.toFixed(3)}, ` +
      `margin ${report.margin.toFixed(3)}x, clean base min ${report.cleanBaseMinMs.count.toFixed(2)} ms ` +
      `(count) / ${report.cleanBaseMinMs.size.toFixed(2)} ms (size)`,
  );
}

describe("the scaling gate: toFhir", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(labOptions()));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(labOptions(), {
      regressedParse: transformRevalidating,
      equals: sameIssues,
    });
    printSelfCheck(report);
    expect(report.margin).toBeGreaterThan(1);
  });
});

describe("the scaling gate: toFhir on a long note", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(noteOptions()));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(noteOptions(), {
      regressedParse: transformRebuildingNote,
      equals: sameIssues,
    });
    printSelfCheck(report);
    expect(report.margin).toBeGreaterThan(1);
  });
});

describe("the scaling gate: toV2Observation", () => {
  it("has not acquired a complexity regression on either axis", () => {
    expectMeasured(scalingGate(reverseOptions));
  });

  it("has fixtures large enough for that gate to fail", () => {
    const report = assertScalingGateFires(reverseOptions, {
      regressedParse: (resources) => {
        if (countEqualPairsQuadratically(resources) < 0) throw new Error("unreachable");
        return reverseAll(resources);
      },
      equals: (a, b) => a.length === b.length && a.every((r, k) => sameIssues(r, b[k] ?? r)),
    });
    printSelfCheck(report);
    expect(report.margin).toBeGreaterThan(1);
  });
});

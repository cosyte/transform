// A CPU profile and a sampled heap profile of the hottest paths, with the top functions of each:
//   pnpm build && node --enable-source-maps bench/profile.mjs dist/index.mjs [--out <dir>] [--summary <file.md>]
//
// First it times every shape of the bench at its smallest and its largest size the same simple way,
// one size at a time, so a size a reading skips for an unsettled warmup still has a throughput. Then
// each workload is warmed and profiled on its own for about two seconds through the inspector
// (node:inspector/promises), so a function's share is a share of that workload alone. With
// --enable-source-maps and the build's source map beside it, a function is named by its src/ file
// and line; without, by the built file. `--out` keeps every .cpuprofile and .heapprofile for a
// profiler's own view (Chrome DevTools, speedscope). The inputs are the bench's own, from
// bench/shapes.mjs: synthetic, built in code, and parsed once before anything is timed.

import { mkdirSync, writeFileSync } from "node:fs";
import { Session } from "node:inspector/promises";
import { findSourceMap } from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

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
  reportWithPdf,
} from "./shapes.mjs";

const PROFILE_MS = 2_000;
const WARMUP_MS = 500;
const TOP = 12;
const SAMPLES = 9;
const SAMPLE_MS = 100;

function args(argv) {
  const out = { target: argv[0], dir: undefined, summary: undefined };
  for (let i = 1; i < argv.length; i++) {
    if (argv[i] === "--out") out.dir = argv[++i];
    else if (argv[i] === "--summary") out.summary = argv[++i];
  }
  return out;
}

/** The parsed messages of one wire text: a batch's every message, or the one message. */
function messagesOf(raw) {
  if (!raw.startsWith("FHS")) return [parseHL7(raw)];
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

/** Run `pass` until `ms` have gone by; returns how many passes ran. */
function runFor(pass, ms) {
  const end = performance.now() + ms;
  let passes = 0;
  let sink = 0;
  while (performance.now() < end) {
    sink += pass();
    passes++;
  }
  if (sink < 0) throw new Error("unreachable");
  return passes;
}

/** Milliseconds a pass, one sample: whole passes until at least `SAMPLE_MS` have gone by. */
function sample(pass) {
  const start = performance.now();
  let passes = 0;
  let sink = 0;
  while (performance.now() - start < SAMPLE_MS) {
    sink += pass();
    passes++;
  }
  if (sink < 0) throw new Error("unreachable");
  return (performance.now() - start) / passes;
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** The median milliseconds a pass of `pass`, warmed, one workload at a time. */
function msPerPass(pass) {
  runFor(pass, WARMUP_MS);
  const samples = [];
  for (let i = 0; i < SAMPLES; i++) samples.push(sample(pass));
  return median(samples);
}

function mib(bytes) {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** Where a call frame is: its src/ file and line through the source map when there is one. */
function locate(frame) {
  const line = frame.lineNumber;
  if (frame.url === "") return "(native)";
  let where = frame.url;
  try {
    const path = frame.url.startsWith("file:") ? fileURLToPath(frame.url) : frame.url;
    const map = findSourceMap(path);
    const entry = map?.findEntry(line, frame.columnNumber);
    if (entry !== undefined && entry.originalSource !== undefined) {
      const source = entry.originalSource.replace(/^.*?(src\/)/, "$1");
      return `${source}:${String(entry.originalLine + 1)}`;
    }
    where = path.replace(/^.*?(dist\/|bench\/|node_modules\/)/, "$1");
  } catch {
    // An unparseable URL keeps its own text.
  }
  return `${where}:${String(line + 1)}`;
}

function key(frame) {
  return `${frame.functionName === "" ? "(anonymous)" : frame.functionName} ${locate(frame)}`;
}

function isProfilerFrame(frame) {
  return (
    frame.url.startsWith("node:inspector") ||
    frame.functionName === "(program)" ||
    frame.functionName === "(idle)"
  );
}

/** Self time by function, from a CPU profile: the share of samples each one was on top. */
function topSelfTime(profile) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n]));
  const self = new Map();
  let total = 0;
  for (let i = 0; i < profile.samples.length; i++) {
    const node = byId.get(profile.samples[i]);
    if (isProfilerFrame(node.callFrame)) continue;
    const dt = profile.timeDeltas[i] ?? 0;
    total += dt;
    const k = key(node.callFrame);
    self.set(k, (self.get(k) ?? 0) + dt);
  }
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, us]) => ({ name, share: us / total }));
}

/** Bytes allocated by function, from a sampled heap profile (sampled, so an estimate). */
function topAllocations(profile) {
  const self = new Map();
  let total = 0;
  const walk = (node) => {
    if (!isProfilerFrame(node.callFrame) && node.selfSize > 0) {
      const k = key(node.callFrame);
      self.set(k, (self.get(k) ?? 0) + node.selfSize);
      total += node.selfSize;
    }
    for (const child of node.children) walk(child);
  };
  walk(profile.head);
  return [...self.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP)
    .map(([name, bytes]) => ({ name, share: total === 0 ? 0 : bytes / total }));
}

async function main() {
  const options = args(process.argv.slice(2));
  if (options.target === undefined) {
    process.stderr.write(
      "usage: node bench/profile.mjs <dist/index.mjs> [--out <dir>] [--summary <file.md>]\n",
    );
    return 2;
  }
  const transform = await import(pathToFileURL(resolve(options.target)).href);
  const namingSystem = transform.createNamingSystem(AUTHORITIES);
  const toFhirAll = (messages) => {
    let n = 0;
    for (const msg of messages) n += transform.toFhir(msg, { namingSystem }).issues.length + 1;
    return n;
  };
  const toV2All = (resources) => {
    let n = 0;
    for (const r of resources) {
      n += transform.toV2Observation(r, "R01", REVERSE_OPTIONS).issues.length + 1;
    }
    return n;
  };

  // Each shape of the bench at its smallest and its largest size, as bench/transform.bench.mjs has
  // them. The small side is a pass over as many inputs as the bench gives it.
  const pairs = [
    {
      shape: "toFhir: ADT^A01 batch",
      smallLabel: "1 message",
      largeLabel: "1,000 messages",
      small: () => Array.from({ length: 16 }, (_v, i) => admission(i)),
      large: () => [admissionBatch(0, 1_000)],
      run: toFhirAll,
      read: messagesOf,
    },
    {
      shape: "toFhir: ORU^R01 lab result",
      smallLabel: "10 results",
      largeLabel: "5,000 results",
      small: () => Array.from({ length: 16 }, (_v, i) => labResult(i, 10)),
      large: () => [labResult(0, 5_000)],
      run: toFhirAll,
      read: messagesOf,
    },
    {
      shape: "toFhir: MDM^T02 long note",
      smallLabel: "20 lines",
      largeLabel: "20,000 lines",
      small: () => Array.from({ length: 16 }, (_v, i) => longNote(i, 20)),
      large: () => [longNote(0, 20_000)],
      run: toFhirAll,
      read: messagesOf,
    },
    {
      shape: "toFhir: ORU^R01 base64 PDF",
      smallLabel: "64 KiB PDF",
      largeLabel: "4 MiB PDF",
      small: () => Array.from({ length: 4 }, (_v, i) => reportWithPdf(i, 64 * KIB)),
      large: () => [reportWithPdf(0, 4096 * KIB)],
      run: toFhirAll,
      read: messagesOf,
    },
    {
      shape: "toV2Observation: searchset Bundle",
      smallLabel: "1 Observation",
      largeLabel: "5,000 entries",
      small: () => Array.from({ length: 64 }, (_v, i) => observationBundle(i, 1)),
      large: () => [observationBundle(0, 5_000)],
      run: toV2All,
      read: entryResources,
    },
  ];

  const lines = [
    "### Throughput, smallest size against largest",
    "",
    `Each size timed the same simple way: warmed for ${String(WARMUP_MS)} ms, then the median of ${String(SAMPLES)} samples of at least ${String(SAMPLE_MS)} ms of whole passes, one size at a time, in one process. Bytes are the wire text's.`,
    "",
    "| Shape | Smallest | Largest | Bytes/s, smallest | Bytes/s, largest | Kept |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const pair of pairs) {
    const rate = (texts) => {
      const bytes = texts.reduce((n, t) => n + Buffer.byteLength(t), 0);
      const inputs = texts.map(pair.read);
      const ms = msPerPass(() => inputs.reduce((n, input) => n + pair.run(input), 0));
      return bytes / (ms / 1000);
    };
    const rateSmall = rate(pair.small());
    const rateLarge = rate(pair.large());
    lines.push(
      `| ${pair.shape} | ${pair.smallLabel} | ${pair.largeLabel} | ${mib(rateSmall)}/s | ${mib(rateLarge)}/s | ${((rateLarge / rateSmall) * 100).toFixed(0)}% |`,
    );
  }

  const feed = Array.from({ length: 64 }, (_v, i) => messagesOf(admission(i))[0]);
  const batch = messagesOf(admissionBatch(0, 100));
  const lab = messagesOf(labResult(0, 500));
  const note = messagesOf(longNote(0, 20_000));
  const pdf = messagesOf(reportWithPdf(0, 4096 * KIB));
  const bundle = entryResources(observationBundle(0, 5_000));

  const workloads = [
    { name: "toFhir: 64 ADT^A01 admissions", pass: () => toFhirAll(feed) },
    { name: "toFhir: ADT^A01 batch, 100 messages", pass: () => toFhirAll(batch) },
    { name: "toFhir: ORU^R01 lab result, 500 results", pass: () => toFhirAll(lab) },
    { name: "toFhir: MDM^T02 long note, 20,000 lines", pass: () => toFhirAll(note) },
    { name: "toFhir: ORU^R01, 4 MiB base64 PDF", pass: () => toFhirAll(pdf) },
    { name: "toV2Observation: searchset Bundle, 5,000 entries", pass: () => toV2All(bundle) },
  ];

  const session = new Session();
  session.connect();
  await session.post("Profiler.enable");
  await session.post("Profiler.setSamplingInterval", { interval: 100 });
  await session.post("HeapProfiler.enable");
  if (options.dir !== undefined) mkdirSync(options.dir, { recursive: true });

  lines.push(
    "",
    "### CPU and heap profile of the hottest paths",
    "",
    `Node ${process.version}. Each workload warmed for ${String(WARMUP_MS)} ms, then profiled alone for ${String(PROFILE_MS)} ms: self time from a CPU profile sampled every 100 us, and allocation from a sampled heap profile (an estimate).`,
  );
  for (const [index, w] of workloads.entries()) {
    runFor(w.pass, WARMUP_MS);
    // The heap sampler starts first and stops last, so the CPU profile holds the workload and not
    // the sampler's own start and stop. It keeps what a collection freed, so a function is charged
    // for everything it allocated, not only for what was still alive at the end.
    await session.post("HeapProfiler.startSampling", {
      samplingInterval: 16_384,
      includeObjectsCollectedByMajorGC: true,
      includeObjectsCollectedByMinorGC: true,
    });
    await session.post("Profiler.start");
    const passes = runFor(w.pass, PROFILE_MS);
    const { profile: cpu } = await session.post("Profiler.stop");
    const { profile: heap } = await session.post("HeapProfiler.stopSampling");
    if (options.dir !== undefined) {
      writeFileSync(resolve(options.dir, `${String(index + 1)}.cpuprofile`), JSON.stringify(cpu));
      writeFileSync(resolve(options.dir, `${String(index + 1)}.heapprofile`), JSON.stringify(heap));
    }
    lines.push(
      "",
      `#### ${String(index + 1)}. ${w.name}`,
      "",
      `${String(passes)} passes in ${String(PROFILE_MS)} ms, ${(PROFILE_MS / passes).toFixed(2)} ms a pass.`,
      "",
      "| Self time | Function | Allocated | Function |",
      "| --- | --- | --- | --- |",
    );
    const cpuTop = topSelfTime(cpu);
    const heapTop = topAllocations(heap);
    for (let i = 0; i < TOP; i++) {
      const c = cpuTop[i];
      const h = heapTop[i];
      lines.push(
        `| ${c === undefined ? "" : `${(c.share * 100).toFixed(1)}%`} | ${c === undefined ? "" : `\`${c.name}\``} | ${h === undefined ? "" : `${(h.share * 100).toFixed(1)}%`} | ${h === undefined ? "" : `\`${h.name}\``} |`,
      );
    }
  }
  session.disconnect();
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (options.summary !== undefined) writeFileSync(options.summary, text);
  return 0;
}

process.exitCode = await main();

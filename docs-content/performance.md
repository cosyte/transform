---
id: performance
title: Performance
sidebar_label: Performance
description: "What we measure on @cosyte/transform and how, what work each call does, and how to time a transform on your own machine."
---

# Performance

This page describes what we measure on `@cosyte/transform`, how, and how to time it yourself. The
shared method every Cosyte package follows (throughput, latency percentiles, memory, import time and
bundle size, and how a pull request is compared with `main`) is written down in the performance
standard in
[cosyte/config's decision records](https://github.com/cosyte/config/tree/main/documentation/decisions).
The numbers for the current release are in [Current numbers](#current-numbers) below.

## What we measure

The benchmarks in the repository's `bench/` folder run on `@cosyte/bench` against the built package,
on synthetic inputs built in code in the shapes real traffic has:

- an ADT^A01 admission of about 1 KiB, the message a feed sends all day, and HL7 batch files of 100
  and 1,000 of them;
- an ORU^R01 lab result of 10, 500 and 5,000 OBX lines;
- an MDM^T02 note of 20, 1,000 and 20,000 text lines, the shape a long clinical document reaches v2
  in;
- an ORU^R01 carrying one base64 PDF of 64 KiB and of 4 MiB;
- the Observations of a searchset Bundle of 1 to 5,000 entries written back to v2, and a Patient
  written back to an ADT^A28.

Each is measured for throughput, latency at the 50th, 95th and 99th percentiles, allocations per
call, peak heap as a multiple of the input, and whether the heap stays flat over a long run, beside
the cold import time and the gzipped size of what an import loads. Parsing is done before anything
is timed, so the numbers are the transform's own.

Two checks run on every pull request. A scaling gate fails the pull request when the cost of
`toFhir` or `toV2Observation` grows faster than its input. A comparison times the pull request's
build against `main`'s on one machine and posts the numbers without failing anything. A full reading,
with a CPU and heap profile of the hottest paths, runs on a GitHub-hosted runner on demand.

## What each call does

- **A datatype converter** reads one composite, consults the naming system when it needs a system
  URI, and builds one FHIR datatype node. It touches nothing else.
- **`toFhir`** runs the converters for each field it maps, checks each resource it builds with
  `@cosyte/fhir`'s `validateResource` before the resource joins the bundle, and records which
  segment occurrences reached a resource. Issues are never summarized, so a message with many
  segments that reach nothing also returns many issues.
- **`toV2Patient` and `toV2Observation`** read one resource and build one v2 message with
  `@cosyte/hl7`'s builder.

Parsing is not part of any of these: `parseHL7` and `parseResource` run before them, in the sibling
packages.

## What these numbers are not

- **Not a guarantee for your machine.** Absolute times depend on the hardware and its load.
- **Not a comparison with other libraries.** That is a separate suite with its own written method.

## Time it yourself

This program parses one synthetic admission and transforms it many times on your machine. It prints
the time and checks only that each run produced its bundle:

```ts runnable
import { parseHL7 } from "@cosyte/hl7";
import { toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I",
  "AL1|1|DA|70618^Penicillin^RXNORM|SV",
].join("\r");
const message = parseHL7(raw);

const runs = 200;
let entries = 0;
const start = performance.now();
for (let i = 0; i < runs; i += 1) {
  entries += toFhir(message).bundle.properties.length > 0 ? 1 : 0;
}
const elapsed = performance.now() - start;

console.log(`${String(runs)} transforms in ${elapsed.toFixed(1)} ms`);
entries; // => 200
```

## Current numbers

The numbers for this section are measured on `main` at each release and filled in when the release
is built. They are never typed by hand.

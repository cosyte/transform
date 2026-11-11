// Where a cold import of the built entry spends its time, by module:
//   node bench/import-share.mjs dist/index.mjs [--runs <n>] [--summary <file.md>]
//
// The bench reading times one cold import of the entry as a whole, and that number carries both
// peers (@cosyte/hl7 and @cosyte/fhir) and every Node built-in any of them loads. This splits it:
// each module is imported alone in a fresh Node process, and the entry is imported once more with
// both peers already loaded, so what is left is the entry's own share. A row is the median of the
// runs, in milliseconds. It prints a Markdown table and always exits 0 when it could take the
// reading: like the budgets, it is advisory. It exits 2 on a usage error.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** The source a child runs: import each preload untimed, then time one import of the target. */
function childSource(preload, target) {
  const pre = preload.map((url) => `await import(${JSON.stringify(url)});`).join("\n");
  return `${pre}
const t0 = performance.now();
await import(${JSON.stringify(target)});
process.stdout.write(String(performance.now() - t0));
`;
}

/** The median of `runs` cold imports of `target`, each in a fresh process, after `preload`. */
function median(target, preload, runs) {
  const times = [];
  for (let i = 0; i < runs; i += 1) {
    const out = execFileSync(
      process.execPath,
      ["--input-type=module", "-e", childSource(preload, target)],
      { encoding: "utf8" },
    );
    times.push(Number(out));
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(times.length / 2)];
}

function main(argv) {
  const file = argv[0];
  if (file === undefined || file.startsWith("--")) {
    process.stderr.write(
      "usage: node bench/import-share.mjs <entry.mjs> [--runs <n>] [--summary <file.md>]\n",
    );
    return 2;
  }
  const runsAt = argv.indexOf("--runs");
  const runs = runsAt === -1 ? 21 : Number(argv[runsAt + 1]);
  if (!Number.isInteger(runs) || runs < 1) {
    process.stderr.write("--runs takes a positive whole number\n");
    return 2;
  }
  const summaryAt = argv.indexOf("--summary");
  const summary = summaryAt === -1 ? undefined : argv[summaryAt + 1];

  const entry = pathToFileURL(resolve(file)).href;
  const hl7 = import.meta.resolve("@cosyte/hl7");
  const fhir = import.meta.resolve("@cosyte/fhir");
  // The floor: a file of its own, loaded the same way as the entry, so the row is comparable.
  const dir = mkdtempSync(join(tmpdir(), "import-share-"));
  const emptyFile = join(dir, "empty.mjs");
  writeFileSync(emptyFile, "export {};\n");
  const empty = pathToFileURL(emptyFile).href;
  const rows = [
    ["An empty module", empty, []],
    ["node:crypto", "node:crypto", []],
    ["@cosyte/fhir", fhir, []],
    ["@cosyte/hl7", hl7, []],
    ["The entry, cold", entry, []],
    ["The entry, with both peers already loaded (its own share)", entry, [hl7, fhir]],
  ];
  const lines = [
    "### Cold import, by module",
    "",
    `Each row is the median of ${String(runs)} imports, each in a fresh Node process. A peer row is that package imported alone; the last row is what the entry adds once both peers are loaded.`,
    "",
    "| Import | Median |",
    "| --- | --- |",
  ];
  try {
    for (const [label, target, preload] of rows) {
      lines.push(`| ${label} | ${median(target, preload, runs).toFixed(2)} ms |`);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const text = `${lines.join("\n")}\n`;
  process.stdout.write(text);
  if (summary !== undefined) writeFileSync(summary, text);
  return 0;
}

process.exitCode = main(process.argv.slice(2));

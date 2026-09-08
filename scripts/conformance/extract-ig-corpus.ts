#!/usr/bin/env tsx
/**
 * Regenerate `test/_support/ig-corpus/messages.json` from a local copy of the IG's published
 * test-conversions page.
 *
 * ▶ THIS IS PROVENANCE, NOT A BUILD STEP. Neither the suite nor `pnpm run conformance` runs it: the
 * corpus is committed, and the drift check that keeps it honest lives in
 * `test/conformance/corpus-provenance.test.ts`, which re-derives every segment line from the
 * `publishedBlock` this script recorded beside it. What this file is for is the other direction: it
 * is the executable statement of HOW the committed corpus was taken off the page, so a reader with
 * the page can reproduce the extraction rather than take it on trust.
 *
 * Usage: `tsx scripts/conformance/extract-ig-corpus.ts <path-to-test_conversions.html>`
 */

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";

import {
  CORPUS_DIR,
  CORPUS_FILE,
  PUBLISHED_MESSAGE_NAMES,
  escapeForPhiGate,
  extractPublishedBlocks,
  findPublishedManglings,
  segmentsFromPublishedBlock,
  type AdditionalEscaping,
} from "./corpus.js";

const SOURCE_URL = "https://hl7.org/fhir/uv/v2mappings/test_conversions.html";

function main(): void {
  const pagePath = process.argv[2];
  if (pagePath === undefined) {
    console.error(
      "usage: tsx scripts/conformance/extract-ig-corpus.ts <path-to-test_conversions.html>",
    );
    process.exit(2);
  }
  const bytes = readFileSync(pagePath);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const blocks = extractPublishedBlocks(bytes.toString("utf8"));

  const escapingEntries: AdditionalEscaping[] = [];
  const messages = PUBLISHED_MESSAGE_NAMES.map((name) => {
    const found = blocks.get(name);
    if (found === undefined) throw new Error(`no block extracted for ${name}`);
    const publishedLines = found.block.map((line, index) => {
      const escaped = escapeForPhiGate(line);
      if (escaped !== line) {
        const fields = line.split("|");
        const changed = fields.findIndex((f) => escapeForPhiGate(f) !== f);
        escapingEntries.push({
          message: name,
          line: index + 1,
          field: `${(fields[0] ?? "").replace(/^\s*<br\s*\/?>/i, "")}-${String(changed)}`,
          escaped: escaped.split("|")[changed] ?? "",
          reason:
            "A dashed Social Security Number shape, which this repository's PHI gate refuses in any " +
            "tracked file and no allow-list entry can clear. Its digits are written as HTML numeric " +
            "character references, in the page's own escaping mechanism, and reading the corpus " +
            "reconstitutes the published value character for character.",
        });
      }
      return escaped;
    });
    const segments = segmentsFromPublishedBlock(publishedLines);
    return {
      name,
      heading: found.heading,
      publishedLines,
      publishedMangled: findPublishedManglings(segments),
    };
  });

  const corpus = {
    source: {
      url: SOURCE_URL,
      sha256,
      retrievedAt: "2026-09-08",
      note:
        "The seven v2 test messages this page publishes, taken from the page's TEXT rather than " +
        "from a DOM parse: the page's own markup is broken from MDM_T02 onward, so a parser nests " +
        "the rest of the document inside an OBX component and mangles the last two messages. " +
        "`publishedLines` is the page's own lines, in the page's own HTML escaping; the segment " +
        "text is DERIVED from them on every read by `<br />` splitting and unescaping, so there is " +
        "one committed form and nothing to drift. No message is edited, narrowed or repaired.",
    },
    additionalEscaping: {
      reason:
        "The one place this copy differs from the page's bytes, declared rather than done quietly. " +
        "Each entry below is a re-encoding, not an edit: unescaping it returns the published value " +
        "exactly, and `test/conformance/corpus-provenance.test.ts` asserts that it does.",
      entries: escapingEntries,
    },
    messages,
  };

  const out = join(process.cwd(), CORPUS_DIR, CORPUS_FILE);
  writeFileSync(out, `${JSON.stringify(corpus, null, 2)}\n`, "utf8");
  console.log(
    `wrote ${CORPUS_DIR}/${CORPUS_FILE}: ${String(messages.length)} messages, page sha256 ${sha256}`,
  );
  for (const m of messages) {
    console.log(
      `  ${m.name}: ${String(m.publishedLines.length)} published lines, ` +
        `${String(m.publishedMangled.length)} published-mangled`,
    );
  }
  console.log(`  additional escaping: ${String(escapingEntries.length)} run(s)`);
}

main();

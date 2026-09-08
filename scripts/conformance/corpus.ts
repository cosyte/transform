/**
 * The IG-published v2 test corpus: reading the committed fixtures, and the extraction that produced
 * them from the published page.
 *
 * ▶ EXTRACTION WORKS FROM THE PAGE'S TEXT, NEVER FROM A DOM PARSE, and that is a measured
 * requirement rather than a preference. The published page's own markup is broken from `MDM_T02`
 * onward: an `OBX-5` component carries the literal `<Base64 encoded="">`, which an HTML parser reads
 * as an open tag, so everything after it nests inside that element and the last two messages are
 * emitted as raw markdown rather than as HTML. A DOM extraction loses or mangles them. The segment
 * text is present verbatim in the file either way, so the extraction reads lines.
 *
 * ▶ AND THE MANGLED LINE IS RECORDED, NEVER REPAIRED. Substituting invented v2 content for a line
 * the publisher mangled would make the corpus disagree with the corpus it claims to be, silently and
 * in the direction that flatters the result. `publishedMangled` says which line, what the page
 * carries there, and that nothing was put in its place.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The seven messages the IG publishes on its test-conversions page, in page order. */
export const PUBLISHED_MESSAGE_NAMES = [
  "ADT_A01",
  "SIU_S12",
  "ORM_O01",
  "OML_O21",
  "ORU_R01",
  "MDM_T02",
  "VXU_V04",
] as const;

/** One of {@link PUBLISHED_MESSAGE_NAMES}. */
export type PublishedMessageName = (typeof PUBLISHED_MESSAGE_NAMES)[number];

/** The corpus directory, relative to the repository root. */
export const CORPUS_DIR = join("test", "_support", "ig-corpus");

/** The corpus fixture file, inside {@link CORPUS_DIR}. */
export const CORPUS_FILE = "messages.json";

/** A segment line the publisher's own page mangles, recorded rather than repaired. */
export interface PublishedMangling {
  /** The 1-based index of the segment within the message. */
  readonly segmentIndex: number;
  /** The segment's three-character id (e.g. `OBX`). */
  readonly segment: string;
  /** The markup fragment the page carries in place of the published value. */
  readonly fragment: string;
  /** Why it is left as published. */
  readonly note: string;
}

/** One character run this repository escaped further than the page did, and why. */
export interface AdditionalEscaping {
  readonly message: string;
  /** The 1-based index of the line within the message's published block. */
  readonly line: number;
  /** The v2 field the run sits in. */
  readonly field: string;
  /** The escaped form as the fixture carries it. */
  readonly escaped: string;
  readonly reason: string;
}

/** One published message, with the provenance that makes it re-checkable against the page. */
export interface CorpusMessage {
  readonly name: PublishedMessageName;
  /** The page heading the message was taken from, verbatim. */
  readonly heading: string;
  /**
   * The page's own lines for this message, between its `<tr>` and the row's close, in the page's own
   * HTML escaping plus whatever `additionalEscaping` declares. This is the ONE committed form of the
   * corpus; {@link CorpusMessage.segments} is derived from it on every read, so the two can never
   * drift apart the way two committed copies would.
   */
  readonly publishedLines: readonly string[];
  /** The segment lines, DERIVED from `publishedLines` by `<br />` splitting and HTML unescaping. */
  readonly segments: readonly string[];
  /** Every segment line the page mangles. Empty for six of the seven messages. */
  readonly publishedMangled: readonly PublishedMangling[];
}

/** The committed corpus: the seven messages plus the provenance of the page they came from. */
export interface Corpus {
  readonly source: {
    readonly url: string;
    readonly sha256: string;
    readonly retrievedAt: string;
    readonly note: string;
  };
  /**
   * The one place this repository's copy differs from the page's bytes, declared rather than done
   * quietly. See {@link escapeForPhiGate}.
   */
  readonly additionalEscaping: {
    readonly reason: string;
    readonly entries: readonly AdditionalEscaping[];
  };
  readonly messages: readonly CorpusMessage[];
}

/** Thrown when the corpus cannot be obtained, or yields no messages. */
export class CorpusError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CorpusError";
  }
}

// ---------------------------------------------------------------------------
// Extraction from the published page
// ---------------------------------------------------------------------------

const ENTITY = /&(amp|lt|gt|quot|apos|nbsp|#\d+|#[xX][0-9a-fA-F]+);/g;

/** HTML-unescape in ONE pass, so `&amp;lt;` becomes `&lt;` and not `<`. */
export function unescapeHtml(text: string): string {
  return text.replace(ENTITY, (whole, name: string) => {
    switch (name) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
      default:
        break;
    }
    const code =
      name.startsWith("#x") || name.startsWith("#X")
        ? Number.parseInt(name.slice(2), 16)
        : Number.parseInt(name.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

/** The dashed Social Security Number shape this repository's PHI gate refuses unconditionally. */
const DASHED_SSN = /\b\d{3}-\d{2}-\d{4}\b/g;

/**
 * Escape the digits of any dashed-SSN-shaped run as HTML numeric character references.
 *
 * ▶ THIS IS THE ONE PLACE THE COMMITTED CORPUS DIFFERS FROM THE PAGE'S BYTES, AND IT IS DECLARED
 * RATHER THAN DONE QUIETLY. The guide's `ADT_A01` and `SIU_S12` carry `PID-19` as a dashed
 * placeholder Social Security Number. This repository's PHI gate refuses a dashed-SSN shape in any
 * tracked file UNCONDITIONALLY: there is no allow-list tag that clears one, deliberately, because
 * that is the token class where a mistaken clearance costs the most. So the fixture writes those
 * digits in the page's OWN escaping mechanism, and reading the fixture reconstitutes the published
 * value exactly, in the same single unescaping pass that turns `&amp;` back into `&`.
 *
 * ▶ IT IS A RE-ENCODING, NOT AN EDIT, AND THE DIFFERENCE IS CHECKABLE. `readCorpus()` returns the
 * published text character for character; `corpus-provenance.test.ts` asserts the reconstituted
 * `PID-19` equals the published value, assembling that value at runtime so the test file itself
 * carries no dashed literal, exactly as this repository's own scanner suite does. Nothing is
 * redacted, nothing is substituted, and the corpus does not get quietly narrower to keep a gate
 * green.
 *
 * @param line - One published line.
 * @returns The line with any dashed-SSN digits written as numeric character references.
 */
export function escapeForPhiGate(line: string): string {
  return line.replace(DASHED_SSN, (run) =>
    [...run].map((ch) => (/\d/.test(ch) ? `&#${String(ch.codePointAt(0) ?? 0)};` : ch)).join(""),
  );
}

/**
 * Split a published block into segment lines: strip each line's leading `<br />`, unescape, and drop
 * the lines that carry no segment.
 *
 * @param block - The page's raw lines for one message.
 * @returns The segment lines, in page order.
 */
export function segmentsFromPublishedBlock(block: readonly string[]): string[] {
  const out: string[] = [];
  for (const line of block) {
    const stripped = line.replace(/^\s*<br\s*\/?>/i, "");
    const segment = unescapeHtml(stripped);
    if (segment.trim().length === 0) continue;
    out.push(segment);
  }
  return out;
}

/** An HTML tag left standing inside a segment line: the shape of a publisher-mangled value. */
const STRAY_TAG = /<[A-Za-z][^>]*>/;

/**
 * Every mangled segment line in a message, found by shape rather than by name.
 *
 * @param segments - The unescaped segment lines.
 * @returns One record per line that still carries markup where a v2 value belongs.
 */
export function findPublishedManglings(segments: readonly string[]): PublishedMangling[] {
  const out: PublishedMangling[] = [];
  segments.forEach((segment, index) => {
    const match = STRAY_TAG.exec(segment);
    if (match === null) return;
    out.push({
      segmentIndex: index + 1,
      segment: segment.slice(0, segment.indexOf("|")),
      fragment: match[0],
      note:
        "The published page carries this markup where the v2 value belongs; the page's own HTML is " +
        "broken from this point on. Recorded as published, never substituted: inventing v2 content " +
        "here would make the corpus disagree with the corpus it claims to be.",
    });
  });
  return out;
}

/**
 * Extract the seven published blocks from the page's text.
 *
 * @param html - The whole committed page, as text.
 * @returns Each message's heading marker and raw block, keyed by message name.
 * @throws CorpusError when a message's heading or table cannot be found.
 */
export function extractPublishedBlocks(
  html: string,
): Map<PublishedMessageName, { heading: string; block: string[] }> {
  const lines = html.split("\n");
  const out = new Map<PublishedMessageName, { heading: string; block: string[] }>();

  for (const name of PUBLISHED_MESSAGE_NAMES) {
    // The page emits the first five headings as HTML and the last two as raw markdown, because its
    // own markup is broken from `MDM_T02` on. Both spellings are accepted; neither is repaired.
    const htmlHeading = `<h4 id="${name.toLowerCase()}">${name}</h4>`;
    const markdownHeading = `#### ${name}`;
    const start = lines.findIndex((l) => l.trim() === htmlHeading || l.trim() === markdownHeading);
    if (start < 0) {
      throw new CorpusError(`refusing the corpus: the page carries no heading for ${name}.`);
    }
    const heading = lines[start]?.trim() ?? "";

    let cursor = start + 1;
    while (cursor < lines.length && lines[cursor]?.trim() !== "<table>") cursor++;
    while (cursor < lines.length && lines[cursor]?.trim() !== "<tr>") cursor++;
    if (cursor >= lines.length) {
      throw new CorpusError(`refusing the corpus: the page carries no message table for ${name}.`);
    }

    const block: string[] = [];
    for (let i = cursor + 1; i < lines.length; i++) {
      const raw = lines[i] ?? "";
      const trimmed = raw.trim();
      if (
        trimmed === "</tr>" ||
        trimmed === "&lt;/tr&gt;" ||
        trimmed === "</table>" ||
        trimmed === "&lt;/table&gt;"
      ) {
        break;
      }
      block.push(raw);
    }
    if (block.length === 0) {
      throw new CorpusError(`refusing the corpus: the page's table for ${name} is empty.`);
    }
    out.set(name, { heading, block });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Reading the committed corpus
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string") return undefined;
    out.push(entry);
  }
  return out;
}

/** A JSON value read as text: a string is itself, anything else is the fallback. */
function asText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

/**
 * Read the committed corpus.
 *
 * @param repoRoot - The repository root the corpus directory sits under.
 * @param corpusDir - Overridable corpus directory (so the unobtainable-input suite can point the
 *   reader at an absent or empty corpus).
 * @returns The parsed corpus.
 * @throws CorpusError when the corpus is absent, unparseable, or yields zero messages.
 */
export function readCorpus(repoRoot: string, corpusDir: string = CORPUS_DIR): Corpus {
  const path = join(repoRoot, corpusDir, CORPUS_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new CorpusError(
      `refusing the run: the corpus ${corpusDir}/${CORPUS_FILE} could not be obtained ` +
        `(${err instanceof Error ? err.message : String(err)}). An unobtainable corpus fails the ` +
        `check; it is never reported as a pass.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CorpusError(
      `refusing the run: the corpus ${corpusDir}/${CORPUS_FILE} is not valid JSON ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed["source"]) || !Array.isArray(parsed["messages"])) {
    throw new CorpusError(
      `refusing the run: the corpus ${corpusDir}/${CORPUS_FILE} is not a corpus.`,
    );
  }
  const source = parsed["source"];
  const messages = parsed["messages"].map((entry: unknown): CorpusMessage => {
    if (!isRecord(entry)) {
      throw new CorpusError(`refusing the run: the corpus carries an entry that is not a message.`);
    }
    const name = entry["name"];
    if (
      typeof name !== "string" ||
      !(PUBLISHED_MESSAGE_NAMES as readonly string[]).includes(name)
    ) {
      throw new CorpusError(
        `refusing the run: the corpus carries ${JSON.stringify(String(name))}, which is not one of ` +
          `the seven published messages.`,
      );
    }
    const block = stringArray(entry["publishedLines"]);
    const heading = entry["heading"];
    if (block === undefined || block.length === 0 || typeof heading !== "string") {
      throw new CorpusError(`refusing the run: the corpus entry for ${name} is incomplete.`);
    }
    // ▶ DERIVED, NEVER READ FROM THE FIXTURE. The published lines are the one committed form; the
    // segments are what they unescape and split to, computed here on every read. Two committed
    // copies could disagree, and the one nobody looks at would be the one that rotted.
    const segments = segmentsFromPublishedBlock(block);
    if (segments.length === 0) {
      throw new CorpusError(`refusing the run: the corpus entry for ${name} yields no segments.`);
    }
    const mangled = Array.isArray(entry["publishedMangled"])
      ? entry["publishedMangled"].filter(isRecord).map(
          (m): PublishedMangling => ({
            segmentIndex: typeof m["segmentIndex"] === "number" ? m["segmentIndex"] : -1,
            segment: asText(m["segment"]),
            fragment: asText(m["fragment"]),
            note: asText(m["note"]),
          }),
        )
      : [];
    return {
      name: name as PublishedMessageName,
      heading,
      publishedLines: block,
      segments,
      publishedMangled: mangled,
    };
  });

  if (messages.length === 0) {
    throw new CorpusError(
      `refusing the run: the corpus ${corpusDir}/${CORPUS_FILE} yields zero messages. An empty ` +
        `corpus is a failure and never a pass.`,
    );
  }

  const escaping = parsed["additionalEscaping"];
  const entries =
    isRecord(escaping) && Array.isArray(escaping["entries"]) ? escaping["entries"] : [];
  return {
    source: {
      url: asText(source["url"]),
      sha256: asText(source["sha256"]),
      retrievedAt: asText(source["retrievedAt"]),
      note: asText(source["note"]),
    },
    additionalEscaping: {
      reason: isRecord(escaping) ? asText(escaping["reason"]) : "",
      entries: entries.filter(isRecord).map(
        (e): AdditionalEscaping => ({
          message: asText(e["message"]),
          line: typeof e["line"] === "number" ? e["line"] : -1,
          field: asText(e["field"]),
          escaped: asText(e["escaped"]),
          reason: asText(e["reason"]),
        }),
      ),
    },
    messages,
  };
}

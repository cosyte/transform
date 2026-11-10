import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { docSnippetSuite } from "@cosyte/vitest-config/snippets";

import { FATAL_CODES, ISSUE_CODES, ISSUE_REGISTRY } from "../src/index.js";

/**
 * The docs.cosyte.com pages in `docs-content/`, held to the code they describe.
 *
 * - Every TypeScript and JavaScript sample on a hand-written page runs, through the shared sample
 *   runner, against the BUILT package (`dist/index.mjs`, which is what an installer loads; the runner
 *   executes each block as a standalone module, so it cannot resolve the source's internal `.js`
 *   imports), and its `// =>` values are checked. The shared CI gate runs `test` before `build`, so
 *   `dist/` is built here.
 * - Every sample also compiles against the built package's type declarations, with the shared strict
 *   settings, because the runner strips types without checking them.
 * - Every link between pages resolves, heading anchor included, and so does every link into the
 *   generated reference under `docs-content/api/`.
 * - No page carries a value shaped like real contact or identity data. `pnpm phi-scan` reads these
 *   pages too, but its cross-cutting pass looks for SSNs and email addresses only, and a phone number
 *   in prose is outside its HL7 field pass.
 * - The issue-code reference lists exactly what the source registers, with each code's severity,
 *   FHIR issue type and message.
 * - The conformance page states the same result the committed measurement carries.
 *
 * The generated `api/` pages are not passed to the runner: their `@example` blocks are fragments
 * written for an editor's tooltip (many use an undeclared `raw`), and `cosyte-docs-reference
 * --check` holds them to the source.
 */
const root = join(import.meta.dirname, "..");
const docsDir = join(root, "docs-content");
const apiDir = join(docsDir, "api");
const distEntry = join(root, "dist", "index.mjs");
const resolve = (specifier: string): string | undefined =>
  specifier === "@cosyte/transform" ? distEntry : undefined;

beforeAll(() => {
  execFileSync("pnpm", ["build"], { cwd: root, stdio: "inherit" });
}, 120_000);

/** The hand-written pages: every `.md` file at the top of `docs-content/`, not the generated `api/`. */
const pages = readdirSync(docsDir)
  .filter((name) => name.endsWith(".md"))
  .sort()
  .map((name) => join(docsDir, name));

/** A page's text, by its file name. */
const page = (name: string): string => readFileSync(join(docsDir, name), "utf8");

/** A page's name relative to `docs-content/`, for a failure message. */
const shortName = (path: string): string => path.slice(docsDir.length + 1);

/**
 * `every` runs each TypeScript and JavaScript sample whether or not it is tagged `runnable`, and
 * lists a `no-run` sample as skipped with its reason. It reaches the runner through a variable
 * rather than a literal so the line compiles against a `@cosyte/vitest-config` that predates the
 * option; such a runner ignores it and runs the `runnable` blocks, which is every sample here that
 * can run, as the test below holds.
 */
const suiteOptions = { files: pages, every: true, resolve };
docSnippetSuite(suiteOptions);

/** One fenced block of a page: its language, the words after it, its body, and its line. */
interface Fence {
  readonly lang: string;
  readonly tags: readonly string[];
  readonly body: string;
  readonly line: number;
}

/** Every fenced block in a page, in order. */
function fences(markdown: string): Fence[] {
  const lines = markdown.split(/\r?\n/);
  const found: Fence[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^(\s*)(`{3,}|~{3,})(.*)$/.exec(lines[i] ?? "");
    if (open === null) continue;
    const [, indent = "", marker = "", info = ""] = open;
    const words = info.trim().split(/\s+/).filter(Boolean);
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j += 1) {
      const line = lines[j] ?? "";
      const close = /^\s*(`{3,}|~{3,})\s*$/.exec(line);
      if (close !== null && (close[1] ?? "").startsWith(marker[0] ?? "`")) break;
      body.push(line.startsWith(indent) ? line.slice(indent.length) : line);
    }
    found.push({ lang: words[0] ?? "", tags: words.slice(1), body: body.join("\n"), line: i + 1 });
    i = j;
  }
  return found;
}

/** A page with its fenced blocks blanked out, so prose checks do not read code. */
function prose(markdown: string): string {
  let inFence = false;
  return markdown
    .split(/\r?\n/)
    .map((line) => {
      if (/^\s*(`{3,}|~{3,})/.test(line)) {
        inFence = !inFence;
        return "";
      }
      return inFence ? "" : line;
    })
    .join("\n");
}

/** The fence languages that make a block a code sample, as the docs-content standard names them. */
const SAMPLE_LANGS: ReadonlySet<string> = new Set([
  "ts",
  "typescript",
  "tsx",
  "js",
  "javascript",
  "mjs",
]);

/** Every sample on every hand-written page. */
const samples = pages.flatMap((path) =>
  fences(readFileSync(path, "utf8"))
    .filter((fence) => SAMPLE_LANGS.has(fence.lang))
    .map((fence) => ({ ...fence, page: shortName(path) })),
);

/**
 * Where the compile check writes its modules: inside the root, so the package resolves itself by
 * name through its own `exports` to the built declarations, and under a name `.gitignore` covers.
 */
const compileDir = join(root, ".cosyte-doc-snippets-tsc");

afterAll(() => {
  rmSync(compileDir, { recursive: true, force: true });
});

/**
 * Compile the given modules the way a reader's strict TypeScript project would, against the built
 * declarations of `@cosyte/transform` and the installed peers, with the shared compiler settings
 * (`@cosyte/tsconfig/base.json`). Returns each error as `file:line TScode text`.
 */
function compileErrors(modules: ReadonlyMap<string, string>): string[] {
  rmSync(compileDir, { recursive: true, force: true });
  mkdirSync(compileDir, { recursive: true });
  for (const [name, code] of modules) writeFileSync(join(compileDir, name), code);
  writeFileSync(
    join(compileDir, "tsconfig.json"),
    JSON.stringify({
      extends: "@cosyte/tsconfig/base.json",
      compilerOptions: { noEmit: true, moduleDetection: "force", pretty: false },
      include: ["./*.ts"],
    }),
  );
  // The repository runs tsc through the copy @cosyte/process pins, never a second one of its own.
  const run = spawnSync(
    process.execPath,
    [join(root, "scripts", "process-tool.mjs"), "tsc", "-p", join(compileDir, "tsconfig.json")],
    { cwd: root, encoding: "utf8" },
  );
  if (run.status === 0) return [];
  const errors = `${run.stdout}${run.stderr}`
    .split(/\r?\n/)
    .filter((line) => /error TS\d+/.test(line))
    .map((line) => line.replace(/^.*\.cosyte-doc-snippets-tsc[\\/]/, ""));
  return errors.length > 0 ? errors : [`tsc exited ${String(run.status)} with no error line`];
}

/** The module name a sample is compiled under: its page and the line its fence opens on. */
const moduleName = (sample: { page: string; line: number }): string =>
  `${sample.page.replace(/\.md$/, "")}-${String(sample.line)}.ts`;

describe("every sample on a hand-written page", () => {
  it("runs, or names in its fence why it cannot", () => {
    const unaccounted: string[] = [];
    for (const sample of samples) {
      const noRun = sample.tags.indexOf("no-run");
      const reason = noRun === -1 ? "" : sample.tags.slice(noRun + 1).join(" ");
      if (sample.tags.includes("runnable") ? noRun !== -1 : reason === "") {
        unaccounted.push(`${sample.page}:${String(sample.line)}`);
      }
    }
    expect(samples.length).toBeGreaterThan(30);
    expect(unaccounted).toEqual([]);
  });

  it(
    "compiles against the package's types, with the shared strict settings",
    { timeout: 120_000 },
    () => {
      const modules = new Map(samples.map((sample) => [moduleName(sample), sample.body]));
      expect(modules.size).toBe(samples.length);
      expect(compileErrors(modules)).toEqual([]);
    },
  );

  it("would report a sample that does not compile", { timeout: 120_000 }, () => {
    const broken = new Map([
      [
        "broken.ts",
        [
          'import { toFhirHumanName } from "@cosyte/transform";',
          "const { issues } = toFhirHumanName({ familyName: 1 });",
          "issues[0].code;",
        ].join("\n"),
      ],
    ]);
    const errors = compileErrors(broken);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/^broken\.ts\(2,\d+\): error TS2322/);
    expect(errors[1]).toMatch(/^broken\.ts\(3,\d+\): error TS2532/);
  });
});

/**
 * The anchor the docs site gives a heading, as github-slugger computes it: lower-cased, every
 * character that is not a letter, a digit, `_`, a space or a hyphen dropped (code ticks, parentheses
 * and the backslash of an escaped `_` included), and each space made a hyphen. A repeated one is
 * numbered from `-1`.
 */
function anchors(markdown: string): Set<string> {
  const seen = new Map<string, number>();
  const result = new Set<string>();
  for (const line of prose(markdown).split("\n")) {
    const heading = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading === null) continue;
    const base = (heading[1] ?? "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}_ -]/gu, "")
      .replace(/ /g, "-");
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    result.add(count === 0 ? base : `${base}-${String(count)}`);
  }
  return result;
}

/** What is wrong with one link target on a page, or null when it resolves. */
function linkFault(from: string, target: string): string | null {
  if (/^https:\/\//.test(target)) return null;
  if (target.startsWith("#")) {
    return anchors(page(from)).has(target.slice(1)) ? null : "names no heading on this page";
  }
  const shaped = /^\.\/((?:api\/)?[^/#]+\.md)(?:#(.+))?$/.exec(target);
  if (shaped === null) return "is not written as ./<page>.md, ./api/<page>.md or #<anchor>";
  const file = join(docsDir, shaped[1] ?? "");
  if (!existsSync(file)) return "resolves to no page";
  const anchor = shaped[2];
  if (anchor !== undefined && !anchors(readFileSync(file, "utf8")).has(anchor)) {
    return "names no heading on that page";
  }
  return null;
}

describe("every link on a hand-written page", () => {
  it("resolves to a page, and to a heading on it when it names one", () => {
    const broken: string[] = [];
    let checked = 0;
    for (const path of pages) {
      const name = shortName(path);
      for (const match of prose(readFileSync(path, "utf8")).matchAll(/\]\(([^)\s]+)\)/g)) {
        const target = match[1] ?? "";
        checked += 1;
        const fault = linkFault(name, target);
        if (fault !== null) broken.push(`${name}: ${target} ${fault}`);
      }
    }
    expect(checked).toBeGreaterThan(100);
    expect(broken).toEqual([]);
  });

  it("reaches the generated reference, and refuses what does not resolve", () => {
    expect(existsSync(join(apiDir, "README.md"))).toBe(true);
    expect(linkFault("intro.md", "./api/README.md#tofhir")).toBeNull();
    expect(linkFault("intro.md", "./api/README.md#issue_codes")).toBeNull();
    expect(linkFault("intro.md", "./api/README.md#no-such-export")).not.toBeNull();
    expect(linkFault("intro.md", "./no-such-page.md")).not.toBeNull();
    expect(linkFault("intro.md", "./quickstart")).not.toBeNull();
    expect(linkFault("intro.md", "#no-such-heading")).not.toBeNull();
    expect(linkFault("intro.md", "http://example.com/")).not.toBeNull();
  });
});

/** A dashed SSN; only the 900 series is invalid, so any other area could be a real number. */
const SSN = /\b(\d{3})-\d{2}-\d{4}\b/g;
/** A full NANP phone number; only `555-0100` to `555-0199` is reserved for fiction. */
const PHONE = /(?:\(\d{3}\)\s?|\b\d{3}-)(\d{3})-(\d{4})\b/g;
/** An email address. */
const EMAIL = /[\w.+-]+@((?:[\w-]+\.)+[a-z]{2,})\b/gi;
/** The domains reserved for examples and testing (RFC 2606, RFC 6761). */
const RESERVED_DOMAIN = /^(?:example\.(?:com|net|org)|.*\.(?:test|example|invalid|localhost))$/i;

/** Every value on a page shaped like real contact or identity data. */
function sampleDataFindings(name: string, text: string): string[] {
  const found: string[] = [];
  for (const m of text.matchAll(SSN)) {
    if (!(m[1] ?? "").startsWith("9")) found.push(`${name}: SSN ${m[0]}`);
  }
  for (const m of text.matchAll(PHONE)) {
    if (m[1] !== "555" || !(m[2] ?? "").startsWith("01")) found.push(`${name}: phone ${m[0]}`);
  }
  for (const m of text.matchAll(EMAIL)) {
    if (!RESERVED_DOMAIN.test(m[1] ?? "")) found.push(`${name}: email ${m[0]}`);
  }
  return found;
}

describe("the sample data on the pages", () => {
  it("holds no SSN, phone number or email address outside the reserved ranges", () => {
    const found = pages.flatMap((path) =>
      sampleDataFindings(shortName(path), readFileSync(path, "utf8")),
    );
    expect(found).toEqual([]);
  });

  it("would refuse a value outside them", () => {
    // The refused values are assembled at run time so this file holds no literal the repository's
    // own PHI scan would flag; each is shaped like real data on purpose, and none is anyone's.
    const dash = (...parts: string[]): string => parts.join("-");
    expect(sampleDataFindings("x", dash("123", "45", "6789"))).toHaveLength(1);
    expect(sampleDataFindings("x", "(212) 555-1212")).toHaveLength(1);
    expect(sampleDataFindings("x", "212-867-0100")).toHaveLength(1);
    expect(sampleDataFindings("x", ["someone", "mail.invalid-domain.org"].join("@"))).toHaveLength(
      1,
    );
    expect(
      sampleDataFindings("x", `${dash("987", "00", "4320")} (528) 555-0105 a@example.org`),
    ).toEqual([]);
  });
});

describe("the issue-code reference", () => {
  const text = page("issue-codes.md");

  /** The table rows under one `## ` heading, keyed by the code in the first cell. */
  function rows(heading: string): Map<string, string[]> {
    const start = text.indexOf(`\n## ${heading}\n`);
    expect(start, `issue-codes.md has a "## ${heading}" section`).toBeGreaterThan(-1);
    const end = text.indexOf("\n## ", start + 1);
    const found = new Map<string, string[]>();
    for (const line of text.slice(start, end === -1 ? undefined : end).split("\n")) {
      const cell = /^\| `([A-Z0-9_]+)` +\|/.exec(line);
      if (cell === null) continue;
      found.set(
        cell[1] ?? "",
        line
          .split("|")
          .slice(1, -1)
          .map((c) => c.trim()),
      );
    }
    return found;
  }

  it("lists every issue code once, with its severity, FHIR issue type and exact message", () => {
    const table = rows("Issue codes");
    expect([...table.keys()].sort()).toEqual(Object.keys(ISSUE_CODES).sort());
    for (const [code, meta] of Object.entries(ISSUE_REGISTRY)) {
      const cells = table.get(code) ?? [];
      expect(cells[1], `${code} severity`).toBe(`\`${meta.severity}\``);
      expect(cells[2], `${code} issue type`).toBe(`\`${meta.fhirIssueType}\``);
      expect(cells[3], `${code} message`).toBe(meta.message);
    }
  });

  it("lists every fatal code once, and no other", () => {
    expect([...rows("Fatal codes").keys()].sort()).toEqual(Object.keys(FATAL_CODES).sort());
  });

  it("is linked from troubleshooting, so a reader who meets a code can look it up", () => {
    expect(page("troubleshooting.md")).toContain("](./issue-codes.md");
  });
});

/** What the committed conformance measurement says. */
interface PublishedResult {
  readonly corpus: { readonly messageCount: number };
  readonly packages: readonly {
    readonly id: string;
    readonly version: string;
    readonly role: string;
  }[];
  readonly summary: {
    readonly messagesWithZeroErrors: number;
    readonly messagesWithZeroErrorNames: readonly string[];
  };
  readonly messages: readonly {
    readonly message: string;
    readonly status: string;
    readonly resources: readonly { readonly baseR4: { readonly errorCount: number } }[];
  }[];
}

/** Spell out a small integer the way the pages' prose does. */
const WORDS = ["none", "one", "two", "three", "four", "five", "six", "seven"] as const;

describe("the conformance page", () => {
  const text = page("conformance.md");
  const result = JSON.parse(
    readFileSync(join(root, "documentation", "conformance", "result.json"), "utf8"),
  ) as PublishedResult;

  it("states the counts and the packages the committed measurement carries", () => {
    const clean = result.summary.messagesWithZeroErrors;
    const total = result.corpus.messageCount;
    expect(text).toContain(
      `${WORDS[clean] ?? String(clean)} of the ${WORDS[total] ?? String(total)} messages`,
    );
    for (const name of result.summary.messagesWithZeroErrorNames) expect(text).toContain(name);
    const baseClean = result.messages.filter(
      (m) => m.status === "validated" && m.resources.every((r) => r.baseR4.errorCount === 0),
    );
    expect(text).toContain(
      `${WORDS[baseClean.length] ?? String(baseClean.length)} of the ${WORDS[total] ?? String(total)} are clean`,
    );
    for (const m of result.messages.filter((x) => !baseClean.includes(x))) {
      expect(text).toContain(`\`${m.message}\``);
    }
    for (const pkg of result.packages) {
      expect(text).toContain(`\`${pkg.id}\` ${pkg.version}`);
    }
  });

  it("qualifies every paragraph on any other page that calls the output validated", () => {
    // This page is the qualification: every other page that says "validated" points here.
    const claim = /\bvalidat(?:ed|es|ing)\b/i;
    const qualified = /not a conformance claim|\(\.\/conformance\.md/;
    const unqualified: string[] = [];
    for (const path of pages.filter((p) => shortName(p) !== "conformance.md")) {
      const paras = prose(readFileSync(path, "utf8"))
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      paras.forEach((para, index) => {
        if (!claim.test(para)) return;
        if (!qualified.test(`${para}\n\n${paras[index + 1] ?? ""}`)) {
          unqualified.push(`${shortName(path)}: ${para.slice(0, 80)}`);
        }
      });
    }
    expect(unqualified).toEqual([]);
  });
});

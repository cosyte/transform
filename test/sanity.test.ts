import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { VERSION } from "../src/index.js";

const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

/** Narrow the parsed manifest without an `as` cast: the sanity test must not lie about its input. */
function manifestVersion(manifest: unknown): string {
  if (typeof manifest !== "object" || manifest === null || !("version" in manifest)) {
    throw new Error("package.json did not parse to an object with a `version` field");
  }
  const { version } = manifest;
  if (typeof version !== "string") throw new Error("package.json `version` is not a string");
  return version;
}

/** The manifest's `name`, narrowed the same way. */
function manifestName(manifest: unknown): string {
  if (typeof manifest !== "object" || manifest === null || !("name" in manifest)) {
    throw new Error("package.json did not parse to an object with a `name` field");
  }
  const { name } = manifest;
  if (typeof name !== "string") throw new Error("package.json `name` is not a string");
  return name;
}

describe("toolchain sanity", () => {
  it("resolves the public entry point and exports VERSION as a string", () => {
    expect(typeof VERSION).toBe("string");
    expect(VERSION.length).toBeGreaterThan(0);
  });

  it("package exports VERSION matching package.json", () => {
    // Compared against package.json, never a hardcoded literal. `changeset version` bumps
    // package.json alone, so a release that skipped `scripts/sync-version.mjs` (wired into the
    // `version` script) would publish a VERSION export that lies about the release. That is exactly
    // how 0.0.4 shipped exporting "0.0.0" - with docs-content/installation.md telling an installer
    // to print that constant as the smoke test - and a shape-only assertion stayed green throughout.
    expect(VERSION).toBe(manifestVersion(pkg));
  });

  it("exposes VERSION as a semver-looking string", () => {
    // Shape only, so a bump needs no edit here: the value itself is pinned to package.json above.
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+(?:[.-].+)?$/);
  });

  it("titles CLAUDE.md with this package's name", () => {
    // An agent-instruction file here was once rewritten out of band to name another package
    // (#29). The card is the one left, and its title is checked against package.json.
    const card = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
    expect(card.split("\n", 1)[0]).toBe(`# ${manifestName(pkg)}`);
  });
});

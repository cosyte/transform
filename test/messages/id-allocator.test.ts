import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { IdAllocator } from "../../src/messages/reference.js";

const SRC = fileURLToPath(new URL("../../src", import.meta.url));

/** Every TypeScript file under `src/`, as a path. */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

/** The module specifiers a file names in a static `import` or `export ... from`. */
function staticSpecifiers(text: string): string[] {
  const out: string[] = [];
  for (const match of text.matchAll(/^(?:import|export)\b[^;]*?\bfrom\s+"([^"]+)"/gmu)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }
  for (const match of text.matchAll(/^import\s+"([^"]+)"/gmu)) {
    const specifier = match[1];
    if (specifier !== undefined) out.push(specifier);
  }
  return out;
}

describe("IdAllocator: the default identity source", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("draws each default id from the global Web Crypto randomUUID when it is minted", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000001");
    vi.stubGlobal("crypto", { randomUUID });

    const ids = new IdAllocator(undefined);
    // Nothing is drawn until an id is asked for.
    expect(randomUUID).not.toHaveBeenCalled();

    expect(ids.next()).toBe("urn:uuid:00000000-0000-4000-8000-000000000001");
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });

  it("never touches the default source when the caller supplies generateId", () => {
    const randomUUID = vi.fn(() => "00000000-0000-4000-8000-000000000002");
    vi.stubGlobal("crypto", { randomUUID });

    const ids = new IdAllocator({ generateId: () => "fixed-id" });
    expect(ids.next()).toBe("urn:uuid:fixed-id");
    expect(randomUUID).not.toHaveBeenCalled();
  });

  it("mints a fresh RFC 9562 version 4 UUID per call with the real source", () => {
    const ids = new IdAllocator(undefined);
    const first = ids.next();
    const second = ids.next();
    const v4 = /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
    expect(first).toMatch(v4);
    expect(second).toMatch(v4);
    expect(first).not.toBe(second);
  });
});

describe("the cold import", () => {
  // A Node built-in named in a static import is loaded the moment the package is imported, whether
  // or not a call ever needs it: `node:crypto` alone costs a few milliseconds of a cold start.
  it("names no Node built-in module in any static import under src/", () => {
    const builtins = new Set(builtinModules);
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const specifier of staticSpecifiers(readFileSync(file, "utf8"))) {
        const bare = specifier.startsWith("node:") ? specifier.slice(5) : specifier;
        if (specifier.startsWith("node:") || builtins.has(bare)) {
          offenders.push(`${file.slice(SRC.length + 1)}: ${specifier}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

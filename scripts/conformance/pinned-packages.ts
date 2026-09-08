/**
 * Resolving the two pinned FHIR definition packages: `vendor/fhir-packages/` plus its
 * `provenance.json`, verified by sha256 on every load.
 *
 * ▶ "OBTAINED AT RUN TIME" MEANS RESOLVING THE PINNED LOCAL COPY, AND NOTHING ELSE. There is no
 * network fetch here and no second copy to fall back to. A package that is absent, unreadable, or
 * whose bytes do not hash to the pinned value is a REFUSAL naming the package id, the version and
 * the expected digest. Falling back would turn "the result was measured against 9.0.0" into "the
 * result was measured against whatever was on the machine", which is the exact claim a pin exists
 * to make checkable.
 */

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { readGzippedTar } from "./tgz.js";

/** The directory holding the pinned tarballs and their provenance record, relative to the repo root. */
export const VENDOR_DIR = join("vendor", "fhir-packages");

/** The provenance record's own file name, inside {@link VENDOR_DIR}. */
export const PROVENANCE_FILE = "provenance.json";

/** What a package is loaded for: base definitions to validate against, or profiles to apply. */
export type PackageRole = "base-definitions" | "profiles";

/** One pinned package, as declared in `vendor/fhir-packages/provenance.json`. */
export interface PinnedPackage {
  readonly id: string;
  readonly version: string;
  readonly role: PackageRole;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly sourceUrl: string;
  readonly resolvedUrl: string;
  readonly retrievedAt: string;
}

/** A loaded package: its pin, plus every JSON resource the archive carries. */
export interface LoadedPackage {
  readonly pin: PinnedPackage;
  /** Every `package/*.json` resource in the archive, keyed by entry name. */
  readonly resources: ReadonlyMap<string, unknown>;
}

/**
 * Thrown when a pinned input cannot be obtained. Carries the package identity and the expected
 * digest so the failure is reproducible against the pin rather than against the machine.
 */
export class PinnedPackageError extends Error {
  constructor(
    message: string,
    readonly packageId: string,
    readonly packageVersion: string,
    readonly expectedSha256: string,
  ) {
    super(message);
    this.name = "PinnedPackageError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A JSON value read as text: a string is itself, anything else is the fallback. */
function asText(value: unknown, fallback = "unknown"): string {
  return typeof value === "string" ? value : fallback;
}

function requireString(source: Record<string, unknown>, key: string, where: string): string {
  const value = source[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new PinnedPackageError(
      `refusing the run: ${where} declares no usable ${JSON.stringify(key)}.`,
      asText(source["id"]),
      asText(source["version"]),
      asText(source["sha256"]),
    );
  }
  return value;
}

/**
 * Read and validate `vendor/fhir-packages/provenance.json`.
 *
 * @param repoRoot - The repository root the vendor directory sits under.
 * @returns The declared pins, in file order.
 * @throws PinnedPackageError when the record is absent, unparseable, or declares an unusable pin.
 */
export function readPins(repoRoot: string): readonly PinnedPackage[] {
  const path = join(repoRoot, VENDOR_DIR, PROVENANCE_FILE);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new PinnedPackageError(
      `refusing the run: the pinned-package provenance record ${VENDOR_DIR}/${PROVENANCE_FILE} ` +
        `could not be read (${err instanceof Error ? err.message : String(err)}). Without it there ` +
        `is no digest to check the packages against, and an unverified package is not a pinned one.`,
      "unknown",
      "unknown",
      "unknown",
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PinnedPackageError(
      `refusing the run: ${VENDOR_DIR}/${PROVENANCE_FILE} is not valid JSON ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
      "unknown",
      "unknown",
      "unknown",
    );
  }
  if (!isRecord(parsed) || !Array.isArray(parsed["packages"]) || parsed["packages"].length === 0) {
    throw new PinnedPackageError(
      `refusing the run: ${VENDOR_DIR}/${PROVENANCE_FILE} declares no packages.`,
      "unknown",
      "unknown",
      "unknown",
    );
  }
  return parsed["packages"].map((entry: unknown): PinnedPackage => {
    if (!isRecord(entry)) {
      throw new PinnedPackageError(
        `refusing the run: ${VENDOR_DIR}/${PROVENANCE_FILE} carries a package entry that is not an object.`,
        "unknown",
        "unknown",
        "unknown",
      );
    }
    const where = `${VENDOR_DIR}/${PROVENANCE_FILE}`;
    const role = requireString(entry, "role", where);
    if (role !== "base-definitions" && role !== "profiles") {
      throw new PinnedPackageError(
        `refusing the run: ${where} declares an unknown package role ${JSON.stringify(role)}.`,
        asText(entry["id"]),
        asText(entry["version"]),
        asText(entry["sha256"]),
      );
    }
    const sha256 = requireString(entry, "sha256", where);
    if (!/^[0-9a-f]{64}$/.test(sha256)) {
      throw new PinnedPackageError(
        `refusing the run: ${where} declares a sha256 that is not 64 lowercase hex digits.`,
        asText(entry["id"]),
        asText(entry["version"]),
        sha256,
      );
    }
    const bytes = entry["bytes"];
    return {
      id: requireString(entry, "id", where),
      version: requireString(entry, "version", where),
      role,
      file: requireString(entry, "file", where),
      bytes: typeof bytes === "number" ? bytes : -1,
      sha256,
      sourceUrl: requireString(entry, "sourceUrl", where),
      resolvedUrl: requireString(entry, "resolvedUrl", where),
      retrievedAt: requireString(entry, "retrievedAt", where),
    };
  });
}

/**
 * Load one pinned package: read the file, verify its sha256, and index every JSON resource in it.
 *
 * @param pin - The declared pin.
 * @param repoRoot - The repository root the vendor directory sits under.
 * @param vendorDir - The directory the tarball is read from (overridable so the unobtainable-input
 *   suite can point the loader at a directory holding an absent or corrupted copy).
 * @returns The loaded package.
 * @throws PinnedPackageError when the file is absent, unreadable, or hashes to anything else.
 */
export function loadPinnedPackage(
  pin: PinnedPackage,
  repoRoot: string,
  vendorDir: string = VENDOR_DIR,
): LoadedPackage {
  const path = join(repoRoot, vendorDir, pin.file);
  let bytes: Buffer;
  try {
    bytes = readFileSync(path);
  } catch (err) {
    throw new PinnedPackageError(
      `refusing the run: the pinned package ${pin.id}#${pin.version} could not be obtained. ` +
        `Expected it at ${vendorDir}/${pin.file} with sha256 ${pin.sha256}, and reading it failed ` +
        `(${err instanceof Error ? err.message : String(err)}). There is no network fetch and no ` +
        `second copy: an unobtainable package fails the check rather than reporting a pass.`,
      pin.id,
      pin.version,
      pin.sha256,
    );
  }
  const actual = createHash("sha256").update(bytes).digest("hex");
  if (actual !== pin.sha256) {
    throw new PinnedPackageError(
      `refusing the run: the pinned package ${pin.id}#${pin.version} at ${vendorDir}/${pin.file} ` +
        `does not match its pin. Expected sha256 ${pin.sha256}, read ${actual}. A result measured ` +
        `against unpinned bytes is not reproducible, so this is a failure and never a fallback.`,
      pin.id,
      pin.version,
      pin.sha256,
    );
  }

  let entries: ReadonlyMap<string, Buffer>;
  try {
    entries = readGzippedTar(bytes);
  } catch (err) {
    throw new PinnedPackageError(
      `refusing the run: the pinned package ${pin.id}#${pin.version} hashed correctly but could ` +
        `not be unpacked (${err instanceof Error ? err.message : String(err)}).`,
      pin.id,
      pin.version,
      pin.sha256,
    );
  }

  const resources = new Map<string, unknown>();
  for (const [name, body] of entries) {
    if (!name.endsWith(".json")) continue;
    // `.index.json` and `package.json` are package metadata, not FHIR resources.
    if (name.endsWith("/.index.json") || name.endsWith("/package.json")) continue;
    try {
      resources.set(name, JSON.parse(body.toString("utf8")));
    } catch {
      // A non-resource JSON blob inside a published package is not this harness's business; the
      // definitions layer selects by `resourceType` and ignores everything else.
    }
  }
  if (resources.size === 0) {
    throw new PinnedPackageError(
      `refusing the run: the pinned package ${pin.id}#${pin.version} carries no JSON resources.`,
      pin.id,
      pin.version,
      pin.sha256,
    );
  }
  return { pin, resources };
}

/**
 * Load every declared pin, keyed by role.
 *
 * @param repoRoot - The repository root the vendor directory sits under.
 * @param vendorDir - Overridable vendor directory (see {@link loadPinnedPackage}).
 * @returns The base-definition package and the profile package.
 * @throws PinnedPackageError when either role is missing or a package cannot be obtained.
 */
export function loadPinnedPackages(
  repoRoot: string,
  vendorDir: string = VENDOR_DIR,
): { readonly base: LoadedPackage; readonly profiles: LoadedPackage } {
  const pins = readPins(repoRoot);
  const loaded = pins.map((pin) => loadPinnedPackage(pin, repoRoot, vendorDir));
  const base = loaded.find((p) => p.pin.role === "base-definitions");
  const profiles = loaded.find((p) => p.pin.role === "profiles");
  if (base === undefined || profiles === undefined) {
    throw new PinnedPackageError(
      `refusing the run: ${VENDOR_DIR}/${PROVENANCE_FILE} must declare one ` +
        `"base-definitions" package and one "profiles" package.`,
      "unknown",
      "unknown",
      "unknown",
    );
  }
  return { base, profiles };
}

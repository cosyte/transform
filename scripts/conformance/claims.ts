/**
 * The claims register: the hand-written, reviewed half of this measurement.
 *
 * ▶ THIS FILE READS THE REGISTER; NOTHING GENERATES IT. `test/_support/conformance-claims.json` is
 * written by hand and reviewed, and that is what makes a declared non-conformance honest: it is a
 * line somebody put there on purpose, with a reason a reader can dispute, rather than a skip the
 * harness quietly took.
 *
 * The register carries two things:
 *
 * 1. **The profile selection.** US Core publishes several profiles for some resource types and none
 *    for others, and no resource can satisfy two topic-specific profiles of the same type at once.
 *    Which profile applies to a resource is therefore a judgement, and it is made HERE, in the open,
 *    beside the number of profiles the package publishes for that type (which the harness records
 *    mechanically, so a reader always sees the denominator).
 * 2. **The claims.** One line per (message, resource type, profile) pair saying whether the library
 *    is expected to produce a conformant resource there today. Observation must EQUAL the
 *    declaration in both directions: an error where conformance was claimed fails the run, and a
 *    declared non-conformance that stops reproducing fails it too, so the register cannot rot into a
 *    list of stale excuses.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

/** The register's path, relative to the repository root. */
export const CLAIMS_PATH = join("test", "_support", "conformance-claims.json");

/** Which profiles of a resource type this measurement applies, and why those. */
export interface ProfileSelection {
  readonly profiles: readonly string[];
  readonly reason: string;
  /**
   * Per-message overrides. US Core's profiles are TOPIC-scoped, so the right profile for an
   * `Observation` depends on what the message is about: a lab result and a vaccine-funding
   * observation are the same resource type and different profiles. A type-level default that
   * ignored that would measure resources against a profile nobody claims applies to them.
   */
  readonly byMessage: Readonly<
    Record<string, { readonly profiles: readonly string[]; readonly reason: string }>
  >;
}

/** One reviewed claim about a (message, resource type, profile) pair. */
export interface Claim {
  readonly message: string;
  readonly resourceType: string;
  /** The profile canonical, or `null` for a pair validated against base R4 alone. */
  readonly profile: string | null;
  /** Whether every resource of this type in this message is expected to validate clean. */
  readonly conformant: boolean;
  readonly reason: string;
}

/** The whole register. */
export interface ClaimsRegister {
  readonly package: { readonly id: string; readonly version: string };
  readonly profileSelection: Readonly<Record<string, ProfileSelection>>;
  readonly claims: readonly Claim[];
}

/** Thrown when the register is absent, unparseable, or malformed. */
export class ClaimsRegisterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClaimsRegisterError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The stable key for a (message, resource type, profile) pair. */
export function pairKey(message: string, resourceType: string, profile: string | null): string {
  return `${message} / ${resourceType} / ${profile ?? "base-R4-only"}`;
}

/**
 * The profile selection in force for a resource type inside one message: the per-message override
 * when the register carries one, the type-level default otherwise.
 *
 * @param register - The reviewed register.
 * @param resourceType - The resource type.
 * @param message - The corpus message the resource came from.
 * @returns The selection, or `undefined` when the register declares none for the type at all.
 */
export function selectionFor(
  register: ClaimsRegister,
  resourceType: string,
  message: string,
): { readonly profiles: readonly string[]; readonly reason: string } | undefined {
  const selection = register.profileSelection[resourceType];
  if (selection === undefined) return undefined;
  return selection.byMessage[message] ?? selection;
}

/**
 * Read the reviewed claims register.
 *
 * @param repoRoot - The repository root.
 * @param claimsPath - Overridable register path, for the suites that exercise a broken register.
 * @returns The parsed register.
 * @throws ClaimsRegisterError when the register is absent, unparseable or malformed.
 */
export function readClaimsRegister(
  repoRoot: string,
  claimsPath: string = CLAIMS_PATH,
): ClaimsRegister {
  const path = join(repoRoot, claimsPath);
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (err) {
    throw new ClaimsRegisterError(
      `refusing the run: the claims register ${claimsPath} could not be read ` +
        `(${err instanceof Error ? err.message : String(err)}). Without it there is nothing to hold ` +
        `the observed result to.`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ClaimsRegisterError(
      `refusing the run: the claims register ${claimsPath} is not valid JSON ` +
        `(${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!isRecord(parsed) || !isRecord(parsed["package"]) || !isRecord(parsed["profileSelection"])) {
    throw new ClaimsRegisterError(`refusing the run: ${claimsPath} is not a claims register.`);
  }
  const claimsRaw = parsed["claims"];
  if (!Array.isArray(claimsRaw)) {
    throw new ClaimsRegisterError(`refusing the run: ${claimsPath} declares no claims.`);
  }

  const selection: Record<string, ProfileSelection> = {};
  for (const [resourceType, value] of Object.entries(parsed["profileSelection"])) {
    if (
      !isRecord(value) ||
      !Array.isArray(value["profiles"]) ||
      typeof value["reason"] !== "string"
    ) {
      throw new ClaimsRegisterError(
        `refusing the run: ${claimsPath} carries an unusable profile selection for ${resourceType}.`,
      );
    }
    const profiles = value["profiles"].filter((p): p is string => typeof p === "string");
    if (profiles.length !== value["profiles"].length) {
      throw new ClaimsRegisterError(
        `refusing the run: ${claimsPath} carries a non-string profile canonical for ${resourceType}.`,
      );
    }
    if (value["reason"].trim().length === 0) {
      throw new ClaimsRegisterError(
        `refusing the run: the profile selection for ${resourceType} in ${claimsPath} carries no ` +
          `reason. A selection nobody wrote a reason for is not a reviewed one.`,
      );
    }
    const overridesRaw = value["byMessage"];
    const byMessage: Record<string, { profiles: readonly string[]; reason: string }> = {};
    if (overridesRaw !== undefined) {
      if (!isRecord(overridesRaw)) {
        throw new ClaimsRegisterError(
          `refusing the run: the profile selection for ${resourceType} in ${claimsPath} carries an ` +
            `unusable byMessage map.`,
        );
      }
      for (const [messageName, override] of Object.entries(overridesRaw)) {
        if (
          !isRecord(override) ||
          !Array.isArray(override["profiles"]) ||
          typeof override["reason"] !== "string" ||
          override["reason"].trim().length === 0
        ) {
          throw new ClaimsRegisterError(
            `refusing the run: the ${resourceType} profile selection for ${messageName} in ` +
              `${claimsPath} is unusable, or carries no reason.`,
          );
        }
        byMessage[messageName] = {
          profiles: override["profiles"].filter((p): p is string => typeof p === "string"),
          reason: override["reason"],
        };
      }
    }
    selection[resourceType] = { profiles, reason: value["reason"], byMessage };
  }

  const claims = claimsRaw.map((entry: unknown): Claim => {
    if (
      !isRecord(entry) ||
      typeof entry["message"] !== "string" ||
      typeof entry["resourceType"] !== "string" ||
      typeof entry["conformant"] !== "boolean" ||
      typeof entry["reason"] !== "string"
    ) {
      throw new ClaimsRegisterError(`refusing the run: ${claimsPath} carries an unusable claim.`);
    }
    const profile = entry["profile"];
    if (profile !== null && typeof profile !== "string") {
      throw new ClaimsRegisterError(
        `refusing the run: a claim in ${claimsPath} carries a profile that is neither a canonical ` +
          `URL nor null.`,
      );
    }
    if (entry["reason"].trim().length === 0) {
      throw new ClaimsRegisterError(
        `refusing the run: a claim in ${claimsPath} carries no reason. A claim nobody wrote a reason ` +
          `for is not a reviewed one.`,
      );
    }
    return {
      message: entry["message"],
      resourceType: entry["resourceType"],
      profile,
      conformant: entry["conformant"],
      reason: entry["reason"],
    };
  });

  const seen = new Set<string>();
  for (const claim of claims) {
    const key = pairKey(claim.message, claim.resourceType, claim.profile);
    if (seen.has(key)) {
      throw new ClaimsRegisterError(`refusing the run: ${claimsPath} declares ${key} twice.`);
    }
    seen.add(key);
  }

  const pkg = parsed["package"];
  if (typeof pkg["id"] !== "string" || typeof pkg["version"] !== "string") {
    throw new ClaimsRegisterError(`refusing the run: ${claimsPath} names no profile package.`);
  }
  return {
    package: { id: pkg["id"], version: pkg["version"] },
    profileSelection: selection,
    claims,
  };
}

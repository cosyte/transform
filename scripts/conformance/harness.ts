/**
 * The conformance harness: transform every corpus message, validate every resource of the resulting
 * Bundle against the pinned R4 4.0.1 definitions and the pinned US Core profiles, and produce the
 * structured measurement the published result is rendered from.
 *
 * ▶ THIS MEASURES; IT NEVER MOVES THE LIBRARY'S OUTPUT. Nothing here reaches into a mapping, an
 * emitted value, an issue code or the emit gate. What it publishes on any given day is a measurement
 * of the library as it stands, which is the whole point: a finding it measures is published, never
 * quietly fixed.
 *
 * ▶ AND IT DECLARES ITS OWN DEPTH. {@link CHECK_CLASSES} is part of the published artifact, so the
 * result cannot be read as a stronger claim than the checks behind it. A validator built on an
 * offline package set does not resolve external terminology and does not evaluate every FHIRPath
 * invariant; saying so in the artifact is the difference between a measurement and a boast.
 */

import { parseHL7 } from "@cosyte/hl7";
import {
  collectInvariantIssues,
  diagnosticFor,
  loadStructureDefinition,
  parseResource,
  resourceType,
  serializeResource,
  validateResource,
  type FhirComplex,
  type StructureDefinition,
  type ValidationIssue,
} from "@cosyte/fhir";

import { toFhir } from "../../src/messages/to-fhir.js";

import {
  R4_BASE_PREFIX,
  ValueSetExpander,
  deriveResourceSchemas,
  loadStructureDefinitions,
  profilesByType,
  type SchemaDerivation,
} from "./definitions.js";
import { readCorpus, type Corpus, type CorpusMessage } from "./corpus.js";
import { loadPinnedPackages, type LoadedPackage } from "./pinned-packages.js";
import { readClaimsRegister, selectionFor, type ClaimsRegister } from "./claims.js";

/** How a resource was validated: against a named profile, or against base R4 alone. */
export type ValidationBasis = "profile" | "base-R4-only";

/** One value-free validation finding, as it reaches the published result. */
export interface Finding {
  readonly code: string;
  readonly severity: string;
  /** The FHIRPath element path the finding is at. */
  readonly path: string;
  /** The value-free diagnostic line for the code. */
  readonly message: string;
  /** The spec constraint key, for an invariant finding (e.g. `pat-1`). */
  readonly constraint?: string;
}

/** The outcome of validating one resource against one profile (or against base R4 alone). */
export interface ProfileVerdict {
  readonly basis: ValidationBasis;
  /** The profile canonical applied, or `null` when the basis is base R4 alone. */
  readonly profile: string | null;
  /** The profile's own business version, or `null`. */
  readonly profileVersion: string | null;
  /** The package the profile came from. Always recorded, even when no profile applied. */
  readonly packageId: string;
  readonly packageVersion: string;
  readonly findings: readonly Finding[];
  readonly errorCount: number;
}

/** Every verdict for one resource of one Bundle. */
export interface ResourceResult {
  readonly resourceType: string;
  /** The resource's 1-based position among the Bundle's entries. */
  readonly entryIndex: number;
  /** Base R4 4.0.1 findings, independent of any profile. */
  readonly baseR4: {
    readonly packageId: string;
    readonly packageVersion: string;
    readonly findings: readonly Finding[];
    readonly errorCount: number;
  };
  /** One verdict per applied profile; a single `base-R4-only` verdict when none applied. */
  readonly profileVerdicts: readonly ProfileVerdict[];
  readonly errorCount: number;
}

/** The outcome for one corpus message. */
export interface MessageResult {
  readonly message: string;
  readonly status: "validated" | "run-failure";
  /** Present only on a run failure: which stage failed and why. */
  readonly failure: { readonly stage: string; readonly reason: string } | null;
  readonly resourceCount: number;
  readonly resources: readonly ResourceResult[];
  readonly errorCount: number;
}

/** The whole measurement, as `documentation/conformance/result.json` carries it. */
export interface ConformanceResult {
  readonly generatedBy: string;
  readonly corpus: {
    readonly url: string;
    readonly sha256: string;
    readonly retrievedAt: string;
    readonly messageCount: number;
  };
  readonly packages: readonly {
    readonly id: string;
    readonly version: string;
    readonly role: string;
    readonly sha256: string;
    readonly sourceUrl: string;
  }[];
  readonly checkClasses: readonly CheckClass[];
  readonly profileScope: readonly ProfileScopeEntry[];
  readonly requiredBindings: {
    readonly enforced: number;
    readonly notEvaluated: number;
    readonly notEvaluatedSample: readonly { readonly path: string; readonly reason: string }[];
  };
  readonly messages: readonly MessageResult[];
  readonly summary: {
    readonly messagesValidated: number;
    readonly messagesWithZeroErrors: number;
    readonly messagesWithZeroErrorNames: readonly string[];
    readonly resourcesValidated: number;
    readonly errorFindings: number;
  };
}

/** One declared class of check, and whether this run performs it. */
export interface CheckClass {
  readonly name: string;
  readonly performed: boolean;
  readonly detail: string;
}

/** What the package publishes for a resource type, and what this run applied of it. */
export interface ProfileScopeEntry {
  readonly resourceType: string;
  /** Every profile the package publishes for the type, whether applied or not. */
  readonly publishedByPackage: readonly string[];
  /** The profiles this run applied by default. */
  readonly applied: readonly string[];
  /** Why that selection, from the reviewed register. */
  readonly reason: string;
  /** Per-message overrides of that default, from the reviewed register. */
  readonly perMessage: readonly {
    readonly message: string;
    readonly applied: readonly string[];
    readonly reason: string;
  }[];
}

/**
 * The classes of check this harness performs, and the classes it does not.
 *
 * ▶ THE "NOT EVALUATED" ROWS ARE THE LOAD-BEARING ONES. A reader who meets only the passing count
 * would take it for a full IG-validator result. It is not one, and the artifact says so where the
 * number is.
 */
export const CHECK_CLASSES: readonly CheckClass[] = Object.freeze([
  {
    name: "structure",
    performed: true,
    detail:
      "Every element of every resource is resolved against the R4 4.0.1 definition of its type; an " +
      "element R4 does not define, a resource with no type, and an ambiguous choice element are errors.",
  },
  {
    name: "element cardinality",
    performed: true,
    detail:
      "Minimum and maximum cardinality of every direct element, from the R4 4.0.1 snapshot, plus any " +
      "cardinality the applied profile tightens.",
  },
  {
    name: "primitive value domain",
    performed: true,
    detail: "The lexical form of every primitive is checked against its R4 datatype pattern.",
  },
  {
    name: "required-binding membership",
    performed: true,
    detail:
      "Enforced for every `code` element whose required-strength value set expands offline from the " +
      "pinned packages alone. A binding needing a filter, an exclusion, or a code system the packages " +
      "do not publish complete is NOT evaluated; the counts are published beside this list.",
  },
  {
    name: "profile fixed and pattern values",
    performed: true,
    detail: "`fixed[x]` and `pattern[x]` constraints of every applied profile.",
  },
  {
    name: "profile slicing",
    performed: true,
    detail:
      "Slice membership by `value`, `pattern` and `exists` discriminators. A slicing whose " +
      "discriminator cannot be evaluated is reported unchecked rather than passed.",
  },
  {
    name: "must-support",
    performed: true,
    detail:
      "Reported at information severity only, never as an error: must-support is a system obligation, " +
      "not an instance-presence requirement, so it never affects the passing count.",
  },
  {
    name: "FHIRPath invariants",
    performed: true,
    detail:
      "Constraints on the base R4 definition and on every applied profile are evaluated where the " +
      "expression is within the engine's FHIRPath subset; anything outside it is reported unchecked, " +
      "at information severity, and never counted as a pass.",
  },
  {
    name: "external terminology resolution",
    performed: false,
    detail:
      "No terminology server is consulted and none is bundled. Membership in a value set drawn from " +
      "SNOMED CT, LOINC, RxNorm, UCUM or any other externally-maintained system is NOT checked.",
  },
  {
    name: "reference resolution across the Bundle",
    performed: false,
    detail:
      "Whether a `Reference` resolves to an entry of the same Bundle is not evaluated here; the " +
      "library's own property suite covers dangling `urn:uuid:` references.",
  },
  {
    name: "mapping correctness",
    performed: false,
    detail:
      "Nothing here says the right v2 field reached the right FHIR element. A zero-error result says " +
      "the FHIR is well formed and conforms to the profiles named, not that the transform is right.",
  },
]);

/** Thrown when a corpus message cannot be parsed or transformed, so the run fails naming it. */
export class MessageRunFailure extends Error {
  constructor(
    readonly stage: string,
    readonly messageName: string,
    reason: string,
  ) {
    super(reason);
    this.name = "MessageRunFailure";
  }
}

/** The loaded, verified inputs a run validates against. */
export interface HarnessDefinitions {
  readonly base: LoadedPackage;
  readonly profiles: LoadedPackage;
  readonly schemas: SchemaDerivation;
  readonly baseByUrl: ReadonlyMap<string, StructureDefinition>;
  readonly profileByUrl: ReadonlyMap<string, StructureDefinition>;
  readonly profilesForType: ReadonlyMap<string, readonly StructureDefinition[]>;
  readonly resolveBase: (canonicalUrl: string) => StructureDefinition | undefined;
}

/**
 * Load and verify the pinned packages, then derive everything the validator needs from them.
 *
 * @param repoRoot - The repository root.
 * @param vendorDir - Overridable vendor directory, for the unobtainable-input suite.
 * @returns The derived definitions.
 * @throws PinnedPackageError when a package cannot be obtained or does not match its pin.
 */
export function loadDefinitions(repoRoot: string, vendorDir?: string): HarnessDefinitions {
  const { base, profiles } = loadPinnedPackages(repoRoot, vendorDir);
  const expander = new ValueSetExpander([base, profiles]);
  const schemas = deriveResourceSchemas(base, expander);
  const load = (raw: Record<string, unknown>): StructureDefinition | undefined => {
    const { resource } = parseResource(JSON.stringify(raw));
    return loadStructureDefinition(resource);
  };
  const baseByUrl = loadStructureDefinitions(base, load);
  const profileByUrl = loadStructureDefinitions(profiles, load);
  const resolveBase = (url: string): StructureDefinition | undefined =>
    baseByUrl.get(url) ?? profileByUrl.get(url);
  return {
    base,
    profiles,
    schemas,
    baseByUrl,
    profileByUrl,
    profilesForType: profilesByType(profileByUrl),
    resolveBase,
  };
}

/**
 * The one punctuation mark this repository bans in every tracked file, assembled from its codepoint
 * so this source file does not contain it and needs no exclusion from the gate that reads it.
 */
const BANNED_DASH = new RegExp(`\\s*${String.fromCodePoint(0x2014)}\\s*`, "g");

/**
 * Normalise a diagnostic before it enters a committed artifact.
 *
 * ▶ THE PUBLISHED RESULT IS A TRACKED FILE, AND A TRACKED FILE MAY NOT CARRY THAT CHARACTER. The
 * diagnostic text comes from `@cosyte/fhir`, which is a different repository under a different
 * convention, and exactly one of its lines uses the banned dash as a clause separator. Rewriting the
 * separator as a colon is what the directive itself prescribes, it is confined to that one character,
 * and it is done HERE, at the single boundary where third-party text enters a committed artifact,
 * rather than by hand-editing the generated file afterwards. The upstream wording is otherwise
 * untouched, and the finding's `code` is carried beside it, so a reader who wants the library's exact
 * line can call `diagnosticFor` on it.
 *
 * @param text - The upstream diagnostic.
 * @returns The same line with the banned separator rewritten.
 */
export function normalizeDiagnostic(text: string): string {
  return text.replace(BANNED_DASH, ": ");
}

function toFinding(issue: ValidationIssue): Finding {
  const base = {
    code: String(issue.code),
    severity: String(issue.severity),
    path: issue.expression,
    message: normalizeDiagnostic(diagnosticFor(issue.code)),
  };
  return issue.constraint === undefined ? base : { ...base, constraint: issue.constraint };
}

function errorsIn(findings: readonly Finding[]): number {
  return findings.filter((f) => f.severity === "error" || f.severity === "fatal").length;
}

/** Sort findings into a stable order, so a re-run produces a byte-identical artifact. */
function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) =>
      a.path.localeCompare(b.path) ||
      a.code.localeCompare(b.code) ||
      a.severity.localeCompare(b.severity) ||
      (a.constraint ?? "").localeCompare(b.constraint ?? ""),
  );
}

/** Drop findings that repeat a code at the same path, which a two-pass validator can produce. */
function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of findings) {
    const key = `${f.code}|${f.severity}|${f.path}|${f.constraint ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(f);
  }
  return out;
}

/** Every entry resource of a Bundle, in bundle order, as parsed resource models. */
export function bundleResources(bundle: FhirComplex): { type: string; resource: FhirComplex }[] {
  const json = JSON.parse(serializeResource(bundle)) as {
    entry?: { resource?: Record<string, unknown> }[];
  };
  const out: { type: string; resource: FhirComplex }[] = [];
  for (const entry of json.entry ?? []) {
    if (entry.resource === undefined) continue;
    const type = entry.resource["resourceType"];
    if (typeof type !== "string") continue;
    out.push({ type, resource: parseResource(JSON.stringify(entry.resource)).resource });
  }
  return out;
}

/** Validate one resource against base R4 alone. */
function validateBaseR4(resource: FhirComplex, defs: HarnessDefinitions, type: string): Finding[] {
  const result = validateResource(resource, {
    mode: "strict",
    schemas: defs.schemas.schemas,
  });
  const findings = result.issues.map(toFinding);
  const baseSd = defs.baseByUrl.get(`${R4_BASE_PREFIX}${type}`);
  if (baseSd !== undefined) {
    findings.push(
      ...collectInvariantIssues(resource, baseSd, { resolve: defs.resolveBase }).map(toFinding),
    );
  }
  return sortFindings(dedupe(findings));
}

/** Validate one resource against one profile, on top of the base R4 checks. */
function validateAgainstProfile(
  resource: FhirComplex,
  defs: HarnessDefinitions,
  profile: StructureDefinition,
): Finding[] {
  const result = validateResource(resource, {
    mode: "strict",
    schemas: defs.schemas.schemas,
    profiles: [profile],
    resolveBase: defs.resolveBase,
  });
  const findings = result.issues.map(toFinding);
  findings.push(
    ...collectInvariantIssues(resource, profile, { resolve: defs.resolveBase }).map(toFinding),
  );
  return sortFindings(dedupe(findings));
}

/**
 * Validate one resource the way a run does: against base R4 alone, or against one named profile.
 *
 * Exported so the bite suite can hand the harness a Bundle it built on purpose, one that violates a
 * profile and one that satisfies it, and check that the harness answers differently. A validator
 * that cannot be shown to fail is not evidence of anything.
 *
 * @param resource - The resource model.
 * @param defs - The loaded definitions.
 * @param profileCanonical - The profile to apply, or `null` for base R4 alone.
 * @returns The findings, in the stable order the published result carries them.
 * @throws Error when the named profile is not in the pinned package.
 */
export function validateOne(
  resource: FhirComplex,
  defs: HarnessDefinitions,
  profileCanonical: string | null,
): Finding[] {
  const type = resourceType(resource) ?? "";
  if (profileCanonical === null) return validateBaseR4(resource, defs, type);
  const profile = defs.profileByUrl.get(profileCanonical);
  if (profile === undefined) {
    throw new Error(
      `${defs.profiles.pin.id}#${defs.profiles.pin.version} publishes no ${profileCanonical}`,
    );
  }
  return validateAgainstProfile(resource, defs, profile);
}

/**
 * Every error-severity finding among a set.
 *
 * @param findings - The findings.
 * @returns Only the error and fatal ones.
 */
export function errorFindings(findings: readonly Finding[]): Finding[] {
  return findings.filter((f) => f.severity === "error" || f.severity === "fatal");
}

/**
 * Run one corpus message: parse, transform, validate every resource of the Bundle.
 *
 * @param message - The corpus message.
 * @param defs - The loaded definitions.
 * @param register - The reviewed claims register, which supplies the profile selection.
 * @returns The message's result. A parse or transform failure yields a `run-failure`, never an
 *   omission: the message is named in the published result either way.
 */
export function runMessage(
  message: CorpusMessage,
  defs: HarnessDefinitions,
  register: ClaimsRegister,
): MessageResult {
  const raw = message.segments.join("\r");
  let bundle: FhirComplex;
  try {
    const parsed = parseHL7(raw);
    bundle = toFhir(parsed).bundle;
  } catch (err) {
    const stage = err instanceof Error && err.name.includes("HL7") ? "parse" : "transform";
    return {
      message: message.name,
      status: "run-failure",
      failure: { stage, reason: err instanceof Error ? err.message : String(err) },
      resourceCount: 0,
      resources: [],
      errorCount: 1,
    };
  }

  const entries = bundleResources(bundle);
  const resources: ResourceResult[] = [];
  const pkg = defs.profiles.pin;

  // The Bundle itself is a resource of the corpus result too: a Bundle with a bad `type` or a
  // missing required element is a defect the entry-by-entry walk would never see.
  const all: { type: string; resource: FhirComplex }[] = [
    { type: "Bundle", resource: bundle },
    ...entries,
  ];

  all.forEach((entry, index) => {
    const baseFindings = validateBaseR4(entry.resource, defs, entry.type);
    const selection = selectionFor(register, entry.type, message.name);
    if (selection === undefined) {
      throw new MessageRunFailure(
        "profile-selection",
        message.name,
        `the claims register declares no profile selection for ${entry.type}, which this Bundle ` +
          `carries. A resource type nobody reviewed cannot be recorded as conformant or as ` +
          `non-conformant, so the run refuses rather than guessing.`,
      );
    }
    const verdicts: ProfileVerdict[] = [];
    if (selection.profiles.length === 0) {
      verdicts.push({
        basis: "base-R4-only",
        profile: null,
        profileVersion: null,
        packageId: pkg.id,
        packageVersion: pkg.version,
        findings: baseFindings,
        errorCount: errorsIn(baseFindings),
      });
    } else {
      for (const canonical of selection.profiles) {
        const profile = defs.profileByUrl.get(canonical);
        if (profile === undefined) {
          throw new MessageRunFailure(
            "profile-selection",
            message.name,
            `the claims register selects ${canonical} for ${entry.type}, and ` +
              `${pkg.id}#${pkg.version} publishes no such profile.`,
          );
        }
        const findings = validateAgainstProfile(entry.resource, defs, profile);
        verdicts.push({
          basis: "profile",
          profile: profile.url,
          profileVersion: profile.version ?? null,
          packageId: pkg.id,
          packageVersion: pkg.version,
          findings,
          errorCount: errorsIn(findings),
        });
      }
    }

    resources.push({
      resourceType: entry.type,
      entryIndex: index,
      baseR4: {
        packageId: defs.base.pin.id,
        packageVersion: defs.base.pin.version,
        findings: baseFindings,
        errorCount: errorsIn(baseFindings),
      },
      profileVerdicts: verdicts,
      errorCount: verdicts.reduce((n, v) => n + v.errorCount, 0),
    });
  });

  if (resources.length === 0) {
    return {
      message: message.name,
      status: "run-failure",
      failure: {
        stage: "transform",
        reason:
          "the transform produced a Bundle with no resources, so nothing reached the validator.",
      },
      resourceCount: 0,
      resources: [],
      errorCount: 1,
    };
  }

  return {
    message: message.name,
    status: "validated",
    failure: null,
    resourceCount: resources.length,
    resources,
    errorCount: resources.reduce((n, r) => n + r.errorCount, 0),
  };
}

/** What a full run needs: the corpus, the definitions and the reviewed register. */
export interface RunInputs {
  readonly corpus: Corpus;
  readonly defs: HarnessDefinitions;
  readonly register: ClaimsRegister;
}

/**
 * Load every pinned input a run needs.
 *
 * @param repoRoot - The repository root.
 * @param overrides - Directory overrides for the unobtainable-input suite.
 * @returns The loaded inputs.
 */
export function loadRunInputs(
  repoRoot: string,
  overrides: { vendorDir?: string; corpusDir?: string; claimsPath?: string } = {},
): RunInputs {
  return {
    corpus: readCorpus(repoRoot, overrides.corpusDir),
    defs: loadDefinitions(repoRoot, overrides.vendorDir),
    register: readClaimsRegister(repoRoot, overrides.claimsPath),
  };
}

/** The profile scope table: what the package publishes per type, and what this run applied. */
export function profileScope(
  defs: HarnessDefinitions,
  register: ClaimsRegister,
): ProfileScopeEntry[] {
  return Object.keys(register.profileSelection)
    .sort()
    .map((resourceType) => {
      const selection = register.profileSelection[resourceType];
      return {
        resourceType,
        publishedByPackage: (defs.profilesForType.get(resourceType) ?? []).map((p) => p.url),
        applied: selection?.profiles ?? [],
        reason: selection?.reason ?? "",
        perMessage: Object.entries(selection?.byMessage ?? {})
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([msg, override]) => ({
            message: msg,
            applied: override.profiles,
            reason: override.reason,
          })),
      };
    });
}

/**
 * Run the whole corpus and assemble the published result.
 *
 * @param inputs - The loaded corpus, definitions and register.
 * @returns The measurement.
 */
export function runConformance(inputs: RunInputs): ConformanceResult {
  const { corpus, defs, register } = inputs;
  const messages = corpus.messages.map((m) => runMessage(m, defs, register));
  const validated = messages.filter((m) => m.status === "validated");
  const zeroError = validated.filter((m) => m.errorCount === 0).map((m) => m.message);
  const notEvaluated = defs.schemas.bindingsNotEvaluated;

  return {
    generatedBy: "pnpm run conformance (scripts/conformance/run.ts)",
    corpus: {
      url: corpus.source.url,
      sha256: corpus.source.sha256,
      retrievedAt: corpus.source.retrievedAt,
      messageCount: corpus.messages.length,
    },
    packages: [defs.base.pin, defs.profiles.pin].map((p) => ({
      id: p.id,
      version: p.version,
      role: p.role,
      sha256: p.sha256,
      sourceUrl: p.sourceUrl,
    })),
    checkClasses: CHECK_CLASSES,
    profileScope: profileScope(defs, register),
    requiredBindings: {
      enforced: defs.schemas.bindingsEnforced.length,
      notEvaluated: notEvaluated.length,
      notEvaluatedSample: notEvaluated.slice(0, 12),
    },
    messages,
    summary: {
      messagesValidated: validated.length,
      messagesWithZeroErrors: zeroError.length,
      messagesWithZeroErrorNames: zeroError,
      resourcesValidated: messages.reduce((n, m) => n + m.resourceCount, 0),
      errorFindings: messages.reduce((n, m) => n + m.errorCount, 0),
    },
  };
}

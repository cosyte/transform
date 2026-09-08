/**
 * Turning the two pinned packages into the inputs `@cosyte/fhir`'s validator takes: R4 element
 * schemas, an expanded required-binding code set where one can be expanded offline, a canonical-URL
 * base resolver, and the US Core profiles.
 *
 * ▶ EVERY DERIVATION HERE IS MECHANICAL, and that is deliberate. Nothing in this file encodes a
 * judgement about what "should" conform; it reads the published definitions and hands them over. The
 * one place a judgement is unavoidable (which of a package's several profiles for a resource type
 * applies to a given resource) is NOT made here: it is a reviewed line in
 * `test/_support/conformance-claims.json`, where a reader can dispute it.
 *
 * ▶ AND WHAT CANNOT BE DERIVED IS LEFT UNDERIVED RATHER THAN GUESSED. A required binding whose value
 * set cannot be expanded from the pinned packages alone (a filter, an exclusion, an import, an
 * incomplete code system, a grammar-based system like UCUM) yields NO binding at all, and the run
 * publishes how many bindings that was. A guessed code set would produce confident wrong findings in
 * both directions.
 */

import {
  UNBOUNDED,
  type ResourceSchema,
  type ElementSchema,
  type StructureDefinition,
} from "@cosyte/fhir";

import type { LoadedPackage } from "./pinned-packages.js";

/** The canonical URL prefix every base R4 resource definition sits under. */
export const R4_BASE_PREFIX = "http://hl7.org/fhir/StructureDefinition/";

/**
 * The element names every resource inherits from `Resource` / `DomainResource`. `buildRegistry`
 * merges these in from the validator's own base schema, so deriving them again here would only
 * re-express them in the FHIRPath system types the R4 snapshot spells them with.
 */
const BASE_ELEMENT_NAMES: ReadonlySet<string> = new Set([
  "id",
  "meta",
  "implicitRules",
  "language",
  "text",
  "contained",
  "extension",
  "modifierExtension",
]);

/** A raw JSON object read out of a package. */
type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringAt(node: Json, key: string): string | undefined {
  const value = node[key];
  return typeof value === "string" ? value : undefined;
}

function arrayAt(node: Json, key: string): readonly unknown[] {
  const value = node[key];
  return Array.isArray(value) ? value : [];
}

function records(node: Json, key: string): Json[] {
  return arrayAt(node, key).filter(isRecord);
}

/** Every resource of a given `resourceType` in a loaded package. */
export function resourcesOfType(pkg: LoadedPackage, resourceType: string): Json[] {
  const out: Json[] = [];
  for (const value of pkg.resources.values()) {
    if (isRecord(value) && value["resourceType"] === resourceType) out.push(value);
  }
  return out;
}

/** Drop the `|version` suffix a canonical reference may carry. */
export function canonicalWithoutVersion(canonical: string): string {
  const bar = canonical.indexOf("|");
  return bar < 0 ? canonical : canonical.slice(0, bar);
}

// ---------------------------------------------------------------------------
// Value-set expansion (offline, conservative)
// ---------------------------------------------------------------------------

/** A value set that could not be expanded from the pinned packages, and the reason it could not. */
export interface UnexpandableBinding {
  readonly valueSet: string;
  readonly reason: string;
}

/**
 * Whether an expansion succeeded.
 *
 * A hand-written guard rather than a bare `Array.isArray`, which widens a `readonly string[]` in a
 * union to `any[]` and takes the type checking with it.
 *
 * @param value - An expansion result.
 * @returns `true` when it is a code list.
 */
export function isCodeList(
  value: readonly string[] | UnexpandableBinding,
): value is readonly string[] {
  return Array.isArray(value);
}

/** Flatten a `CodeSystem.concept` tree into its codes. */
function codeSystemCodes(concepts: readonly Json[], into: string[]): void {
  for (const concept of concepts) {
    const code = stringAt(concept, "code");
    if (code !== undefined) into.push(code);
    codeSystemCodes(records(concept, "concept"), into);
  }
}

/**
 * An offline value-set expander over the pinned packages.
 *
 * Expands only the shapes that are unambiguous without a terminology server: a `compose.include`
 * that enumerates its `concept` list, or that names a `CodeSystem` the packages carry with
 * `content: "complete"`. Anything else (a `filter`, an `exclude`, an imported `valueSet`, a code
 * system that is `not-present`/`fragment`/`example`) is refused, so no element ever gets a code set
 * narrower than the specification's.
 */
export class ValueSetExpander {
  private readonly valueSets = new Map<string, Json>();
  private readonly codeSystems = new Map<string, Json>();
  private readonly cache = new Map<string, readonly string[] | UnexpandableBinding>();

  constructor(packages: readonly LoadedPackage[]) {
    for (const pkg of packages) {
      for (const vs of resourcesOfType(pkg, "ValueSet")) {
        const url = stringAt(vs, "url");
        if (url !== undefined && !this.valueSets.has(url)) this.valueSets.set(url, vs);
      }
      for (const cs of resourcesOfType(pkg, "CodeSystem")) {
        const url = stringAt(cs, "url");
        if (url !== undefined && !this.codeSystems.has(url)) this.codeSystems.set(url, cs);
      }
    }
  }

  /**
   * Expand a value set canonical to its complete code set.
   *
   * @param canonical - The value set canonical, with or without a `|version` suffix.
   * @returns The codes, or the reason the value set could not be expanded offline.
   */
  expand(canonical: string): readonly string[] | UnexpandableBinding {
    const url = canonicalWithoutVersion(canonical);
    const cached = this.cache.get(url);
    if (cached !== undefined) return cached;
    // Guard against a cyclic import chain while the entry is being computed.
    this.cache.set(url, { valueSet: url, reason: "cyclic value-set composition" });
    const result = this.compute(url, new Set([url]));
    this.cache.set(url, result);
    return result;
  }

  private compute(url: string, seen: Set<string>): readonly string[] | UnexpandableBinding {
    const vs = this.valueSets.get(url);
    if (vs === undefined) {
      return { valueSet: url, reason: "value set is not in the pinned packages" };
    }
    const expansion = vs["expansion"];
    if (isRecord(expansion)) {
      const codes = records(expansion, "contains")
        .map((c) => stringAt(c, "code"))
        .filter((c): c is string => c !== undefined);
      if (codes.length > 0) return codes;
    }
    const compose = vs["compose"];
    if (!isRecord(compose)) {
      return { valueSet: url, reason: "value set carries neither an expansion nor a composition" };
    }
    if (records(compose, "exclude").length > 0) {
      return { valueSet: url, reason: "composition excludes codes, which is not expanded offline" };
    }
    const includes = records(compose, "include");
    if (includes.length === 0) {
      return { valueSet: url, reason: "composition includes nothing" };
    }
    const codes: string[] = [];
    for (const include of includes) {
      if (records(include, "filter").length > 0) {
        return {
          valueSet: url,
          reason: "composition uses a filter, which is not expanded offline",
        };
      }
      const imported = arrayAt(include, "valueSet").filter(
        (v): v is string => typeof v === "string",
      );
      for (const importedUrl of imported) {
        const target = canonicalWithoutVersion(importedUrl);
        if (seen.has(target)) {
          return { valueSet: url, reason: "cyclic value-set composition" };
        }
        const nested = this.compute(target, new Set([...seen, target]));
        if (!isCodeList(nested)) {
          return { valueSet: url, reason: `imported ${target}: ${nested.reason}` };
        }
        for (const code of nested) codes.push(code);
      }
      const system = stringAt(include, "system");
      if (system === undefined) {
        if (imported.length > 0) continue;
        return { valueSet: url, reason: "composition includes an entry naming no system" };
      }
      const enumerated = records(include, "concept")
        .map((c) => stringAt(c, "code"))
        .filter((c): c is string => c !== undefined);
      if (enumerated.length > 0) {
        codes.push(...enumerated);
        continue;
      }
      const cs = this.codeSystems.get(canonicalWithoutVersion(system));
      if (cs === undefined) {
        return { valueSet: url, reason: `code system ${system} is not in the pinned packages` };
      }
      if (stringAt(cs, "content") !== "complete") {
        return { valueSet: url, reason: `code system ${system} is not published complete` };
      }
      const all: string[] = [];
      codeSystemCodes(records(cs, "concept"), all);
      if (all.length === 0) {
        return { valueSet: url, reason: `code system ${system} enumerates no concepts` };
      }
      codes.push(...all);
    }
    return [...new Set(codes)];
  }
}

// ---------------------------------------------------------------------------
// R4 resource schemas
// ---------------------------------------------------------------------------

/** The datatype name for an `ElementDefinition.type` entry, resolving the FHIRPath system types. */
function typeCodeOf(type: Json): string | undefined {
  const code = stringAt(type, "code");
  if (code === undefined) return undefined;
  if (!code.startsWith("http://hl7.org/fhirpath/System.")) return code;
  for (const ext of records(type, "extension")) {
    if (
      stringAt(ext, "url") ===
      "http://hl7.org/fhir/StructureDefinition/structuredefinition-fhir-type"
    ) {
      const value = stringAt(ext, "valueUrl") ?? stringAt(ext, "valueString");
      if (value !== undefined) return value;
    }
  }
  return code.slice("http://hl7.org/fhirpath/System.".length).toLowerCase();
}

/** What the schema derivation found, so the published result can state its own depth. */
export interface SchemaDerivation {
  readonly schemas: readonly ResourceSchema[];
  /** Element paths that carry a required binding this run enforces. */
  readonly bindingsEnforced: readonly string[];
  /** Element paths whose required binding could not be expanded offline, with the reason. */
  readonly bindingsNotEvaluated: readonly { readonly path: string; readonly reason: string }[];
}

/**
 * Derive a {@link ResourceSchema} for every R4 resource type in the base package.
 *
 * @param base - The loaded base-definitions package.
 * @param expander - The offline value-set expander.
 * @returns The schemas plus the required-binding coverage this run achieved.
 */
export function deriveResourceSchemas(
  base: LoadedPackage,
  expander: ValueSetExpander,
): SchemaDerivation {
  const schemas: ResourceSchema[] = [];
  const bindingsEnforced: string[] = [];
  const bindingsNotEvaluated: { path: string; reason: string }[] = [];

  for (const sd of resourcesOfType(base, "StructureDefinition")) {
    if (stringAt(sd, "kind") !== "resource") continue;
    if (stringAt(sd, "derivation") !== "specialization") continue;
    if (sd["abstract"] === true) continue;
    const type = stringAt(sd, "type");
    const snapshot = sd["snapshot"];
    if (type === undefined || !isRecord(snapshot)) continue;

    const elements: Record<string, ElementSchema> = {};
    for (const element of records(snapshot, "element")) {
      const path = stringAt(element, "path");
      if (path === undefined) continue;
      const parts = path.split(".");
      if (parts.length !== 2 || parts[0] !== type) continue;
      const raw = parts[1];
      if (raw === undefined) continue;
      const isChoice = raw.endsWith("[x]");
      const name = isChoice ? raw.slice(0, -"[x]".length) : raw;
      if (BASE_ELEMENT_NAMES.has(name)) continue;

      const types = records(element, "type")
        .map(typeCodeOf)
        .filter((t): t is string => t !== undefined);
      if (types.length === 0) continue;

      const min = typeof element["min"] === "number" ? element["min"] : 0;
      const maxRaw = stringAt(element, "max") ?? "1";
      // ▶ `UNBOUNDED` IS `Infinity`, so this guard tests for NaN and NOT for finiteness. A
      // finiteness test here silently dropped every `0..*` element of every resource, which is most
      // of the interesting ones (`Patient.name`, `Patient.identifier`, `Bundle.entry`), and the
      // validator then reported each of them as an UNKNOWN_ELEMENT error: a schema hole that
      // manufactures findings rather than one that hides them, but wrong in both directions.
      const max = maxRaw === "*" ? UNBOUNDED : Number.parseInt(maxRaw, 10);
      if (Number.isNaN(max)) continue;

      const binding = element["binding"];
      let required: ElementSchema["binding"];
      if (isRecord(binding) && stringAt(binding, "strength") === "required") {
        const valueSet = stringAt(binding, "valueSet");
        if (valueSet === undefined) {
          bindingsNotEvaluated.push({ path, reason: "required binding names no value set" });
        } else if (types.length !== 1 || types[0] !== "code") {
          bindingsNotEvaluated.push({
            path,
            reason: `required binding is on a ${types.join("|")} element, and only \`code\` elements carry an enumerated set here`,
          });
        } else {
          const expanded = expander.expand(valueSet);
          if (isCodeList(expanded)) {
            required = { strength: "required", codes: expanded };
            bindingsEnforced.push(path);
          } else {
            bindingsNotEvaluated.push({ path, reason: expanded.reason });
          }
        }
      }

      elements[name] =
        required === undefined ? { min, max, types } : { min, max, types, binding: required };
    }

    if (Object.keys(elements).length > 0) schemas.push({ type, elements });
  }

  bindingsEnforced.sort();
  bindingsNotEvaluated.sort((a, b) => a.path.localeCompare(b.path));
  return { schemas, bindingsEnforced, bindingsNotEvaluated };
}

// ---------------------------------------------------------------------------
// StructureDefinitions: base resolver + profiles
// ---------------------------------------------------------------------------

/** Load every `StructureDefinition` in a package, keyed by canonical URL. */
export function loadStructureDefinitions(
  pkg: LoadedPackage,
  load: (resource: Json) => StructureDefinition | undefined,
): Map<string, StructureDefinition> {
  const out = new Map<string, StructureDefinition>();
  for (const raw of resourcesOfType(pkg, "StructureDefinition")) {
    const url = stringAt(raw, "url");
    if (url === undefined || out.has(url)) continue;
    const sd = load(raw);
    if (sd !== undefined) out.set(url, sd);
  }
  return out;
}

/** Every profile in the profile package, grouped by the resource type it constrains. */
export function profilesByType(
  profiles: ReadonlyMap<string, StructureDefinition>,
): Map<string, StructureDefinition[]> {
  const out = new Map<string, StructureDefinition[]>();
  for (const sd of profiles.values()) {
    if (sd.kind !== "resource" || sd.derivation !== "constraint") continue;
    const bucket = out.get(sd.type);
    if (bucket === undefined) out.set(sd.type, [sd]);
    else bucket.push(sd);
  }
  for (const bucket of out.values()) bucket.sort((a, b) => a.url.localeCompare(b.url));
  return out;
}

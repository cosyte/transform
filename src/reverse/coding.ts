/**
 * Codes and coding systems on the way out to v2, and the caller-supplied context that resolution
 * needs.
 *
 * A v2 coded field names its vocabulary with a Table 0396 mnemonic (`LN`, `SCT`, `UCUM`), so writing
 * a FHIR `Coding` into one means turning a canonical system URI back into that mnemonic. There is no
 * algorithm for that, only a registry, so this module inverts the same seed the forward direction
 * resolves through ({@link DEFAULT_V2_CODE_SYSTEMS} plus whatever the caller adds) and **refuses
 * everything else**: an unrecognized system is flagged, never written into a coded field with no
 * table context and never re-coded into a neighbouring table.
 *
 * The inversion keeps only URIs exactly one mnemonic names, for the same reason the code-map
 * inversion does: two mnemonics for one URI is an ambiguity, not a choice to make silently.
 *
 * @packageDocumentation
 */

import type { BuildMessageInit } from "@cosyte/hl7";
import type { FhirComplex } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import { DEFAULT_V2_CODE_SYSTEMS } from "../terminology/naming-system.js";
import { at, readComplexes, readString } from "./read.js";
import { invertCodeMap, type V2Components } from "./v2.js";

/**
 * Caller context for a reverse (FHIR to v2) conversion. Every entry is **caller-vetted**: nothing
 * here is derived from resource content, and omitting all of it is safe (the conversion then flags
 * what it cannot resolve rather than guessing it).
 *
 * @example
 * ```ts
 * import { toV2Patient } from "@cosyte/transform";
 * const options = {
 *   assigningAuthorities: { "urn:oid:1.2.840.114350": "HOSP" },
 *   envelope: { sendingApp: "EHR", sendingFacility: "MAIN" },
 * };
 * void options;
 * void toV2Patient;
 * ```
 */
export interface ReverseOptions {
  /**
   * Extra v2 coding-system mnemonic to canonical URI entries, merged over
   * {@link DEFAULT_V2_CODE_SYSTEMS} and then inverted. Same shape and direction as the forward
   * registry's seed, so one declaration serves both directions.
   */
  readonly codeSystems?: Readonly<Record<string, string>>;
  /**
   * `Identifier.system` URI to the v2 assigning-authority namespace (HD.1) that stands for it. There
   * is no derivation from a URI to a namespace, so an identifier whose system is absent here is
   * emitted with its value and **no** assigning authority, flagged rather than invented.
   */
  readonly assigningAuthorities?: Readonly<Record<string, string>>;
  /**
   * MSH envelope fields for the emitted message (sending/receiving application and facility, control
   * id, timestamp, version, processing id). The message type is never taken from here: it is fixed
   * by the shape plus the caller's trigger argument.
   */
  readonly envelope?: Omit<BuildMessageInit, "type">;
}

/** The resolved, inverted lookups one conversion runs against. */
export interface ReverseContext {
  /** The v2 Table 0396 mnemonic for a canonical system URI, or `undefined` when unresolvable. */
  readonly mnemonicFor: (system: string) => string | undefined;
  /** The v2 assigning-authority namespace for an `Identifier.system`, or `undefined`. */
  readonly namespaceFor: (system: string) => string | undefined;
  /** The MSH envelope fields to build the message with. */
  readonly envelope: Omit<BuildMessageInit, "type">;
}

/**
 * Resolve a {@link ReverseOptions} into the lookups a conversion consults.
 *
 * @param options - The caller's reverse options.
 * @example
 * ```ts
 * // reverseContext({ codeSystems: { LOCAL: "http://example.org/cs" } }).mnemonicFor("http://loinc.org")
 * // => "LN"
 * ```
 */
export function reverseContext(options: ReverseOptions = {}): ReverseContext {
  const mnemonics = invertCodeMap({ ...DEFAULT_V2_CODE_SYSTEMS, ...options.codeSystems });
  const authorities = options.assigningAuthorities ?? {};
  return {
    mnemonicFor: (system) => (Object.hasOwn(mnemonics, system) ? mnemonics[system] : undefined),
    namespaceFor: (system) =>
      Object.hasOwn(authorities, system) ? authorities[system] : undefined,
    envelope: options.envelope ?? {},
  };
}

/** One `Coding`, read into the three v2 components a coded triplet carries. */
interface V2Coding {
  readonly code: string | undefined;
  readonly display: string | undefined;
  readonly mnemonic: string;
}

/**
 * Read one `Coding` into its v2 triplet, or `undefined` when its system has no v2 mnemonic (flagged)
 * or it carries no code at all.
 */
function readCoding(
  coding: FhirComplex,
  ctx: ReverseContext,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): V2Coding | undefined {
  const code = readString(at(coding, "code"), location, `${fhirPath}.code`, issues);
  const display = readString(at(coding, "display"), location, `${fhirPath}.display`, issues);
  const system = readString(at(coding, "system"), location, `${fhirPath}.system`, issues);
  if (code === undefined) return undefined;
  const mnemonic = system === undefined ? undefined : ctx.mnemonicFor(system);
  if (mnemonic === undefined) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2, location, `${fhirPath}.system`));
    return undefined;
  }
  return { code, display, mnemonic };
}

/**
 * A FHIR `CodeableConcept` as CWE components (CWE.1/2/3 primary triplet, CWE.4/5/6 alternate,
 * CWE.9 original text), or `undefined` when nothing in it can be written to a v2 coded field.
 *
 * Codings whose system has no v2 mnemonic are flagged and left out: the concept degrades to the
 * codings that resolve, and to `CodeableConcept.text` when none do, which is the exact inverse of
 * the CWE to CodeableConcept map's `CWE.9` row.
 *
 * @param concept - The `CodeableConcept` node.
 * @param ctx - The resolved reverse context.
 * @param location - The v2 target location (e.g. `"OBX.3"`), for value-free issues.
 * @param fhirPath - The FHIR path being converted.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // codeableToCwe(observationCode, ctx, "OBX.3", "Observation.code", issues)
 * // => ["789-8", "Hemoglobin", "LN"]
 * ```
 */
export function codeableToCwe(
  concept: FhirComplex,
  ctx: ReverseContext,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): V2Components | undefined {
  const codings: V2Coding[] = [];
  for (const coding of readComplexes(
    at(concept, "coding"),
    location,
    `${fhirPath}.coding`,
    issues,
  )) {
    const read = readCoding(coding, ctx, location, `${fhirPath}.coding`, issues);
    if (read !== undefined) codings.push(read);
  }
  const text = readString(at(concept, "text"), location, `${fhirPath}.text`, issues);
  if (codings.length === 0 && text === undefined) return undefined;

  // A third and further coding has no CWE slot: CWE carries a primary and one alternate triplet.
  if (codings.length > 2) {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_VALUE_NOT_REPRESENTABLE, location, `${fhirPath}.coding`),
    );
  }
  const primary = codings[0];
  const alternate = codings[1];
  return [
    primary?.code,
    primary?.display,
    primary?.mnemonic,
    alternate?.code,
    alternate?.display,
    alternate?.mnemonic,
    undefined,
    undefined,
    text,
  ];
}

/**
 * The code a concept carries in one specific system, or `undefined` when it carries none there.
 * Used where a v2 field is a bare table code rather than a full CWE (an identifier type, an abnormal
 * flag): a coding from any other system is flagged, never re-read as if it were from this table.
 *
 * @param concept - The `CodeableConcept` node.
 * @param system - The canonical system URI the v2 table corresponds to.
 * @param location - The v2 target location, for value-free issues.
 * @param fhirPath - The FHIR path being converted.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // codeInSystem(identifierType, V2_0203_SYSTEM, "CX.5", "Identifier.type", issues) -> "MR"
 * ```
 */
export function codeInSystem(
  concept: FhirComplex,
  system: string,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): string | undefined {
  let found: string | undefined;
  let foreign = false;
  for (const coding of readComplexes(
    at(concept, "coding"),
    location,
    `${fhirPath}.coding`,
    issues,
  )) {
    const codingSystem = readString(at(coding, "system"), location, `${fhirPath}.system`, issues);
    const code = readString(at(coding, "code"), location, `${fhirPath}.code`, issues);
    if (code === undefined) continue;
    if (codingSystem === system) found ??= code;
    else foreign = true;
  }
  if (found === undefined && foreign) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_SYSTEM_NOT_V2, location, `${fhirPath}.system`));
  }
  return found;
}

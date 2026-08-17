/**
 * Reading the `@cosyte/fhir` node model on the way **out** of FHIR, never-throw by construction.
 *
 * The reverse direction is handed nodes it did not build, so every read here answers two questions at
 * once: what the element carries, and whether it is the *kind* of node FHIR says it should be. A node
 * of the wrong kind (a `HumanName` where a string belongs, a string where a list belongs) is not an
 * exception here: it raises {@link ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED} on the caller's issue
 * sink and reads as absent, so the whole-repository never-throw guardrail holds for structurally
 * malformed input exactly as it does for unmappable input.
 *
 * @packageDocumentation
 */

import {
  getProperty,
  isComplex,
  isList,
  isPrimitive,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";

/** The nodes an element carries: a list's items, a lone node as one item, or none when absent. */
function itemsOf(node: FhirNode | undefined): readonly FhirNode[] {
  if (node === undefined) return [];
  return isList(node) ? node.items : [node];
}

/**
 * The named property of a complex node, or `undefined` when the element is absent.
 *
 * @param node - The complex node to read.
 * @param name - The FHIR element name.
 * @example
 * ```ts
 * // at(patientNode, "birthDate") -> the birthDate primitive node, or undefined
 * ```
 */
export function at(node: FhirComplex, name: string): FhirNode | undefined {
  return getProperty(node, name);
}

/**
 * The string a primitive element carries, or `undefined` when it is absent or empty. A node that is
 * not a string primitive is flagged malformed and read as absent.
 *
 * @param node - The element node, or `undefined`.
 * @param location - The v2 target location, for a value-free issue.
 * @param fhirPath - The FHIR path being read.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // readString(at(name, "family"), "PID.5.1", "Patient.name.family", issues) -> "Public"
 * ```
 */
export function readString(
  node: FhirNode | undefined,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): string | undefined {
  if (node === undefined) return undefined;
  if (!isPrimitive(node) || typeof node.value !== "string") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, location, fhirPath));
    return undefined;
  }
  return node.value === "" ? undefined : node.value;
}

/**
 * Every string a repeating primitive element carries, in order; non-string items are flagged
 * malformed and skipped.
 *
 * @param node - The element node, or `undefined`.
 * @param location - The v2 target location, for a value-free issue.
 * @param fhirPath - The FHIR path being read.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // readStrings(at(name, "given"), "PID.5.2", "Patient.name.given", issues) -> ["Jane"]
 * ```
 */
export function readStrings(
  node: FhirNode | undefined,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): readonly string[] {
  const out: string[] = [];
  for (const item of itemsOf(node)) {
    const value = readString(item, location, fhirPath, issues);
    if (value !== undefined) out.push(value);
  }
  return out;
}

/**
 * Every complex item a repeating element carries; items of another kind are flagged malformed and
 * skipped.
 *
 * @param node - The element node, or `undefined`.
 * @param location - The v2 target location, for a value-free issue.
 * @param fhirPath - The FHIR path being read.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // readComplexes(at(patient, "name"), "PID.5", "Patient.name", issues) -> [HumanName, ...]
 * ```
 */
export function readComplexes(
  node: FhirNode | undefined,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): readonly FhirComplex[] {
  const out: FhirComplex[] = [];
  for (const item of itemsOf(node)) {
    if (isComplex(item)) out.push(item);
    else issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, location, fhirPath));
  }
  return out;
}

/**
 * The **exact lexical form** of a numeric element, never routed through a JS `number`: a
 * string-backed `decimal` yields its raw text unchanged. A boolean (or a value-absent) primitive is
 * flagged malformed.
 *
 * @param node - The element node, or `undefined`.
 * @param location - The v2 target location, for a value-free issue.
 * @param fhirPath - The FHIR path being read.
 * @param issues - The issue sink.
 * @example
 * ```ts
 * // readNumberText(at(quantity, "value"), "OBX.5", "Observation.valueQuantity.value", issues) -> "120.50"
 * ```
 */
export function readNumberText(
  node: FhirNode | undefined,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): string | undefined {
  if (node === undefined) return undefined;
  const value = isPrimitive(node) ? node.value : undefined;
  if (value === undefined || typeof value === "boolean") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_MALFORMED, location, fhirPath));
    return undefined;
  }
  return typeof value === "string" ? value : value.raw;
}

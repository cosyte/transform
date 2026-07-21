/**
 * The {@link ConvertResult} envelope every datatype converter returns.
 *
 * A converter never throws on ambiguity and never returns a "confident wrong" value: it returns the
 * FHIR value it could faithfully produce (or `undefined` when nothing can be safely emitted) together
 * with the value-free {@link TransformIssue}s it raised. This is the fail-safe rule as a type.
 *
 * @packageDocumentation
 */

import type { TransformIssue } from "./issue.js";

/**
 * The result of one datatype conversion: the produced FHIR value (or `undefined` when the input was
 * empty or un-emittable) plus the diagnostics raised.
 *
 * @template T - The produced FHIR value's type (a `FhirComplex` datatype node, or a lexical string
 *   for `dateTime`).
 *
 * @example
 * ```ts
 * import { toFhirHumanName } from "@cosyte/transform";
 * const { value, issues } = toFhirHumanName({ familyName: "Public" });
 * // value is a FHIR HumanName node; issues is [] here
 * void value;
 * void issues;
 * ```
 */
export interface ConvertResult<T> {
  /** The produced FHIR value, or `undefined` when nothing could be safely emitted. */
  readonly value: T | undefined;
  /** The value-free diagnostics raised during the conversion, in emission order. */
  readonly issues: readonly TransformIssue[];
}

/**
 * Small builders over the `@cosyte/fhir` generic element model, so each converter reads as the
 * datatype it produces rather than as node plumbing. All of them **omit absent/empty parts**: a
 * FHIR datatype node never carries an empty-string leaf or an empty list.
 *
 * @packageDocumentation
 */

import { complex, list, primitive, type FhirComplex, type FhirNode } from "@cosyte/fhir";

/** A `(name, value)` pair for {@link object}; a `undefined` value is dropped. */
export type Field = readonly [name: string, value: FhirNode | undefined];

/**
 * A FHIR string/code/uri primitive, or `undefined` for an absent/empty source value.
 *
 * @param value - The source string.
 * @example
 * ```ts
 * // text("MA") -> a FHIR primitive; text("") and text(undefined) -> undefined
 * ```
 */
export function text(value: string | undefined): FhirNode | undefined {
  return value === undefined || value === "" ? undefined : primitive(value);
}

/**
 * A FHIR list of the present items, or `undefined` when none are present.
 *
 * @param items - The candidate items; `undefined` entries are dropped.
 * @example
 * ```ts
 * // arr([text("Jane"), text(undefined)]) -> a list of one item
 * ```
 */
export function arr(items: readonly (FhirNode | undefined)[]): FhirNode | undefined {
  const present = items.filter((i): i is FhirNode => i !== undefined);
  return present.length === 0 ? undefined : list(present);
}

/**
 * A FHIR complex node from the present fields, or `undefined` when every field is absent (so an
 * all-empty datatype collapses to "nothing to emit" rather than an empty object).
 *
 * @param fields - The candidate `(name, value)` pairs; pairs with a `undefined` value are dropped.
 * @example
 * ```ts
 * // object([["city", text("Boston")], ["state", text(undefined)]]) -> a complex with one property
 * ```
 */
export function object(fields: readonly Field[]): FhirComplex | undefined {
  const props = fields
    .filter((f): f is readonly [string, FhirNode] => f[1] !== undefined)
    .map(([name, value]) => ({ name, value }));
  return props.length === 0 ? undefined : complex(props);
}

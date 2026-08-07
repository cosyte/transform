/**
 * Test support: embed a produced datatype node into a host FHIR resource and run it through
 * `@cosyte/fhir`'s `validateResource`, the transform's **emit gate**. A produced value that would
 * be structurally invalid FHIR must surface as a validation error here, never ship silently.
 *
 * The host is a small custom-schema "TransformProbe" resource carrying one slot per datatype, so the
 * dateTime primitive is validated against the FHIR dateTime value domain (the strong gate) and every
 * complex datatype is checked for object-ness / cardinality.
 */

import {
  complex,
  primitive,
  list,
  isComplex,
  isList,
  validateResource,
  UNBOUNDED,
  type FhirComplex,
  type FhirNode,
  type ResourceSchema,
} from "@cosyte/fhir";

export const PROBE_SCHEMA: ResourceSchema = {
  type: "TransformProbe",
  elements: {
    identifier: { min: 0, max: UNBOUNDED, types: ["Identifier"] },
    name: { min: 0, max: UNBOUNDED, types: ["HumanName"] },
    address: { min: 0, max: UNBOUNDED, types: ["Address"] },
    code: { min: 0, max: 1, types: ["CodeableConcept"] },
    valueQuantity: { min: 0, max: 1, types: ["Quantity"] },
    effectiveDateTime: { min: 0, max: 1, types: ["dateTime"] },
  },
};

/** The validation issues with error/fatal severity for a probe carrying the given fields. */
export function embedAndValidate(
  fields: readonly (readonly [string, FhirNode])[],
): readonly string[] {
  const resource: FhirComplex = complex([
    { name: "resourceType", value: primitive("TransformProbe") },
    ...fields.map(([name, value]) => ({ name, value })),
  ]);
  const result = validateResource(resource, { schemas: [PROBE_SCHEMA] });
  return result.issues
    .filter((i) => i.severity === "error" || i.severity === "fatal")
    .map((i) => `${i.code}@${i.expression}`);
}

/** Wrap a datatype node as a single-item list (for the `name`/`address`/`identifier` slots). */
export function one(node: FhirNode): FhirNode {
  return list([node]);
}

/** The complex item at index `i` of a list-valued node, or throw (test-only accessor). */
export function itemAt(node: FhirNode | undefined, i: number): FhirComplex {
  if (node === undefined || !isList(node)) throw new Error("expected a list node");
  const item = node.items[i];
  if (item === undefined || !isComplex(item))
    throw new Error(`no complex item at index ${String(i)}`);
  return item;
}

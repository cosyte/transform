/**
 * Render a list of {@link TransformIssue}s as a FHIR `OperationOutcome` resource model.
 *
 * The transform's diagnostic channel is `OperationOutcome`-shaped by design; this is the adapter that
 * materializes it as an actual `@cosyte/fhir` resource node a consumer can serialize, validate, or
 * return alongside a bundle. It is **value-free**: every field is drawn from the issue's static
 * metadata (code, severity, message) and its positional locations (v2 location → `diagnostics`, FHIR
 * path → `expression`). No patient data is reachable here.
 *
 * @packageDocumentation
 */

import { complex, list, primitive, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { fhirIssueTypeFor, type TransformIssue } from "./issue.js";

/** The code system under which the transform's stable issue codes are carried in `details.coding`. */
export const TRANSFORM_ISSUE_SYSTEM = "https://cosyte.com/fhir/CodeSystem/transform-issue-codes";

function prop(name: string, value: FhirNode): { name: string; value: FhirNode } {
  return { name, value };
}

function renderIssue(i: TransformIssue): FhirComplex {
  const details = complex([
    prop(
      "coding",
      list([
        complex([
          prop("system", primitive(TRANSFORM_ISSUE_SYSTEM)),
          prop("code", primitive(i.code)),
        ]),
      ]),
    ),
    prop("text", primitive(i.message)),
  ]);

  const props = [
    prop("severity", primitive(i.severity)),
    prop("code", primitive(fhirIssueTypeFor(i.code))),
    prop("details", details),
    // `diagnostics` carries the v2 source location: positional metadata, never a value.
    prop("diagnostics", primitive(i.v2Location)),
  ];
  if (i.fhirPath !== undefined) {
    props.push(prop("expression", list([primitive(i.fhirPath)])));
  }
  return complex(props);
}

/**
 * Build a FHIR `OperationOutcome` {@link FhirComplex} from the given issues. An empty list still
 * produces a structurally-valid `OperationOutcome` with a single `information` "all clear" issue
 * (FHIR requires `OperationOutcome.issue` to be non-empty).
 *
 * @param issues - The value-free diagnostics to render.
 * @example
 * ```ts
 * import { toOperationOutcome } from "@cosyte/transform";
 * const oo = toOperationOutcome([]);
 * // oo is a FhirComplex resource node with resourceType "OperationOutcome"
 * void oo;
 * ```
 */
export function toOperationOutcome(issues: readonly TransformIssue[]): FhirComplex {
  const rendered =
    issues.length > 0
      ? issues.map(renderIssue)
      : [
          complex([
            prop("severity", primitive("information")),
            prop("code", primitive("informational")),
            prop("details", complex([prop("text", primitive("No transform issues."))])),
          ]),
        ];
  return complex([
    prop("resourceType", primitive("OperationOutcome")),
    prop("issue", list(rendered)),
  ]);
}

/**
 * MSH → FHIR `MessageHeader` — grounded on the IG **Segment MSH to MessageHeader** ConceptMap
 * (`hl7.fhir.uv.v2mappings`, STU1), scoped to the R4 elements that can be produced faithfully:
 *
 * | MSH field | FHIR target | note |
 * |---|---|---|
 * | MSH-9 Message Type (trigger event) | `MessageHeader.eventCoding` | v2-0003 event-type system |
 * | MSH-3 Sending Application (HD) | `MessageHeader.source.name` / `.endpoint` | endpoint is a URL; an app namespace is not one |
 *
 * R4 requires `MessageHeader.source.endpoint` (1..1, a URL). An MSH-3 application *namespace* is not a
 * URL, so rather than fabricate one, the endpoint is emitted with a `data-absent-reason` extension
 * (value `unknown`) and flagged {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN} — the
 * spec-clean way to satisfy a required primitive whose value is genuinely unknown. `MessageHeader.focus`
 * wires the header to the message's focal resources (Patient, Encounter). MSH-10 (message control id)
 * is carried on `Bundle.identifier` by the assembler (R4 `MessageHeader` has no identifier element);
 * MSH-4/5/6 sender/destination Organizations and MessageHeader.timestamp (an R5 element) are deferred.
 *
 * @packageDocumentation
 */

import type { Meta } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import { coding, dataAbsent, reference } from "./reference.js";

/** HL7 v2 Table 0003 (Event Type) canonical system — the `MessageHeader.eventCoding` code system. */
const V2_0003_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0003";

/**
 * Build a FHIR `MessageHeader` resource node from the MSH-derived message metadata.
 *
 * @param meta - The `@cosyte/hl7` `Meta` view (MSH-derived).
 * @param focusFullUrls - The `urn:uuid:` fullUrls of the message's focal resources (Patient,
 *   Encounter), wired into `MessageHeader.focus`.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { value } = buildMessageHeader(parseHL7(raw).meta, ["urn:uuid:1-2-3"]);
 * ```
 */
export function buildMessageHeader(
  meta: Meta,
  focusFullUrls: readonly string[],
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("MessageHeader") },
  ];

  // MSH-9 trigger event → MessageHeader.eventCoding (Table 0003).
  const eventCoding = coding(V2_0003_SYSTEM, meta.triggerEvent);
  if (eventCoding !== undefined) {
    props.push({ name: "eventCoding", value: eventCoding });
  } else {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "MSH.9", "MessageHeader.eventCoding"));
  }

  // MSH-3 → MessageHeader.source. endpoint (a URL) is required by R4 but an app namespace is not a
  // URL, so it is emitted data-absent (unknown) rather than fabricated.
  const sourceProps: { name: string; value: FhirNode }[] = [];
  if (meta.sendingApp !== undefined && meta.sendingApp !== "") {
    sourceProps.push({ name: "name", value: primitive(meta.sendingApp) });
  }
  sourceProps.push({ name: "endpoint", value: dataAbsent("unknown") });
  issues.push(
    issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "MSH.3", "MessageHeader.source.endpoint"),
  );
  props.push({ name: "source", value: complex(sourceProps) });

  // MessageHeader.focus → the focal resources of the message.
  if (focusFullUrls.length > 0) {
    props.push({ name: "focus", value: list(focusFullUrls.map((url) => reference(url))) });
  }

  return { value: complex(props), issues };
}

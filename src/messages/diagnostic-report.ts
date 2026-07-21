/**
 * OBR → FHIR `DiagnosticReport` — the ORU results-report anchor (roadmap §Phase 3), grounded firsthand
 * on the IG **Segment OBR to DiagnosticReport** ConceptMap and its **Table HL70123 to Diagnostic Report
 * Status** ConceptMap (`hl7.fhir.uv.v2mappings`, STU1;
 * `ConceptMap-segment-obr-to-diagnosticreport.html`,
 * `ConceptMap-table-hl70123-queries-to-diagnostic-report-status.html`):
 *
 * | OBR field | FHIR target | via |
 * |---|---|---|
 * | OBR-2 Placer Order Number | `identifier` (type `PLAC`) | EI.1 → `Identifier.value`, v2-0203 type |
 * | OBR-3 Filler Order Number | `identifier` (type `FILL`) | EI.1 → `Identifier.value`, v2-0203 type |
 * | OBR-4 Universal Service Identifier (CWE) | `DiagnosticReport.code` | {@link toFhirCodeableConcept} |
 * | OBR-7 Observation Date/Time | `effectiveDateTime` / `effectivePeriod.start` | {@link toFhirDateTime} |
 * | OBR-8 Observation End Date/Time | `effectivePeriod.end` (start moves to the period when valued) | — |
 * | OBR-22 Results Rpt/Status Chng Date/Time | `DiagnosticReport.issued` (an `instant`) | {@link toFhirDateTime} |
 * | OBR-24 Diagnostic Serv Sect ID | `DiagnosticReport.category` | v2-0074 coding |
 * | OBR-25 Result Status | `DiagnosticReport.status` | {@link DIAGNOSTIC_REPORT_STATUS_MAP} (HL70123) |
 * | (OBX children) | `DiagnosticReport.result` | reference wiring from the assembler |
 *
 * **Fail-safes.** `DiagnosticReport.status` is required (R4 1..1) and the IG itself notes an unvalued
 * OBR-25 is an error; so an absent OBR-25 — or an OBR-25 code the HL70123 map does not carry (`A`, `M`,
 * `N`, `Y`, `Z`) — leaves `status` absent + flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}, and the
 * required-`status` emit gate withholds the report rather than emitting an invalid one or guessing
 * `final`. `OBR-25 = C`→`corrected` / `X`→`cancelled` are modelled exactly. OBR-22 becomes `issued`
 * only when it is a fully-zoned instant; a date-only/naked OBR-22 is dropped + flagged (never a
 * fabricated UTC), mirroring `Bundle.timestamp`. Deferred and flagged elsewhere, not silently mapped:
 * OBR-32/34/35 performers (need PractitionerRole resources), specimen, and `basedOn` ServiceRequest
 * (Phase 4).
 *
 * @packageDocumentation
 */

import type { Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { orderIdentifier, reference } from "./reference.js";

/** The HL7 v2 Table 0074 (Diagnostic Service Section ID) canonical system — `DiagnosticReport.category`. */
const V2_0074_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0074";

/**
 * HL7 v2 Table 0123 (Result Status) → FHIR `diagnostic-report-status` (`DiagnosticReport.status`), per
 * the IG **Table HL70123 [Queries] to Diagnostic Report Status** ConceptMap (each `is equivalent to`).
 * Only these **eight** source codes carry a target; the IG leaves `A`, `M`, `N`, `Y`, `Z` unmapped
 * (verified firsthand against the published v1.0.0 ConceptMap — `N` "Procedure completed, results
 * pending" is in the `(not mapped)` group, and the map declares no `unmapped` default), so an OBR-25
 * with one of them leaves `status` absent + flagged and the report is withheld. In particular a
 * results-**pending** `N` is **never** emitted as the post-final `appended`. **`C`→`corrected` and
 * `X`→`cancelled` guarantee a corrected/cancelled report never emits as `final`.**
 */
export const DIAGNOSTIC_REPORT_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  O: "registered",
  I: "registered",
  S: "registered",
  P: "preliminary",
  R: "partial",
  C: "corrected",
  F: "final",
  X: "cancelled",
});

/**
 * Build a FHIR `DiagnosticReport` resource node from one parsed HL7 v2 OBR segment and the fullUrls of
 * the `Observation`s produced under it. Returns `{ value: undefined }` when OBR-4 (the report `code`,
 * required 1..1) is absent. `DiagnosticReport.status` is left absent (and the report withheld by the
 * emit gate) when OBR-25 is missing or has no HL70123 target — never guessed.
 *
 * @param obr - The OBR `@cosyte/hl7` `Segment`.
 * @param resultFullUrls - The `urn:uuid:` fullUrls of this report's emitted `Observation`s → `.result`.
 * @param subjectFullUrl - The bundle's Patient fullUrl → `DiagnosticReport.subject`.
 * @param encounterFullUrl - The bundle's Encounter fullUrl → `DiagnosticReport.encounter`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const obr = parseHL7(raw).segments("OBR")[0];
 * // const { value } = buildDiagnosticReport(obr!, ["urn:uuid:obs1"], "urn:uuid:pat", undefined, {});
 * ```
 */
export function buildDiagnosticReport(
  obr: Segment,
  resultFullUrls: readonly string[],
  subjectFullUrl: string | undefined,
  encounterFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("DiagnosticReport") },
  ];

  // OBR-2 / OBR-3 → DiagnosticReport.identifier (PLAC / FILL, v2-0203 types).
  const identifiers = [
    orderIdentifier(obr.field(2).value, "PLAC"),
    orderIdentifier(obr.field(3).value, "FILL"),
  ].filter((i): i is FhirComplex => i !== undefined);
  if (identifiers.length > 0) props.push({ name: "identifier", value: list(identifiers) });

  // OBR-25 → DiagnosticReport.status (HL70123). Absent/unmapped → left absent (emit gate withholds),
  // never guessed; a corrected/cancelled result is modelled exactly, never emitted as `final`.
  const statusCode = obr.field(25).value;
  if (statusCode !== "") {
    const status = Object.hasOwn(DIAGNOSTIC_REPORT_STATUS_MAP, statusCode)
      ? DIAGNOSTIC_REPORT_STATUS_MAP[statusCode]
      : undefined;
    if (status === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "OBR.25", "DiagnosticReport.status"));
    } else {
      props.push({ name: "status", value: primitive(status) });
    }
  }

  // OBR-24 → DiagnosticReport.category (v2-0074 diagnostic service section).
  const section = obr.field(24).value;
  if (section !== "") {
    props.push({
      name: "category",
      value: list([
        complex([
          {
            name: "coding",
            value: list([
              complex([
                { name: "system", value: primitive(V2_0074_SYSTEM) },
                { name: "code", value: primitive(section) },
              ]),
            ]),
          },
        ]),
      ]),
    });
  }

  // OBR-4 → DiagnosticReport.code (required 1..1). Absent → nothing emittable.
  const code = toFhirCodeableConcept(obr.field(4).asCwe(), ctx);
  issues.push(...code.issues);
  if (code.value === undefined) return { value: undefined, issues };
  props.push({ name: "code", value: code.value });

  // subject / encounter → the bundle's Patient / Encounter (message-map reference wiring).
  if (subjectFullUrl !== undefined)
    props.push({ name: "subject", value: reference(subjectFullUrl) });
  if (encounterFullUrl !== undefined) {
    props.push({ name: "encounter", value: reference(encounterFullUrl) });
  }

  // OBR-7 / OBR-8 → effectiveDateTime, or effectivePeriod when an end (OBR-8) is valued.
  const hasEnd = obr.field(8).value !== "";
  if (obr.field(7).value !== "") {
    const start = toFhirDateTime(obr.field(7).asTs(), ctx.options);
    issues.push(...start.issues);
    if (start.value !== undefined && !hasEnd) {
      props.push({ name: "effectiveDateTime", value: primitive(start.value) });
    } else if (start.value !== undefined) {
      const end = toFhirDateTime(obr.field(8).asTs(), ctx.options);
      issues.push(...end.issues);
      const periodProps: { name: string; value: FhirNode }[] = [
        { name: "start", value: primitive(start.value) },
      ];
      if (end.value !== undefined) periodProps.push({ name: "end", value: primitive(end.value) });
      props.push({ name: "effectivePeriod", value: complex(periodProps) });
    }
  }

  // OBR-22 → DiagnosticReport.issued (an `instant`): only a fully-zoned datetime qualifies; a
  // date-only/naked OBR-22 is dropped + flagged rather than emitted as an invalid or fabricated instant.
  if (obr.field(22).value !== "") {
    const issued = toFhirDateTime(obr.field(22).asTs(), ctx.options);
    issues.push(...issued.issues);
    if (issued.value !== undefined && issued.value.includes("T")) {
      props.push({ name: "issued", value: primitive(issued.value) });
    } else if (issued.value !== undefined) {
      issues.push(
        issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "OBR.22", "DiagnosticReport.issued"),
      );
    }
  }

  // DiagnosticReport.result → the emitted Observations under this OBR.
  if (resultFullUrls.length > 0) {
    props.push({ name: "result", value: list(resultFullUrls.map((u) => reference(u))) });
  }

  return { value: complex(props), issues };
}

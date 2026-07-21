/**
 * `toFhir` — the message-level entry point: assemble a parsed HL7 v2 message into a FHIR R4
 * **message Bundle** (a `MessageHeader` first, then the focal resources), grounded on the IG message
 * and segment maps. Phase 2 covers the **ADT** family → **Patient + Encounter** (+ `RelatedPerson`
 * from NK1), establishing the message-map → resource-graph pattern the later phases reuse.
 *
 * The fail-safe rule holds at the message level. Two message-level fail-safes join the datatype ones:
 *
 * - **Segment-assembled, not fabricated.** For an ADT trigger the IG maps ({@link IG_MAPPED_ADT_TRIGGERS}),
 *   the graph is message-map-grounded. For any other trigger there is no IG *message* map, so the
 *   graph is assembled from the reusable IG *segment* maps and flagged
 *   {@link ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED} — never a fabricated message map.
 * - **Conservative emit gate.** Every produced resource is run through `@cosyte/fhir.validateResource`
 *   before it can join the bundle — `Patient` against the built-in schema in `strict` mode, and the
 *   other types against the minimal required-cardinality {@link EMIT_SCHEMAS} in `lenient` mode (so a
 *   missing required element errors and withholds, while unmodeled sibling elements do not
 *   false-reject). A resource with any structural error is **withheld** from the bundle and flagged
 *   {@link ISSUE_CODES.TRANSFORM_RESOURCE_INVALID} rather than shipped as silently-invalid FHIR. When
 *   the Patient is withheld, the Encounter's `subject` and any RelatedPerson are dropped rather than
 *   left dangling — references always resolve within the bundle.
 *
 * @packageDocumentation
 */

import type { Hl7Message } from "@cosyte/hl7";
import {
  complex,
  primitive,
  list,
  resourceType,
  validateResource,
  type FhirComplex,
  type FhirNode,
} from "@cosyte/fhir";

import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import { createNamingSystem } from "../terminology/naming-system.js";
import type { TransformContext, TransformOptions } from "../terminology/context.js";
import { buildDiagnosticReport } from "./diagnostic-report.js";
import { buildEncounter } from "./encounter.js";
import { EMIT_SCHEMAS } from "./emit-schemas.js";
import { buildMessageHeader } from "./message-header.js";
import { buildObservation } from "./observation.js";
import { collectReportGroups } from "./oru.js";
import { buildPatient } from "./patient.js";
import { buildRelatedPerson } from "./related-person.js";
import { IdAllocator } from "./reference.js";

/**
 * The immutable result of a message-level transform: the FHIR `Bundle` model and the value-free
 * diagnostics raised assembling it.
 */
export interface TransformResult {
  /** The FHIR R4 `Bundle` resource node (a message Bundle: MessageHeader first, then focal resources). */
  readonly bundle: FhirComplex;
  /** The value-free diagnostics raised during assembly, in emission order. */
  readonly issues: readonly TransformIssue[];
}

/**
 * The ADT trigger events the IG ships a **message** map for. Other triggers still transform — from the
 * reusable segment maps — but are flagged {@link ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED}.
 */
export const IG_MAPPED_ADT_TRIGGERS: ReadonlySet<string> = new Set([
  "A01",
  "A02",
  "A05",
  "A06",
  "A09",
  "A11",
  "A17",
]);

/**
 * The ORU trigger events the IG ships a **message** map for. The IG maps only `R01`; other ORU triggers
 * still assemble their results graph from the reusable OBR/OBX segment maps but are flagged
 * {@link ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED}.
 */
export const IG_MAPPED_ORU_TRIGGERS: ReadonlySet<string> = new Set(["R01"]);

interface Entry {
  readonly fullUrl: string;
  readonly resource: FhirComplex;
}

/**
 * The conservative-emit gate: validate a produced resource against `@cosyte/fhir` before it can join
 * the bundle. Returns `true` when it is safe to emit, or pushes a
 * {@link ISSUE_CODES.TRANSFORM_RESOURCE_INVALID} issue and returns `false` when it has any structural
 * error (the resource is then **withheld** — never shipped invalid).
 *
 * `@cosyte/fhir` models only `Patient` natively, so `Patient` is validated `strict` (its value domains
 * and unknown elements both caught). The other emitted types are validated `lenient` against the
 * minimal required-cardinality {@link EMIT_SCHEMAS}: a **missing required** element (e.g. a
 * class-less/status-less Encounter from an unmapped patient class) is an error and withholds the
 * resource, while the resource's other elements degrade to warnings rather than false rejections.
 */
function passesEmitGate(
  resource: FhirComplex,
  v2Location: string,
  fhirPath: string,
  issues: TransformIssue[],
): boolean {
  const result =
    resourceType(resource) === "Patient"
      ? validateResource(resource, { mode: "strict" })
      : validateResource(resource, { mode: "lenient", schemas: EMIT_SCHEMAS });
  if (result.valid) return true;
  issues.push(issue(ISSUE_CODES.TRANSFORM_RESOURCE_INVALID, v2Location, fhirPath));
  return false;
}

/** Assemble the FHIR message `Bundle` envelope from its ordered entries. */
function buildBundle(
  msg: Hl7Message,
  entries: readonly Entry[],
  ctx: TransformContext,
  issues: TransformIssue[],
): FhirComplex {
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Bundle") },
  ];

  // MSH-10 message control id → Bundle.identifier (R4 MessageHeader carries no identifier element).
  const controlId = msg.meta.controlId;
  if (controlId !== undefined && controlId !== "") {
    props.push({
      name: "identifier",
      value: complex([{ name: "value", value: primitive(controlId) }]),
    });
  }

  props.push({ name: "type", value: primitive("message") });

  // MSH-7 → Bundle.timestamp (an `instant`: only a fully-zoned datetime qualifies; else omit + flag).
  if (msg.meta.timestamp !== undefined) {
    const ts = toFhirDateTime(msg.meta.timestamp, ctx.options);
    issues.push(...ts.issues);
    if (ts.value !== undefined && ts.value.includes("T")) {
      props.push({ name: "timestamp", value: primitive(ts.value) });
    } else if (ts.value !== undefined) {
      // A date-only or unzoned MSH-7 is not a valid FHIR `instant`; omit rather than emit invalid.
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "MSH.7", "Bundle.timestamp"));
    }
  }

  const entryNodes = entries.map((e) =>
    complex([
      { name: "fullUrl", value: primitive(e.fullUrl) },
      { name: "resource", value: e.resource },
    ]),
  );
  if (entryNodes.length > 0) props.push({ name: "entry", value: list(entryNodes) });

  return complex(props);
}

/**
 * Transform a parsed HL7 v2 message into a FHIR R4 message `Bundle`. Never throws for a well-formed
 * {@link Hl7Message}; every ambiguity, unmapped code, dropped element, or withheld resource surfaces
 * as a value-free {@link TransformIssue}.
 *
 * @param msg - A parsed `@cosyte/hl7` message.
 * @param opts - Transform options: the {@link TransformOptions.namingSystem} registry, the naked-
 *   timestamp {@link TransformOptions.assumeTimezoneOffsetMinutes} policy, and a
 *   {@link TransformOptions.generateId} allocator for reproducible fullUrls.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * import { toFhir, createNamingSystem } from "@cosyte/transform";
 * const { bundle, issues } = toFhir(parseHL7(raw), { namingSystem: createNamingSystem() });
 * void bundle;
 * void issues;
 * ```
 */
export function toFhir(msg: Hl7Message, opts: TransformOptions = {}): TransformResult {
  const issues: TransformIssue[] = [];
  const namingSystem = opts.namingSystem ?? createNamingSystem();
  const ctx: TransformContext = { namingSystem, options: opts };
  const ids = new IdAllocator(opts);

  // Dispatch: an IG-mapped ADT or ORU trigger is message-map-grounded; anything else is
  // segment-assembled (best-effort from the reusable IG segment maps, flagged as such).
  const code = msg.meta.messageCode;
  const trigger = msg.meta.triggerEvent;
  const messageMapGrounded =
    trigger !== undefined &&
    ((code === "ADT" && IG_MAPPED_ADT_TRIGGERS.has(trigger)) ||
      (code === "ORU" && IG_MAPPED_ORU_TRIGGERS.has(trigger)));
  if (!messageMapGrounded) {
    issues.push(issue(ISSUE_CODES.TRANSFORM_SEGMENT_ASSEMBLED, "MSH.9"));
  }

  const focalEntries: Entry[] = [];

  // PID → Patient (the identity anchor). Gated before it can anchor references.
  let patientFullUrl: string | undefined;
  const patientView = msg.patient;
  if (patientView !== undefined) {
    const built = buildPatient(patientView, ctx);
    issues.push(...built.issues);
    if (built.value !== undefined && passesEmitGate(built.value, "PID", "Patient", issues)) {
      patientFullUrl = ids.next();
      focalEntries.push({ fullUrl: patientFullUrl, resource: built.value });
    }
  }

  // PV1 → Encounter, subject wired to the Patient (omitted if no valid Patient).
  let encounterFullUrl: string | undefined;
  const visitView = msg.visit;
  if (visitView !== undefined) {
    const built = buildEncounter(visitView, patientFullUrl, ctx);
    issues.push(...built.issues);
    if (built.value !== undefined && passesEmitGate(built.value, "PV1", "Encounter", issues)) {
      encounterFullUrl = ids.next();
      focalEntries.push({ fullUrl: encounterFullUrl, resource: built.value });
    }
  }

  // NK1 → RelatedPerson, patient wired to the Patient. Requires a Patient (FHIR-required reference).
  const nextOfKin = msg.nextOfKin();
  if (patientFullUrl !== undefined) {
    for (let i = 0; i < nextOfKin.length; i++) {
      const nk1 = nextOfKin[i];
      if (nk1 === undefined) continue;
      const built = buildRelatedPerson(nk1, patientFullUrl, ctx, i);
      issues.push(...built.issues);
      if (
        built.value !== undefined &&
        passesEmitGate(built.value, `NK1[${String(i)}]`, "RelatedPerson", issues)
      ) {
        focalEntries.push({ fullUrl: ids.next(), resource: built.value });
      }
    }
  } else if (nextOfKin.length > 0) {
    // No Patient to anchor RelatedPerson.patient — dropped rather than emitted with a dangling ref.
    issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "NK1", "RelatedPerson.patient"));
  }

  // ORU → the DiagnosticReport + Observation results graph (Phase 3). OBR anchors a DiagnosticReport;
  // its OBX children become Observations, each subject-wired to the Patient. A withheld Observation is
  // simply absent from DiagnosticReport.result (references always resolve within the bundle), and a
  // withheld DiagnosticReport (unmapped/absent OBR-25 status) still leaves its valid Observations.
  const diagnosticReportFullUrls: string[] = [];
  if (code === "ORU") {
    const { groups, orphanObxCount } = collectReportGroups(msg);
    if (orphanObxCount > 0) {
      // OBX with no preceding OBR — no report to anchor it; surfaced rather than silently dropped.
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "OBX", "DiagnosticReport.result"));
    }
    for (const group of groups) {
      const resultFullUrls: string[] = [];
      const observationEntries: Entry[] = [];
      for (let i = 0; i < group.observations.length; i++) {
        const obx = group.observations[i];
        if (obx === undefined) continue;
        const built = buildObservation(obx, patientFullUrl, encounterFullUrl, ctx);
        issues.push(...built.issues);
        if (
          built.value !== undefined &&
          passesEmitGate(built.value, `OBX[${String(i)}]`, "Observation", issues)
        ) {
          const url = ids.next();
          resultFullUrls.push(url);
          observationEntries.push({ fullUrl: url, resource: built.value });
        }
      }
      const report = buildDiagnosticReport(
        group.obr,
        resultFullUrls,
        patientFullUrl,
        encounterFullUrl,
        ctx,
      );
      issues.push(...report.issues);
      if (
        report.value !== undefined &&
        passesEmitGate(report.value, "OBR", "DiagnosticReport", issues)
      ) {
        const reportUrl = ids.next();
        diagnosticReportFullUrls.push(reportUrl);
        focalEntries.push({ fullUrl: reportUrl, resource: report.value });
      }
      // The Observations follow their report in the bundle (references resolve regardless of order).
      focalEntries.push(...observationEntries);
    }
  }

  // MSH → MessageHeader (first entry of a message Bundle), focus = the focal resources.
  const focus = [patientFullUrl, encounterFullUrl, ...diagnosticReportFullUrls].filter(
    (u): u is string => u !== undefined,
  );
  const header = buildMessageHeader(msg.meta, focus);
  issues.push(...header.issues);
  const entries: Entry[] = [];
  if (header.value !== undefined && passesEmitGate(header.value, "MSH", "MessageHeader", issues)) {
    entries.push({ fullUrl: ids.next(), resource: header.value });
  }
  entries.push(...focalEntries);

  const bundle = buildBundle(msg, entries, ctx, issues);
  return { bundle, issues };
}

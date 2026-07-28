/**
 * MDM_T02 → FHIR `DocumentReference` — the thin IG single for clinical documents,
 * grounded firsthand on the IG **MDM_T02 message map** and the **TXA/OBX → DocumentReference** segment
 * maps (`hl7.fhir.uv.v2mappings`, STU1; `ConceptMap-message-mdm-t02-to-bundle.json`,
 * `ConceptMap-segment-txa-to-documentreference.json`, `ConceptMap-segment-obx-to-documentreference.json`).
 * Per the message map an MDM message yields **one** `DocumentReference` created from the `TXA` segment,
 * with the document body carried by the `OBX` segments.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | TXA-19 Document Availability Status | `status` (required 1..1) | `AV` → `current` only (see below) |
 * | TXA-2 Document Type (CWE) | `type` | {@link toFhirCodeableConcept} (structural — no IG value map) |
 * | TXA-6 Origination Date/Time (DTM) | `date` (an `instant`) | {@link toFhirDateTime}, fully-zoned only |
 * | TXA-12 Unique Document Number | `masterIdentifier` | EI.1 → `Identifier.value` |
 * | TXA-16 Unique Document File Name | `identifier` | ST → `Identifier.value` |
 * | TXA-25 Document Title | `description` | verbatim |
 * | OBX-5 (per OBX-2) | `content.attachment` (required 1..*) | {@link buildContent} |
 * | (message-map wiring) | `subject` | the bundle's Patient |
 *
 * **Fail-safes (never a confident wrong document record).**
 * - **`status` (required 1..1) — grounded only for `AV`.** The IG conditions TXA-19 → `status` on
 *   `IF TXA-19 = "AV"` and ships **no** value ConceptMap (there is no HL70273 → document-reference-status
 *   table in the IG). "AV" (Available) has exactly one faithful target in the required
 *   `document-reference-status` binding (`current` | `superseded` | `entered-in-error`): **`current`**, so
 *   `AV → current` is emitted. Every other TXA-19 value — `CA`/`OB`/`UN` (whose IG target is a
 *   `status.extension` construct that is not valid R4) and any local code — is **unmapped**
 *   ({@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}); `status` is left absent and the required-`status` emit
 *   gate **withholds** the DocumentReference. Never guessed.
 * - **`content` (required 1..*).** Built from the `OBX` document body via {@link buildContent}. When no
 *   OBX yields a groundable attachment the DocumentReference has no content and is withheld + flagged —
 *   a document reference that references nothing is never emitted.
 * - **`docStatus` — unmapped, left absent.** TXA-17 → `docStatus` has **no** IG value ConceptMap
 *   (HL70271 → composition-status is genuinely ambiguous), so a valued TXA-17 is flagged
 *   {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED} and `docStatus` (0..1) is left absent — never guessed.
 * - **`content.attachment.contentType`.** Taken from the IG's OBX-2 assignment (`application/text` for
 *   TX, `text/hl7v2` for FT — see {@link BODY_CONTENT_TYPE}), **not** from TXA-3 — the TXA-3 → contentType
 *   row carries HL70191 codes that are not MIME types, so TXA-3 is flagged dropped rather than emitted as
 *   an invalid `contentType`. The document body itself is **carried, never interpreted** (TX/FT text is
 *   base64-encoded verbatim into `content.attachment.data`).
 *
 * Deferred and flagged elsewhere, not silently mapped: TXA-9/10 author/authenticator (Practitioner),
 * TXA-18 securityLabel, the ED-encapsulated OBX body, and the COMMON_ORDER ORC → ServiceRequest graph.
 *
 * @packageDocumentation
 */

import type { Hl7Message, Segment } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "../terminology/context.js";
import { reference } from "./reference.js";

/** The only faithful `document-reference-status` target for TXA-19 = "AV" (Document is Available). */
const STATUS_AVAILABLE_TARGET = "current";
/**
 * The `content.attachment.contentType` the IG assigns per OBX-2 body type (verified firsthand against
 * `ConceptMap-segment-obx-to-documentreference.json`: `content[4].contentType` = `"application/text"`
 * for `IF OBX-2="TX"`, `content[2].contentType` = `"text/hl7v2"` for `IF OBX-2="FT"`).
 */
const BODY_CONTENT_TYPE: Readonly<Record<string, string>> = Object.freeze({
  TX: "application/text",
  FT: "text/hl7v2",
});

/**
 * Build one `DocumentReference.content` entry from a body `OBX`, discriminated by OBX-2 per the IG
 * **OBX → DocumentReference** map: `TX` → `content.attachment.data` (the text base64-encoded) + the
 * IG-assigned `application/text` contentType; `FT` → the same, with `text/hl7v2`; `RP` →
 * `content.attachment.url` (the reference pointer). The IG also maps `ED` → `content.attachment`, but
 * that requires decoding the ED encapsulated-data composite (a later concern), so `ED` — and any
 * non-document OBX-2 — is flagged {@link ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED} and deferred, never
 * fabricated. The document body itself is carried verbatim, never interpreted.
 */
function buildContent(
  obx: Segment,
  index: number,
  issues: TransformIssue[],
): FhirComplex | undefined {
  const valueType = obx.field(2).value.toUpperCase();
  const raw = obx.field(5).value;
  if (raw === "") return undefined;

  if (Object.hasOwn(BODY_CONTENT_TYPE, valueType)) {
    // The document body is carried, never interpreted: the verbatim text is base64-encoded into
    // Attachment.data (a base64Binary), with the IG-assigned contentType for this body type.
    const data = Buffer.from(raw, "utf8").toString("base64");
    return complex([
      {
        name: "attachment",
        value: complex([
          { name: "contentType", value: primitive(BODY_CONTENT_TYPE[valueType]) },
          { name: "data", value: primitive(data) },
        ]),
      },
    ]);
  }

  if (valueType === "RP") {
    // RP (reference pointer): the first component is the pointer/URL to the document body.
    return complex([
      {
        name: "attachment",
        value: complex([{ name: "url", value: primitive(raw) }]),
      },
    ]);
  }

  // ED-encapsulated (deferred) and non-document OBX-2 bodies are flagged and dropped, never fabricated.
  issues.push(
    issue(
      ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
      `OBX[${String(index)}].5`,
      "DocumentReference.content",
    ),
  );
  return undefined;
}

/**
 * Build a FHIR `DocumentReference` resource node from an MDM message's `TXA` segment and its body `OBX`
 * segments. Returns `{ value: undefined }` when there is no `TXA`. `status` (from TXA-19 = "AV") and
 * `content` (from the OBX body) are both required 1..1 / 1..*; when either cannot be grounded the
 * resource is left incomplete and later **withheld** by the conservative-emit gate — never guessed.
 *
 * @param txa - The `TXA` `@cosyte/hl7` `Segment` (the document metadata anchor).
 * @param obxs - The document-body `OBX` segments, in document order.
 * @param subjectFullUrl - The bundle's Patient fullUrl → `DocumentReference.subject`.
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const txa = parseHL7(raw).segments("TXA")[0];
 * // const obxs = parseHL7(raw).segments("OBX");
 * // const { value } = buildDocumentReference(txa!, obxs, "urn:uuid:pat", {});
 * ```
 */
export function buildDocumentReference(
  txa: Segment,
  obxs: readonly Segment[],
  subjectFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("DocumentReference") },
  ];

  // TXA-19 → status (required 1..1). Grounded only for "AV" → "current"; anything else is unmapped and
  // the required-status emit gate withholds the resource.
  const availability = txa.field(19).value;
  if (availability === "AV") {
    props.push({ name: "status", value: primitive(STATUS_AVAILABLE_TARGET) });
  } else if (availability !== "") {
    issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "TXA.19", "DocumentReference.status"));
  }

  // TXA-17 → docStatus: no IG value map exists → flag when valued, leave docStatus (0..1) absent.
  if (txa.field(17).value !== "") {
    issues.push(
      issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "TXA.17", "DocumentReference.docStatus"),
    );
  }

  // TXA-2 → type: carried **structurally** (system recognized, value preserved). The IG's
  // TXA→DocumentReference segment map ships **no** `mappedVia` value ConceptMap for TXA-2 (verified
  // firsthand — only TXA-18 securityLabel carries one), so a value translation is never invented for it
  // (ADR 0018 applied to mappings); the document-type code (typically LOINC) is emitted as-is.
  if (txa.field(2).value !== "") {
    const type = toFhirCodeableConcept(txa.field(2).asCwe(), ctx);
    issues.push(...type.issues);
    if (type.value !== undefined) props.push({ name: "type", value: type.value });
  }

  // TXA-12 → masterIdentifier; TXA-16 → identifier[1] (both EI/ST → Identifier.value).
  if (txa.field(12).value !== "") {
    props.push({
      name: "masterIdentifier",
      value: complex([{ name: "value", value: primitive(txa.field(12).value) }]),
    });
  }
  if (txa.field(16).value !== "") {
    props.push({
      name: "identifier",
      value: list([complex([{ name: "value", value: primitive(txa.field(16).value) }])]),
    });
  }

  // subject → the bundle's Patient (message-map reference wiring).
  if (subjectFullUrl !== undefined)
    props.push({ name: "subject", value: reference(subjectFullUrl) });

  // TXA-6 → date (an `instant`): only a fully-zoned datetime qualifies (the IG's "IF time is included"
  // condition), else dropped + flagged rather than emitted as an invalid or fabricated instant.
  if (txa.field(6).value !== "") {
    const date = toFhirDateTime(txa.field(6).asTs(), ctx.options);
    issues.push(...date.issues);
    if (date.value !== undefined && date.value.includes("T")) {
      props.push({ name: "date", value: primitive(date.value) });
    } else if (date.value !== undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, "TXA.6", "DocumentReference.date"));
    }
  }

  // TXA-3 → content.attachment.contentType: HL70191 codes are not MIME types, so a valued TXA-3 is
  // flagged dropped rather than emitted as an invalid contentType (the body type drives it instead).
  if (txa.field(3).value !== "") {
    issues.push(
      issue(
        ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED,
        "TXA.3",
        "DocumentReference.content.attachment.contentType",
      ),
    );
  }

  // TXA-25 → description.
  if (txa.field(25).value !== "")
    props.push({ name: "description", value: primitive(txa.field(25).value) });

  // OBX body → content (required 1..*). No groundable content → resource withheld by the emit gate.
  const contents: FhirComplex[] = [];
  for (let i = 0; i < obxs.length; i++) {
    const obx = obxs[i];
    if (obx === undefined) continue;
    const content = buildContent(obx, i, issues);
    if (content !== undefined) contents.push(content);
  }
  if (contents.length > 0) props.push({ name: "content", value: list(contents) });

  return { value: complex(props), issues };
}

/**
 * The first `TXA` and all body `OBX` segments of an MDM message, for the single-DocumentReference build.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { txa, obxs } = collectDocument(parseHL7(raw));
 * ```
 */
export function collectDocument(msg: Hl7Message): {
  txa: Segment | undefined;
  obxs: readonly Segment[];
} {
  let txa: Segment | undefined;
  const obxs: Segment[] = [];
  for (const seg of msg.allSegments()) {
    if (seg.type === "TXA" && txa === undefined) txa = seg;
    else if (seg.type === "OBX") obxs.push(seg);
  }
  return { txa, obxs };
}

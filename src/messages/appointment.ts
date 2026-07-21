/**
 * SIU_S12 → FHIR `Appointment` — the thin IG single for scheduling (roadmap §Phase 5), grounded
 * firsthand on the IG **SIU_S12 message map**, the **SCH/AIS/PID → Appointment** segment maps, the
 * **Table HL70278 → AppointmentStatus** ConceptMap, and the **TQ → Appointment** datatype map
 * (`hl7.fhir.uv.v2mappings`, STU1; `ConceptMap-message-siu-s12-to-bundle.json`,
 * `ConceptMap-segment-sch-to-appointment.json`, `ConceptMap-segment-ais-to-appointment.json`,
 * `ConceptMap-segment-pid-to-appointment.json`, `ConceptMap-table-hl70278-to-appointmentstatus.json`,
 * `ConceptMap-datatype-tq-to-appointment.json`). Per the message map an SIU message yields **one**
 * `Appointment` created from the `SCH` segment; `PID` contributes the patient participant and `AIS`
 * the service type.
 *
 * | v2 field | FHIR target | via |
 * |---|---|---|
 * | SCH-25 Filler Status Code | `status` (required 1..1) | {@link APPOINTMENT_STATUS_MAP} (HL70278) |
 * | SCH-1 Placer / SCH-2 Filler Appointment ID | `identifier` | EI.1 → `Identifier.value` |
 * | SCH-7 Appointment Reason (CWE) | `reasonCode` | {@link toFhirCodeableConcept} (structural — SNOMED target, BYO) |
 * | SCH-8 Appointment Type (CWE) | `appointmentType` | {@link APPOINTMENT_TYPE_VALUE_MAP} (HL70277, value-translated) |
 * | SCH-9 Duration + SCH-10 Units | `minutesDuration` | integer, only when SCH-10 is minutes |
 * | SCH-11 Appointment Timing Quantity (TQ) | `start` / `end` (instant) | TQ.4/TQ.5 → {@link toFhirDateTime} |
 * | AIS-3 Universal Service Identifier (CWE) | `serviceType` | {@link toFhirCodeableConcept} |
 * | PID (bundle Patient) | `participant.actor` (required 1..*) | reference wiring |
 *
 * **Fail-safes (never a confident wrong appointment).**
 * - **`status` (required 1..1).** SCH-25 → {@link APPOINTMENT_STATUS_MAP} (HL70278). The three HL70278
 *   codes the IG leaves unmatched (`Discontinued`, `Blocked`, `Overbook`) and an absent SCH-25 leave
 *   `status` absent + flagged {@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED}; the required-`status` emit gate
 *   then **withholds** the Appointment — never guessed.
 * - **`participant` (required 1..*).** The bundle Patient is emitted as the required participant. Its
 *   `participant.status` (a required-bound `code` the IG supplies no source for) is emitted as a
 *   `data-absent-reason` primitive (value `unknown`) + flagged {@link ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN}
 *   — the spec-clean way to satisfy a required code whose value is genuinely unknown, never fabricated. An
 *   Appointment with no resolvable Patient (and no other groundable actor this phase builds) has no
 *   participant and is withheld.
 * - **`start`/`end` (instant).** SCH-11's TQ.4/TQ.5 become `start`/`end` only when they are fully-zoned
 *   instants; a naked (unzoned) timing is dropped + flagged rather than assigned a fabricated UTC offset,
 *   mirroring `Bundle.timestamp`.
 * - **`appointmentType` value translation (Phase 6).** SCH-8 → {@link APPOINTMENT_TYPE_VALUE_MAP}
 *   (HL70277 `Normal`/`Tentative`/`Complete` identity into `v2-0277`); a code outside the table is
 *   preserved + flagged, never coerced. **`reasonCode` is NOT value-translated:** SCH-7's IG map target
 *   is SNOMED CT (`table-hl70276-to-sct`) — encumbered, **not bundled** (§5) — so the reason is carried
 *   structurally (BYO ConceptMap), never SNOMED-translated here. (The IG's SCH→Appointment map *also*
 *   carries a redundant SCH-7 → `appointmentType[1]` row via `table-hl70277-to-v2-0277`; it is not
 *   applied — SCH-7 carries HL70276 *reason* codes, not HL70277 *type* codes, so translating them through
 *   the type table would only ever produce spurious unmapped flags. `appointmentType` comes from SCH-8,
 *   the appointment-*type* field, per that same map's SCH-8 → `appointmentType[1]` row.)
 *
 * Deferred and flagged elsewhere, not silently mapped: SCH-12/16/20 contact participants and AIP/AIL/AIG
 * actors (need Practitioner/Location resources), SCH-26/27 `basedOn` ServiceRequest, AIS participant periods.
 *
 * @packageDocumentation
 */

import { parseDtm, type Hl7Message, type Segment, type TS } from "@cosyte/hl7";
import { complex, decimal, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import { toFhirCodeableConcept } from "../datatypes/codeable-concept.js";
import { toFhirDateTime } from "../datatypes/datetime.js";
import { ISSUE_CODES } from "../diagnostics/codes.js";
import { issue, type TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import {
  toFhirCodeableConceptVia,
  APPOINTMENT_TYPE_VALUE_MAP,
} from "../terminology/concept-map.js";
import type { TransformContext } from "../terminology/context.js";
import { dataAbsent, reference } from "./reference.js";

/**
 * HL7 v2 Table 0278 (Filler Status Code) → FHIR `appointmentstatus` (`Appointment.status`), per the IG
 * **Table HL70278 to AppointmentStatus** ConceptMap (each `is equivalent to`). The three source codes
 * the IG leaves **unmatched** (`Discontinued`, `Blocked`, `Overbook`) are absent here on purpose — an
 * SCH-25 carrying one of them (or any local code) leaves `Appointment.status` absent + flagged and the
 * required-`status` emit gate withholds the Appointment.
 */
export const APPOINTMENT_STATUS_MAP: Readonly<Record<string, string>> = Object.freeze({
  Pending: "pending",
  Waitlist: "waitlist",
  Booked: "booked",
  Started: "checked-in",
  Complete: "fulfilled",
  Cancelled: "cancelled",
  Deleted: "entered-in-error",
  Noshow: "noshow",
});

/** The `data-absent-reason` code for the patient participant's unknown required `status`. */
const PARTICIPANT_STATUS_UNKNOWN = "unknown";
/** UCUM / HL7 unit codes SCH-10 uses to declare that SCH-9 is expressed in minutes. */
const MINUTE_UNITS: ReadonlySet<string> = new Set(["min", "MIN", "minutes", "m"]);
/** A FHIR `positiveInt` lexical form (a leading-non-zero positive integer, no sign, no leading zero). */
const POSITIVE_INT = /^[1-9][0-9]*$/;

/** Convert an SCH-11 TQ timing component (a raw v2 timestamp) to a fully-zoned FHIR `instant`, or drop. */
function tqInstant(
  raw: string | undefined,
  ctx: TransformContext,
  location: string,
  fhirPath: string,
  issues: TransformIssue[],
): string | undefined {
  if (raw === undefined || raw === "") return undefined;
  const ts: TS = parseDtm(raw);
  const dt = toFhirDateTime(ts, ctx.options);
  issues.push(...dt.issues);
  if (dt.value === undefined) return undefined;
  // Appointment.start/.end are `instant`: only a fully-zoned datetime qualifies, else drop + flag.
  if (
    dt.value.includes("T") &&
    (dt.value.includes("+") || dt.value.endsWith("Z") || /-\d{2}:\d{2}$/.test(dt.value))
  ) {
    return dt.value;
  }
  issues.push(issue(ISSUE_CODES.TRANSFORM_ELEMENT_DROPPED, location, fhirPath));
  return undefined;
}

/** The raw first-subcomponent of a field's component at 0-based `index`, or `undefined` when empty. */
function rawComponent(seg: Segment, field: number, index: number): string | undefined {
  const c = seg.field(field).repetitions[0]?.components[index]?.subcomponents[0];
  return c === undefined || c === "" ? undefined : c;
}

/** Build the required patient `participant` (actor → Patient, status data-absent), or `undefined`. */
function patientParticipant(
  patientFullUrl: string | undefined,
  issues: TransformIssue[],
): FhirComplex | undefined {
  if (patientFullUrl === undefined) return undefined;
  // participant.status is a required-bound code with no IG source for the patient participant → the
  // spec-clean data-absent-reason primitive, flagged, rather than a fabricated ParticipationStatus.
  issues.push(
    issue(ISSUE_CODES.TRANSFORM_REQUIRED_ELEMENT_UNKNOWN, "SIU", "Appointment.participant.status"),
  );
  return complex([
    { name: "actor", value: reference(patientFullUrl) },
    { name: "status", value: dataAbsent(PARTICIPANT_STATUS_UNKNOWN) },
  ]);
}

/**
 * Build a FHIR `Appointment` resource node from an SIU message's `SCH` segment (+ the first `AIS`), with
 * the bundle Patient wired as the required participant. Returns `{ value: undefined }` when there is no
 * `SCH`. `Appointment.status` is left absent (and the resource withheld by the emit gate) when SCH-25
 * cannot be grounded via HL70278 — never guessed.
 *
 * @param sch - The `SCH` `@cosyte/hl7` `Segment` (the schedule anchor).
 * @param ais - The first `AIS` service segment, when present (supplies `serviceType`).
 * @param patientFullUrl - The bundle's Patient fullUrl → the required `participant.actor` (Patient).
 * @param ctx - The transform context (naming-system registry + timezone policy).
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const sch = parseHL7(raw).segments("SCH")[0];
 * // const { value } = buildAppointment(sch!, undefined, "urn:uuid:pat", {});
 * ```
 */
export function buildAppointment(
  sch: Segment,
  ais: Segment | undefined,
  patientFullUrl: string | undefined,
  ctx: TransformContext,
): ConvertResult<FhirComplex> {
  const issues: TransformIssue[] = [];
  const props: { name: string; value: FhirNode }[] = [
    { name: "resourceType", value: primitive("Appointment") },
  ];

  // SCH-25 → status (HL70278, required 1..1). Absent/unmapped → left absent (emit gate withholds).
  const fillerStatus = sch.field(25).value;
  if (fillerStatus !== "") {
    const status = Object.hasOwn(APPOINTMENT_STATUS_MAP, fillerStatus)
      ? APPOINTMENT_STATUS_MAP[fillerStatus]
      : undefined;
    if (status === undefined) {
      issues.push(issue(ISSUE_CODES.TRANSFORM_CODE_UNMAPPED, "SCH.25", "Appointment.status"));
    } else {
      props.push({ name: "status", value: primitive(status) });
    }
  }

  // SCH-1 / SCH-2 → identifier (placer / filler appointment id; EI.1 → Identifier.value).
  const identifiers = [sch.field(1).value, sch.field(2).value]
    .filter((v) => v !== "")
    .map((v) => complex([{ name: "value", value: primitive(v) }]));
  if (identifiers.length > 0) props.push({ name: "identifier", value: list(identifiers) });

  // SCH-8 → appointmentType (HL70277 → v2-0277; value-translated via the license-clean identity map).
  if (sch.field(8).value !== "") {
    const appointmentType = toFhirCodeableConceptVia(
      sch.field(8).asCwe(),
      APPOINTMENT_TYPE_VALUE_MAP,
      ctx,
    );
    issues.push(...appointmentType.issues);
    if (appointmentType.value !== undefined)
      props.push({ name: "appointmentType", value: appointmentType.value });
  }

  // AIS-3 → serviceType.
  if (ais !== undefined && ais.field(3).value !== "") {
    const serviceType = toFhirCodeableConcept(ais.field(3).asCwe(), ctx);
    issues.push(...serviceType.issues);
    if (serviceType.value !== undefined)
      props.push({ name: "serviceType", value: list([serviceType.value]) });
  }

  // SCH-7 → reasonCode (default table HL70276).
  if (sch.field(7).value !== "") {
    const reason = toFhirCodeableConcept(sch.field(7).asCwe(), ctx);
    issues.push(...reason.issues);
    if (reason.value !== undefined) props.push({ name: "reasonCode", value: list([reason.value]) });
  }

  // SCH-9 + SCH-10 → minutesDuration, only when SCH-10 declares units of minutes (per the IG condition).
  const duration = sch.field(9).value;
  if (
    duration !== "" &&
    POSITIVE_INT.test(duration) &&
    MINUTE_UNITS.has(rawComponent(sch, 10, 0) ?? "")
  ) {
    props.push({ name: "minutesDuration", value: primitive(decimal(duration)) });
  }

  // SCH-11 (TQ) → start / end via TQ.4 / TQ.5 (instant; naked timing dropped + flagged).
  const start = tqInstant(rawComponent(sch, 11, 3), ctx, "SCH.11", "Appointment.start", issues);
  if (start !== undefined) props.push({ name: "start", value: primitive(start) });
  const end = tqInstant(rawComponent(sch, 11, 4), ctx, "SCH.11", "Appointment.end", issues);
  if (end !== undefined) props.push({ name: "end", value: primitive(end) });

  // participant (required 1..*): the bundle Patient (participant.status data-absent + flagged).
  const participant = patientParticipant(patientFullUrl, issues);
  if (participant !== undefined) props.push({ name: "participant", value: list([participant]) });

  return { value: complex(props), issues };
}

/**
 * The first `SCH` and first `AIS` of an SIU message, for the single-Appointment build.
 *
 * @param msg - The parsed `@cosyte/hl7` message.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const { sch, ais } = collectAppointment(parseHL7(raw));
 * ```
 */
export function collectAppointment(msg: Hl7Message): {
  sch: Segment | undefined;
  ais: Segment | undefined;
} {
  let sch: Segment | undefined;
  let ais: Segment | undefined;
  for (const seg of msg.allSegments()) {
    if (seg.type === "SCH" && sch === undefined) sch = seg;
    else if (seg.type === "AIS" && ais === undefined) ais = seg;
  }
  return { sch, ais };
}

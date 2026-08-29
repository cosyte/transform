/**
 * The set of HL7 v2 segment names the **HL7 Version 2 to FHIR** Implementation Guide publishes a
 * segment-to-resource map for, transcribed by hand from the guide's own Segment Maps index.
 *
 * This is the one fact the completeness diagnostic cannot derive from the message or from this
 * library's own code: whether a segment the transform did not carry into the Bundle is missing
 * because this library has not built the mapping yet, or because the standard publishes no mapping
 * to build. The two answers are different news for a consumer, so the set is recorded here with the
 * guide version and the retrieval date it was read at, and every entry is auditable against the
 * published index a reader can open themselves.
 *
 * **The set is the guide's, not this library's.** It says nothing about which of these segments the
 * transform actually reads: `IAM` is on it and is not transformed, `RXE` is off it and is read and
 * refused. Whether an occurrence is reported at all is decided elsewhere, by whether it reached an
 * emitted resource; this set only chooses which of the two codes the report carries.
 *
 * **Qualified rows collapse onto their segment name.** The index publishes several maps per name and
 * some of them carry a use qualifier (`MSH[Source]`, `PID[Patient]`, `PV1[EncounterHistory]`,
 * `OBX[Component]`, `NTE[Comment]`, `PD1[LivingWill]`, `PRT[Location]`, `ROL[GeneralPractitioner]`
 * and the rest). A qualifier selects a use of the same segment, so every one of them contributes its
 * base name and nothing else: what a message carries is an `MSH`, never an `MSH[Source]`.
 *
 * @packageDocumentation
 */

/**
 * The published version of the HL7 Version 2 to FHIR Implementation Guide this set was read from.
 *
 * @example
 * ```ts
 * import { IG_SEGMENT_MAPS_VERSION } from "@cosyte/transform";
 * IG_SEGMENT_MAPS_VERSION; // "1.0.0"
 * ```
 */
export const IG_SEGMENT_MAPS_VERSION = "1.0.0";

/**
 * The publication date of {@link IG_SEGMENT_MAPS_VERSION}, so a later release of the guide can be
 * told apart from a defect in this library.
 *
 * @example
 * ```ts
 * import { IG_SEGMENT_MAPS_PUBLISHED } from "@cosyte/transform";
 * IG_SEGMENT_MAPS_PUBLISHED; // "2025-10-07"
 * ```
 */
export const IG_SEGMENT_MAPS_PUBLISHED = "2025-10-07";

/**
 * The date the Segment Maps index was retrieved and transcribed into {@link IG_MAPPED_SEGMENT_NAMES}.
 *
 * A classification that surprises a reader is answered by re-reading the index at this date: the set
 * is a transcription of a published document at a moment, not a live query.
 *
 * @example
 * ```ts
 * import { IG_SEGMENT_MAPS_RETRIEVED } from "@cosyte/transform";
 * IG_SEGMENT_MAPS_RETRIEVED; // "2026-08-22"
 * ```
 */
export const IG_SEGMENT_MAPS_RETRIEVED = "2026-08-22";

/**
 * The Segment Maps index this set was transcribed from, so a reader can audit any entry.
 *
 * @example
 * ```ts
 * import { IG_SEGMENT_MAPS_SOURCE } from "@cosyte/transform";
 * IG_SEGMENT_MAPS_SOURCE.startsWith("https://"); // true
 * ```
 */
export const IG_SEGMENT_MAPS_SOURCE = "https://hl7.org/fhir/uv/v2mappings/segment_maps.html";

/**
 * Every v2 segment name the guide publishes at least one segment-to-resource map for, at
 * {@link IG_SEGMENT_MAPS_VERSION}, as of {@link IG_SEGMENT_MAPS_RETRIEVED}.
 *
 * Thirty-three names, transcribed chapter by chapter from {@link IG_SEGMENT_MAPS_SOURCE}: Control
 * (`MSA`, `MSH`, `NTE`, `SFT`), Patient Administration (`AL1`, `EVN`, `IAM`, `MRG`, `NK1`, `PD1`,
 * `PID`, `PV1`, `PV2`), Order Entry (`OBR`, `ORC`, `TQ1`), Pharmacy and Vaccination (`RXA`, `RXO`,
 * `RXR`), Financial Management (`DG1`, `IN1`, `IN3`, `PR1`), Observation Reporting (`OBX`, `PRT`,
 * `SPM`), Medical Records (`TXA`), Scheduling (`AIG`, `AIL`, `AIP`, `AIS`, `SCH`) and Personnel
 * Management (`ROL`).
 *
 * Two absences a reader is most likely to check, because they look like oversights and are not:
 * **`RXE` is not on this set** (the guide publishes no map for it, which is why this library counts
 * an `RXE` and refuses to assemble one), and neither is **`GT1`**.
 *
 * @example
 * ```ts
 * import { IG_MAPPED_SEGMENT_NAMES } from "@cosyte/transform";
 * IG_MAPPED_SEGMENT_NAMES.has("IAM"); // true
 * IG_MAPPED_SEGMENT_NAMES.has("RXE"); // false
 * ```
 */
export const IG_MAPPED_SEGMENT_NAMES: ReadonlySet<string> = Object.freeze(
  new Set([
    "AIG",
    "AIL",
    "AIP",
    "AIS",
    "AL1",
    "DG1",
    "EVN",
    "IAM",
    "IN1",
    "IN3",
    "MRG",
    "MSA",
    "MSH",
    "NK1",
    "NTE",
    "OBR",
    "OBX",
    "ORC",
    "PD1",
    "PID",
    "PR1",
    "PRT",
    "PV1",
    "PV2",
    "ROL",
    "RXA",
    "RXO",
    "RXR",
    "SCH",
    "SFT",
    "SPM",
    "TQ1",
    "TXA",
  ]),
);

/**
 * Whether the guide publishes a segment map for `name`, decided against
 * {@link IG_MAPPED_SEGMENT_NAMES} and against nothing else.
 *
 * The comparison is exact: a name this library could not classify is not in the set, and is reported
 * as a standard gap for that reason rather than because the guide was consulted and published
 * nothing. That conflation is deliberate and is documented on the code itself; the alternative would
 * be re-deriving a name the parser refused to vouch for.
 *
 * @param name - A v2 segment name, exactly as the parser published it.
 * @example
 * ```ts
 * import { isIgMappedSegmentName } from "@cosyte/transform";
 * isIgMappedSegmentName("DG1"); // true
 * isIgMappedSegmentName("ZAL"); // false
 * ```
 */
export function isIgMappedSegmentName(name: string): boolean {
  return IG_MAPPED_SEGMENT_NAMES.has(name);
}

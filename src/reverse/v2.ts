/**
 * Writing HL7 v2 field content: the small, safe primitives the reverse (FHIR to v2) maps build on.
 *
 * Two disciplines live here.
 *
 * **Composite content is structured, never concatenated.** A typed composite (XPN, CX, CWE, XAD) is
 * handed to `@cosyte/hl7` as a `RawField` of components, so the serializer owns delimiter escaping:
 * a family name of `Do^e` emits as `Do\S\e` and reads back as `Do^e`, where a hand-built `"Do^e"`
 * string would have silently become two components. Nothing in this module writes a `^` or a `~`.
 *
 * **A lexical form v2 cannot carry is refused, never trimmed to fit.** {@link v2Timestamp} and
 * {@link v2Number} return `undefined` rather than an approximation, and their callers flag the value
 * and leave the v2 field absent.
 *
 * @packageDocumentation
 */

import type { RawField } from "@cosyte/hl7";

/** One repetition of a field: its components, in order, `undefined` for an absent component. */
export type V2Components = readonly (string | undefined)[];

/** A component with a single subcomponent, or an empty component for absent content. */
function component(value: string | undefined): { subcomponents: readonly string[] } {
  return { subcomponents: value === undefined || value === "" ? [] : [value] };
}

/**
 * Build a v2 field from its repetitions, each a list of components, or `undefined` when every
 * repetition is empty (an empty field is left absent, never emitted as structure).
 *
 * @param repetitions - The field's repetitions, outermost first.
 * @example
 * ```ts
 * // v2Field([["Public", "Jane"]]) -> a PID-5 field that serializes as `Public^Jane`
 * ```
 */
export function v2Field(repetitions: readonly V2Components[]): RawField | undefined {
  const present = repetitions.filter((components) =>
    components.some((value) => value !== undefined && value !== ""),
  );
  if (present.length === 0) return undefined;
  return {
    isNull: false,
    repetitions: present.map((components) => {
      // Trailing absent components carry no information on the wire: drop them, keep interior gaps.
      let last = components.length;
      while (last > 0 && (components[last - 1] === undefined || components[last - 1] === ""))
        last--;
      return { components: components.slice(0, last).map(component) };
    }),
  };
}

/**
 * Lay fields out in HL7 1-indexed positional order for `addSegment`, filling unmapped positions with
 * an empty field. Position 1 is the segment's first field (PID-1, OBX-1, ...).
 *
 * @param byPosition - The mapped fields, keyed by their 1-based HL7 field position.
 * @example
 * ```ts
 * // segmentFields(new Map([[3, mrnField], [5, nameField]])) -> ["", "", mrnField, "", nameField]
 * ```
 */
export function segmentFields(
  byPosition: ReadonlyMap<number, RawField>,
): readonly (string | RawField)[] {
  const positions = [...byPosition.keys()];
  const highest = positions.length === 0 ? 0 : Math.max(...positions);
  const out: (string | RawField)[] = [];
  for (let position = 1; position <= highest; position++) {
    out.push(byPosition.get(position) ?? "");
  }
  return out;
}

/** FHIR `date`/`dateTime` lexical forms, at every precision R4 permits. */
const FHIR_DATETIME =
  /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:T(\d{2}):(\d{2}):(\d{2})(\.\d{1,4})?(Z|[+-]\d{2}:\d{2}))?)?)?$/;

/**
 * FHIR `date`/`dateTime` to a v2 DTM, precision-preserving, or `undefined` when the value has no
 * faithful v2 form (an unparseable lexical form, or sub-second precision finer than DTM's four
 * digits, which would have to be truncated). `Z` becomes the explicit `+0000` offset v2 writes.
 *
 * @param value - The FHIR lexical date or dateTime.
 * @example
 * ```ts
 * // v2Timestamp("2026-01-02") -> "20260102"
 * // v2Timestamp("2026-01-02T10:15:00-05:00") -> "20260102101500-0500"
 * ```
 */
export function v2Timestamp(value: string): string | undefined {
  const parts = FHIR_DATETIME.exec(value);
  if (parts === null) return undefined;
  const [, year, month, day, hour, minute, second, fraction, zone] = parts;
  let out = year ?? "";
  if (month !== undefined) out += month;
  if (day !== undefined) out += day;
  if (hour === undefined) return out;
  out += `${hour}${minute ?? ""}${second ?? ""}${fraction ?? ""}`;
  return out + (zone === "Z" ? "+0000" : (zone ?? "").replace(":", ""));
}

/**
 * FHIR `date` to a v2 DTM. A `date` element carrying a time-of-day is outside its own type's value
 * domain, so it is refused (`undefined`) rather than quietly re-read as a `dateTime`: reinterpreting
 * an out-of-domain value is the coercion the fail-safe rule forbids.
 *
 * @param value - The FHIR lexical date.
 * @example
 * ```ts
 * // v2Date("1980-01-15") -> "19800115"
 * // v2Date("1980-01-15T10:00:00-05:00") -> undefined
 * ```
 */
export function v2Date(value: string): string | undefined {
  return value.includes("T") ? undefined : v2Timestamp(value);
}

/** The FHIR `decimal` lexical forms a v2 NM can carry verbatim: no exponent, no leading `+`. */
const V2_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/;

/**
 * A FHIR decimal's exact lexical form when v2 NM can carry it unchanged, else `undefined`. An
 * exponent form (`1e3`) has no NM representation, and rewriting it would alter the value's lexical
 * precision, so it is refused rather than expanded.
 *
 * @param raw - The decimal's exact lexical text.
 * @example
 * ```ts
 * // v2Number("120.50") -> "120.50"   (trailing-zero precision preserved)
 * // v2Number("1e3") -> undefined
 * ```
 */
export function v2Number(raw: string): string | undefined {
  return V2_NUMBER.test(raw) ? raw : undefined;
}

/**
 * Invert a forward v2-to-FHIR code map, keeping **only** the targets exactly one v2 code maps to.
 *
 * This is the bijective-subset rule as code. Where several v2 codes are "equivalent to" one FHIR
 * concept (Table 0001 `O`/`A`/`N` all map to `other`), the inverse is ambiguous: the target is
 * dropped here, and its caller flags `TRANSFORM_CODE_NOT_INVERTIBLE` rather than picking one member
 * of the set.
 *
 * @param forward - A v2 code to FHIR code map, as published by the IG ConceptMap.
 * @example
 * ```ts
 * import { invertCodeMap } from "@cosyte/transform";
 * invertCodeMap({ F: "female", O: "other", A: "other" }); // => { female: "F" }
 * ```
 */
export function invertCodeMap(
  forward: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  const sources = new Map<string, string[]>();
  for (const [v2Code, fhirCode] of Object.entries(forward)) {
    const seen = sources.get(fhirCode);
    if (seen === undefined) sources.set(fhirCode, [v2Code]);
    else seen.push(v2Code);
  }
  const inverse: Record<string, string> = {};
  for (const [fhirCode, v2Codes] of sources) {
    const only = v2Codes[0];
    if (v2Codes.length === 1 && only !== undefined) inverse[fhirCode] = only;
  }
  return Object.freeze(inverse);
}

/**
 * Bundle-assembly primitives shared by the segment→resource builders: fresh `urn:uuid:` identities,
 * FHIR `Reference` nodes, and the small coding/data-absent helpers the message maps need.
 *
 * The identities are the wiring of the resource graph: a produced resource is registered under a
 * `urn:uuid:` `fullUrl`, and every intra-bundle reference (Encounter→subject→Patient,
 * RelatedPerson→patient→Patient, MessageHeader→focus→…) points at that same `fullUrl` so references
 * always resolve **within** the bundle. Identities come from {@link TransformOptions.generateId}
 * (default `crypto.randomUUID`) so output can be made reproducible for golden fixtures.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

import type { Field } from "@cosyte/hl7";
import { complex, primitive, list, type FhirComplex } from "@cosyte/fhir";

import type { TransformOptions } from "../terminology/context.js";
import { V2_0203_SYSTEM } from "../terminology/naming-system.js";

/** The FHIR `data-absent-reason` extension canonical URL. */
const DATA_ABSENT_REASON_URL = "http://hl7.org/fhir/StructureDefinition/data-absent-reason";

/**
 * Allocates `urn:uuid:` identities for the resources of one bundle, from the caller's
 * {@link TransformOptions.generateId} (default `crypto.randomUUID`).
 *
 * @example
 * ```ts
 * // const ids = new IdAllocator({ generateId: () => "1-2-3" });
 * // ids.next(); // "urn:uuid:1-2-3"
 * ```
 */
export class IdAllocator {
  private readonly gen: () => string;

  /**
   * @param options - The transform options; `options.generateId` overrides the default UUID source.
   */
  constructor(options: TransformOptions | undefined) {
    this.gen = options?.generateId ?? (() => randomUUID());
  }

  /** Mint one fresh `urn:uuid:<id>` fullUrl. */
  next(): string {
    return `urn:uuid:${this.gen()}`;
  }
}

/**
 * A FHIR `Reference` node pointing at a bundle `fullUrl`.
 *
 * @param fullUrl - The `urn:uuid:` fullUrl of the referenced entry.
 * @example
 * ```ts
 * // reference("urn:uuid:1-2-3") -> { reference: "urn:uuid:1-2-3" }
 * ```
 */
export function reference(fullUrl: string): FhirComplex {
  return complex([{ name: "reference", value: primitive(fullUrl) }]);
}

/**
 * A single FHIR `Coding` node (`system` + `code`, optional `display`), or `undefined` when no code
 * is present.
 *
 * @param system - The canonical system URI.
 * @param code - The code.
 * @param display - The optional display.
 * @example
 * ```ts
 * // coding("http://terminology.hl7.org/CodeSystem/v3-ActCode", "IMP", "inpatient encounter")
 * ```
 */
export function coding(
  system: string,
  code: string | undefined,
  display?: string,
): FhirComplex | undefined {
  if (code === undefined || code === "") return undefined;
  const props = [
    { name: "system", value: primitive(system) },
    { name: "code", value: primitive(code) },
  ];
  if (display !== undefined && display !== "") {
    props.push({ name: "display", value: primitive(display) });
  }
  return complex(props);
}

/**
 * Build one order `identifier` (an EI's EI.1 → `Identifier.value`) with a v2-0203 identifier-type
 * coding, or `undefined` when the value is empty. Shared by the order/result-anchoring resources
 * whose IG maps route the placer/filler order numbers (OBR-2/ORC-2 `PLAC`, OBR-3/ORC-3 `FILL`) to
 * `Identifier` with a `type` from HL7 Table 0203: `DiagnosticReport` and `ServiceRequest`
 * both use it, so the shape lives here rather than being duplicated per builder.
 *
 * @param value - The order number (EI.1); an empty string yields `undefined`.
 * @param typeCode - The v2-0203 identifier-type code (`PLAC` placer, `FILL` filler).
 * @example
 * ```ts
 * // orderIdentifier("PLACER123", "PLAC") -> { type: { coding: [{ system: v2-0203, code: "PLAC" }] }, value: "PLACER123" }
 * ```
 */
export function orderIdentifier(value: string, typeCode: string): FhirComplex | undefined {
  if (value === "") return undefined;
  return complex([
    {
      name: "type",
      value: complex([
        {
          name: "coding",
          value: list([
            complex([
              { name: "system", value: primitive(V2_0203_SYSTEM) },
              { name: "code", value: primitive(typeCode) },
            ]),
          ]),
        },
      ]),
    },
    { name: "value", value: primitive(value) },
  ]);
}

/** The raw first-subcomponent of a field's component at 0-based `index`, or `""` when empty. */
function component(field: Field, index: number): string {
  return field.repetitions[0]?.components[index]?.subcomponents[0] ?? "";
}

/** One EI field read as a FHIR `Identifier`: the value, and whether an authority went unused. */
export interface EntityIdentifier {
  /** The `Identifier` node built from EI.1, or `undefined` when EI.1 carries nothing. */
  readonly identifier: FhirComplex | undefined;
  /** Whether EI.2, EI.3 or EI.4 carried an assigning authority this library did not resolve. */
  readonly authorityValued: boolean;
}

/**
 * Read one EI (Entity Identifier) field as a FHIR `Identifier`, carrying EI.1 as
 * `Identifier.value` and nothing else. The same reading {@link orderIdentifier} applies to the
 * placer/filler order numbers, without the v2-0203 identifier type those rows assign.
 *
 * `Identifier.system` is deliberately left absent even when EI.2 to EI.4 name an assigning
 * authority: a system URI is never synthesized from a bare namespace, because two senders reusing
 * one namespace would otherwise collide. The caller is told the authority went unused through
 * {@link EntityIdentifier.authorityValued} so it can raise its own value-free diagnostic.
 *
 * @param field - The `EI` field, exactly as the parser published it.
 * @example
 * ```ts
 * import { parseHL7 } from "@cosyte/hl7";
 * // const dg1 = parseHL7(raw).segments("DG1")[0];
 * // toFhirEntityIdentifier(dg1!.field(20)).identifier; // { value: "<EI.1>" } or undefined
 * ```
 */
export function toFhirEntityIdentifier(field: Field): EntityIdentifier {
  const entityId = component(field, 0);
  const authorityValued =
    component(field, 1) !== "" || component(field, 2) !== "" || component(field, 3) !== "";
  return {
    identifier:
      entityId === "" ? undefined : complex([{ name: "value", value: primitive(entityId) }]),
    authorityValued,
  };
}

/**
 * The same `CodeableConcept` with its `text` replaced by `textValue`, so a segment row that targets
 * `code.text` directly can override the original text the datatype map read out of the coded field.
 *
 * @param concept - The `CodeableConcept` node the datatype converter produced.
 * @param textValue - The text the segment map's own row assigns.
 * @example
 * ```ts
 * // withCodeableText(concept, "Diabetes mellitus") -> the same codings, that text
 * ```
 */
export function withCodeableText(concept: FhirComplex, textValue: string): FhirComplex {
  return complex([
    ...concept.properties.filter((p) => p.name !== "text"),
    { name: "text", value: primitive(textValue) },
  ]);
}

/**
 * A value-absent FHIR primitive carrying only a `data-absent-reason` extension: the spec-clean way
 * to satisfy a required primitive whose value is genuinely unknown, **without fabricating one**.
 *
 * @param reasonCode - The `data-absent-reason` code (e.g. `"unknown"`).
 * @example
 * ```ts
 * // used for MessageHeader.source.endpoint when MSH-3 is an app name, not a URL
 * ```
 */
export function dataAbsent(reasonCode: string): ReturnType<typeof primitive> {
  return primitive(undefined, { extension: [dataAbsentReason(reasonCode)] });
}

/** The `data-absent-reason` extension node itself, shared by the primitive and complex forms. */
function dataAbsentReason(reasonCode: string): FhirComplex {
  return complex([
    { name: "url", value: primitive(DATA_ABSENT_REASON_URL) },
    { name: "valueCode", value: primitive(reasonCode) },
  ]);
}

/**
 * A value-absent FHIR **complex** element carrying only a `data-absent-reason` extension: the
 * counterpart of {@link dataAbsent} for a required element whose type is a datatype rather than a
 * primitive, so the cardinality is satisfied **without fabricating any part of the value**.
 *
 * @param reasonCode - The `data-absent-reason` code (e.g. `"unknown"`).
 * @example
 * ```ts
 * // used for SampledData.origin, which R4 requires and the IG's NA map has no source row for
 * // dataAbsentComplex("unknown"); // { extension: [{ url: …/data-absent-reason, valueCode: "unknown" }] }
 * ```
 */
export function dataAbsentComplex(reasonCode: string): FhirComplex {
  return complex([{ name: "extension", value: list([dataAbsentReason(reasonCode)]) }]);
}

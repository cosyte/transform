/**
 * Bundle-assembly primitives shared by the segment→resource builders: fresh `urn:uuid:` identities,
 * FHIR `Reference` nodes, and the small coding/data-absent helpers the message maps need.
 *
 * The identities are the wiring of the resource graph — a produced resource is registered under a
 * `urn:uuid:` `fullUrl`, and every intra-bundle reference (Encounter→subject→Patient,
 * RelatedPerson→patient→Patient, MessageHeader→focus→…) points at that same `fullUrl` so references
 * always resolve **within** the bundle. Identities come from {@link TransformOptions.generateId}
 * (default `crypto.randomUUID`) so output can be made reproducible for golden fixtures.
 *
 * @packageDocumentation
 */

import { randomUUID } from "node:crypto";

import { complex, primitive, type FhirComplex } from "@cosyte/fhir";

import type { TransformOptions } from "../terminology/context.js";

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
 * A value-absent FHIR primitive carrying only a `data-absent-reason` extension — the spec-clean way
 * to satisfy a required primitive whose value is genuinely unknown, **without fabricating one**.
 *
 * @param reasonCode - The `data-absent-reason` code (e.g. `"unknown"`).
 * @example
 * ```ts
 * // used for MessageHeader.source.endpoint when MSH-3 is an app name, not a URL
 * ```
 */
export function dataAbsent(reasonCode: string): ReturnType<typeof primitive> {
  const ext = complex([
    { name: "url", value: primitive(DATA_ABSENT_REASON_URL) },
    { name: "valueCode", value: primitive(reasonCode) },
  ]);
  return primitive(undefined, { extension: [ext] });
}

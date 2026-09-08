/**
 * Shared fixture plumbing for the DG1 / PR1 / IN1 suites: a segment builder that places values at
 * their 1-indexed HL7 field positions (so a fixture cannot silently shift a field by miscounting
 * pipes), a deterministic identity allocator, and the message-level runner the three suites share.
 *
 * Every person-identifying literal used by the suites is drawn from `scripts/phi-allow-list.txt`.
 */

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource, parseResource, getProperty, isList, isComplex } from "@cosyte/fhir";

import { createNamingSystem } from "../../src/terminology/naming-system.js";
import { toFhir, type TransformResult } from "../../src/messages/to-fhir.js";
import type { TransformIssue } from "../../src/diagnostics/issue.js";

/** Build one segment string placing each value at its 1-indexed HL7 field position. */
export function segment(name: string, fields: Readonly<Record<number, string>>): string {
  const positions = Object.keys(fields).map(Number);
  const max = positions.length === 0 ? 0 : Math.max(...positions);
  const parts = [name];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

/** An `ADT^A01` MSH whose trigger the guide publishes a message map for. */
export const MSH_ADT_A01 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1";

/** A PID that yields a Patient which clears the emit gate, so references have something to anchor. */
export const PID_JANE = "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F";

/** A PV1 whose patient class grounds `Encounter.class`, so the Encounter joins the bundle. */
export const PV1_INPATIENT = "PV1|1|I";

/** A deterministic `urn:uuid` allocator, so fullUrls and reference wiring can be asserted exactly. */
export function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/**
 * Run one message through the transform under the registry the three suites share: the default
 * coding systems plus the two mnemonics the fixtures use, and a deterministic id allocator.
 */
export function run(lines: readonly string[]): TransformResult {
  return toFhir(parseHL7(lines.join("\r")), {
    namingSystem: createNamingSystem({
      authorities: { HOSP: "urn:oid:1.2.840.114350" },
      codeSystems: { I9: "http://hl7.org/fhir/sid/icd-9-cm" },
    }),
    generateId: sequentialIds(),
  });
}

/** The bundle as plain JSON, for structural assertions that read like the wire. */
export function bundleJson(result: TransformResult): Record<string, unknown> {
  return JSON.parse(serializeResource(result.bundle)) as Record<string, unknown>;
}

/** Every entry resource of the given `resourceType`, in bundle order, as plain JSON. */
export function resourcesOfType(result: TransformResult, type: string): Record<string, unknown>[] {
  const entries = (bundleJson(result)["entry"] ?? []) as {
    resource?: Record<string, unknown>;
  }[];
  return entries
    .map((e) => e.resource)
    .filter((r): r is Record<string, unknown> => r?.["resourceType"] === type);
}

/** The `fullUrl` of each entry whose resource is of the given type, in bundle order. */
export function fullUrlsOfType(result: TransformResult, type: string): string[] {
  const entries = (bundleJson(result)["entry"] ?? []) as {
    fullUrl?: string;
    resource?: Record<string, unknown>;
  }[];
  return entries.filter((e) => e.resource?.["resourceType"] === type).map((e) => e.fullUrl ?? "");
}

/** `CODE@location#path` for each issue, the shape the suites write their expectations in. */
export function labels(result: TransformResult): string[] {
  return result.issues.map((i) => `${i.code}@${i.v2Location}#${i.fhirPath ?? ""}`);
}

/** Only the issues whose location names the given v2 field or occurrence. */
export function issuesAt(result: TransformResult, location: string): readonly TransformIssue[] {
  return result.issues.filter((i) => i.v2Location === location);
}

/** Every `reference` string anywhere in the serialized bundle. */
export function references(result: TransformResult): string[] {
  const json = serializeResource(result.bundle);
  return [...json.matchAll(/"reference":"([^"]+)"/g)].map((m) => m[1] ?? "");
}

/** Every `fullUrl` in the serialized bundle. */
export function fullUrls(result: TransformResult): Set<string> {
  const json = serializeResource(result.bundle);
  return new Set([...json.matchAll(/"fullUrl":"([^"]+)"/g)].map((m) => m[1] ?? ""));
}

/** The resourceType of each bundle entry, in order. */
export function entryTypes(result: TransformResult): string[] {
  const parsed = parseResource(serializeResource(result.bundle)).resource;
  const entry = getProperty(parsed, "entry");
  if (entry === undefined || !isList(entry)) return [];
  return entry.items.map((e) => {
    const res = isComplex(e) ? getProperty(e, "resource") : undefined;
    const rt = res !== undefined && isComplex(res) ? getProperty(res, "resourceType") : undefined;
    return rt !== undefined && "value" in rt ? String((rt as { value: unknown }).value) : "";
  });
}

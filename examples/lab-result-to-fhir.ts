/**
 * Turn an HL7 v2 ORU^R01 lab result into a FHIR R4 DiagnosticReport and its Observations.
 *
 * OBR becomes the `DiagnosticReport`, each OBX an `Observation` that the report references, and a
 * numeric result keeps its magnitude exactly as sent (`210.50`, never the double 210.5) with its
 * UCUM unit. The segments are the synthetic ones this repository's test fixtures use.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/lab-result-to-fhir.ts
 */

import assert from "node:assert/strict";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|LAB|LABFAC|EHR|HOSP|20260721150000-0500||ORU^R01^ORU_R01|MSG0002|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1||O",
  "OBR|1|PLACER1|FILLER1|24331-1^Lipid Panel^LN|||20260721143000-0500|||||||||||||||20260721150000-0500||LAB|F",
  "OBX|1|NM|2093-3^Cholesterol^LN||210.50|mg/dL^mg/dL^UCUM|<200|H|||F|||20260721143000-0500",
  "OBX|2|CWE|32207-3^Appearance^LN||NORMAL^Normal^L||||||F",
].join("\r");

const { bundle } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
});

const text = serializeResource(bundle);
interface Entry {
  fullUrl: string;
  resource: Record<string, unknown> & { resourceType: string };
}
const entries = (JSON.parse(text) as { entry: Entry[] }).entry;
console.log("Entries:", entries.map((e) => e.resource.resourceType).join(", "));

const report = entries.find((e) => e.resource.resourceType === "DiagnosticReport")?.resource;
const results = (report?.["result"] ?? []) as { reference: string }[];
const observationUrls = entries
  .filter((e) => e.resource.resourceType === "Observation")
  .map((e) => e.fullUrl);
console.log("Report status:", report?.["status"], "| results referenced:", results.length);

// The serialized JSON carries the magnitude as written, which a JavaScript number cannot.
const magnitudeKept = text.includes('"value":210.50');
console.log("Cholesterol magnitude kept as 210.50:", magnitudeKept);

assert.equal(report?.["status"], "final");
assert.deepEqual(
  results.map((r) => r.reference),
  observationUrls,
);
assert.equal(observationUrls.length, 2);
assert.ok(magnitudeKept);
assert.ok(text.includes('"system":"http://unitsofmeasure.org"'));
console.log("lab-result-to-fhir: ok");

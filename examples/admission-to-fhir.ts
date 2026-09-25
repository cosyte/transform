/**
 * Turn a parsed HL7 v2 ADT^A01 admission into a FHIR R4 message Bundle.
 *
 * `@cosyte/hl7` parses the message and `toFhir` assembles a `MessageHeader`, the `Patient` and
 * the `Encounter`, every reference pointing at a `urn:uuid:` fullUrl inside the Bundle. The
 * segments are the synthetic ones this repository's test fixtures use.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/admission-to-fhir.ts
 */

import assert from "node:assert/strict";

import { parseHL7 } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import { createNamingSystem, toFhir } from "@cosyte/transform";

const raw = [
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|I",
].join("\r");

// The naming system says which system URI an assigning authority stands for. Nothing is guessed:
// an authority missing from it leaves the identifier without a system and raises an issue.
const { bundle, issues } = toFhir(parseHL7(raw), {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
});

interface Entry {
  fullUrl: string;
  resource: Record<string, unknown> & { resourceType: string };
}
const json = JSON.parse(serializeResource(bundle)) as { type: string; entry: Entry[] };
const types = json.entry.map((e) => e.resource.resourceType);
console.log("Bundle type:", json.type);
console.log("Entries:", types.join(", "));

const patient = json.entry.find((e) => e.resource.resourceType === "Patient")?.resource;
console.log("Patient:", JSON.stringify(patient));

// Every reference in the Bundle resolves to an entry's fullUrl.
const fullUrls = new Set(json.entry.map((e) => e.fullUrl));
const references = [...serializeResource(bundle).matchAll(/"reference":"([^"]+)"/g)].map(
  (m) => m[1] ?? "",
);
const dangling = references.filter((reference) => !fullUrls.has(reference));
console.log(`References: ${String(references.length)}, dangling: ${String(dangling.length)}`);

// Issues are codes and locations, never values, so they are safe to log.
console.log("Issues:", issues.map((i) => i.code).join(", "));

assert.equal(json.type, "message");
assert.deepEqual(types, ["MessageHeader", "Patient", "Encounter"]);
assert.deepEqual(patient?.["name"], [{ family: "Public", given: ["Jane", "Q"] }]);
assert.equal(patient?.["birthDate"], "1980-01-15");
assert.equal(patient?.["gender"], "female");
assert.ok(references.length > 0);
assert.deepEqual(dangling, []);
console.log("admission-to-fhir: ok");

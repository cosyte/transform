/**
 * Emit an HL7 v2 message from a FHIR R4 Patient, narrowly, and see a missing trigger refused.
 *
 * `toV2Patient` writes only the fields whose mapping inverts one to one, and it needs the v2
 * trigger from you, because no FHIR resource carries one. The result is a complete `@cosyte/hl7`
 * message that parses back. The patient is the synthetic one this repository's test fixtures use.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/fhir-to-v2.ts
 */

import assert from "node:assert/strict";

import { parseHL7 } from "@cosyte/hl7";
import { parseResource } from "@cosyte/fhir";
import { toV2Patient } from "@cosyte/transform";

const { resource } = parseResource(
  JSON.stringify({
    resourceType: "Patient",
    identifier: [
      {
        system: "urn:oid:1.2.840.114350",
        value: "MRN12345",
        type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
      },
    ],
    name: [{ family: "Public", given: ["Jane", "Q"] }],
    birthDate: "1980-01-15",
    gender: "female",
  }),
);

const { value, issues } = toV2Patient(resource, "A28", {
  assigningAuthorities: { "urn:oid:1.2.840.114350": "HOSP" },
  envelope: { sendingApp: "EHR", sendingFacility: "MAIN" },
});
const wire = value?.toString() ?? "";
console.log("Issues:", issues.length === 0 ? "none" : issues.map((i) => i.code).join(", "));
console.log(
  "Segments:",
  wire
    .split("\r")
    .filter(Boolean)
    .map((s) => s.slice(0, 3))
    .join(", "),
);

// The emitted message parses back under the parser that owns the wire format.
const back = parseHL7(wire);
console.log(
  "Parsed back:",
  back.meta.type,
  back.get("PID.3.1"),
  back.get("PID.5.1"),
  back.get("PID.7"),
);

// With no trigger there is no message: one diagnostic, and nothing built.
const refused = toV2Patient(resource, "");
console.log(
  "No trigger:",
  refused.value === undefined ? "no message" : "a message",
  refused.issues.map((i) => i.code).join(", "),
);

assert.deepEqual(issues, []);
assert.equal(back.meta.type, "ADT^A28");
assert.equal(back.get("PID.3.1"), "MRN12345");
assert.equal(back.get("PID.3.4"), "HOSP");
assert.equal(back.get("PID.5.1"), "Public");
assert.equal(back.get("PID.7"), "19800115");
assert.equal(back.get("PID.8"), "F");
assert.equal(refused.value, undefined);
assert.deepEqual(
  refused.issues.map((i) => i.code),
  ["TRANSFORM_MISSING_TRIGGER"],
);
console.log("fhir-to-v2: ok");

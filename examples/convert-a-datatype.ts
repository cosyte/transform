/**
 * Convert single HL7 v2 datatypes to FHIR R4, and see the fail-safe rule refuse to guess.
 *
 * Every converter returns `{ value, issues }`: the FHIR value it could produce faithfully, and a
 * typed, value-free issue for anything it would otherwise have had to guess. The identifiers are
 * the synthetic ones this repository's test fixtures use.
 *
 * Run from the repository root after `pnpm build`:
 *
 *     pnpm tsx examples/convert-a-datatype.ts
 */

import assert from "node:assert/strict";

import { parseDtm } from "@cosyte/hl7";
import { serializeResource } from "@cosyte/fhir";
import {
  createNamingSystem,
  toFhirDateTime,
  toFhirHumanName,
  toFhirIdentifier,
  toFhirQuantity,
  toOperationOutcome,
} from "@cosyte/transform";

// XPN to HumanName: HL7 table 0200 "L" (legal name) maps to FHIR name use "official".
const name = toFhirHumanName({ familyName: "Public", givenName: "Jane", nameTypeCode: "L" });
const nameJson = name.value === undefined ? "" : serializeResource(name.value);
// The name is a person's, so it is read and checked below, never printed. Its use is a code.
const nameUse = (JSON.parse(nameJson) as { use?: string }).use; // "official"
console.log("HumanName use:", nameUse);

// A v2 timestamp with a time of day and no zone: FHIR forbids a time without one, so the value is
// reduced to the date, and an issue says why instead of a zone being guessed.
const naked = toFhirDateTime(parseDtm("202607211430"));
// The value is a date, so only its precision and the issue codes are printed.
console.log(
  "dateTime precision:",
  naked.value?.length === 10 ? "date" : "other",
  naked.issues.map((i) => i.code).join(", "),
);

// An assigning authority with no registered system URI: the identifier keeps its value and gets no
// system, because a system synthesized from a bare namespace could merge two patients.
const cx = { idNumber: "MRN12345", assigningAuthority: { namespaceId: "HOSP" } };
const unresolved = toFhirIdentifier(cx, { namingSystem: createNamingSystem() });
const resolved = toFhirIdentifier(cx, {
  namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:2.16.840.1.113883.19" } }),
});
console.log("Identifier, unregistered authority:", unresolved.issues.map((i) => i.code).join(", "));
// The identifier is a record number, so it is not printed: it is read and checked below.
const identifierSystem = (
  JSON.parse(resolved.value === undefined ? "{}" : serializeResource(resolved.value)) as {
    system?: string;
  }
).system; // "urn:oid:2.16.840.1.113883.19"
console.log("Identifier, registered authority has a system:", identifierSystem !== undefined);

// A unit that is not UCUM is kept as display text only, and the magnitude is never converted.
const quantity = toFhirQuantity(
  { raw: "5.4", value: 5.4 },
  { identifier: "milligrams per deciliter" },
);
// A quantity is a lab measurement tied to a patient, so only its shape is printed.
console.log("Quantity kept:", quantity.value !== undefined);

// Any issue list renders as a FHIR OperationOutcome for a caller that speaks FHIR.
const outcome = JSON.parse(serializeResource(toOperationOutcome(quantity.issues))) as {
  issue: { severity: string; details: { coding: { code: string }[] } }[];
};
console.log(
  "OperationOutcome:",
  JSON.stringify(outcome.issue.map((i) => i.details.coding[0]?.code)),
);

assert.equal(nameJson, '{"use":"official","family":"Public","given":["Jane"]}');
assert.equal(naked.value, "2026-07-21");
assert.deepEqual(
  naked.issues.map((i) => i.code),
  ["TRANSFORM_TIMESTAMP_NO_TIMEZONE"],
);
assert.deepEqual(
  unresolved.issues.map((i) => i.code),
  ["TRANSFORM_IDENTIFIER_SYSTEM_UNRESOLVED"],
);
assert.equal(resolved.issues.length, 0);
assert.deepEqual(
  quantity.issues.map((i) => i.code),
  ["TRANSFORM_UNIT_NOT_UCUM"],
);
assert.deepEqual(
  outcome.issue.map((i) => i.details.coding[0]?.code),
  ["TRANSFORM_UNIT_NOT_UCUM"],
);
console.log("convert-a-datatype: ok");

/**
 * The order-message fixture the TQ1 suite measures **no-regression** against, plus the one runner
 * both the suite and `scripts/capture-tq1-baseline.ts` call, so the bytes compared are the bytes
 * captured.
 *
 * The message below carries **no TQ1 at all**: an `OMP^O09` (segment-assembled, like every real
 * RXO-plus-TQ1 carrier) with a service order and a pharmacy order, exercising the ServiceRequest
 * `occurrenceDateTime` from OBR-6 and the MedicationRequest dose range, dispense request,
 * substitution and route/site that the RXO/RXR path has always produced. The TQ1 work must leave all
 * of it exactly as it was, and "exactly" here means byte for byte and issue for issue.
 */

import { parseHL7 } from "@cosyte/hl7";

import { toFhir, createNamingSystem, type TransformResult } from "../../src/index.js";

/** An order message with no TQ1: the shape the TQ1 change must not perturb in any way. */
export const NO_TQ1_ORDER: readonly string[] = [
  "MSH|^~\\&|CPOE|HOSP|LAB|HOSP|20260721150000-0500||OMP^O09|MSGPIN1|P|2.5.1",
  "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F",
  "PV1|1|O",
  "ORC|NW|PLACER1|FILLER1||||||20260721140000-0500",
  "OBR|1|||24331-1^Lipid Panel^LN|R|20260722080000-0500",
  "ORC|NW|PLACER2|FILLER2||||||20260721141000-0500",
  "RXO|197361^Amoxicillin 250 MG Oral Tablet^RXNORM|250|500|mg^milligram^UCUM|||||G||30|tab^tablet^UCUM|2",
  "RXR|PO^Oral^HL70162|ARM^Arm^HL70550",
];

/**
 * Run one order fixture through `toFhir` with a fixed NamingSystem registry and a deterministic
 * fullUrl allocator, so two runs of the same message on two trees are comparable byte for byte.
 */
export function runOrderFixture(lines: readonly string[]): TransformResult {
  let n = 0;
  return toFhir(parseHL7(lines.join("\r")), {
    namingSystem: createNamingSystem({ authorities: { HOSP: "urn:oid:1.2.840.114350" } }),
    generateId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  });
}

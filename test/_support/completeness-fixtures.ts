/**
 * The fixture corpus for the message-level completeness diagnostic, plus the fixed transform options
 * every one of them is run under.
 *
 * Two consumers read this module and they must read the SAME bytes:
 *
 * - `scripts/capture-completeness-goldens.ts`, which recorded each fixture's Bundle and issues list
 *   from the tree as it stood BEFORE the completeness diagnostic existed, into
 *   `completeness-goldens.json`; and
 * - `test/messages/segment-completeness.test.ts`, which asserts the new behaviour against those
 *   baselines (the Bundle byte-identical, the pre-existing issues first and in their recorded order).
 *
 * So `raw` is the exact wire bytes, trailing segment terminator included or deliberately absent, and
 * a fixture is never edited in place: a changed input is a new id, because the baseline was captured
 * from the old bytes and cannot be recaptured from a tree that already carries the change. The `what`
 * line is prose about the input rather than part of it, and is kept true as the library grows: an
 * input whose baseline a later change supersedes is declared in `segment-completeness.test.ts`,
 * which proves the difference is exactly that change.
 *
 * **Every person-identifying literal here is drawn from `scripts/phi-allow-list.txt`**, and the one
 * fixture that needs unique values per field builds them by template interpolation, which the PHI
 * scanner skips by design. Nothing in this file needs `phi-scan-overrides.md` touched.
 */

import { parseHL7 } from "@cosyte/hl7";

import { createNamingSystem } from "../../src/terminology/naming-system.js";
import { toFhir, type TransformResult } from "../../src/messages/to-fhir.js";

/** One recorded input: its id, what it is for, and the exact bytes handed to the parser. */
export interface CompletenessFixture {
  /** Stable id: the key under which this input's baseline is recorded. */
  readonly id: string;
  /** What the input exists to pin down, in one line. */
  readonly what: string;
  /** The exact wire bytes, trailing segment terminator included or deliberately absent. */
  readonly raw: string;
}

const CR = "\r";

/** Join lines with the segment terminator and terminate the message the conventional way. */
function message(lines: readonly string[]): string {
  return lines.join(CR) + CR;
}

/** Join lines with the segment terminator and leave the message unterminated. */
function unterminated(lines: readonly string[]): string {
  return lines.join(CR);
}

const MSH_ADT_A01 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT^A01^ADT_A01|MSG00001|P|2.5.1";
const MSH_ADT_NO_TRIGGER =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ADT|MSG00002|P|2.5.1";
const MSH_ORM_O01 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ORM^O01|MSG00003|P|2.5.1";
const MSH_ORU_R01 =
  "MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||ORU^R01|MSG00004|P|2.5.1";

const PID_JANE = "PID|1||MRN12345^^^HOSP^MR||Public^Jane^Q||19800115|F";
/** A PV1 whose patient class grounds `Encounter.class`, so the Encounter passes the emit gate. */
const PV1_INPATIENT = "PV1|1|I";
/** A PV1 with no patient class: the Encounter is built and then WITHHELD by the emit gate. */
const PV1_NO_CLASS = "PV1|1";
/** An OBR whose OBR-25 result status grounds `DiagnosticReport.status`. */
const OBR_FINAL = `OBR|1|PLC1|FIL1|CBC^Complete^LN${"|".repeat(21)}F`;

/**
 * The unique per-field tokens of the value-free fixture. Interpolated rather than written inline so
 * the PHI scanner's structured pass skips the components (it skips any component containing `${`),
 * which is what keeps this fixture off `scripts/phi-allow-list.txt` and out of any override file.
 */
export const UNIQUE_FIELD_TOKENS: readonly string[] = Object.freeze(
  Array.from({ length: 16 }, (_unused, i) => `UQ${String(i + 1).padStart(4, "0")}`),
);

function uq(n: number): string {
  return UNIQUE_FIELD_TOKENS[n - 1] ?? "";
}

const UNIQUE_TOKEN_MESSAGE = message([
  `MSH|^~\\&|${uq(1)}|${uq(2)}|${uq(3)}|${uq(4)}|20260721143000-0500||ADT^A01|${uq(5)}|P|2.5.1`,
  `PID|1||${uq(6)}^^^${uq(7)}^MR||${uq(8)}^${uq(9)}||19800115|F`,
  `AL1|1|${uq(10)}|${uq(11)}^${uq(12)}^L`,
  `ZQQ|${uq(13)}|${uq(14)}`,
  `IN3|${uq(15)}|${uq(16)}`,
]);

/**
 * Every recorded input, in the order the baselines were captured.
 *
 * @example
 * ```ts
 * import { COMPLETENESS_FIXTURES } from "./completeness-fixtures.js";
 * COMPLETENESS_FIXTURES.length > 0; // true
 * ```
 */
export const COMPLETENESS_FIXTURES: readonly CompletenessFixture[] = Object.freeze([
  {
    id: "ig-mapped-unhandled",
    what: "an ADT carrying an AL1 and a DG1: two segments the IG maps, of which the DG1 is still unread",
    raw: message([MSH_ADT_A01, PID_JANE, "AL1|1|DA|PEN^Penicillin^L", "DG1|1|I9|250.00^Diab^I9"]),
  },
  {
    id: "unclassifiable-names",
    what: "a Z-segment plus four lines whose segment identifier is damaged beyond classification",
    raw: message([
      MSH_ADT_A01,
      PID_JANE,
      "ZAL|zed",
      "DOE^JOHN^Q|20260721143000-0500",
      "202",
      "AL11|1|DA|PEN^Penicillin^L",
    ]),
  },
  {
    id: "separator-free-malformed",
    what: "a damaged line carrying no field separator at all: content without a classifiable name",
    raw: message([MSH_ADT_A01, PID_JANE, "202"]),
  },
  {
    id: "consumed-values-dropped",
    what: "an NK1 whose only populated field is dropped by the terminology step, resource still emitted",
    raw: message([MSH_ADT_A01, PID_JANE, "NK1|1||SPO"]),
  },
  {
    id: "all-reaching-terminated",
    what: "every occurrence reaches an emitted resource, message terminated the conventional way",
    raw: message([MSH_ADT_A01, PID_JANE, PV1_INPATIENT]),
  },
  {
    id: "all-reaching-unterminated",
    what: "the same message with no trailing segment terminator at all",
    raw: unterminated([MSH_ADT_A01, PID_JANE, PV1_INPATIENT]),
  },
  {
    id: "all-reaching-doubled-terminator",
    what: "the same message ending in two terminators, so the parser keeps a trailing empty position",
    raw: message([MSH_ADT_A01, PID_JANE, PV1_INPATIENT]) + CR,
  },
  {
    id: "blank-line-between-reaching",
    what: "two consecutive terminators between two segments that both reach an emitted resource",
    raw: message([MSH_ADT_A01, PID_JANE, "", PV1_INPATIENT]),
  },
  {
    id: "blank-line-then-named",
    what: "a blank position followed by a well-formed segment the library never reads",
    raw: message([MSH_ADT_A01, PID_JANE, "", "DG1|1|I9|250.00^Diab^I9"]),
  },
  {
    id: "blank-line-then-malformed",
    what: "a blank position followed by a damaged line, whose ordinal must count the blank",
    raw: message([MSH_ADT_A01, PID_JANE, "", "202"]),
  },
  {
    id: "separator-leading-line",
    what: "a line whose segment identifier was eaten but whose field separator and data survived",
    raw: message([MSH_ADT_A01, PID_JANE, "|SMITH^JOHN|20260721143000-0500"]),
  },
  {
    id: "adt-obx",
    what: "an OBX on the ADT path, which the assembly never reads although it emits Observation elsewhere",
    raw: message([MSH_ADT_A01, PID_JANE, "OBX|1|NM|GLU^Glucose^LN||99|mg|||||F"]),
  },
  {
    id: "three-dg1",
    what: "three occurrences of one name, none of them consumed",
    raw: message([
      MSH_ADT_A01,
      PID_JANE,
      "DG1|1|I9|250.00^Diab^I9",
      "DG1|2|I9|401.9^Hyp^I9",
      "DG1|3|I9|272.0^Chol^I9",
    ]),
  },
  {
    id: "two-nk1-second-unbuilt",
    what: "two NK1 occurrences where only the first yields a RelatedPerson in the returned Bundle",
    raw: message([MSH_ADT_A01, PID_JANE, "NK1|1|Kin^Next|SPO", "NK1|2"]),
  },
  {
    id: "orm-read-and-refused",
    what: "an order the assembly reads and refuses: the ORC and RXO build a request, the RXE is counted",
    raw: message([
      MSH_ORM_O01,
      PID_JANE,
      "ORC|NW|PLC1|FIL1",
      "RXO|MED1^Drug^L|1||mg",
      "RXE|1^Q6H|MED1^Drug^L|1",
    ]),
  },
  {
    id: "orm-two-refused",
    what: "the same order with a second RXE, so the count-based issue stays at one",
    raw: message([
      MSH_ORM_O01,
      PID_JANE,
      "ORC|NW|PLC1|FIL1",
      "RXO|MED1^Drug^L|1||mg",
      "RXE|1^Q6H|MED1^Drug^L|1",
      "RXE|2^Q8H|MED2^Drug2^L|2",
    ]),
  },
  {
    id: "oru-orphan-obx",
    what: "an ORU whose first OBX precedes any OBR, so no report anchors it",
    raw: message([
      MSH_ORU_R01,
      PID_JANE,
      "OBX|1|NM|GLU^Glucose^LN||99|mg|||||F",
      OBR_FINAL,
      "OBX|2|NM|HGB^Hemoglobin^LN||14|g|||||F",
    ]),
  },
  {
    id: "oru-two-orphan-obx",
    what: "the same ORU with two orphan OBX, so the count-based issue stays at one",
    raw: message([
      MSH_ORU_R01,
      PID_JANE,
      "OBX|1|NM|GLU^Glucose^LN||99|mg|||||F",
      "OBX|2|NM|K^Potassium^LN||4|mmol|||||F",
      OBR_FINAL,
      "OBX|3|NM|HGB^Hemoglobin^LN||14|g|||||F",
    ]),
  },
  {
    id: "encounter-withheld",
    what: "a PV1 whose Encounter is built and then withheld by the emit gate",
    raw: message([MSH_ADT_A01, PID_JANE, PV1_NO_CLASS]),
  },
  {
    id: "nothing-emitted",
    what: "a message with no trigger event, so even the MessageHeader is withheld and the Bundle is empty",
    raw: message([MSH_ADT_NO_TRIGGER, "DG1|1|I9|250.00^Diab^I9"]),
  },
  {
    id: "bare-msh",
    what: "the minimal message: an MSH and nothing else",
    raw: message([MSH_ADT_A01]),
  },
  {
    id: "eleven-silent-segments",
    what: "eleven segment names the assembly did not read when this input was recorded, in one message",
    raw: message([
      MSH_ADT_A01,
      "SFT|VENDOR|1.0|PRODUCT",
      "EVN|A01|20260721143000-0500",
      PID_JANE,
      "AL1|1|DA|PEN^Penicillin^L",
      "IAM|1|DA|PEN^Penicillin^L",
      "DG1|1|I9|250.00^Diab^I9",
      "PR1|1|I9|4491^Proc^I9",
      "IN1|1|PLAN1^Plan^L",
      "IN3|1|CERT1",
      "SPM|1|SPEC1",
      "PRT|1|AD",
      "ROL|1|AD|AT",
    ]),
  },
  {
    id: "unique-field-tokens",
    what: "every field value a token unique to this input, for the value-free assertion",
    raw: UNIQUE_TOKEN_MESSAGE,
  },
]);

/** Look up one recorded input's bytes by id, or throw if the id is not in the corpus. */
export function fixtureRaw(id: string): string {
  const found = COMPLETENESS_FIXTURES.find((f) => f.id === id);
  if (found === undefined) throw new Error(`no completeness fixture with id ${id}`);
  return found.raw;
}

/** A deterministic `urn:uuid` allocator, so a captured baseline is reproducible byte for byte. */
function sequentialIds(): () => string {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
}

/**
 * Run one recorded input through the message-level transform under the fixed options every baseline
 * was captured with: the default NamingSystem registry and a deterministic id allocator.
 *
 * @param raw - The exact wire bytes of the input.
 * @example
 * ```ts
 * import { fixtureRaw, runCompletenessFixture } from "./completeness-fixtures.js";
 * runCompletenessFixture(fixtureRaw("bare-msh")).issues.length >= 0; // true
 * ```
 */
export function runCompletenessFixture(raw: string): TransformResult {
  return toFhir(parseHL7(raw), {
    namingSystem: createNamingSystem(),
    generateId: sequentialIds(),
  });
}

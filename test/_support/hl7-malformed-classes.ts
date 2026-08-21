/**
 * The four malformed-input CLASSES, authored as synthetic inputs and carried here so the same
 * literals feed the fail-safe suite and the before/after refresh capture.
 *
 * ▶ SYNTHETIC BY CONSTRUCTION, AND DELIBERATELY EMPTY OF PERSON DATA. None of these four carries a
 *   name, a date of birth, an address, a telephone number or an identifier: the classes are about
 *   STRUCTURE, so the inputs are structure and nothing else. That is why none of them needs an
 *   entry in `scripts/phi-allow-list.txt`, and it is what makes their diagnostics quotable in a
 *   record without quoting patient data.
 *
 * ▶ AUTHORED BEFORE THE DEPENDENCY MOVES, NOT AFTER. Each one is a corpus member exactly like a
 *   repository fixture, so each has a measured pre-refresh behaviour to compare a refreshed
 *   dependency against, rather than only a post-refresh assertion.
 */

/** One authored input: the class it stands for, why it is in that class, and the exact bytes. */
export interface MalformedClassInput {
  /** The class this input stands for. */
  readonly id: "malformed" | "truncated" | "empty" | "wrong-version";
  /** Why this input belongs to that class, in one line. */
  readonly why: string;
  /** The exact bytes handed to `parseHL7`. */
  readonly raw: string;
}

/**
 * One input per class, in class order.
 *
 * `wrong-version` uses the "outside the set the package supports" limb rather than the absent or
 * malformed limb: this package is grounded on HL7 v2.5.1 throughout (`src/reverse/message.ts`,
 * `src/reverse/patient.ts`, `src/reverse/observation.ts` and the banner in `scripts/phi-scan.ts`
 * all cite the v2.5.1 segment attribute tables), and `9.9` is a version no published HL7 v2 release
 * carries.
 */
export const MALFORMED_CLASS_INPUTS: readonly MalformedClassInput[] = [
  {
    id: "malformed",
    why: "MSH-2 carries two encoding characters where the standard requires four (or five from v2.7): a field-structure violation in the header that defines how every later field is read.",
    raw: "MSH|^~|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1",
  },
  {
    id: "truncated",
    why: "the byte stream stops part way through PV1: PV1-3 ends after its second component separator and PV1-4 onward never arrive.",
    raw: "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|2.5.1\rPV1|1|I|ICU^101^",
  },
  {
    id: "empty",
    why: "zero-length input.",
    raw: "",
  },
  {
    id: "wrong-version",
    why: "MSH-12 declares 9.9, which is outside the HL7 v2 releases this package is grounded on.",
    raw: "MSH|^~\\&|A|B|C|D|20260101||ADT^A01|M1|P|9.9",
  },
];

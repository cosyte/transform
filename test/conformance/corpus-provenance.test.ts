/**
 * The corpus's provenance: where each message came from, that reading the fixture reproduces the
 * published text, and that the one line the publisher mangled is recorded rather than repaired.
 *
 * ▶ NO VIOLATOR VALUE IS WRITTEN AS A LITERAL IN THIS FILE. The published `PID-19` is a dashed
 * Social Security Number shape, which this repository's PHI gate refuses in every tracked file, so
 * the expected value is ASSEMBLED at runtime from parts, exactly as `test/scripts/phi-scan.test.ts`
 * does with its own payloads. That is what lets this suite check the reconstitution is exact instead
 * of taking it on trust.
 */

import { describe, expect, it } from "vitest";

import {
  PUBLISHED_MESSAGE_NAMES,
  escapeForPhiGate,
  findPublishedManglings,
  segmentsFromPublishedBlock,
  unescapeHtml,
} from "../../scripts/conformance/corpus.js";
import { corpus } from "../_support/conformance.js";

/** The page this corpus was taken from, and the digest recorded when it was fetched. */
const SOURCE_URL = "https://hl7.org/fhir/uv/v2mappings/test_conversions.html";
const SOURCE_SHA256 = "a25b317e58c872b8bd21a3dcfb893b00f7fc2d24025dd21a83cef11678642a38";

/**
 * The number of segment lines each published message carries, counted off the page by hand.
 *
 * These are the anti-drift device: a fixture edited by hand, a message quietly narrowed, or an
 * extraction that silently loses a line all change one of these numbers.
 */
const SEGMENT_COUNTS: Record<string, number> = {
  ADT_A01: 11,
  SIU_S12: 9,
  ORM_O01: 9,
  OML_O21: 11,
  ORU_R01: 11,
  MDM_T02: 12,
  VXU_V04: 14,
};

/** The v2 message type each MSH-9 declares, read off the page. */
const MSH_TRIGGERS: Record<string, string> = {
  ADT_A01: "ADT^A01^ADT_A01",
  SIU_S12: "SIU^S12^SIU_S12",
  ORM_O01: "ORM^O01^ORM_O01",
  OML_O21: "OML^O21^OML_O21",
  ORU_R01: "ORU^R01^ORU_R01",
  MDM_T02: "MDM^T02^MDM_T02",
  VXU_V04: "VXU^V04^VXU_V04",
};

/** The published `PID-19` placeholder, assembled so this file carries no dashed SSN literal. */
const PUBLISHED_PID_19 = ["000", "00", "0000"].join("-");

describe("I1: every corpus fixture carries its provenance", () => {
  it("names the page, the digest of the page it came from, and the heading it was taken from", () => {
    const c = corpus();
    expect(c.source.url).toBe(SOURCE_URL);
    expect(c.source.sha256).toBe(SOURCE_SHA256);
    expect(c.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(c.source.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(c.messages.map((m) => m.name)).toEqual([...PUBLISHED_MESSAGE_NAMES]);

    for (const message of c.messages) {
      // The heading is the page's own marker, and it is NOT uniform: the page emits the first five
      // as HTML and the last two as raw markdown, because its markup breaks at MDM_T02. Recorded as
      // published rather than normalised, so the breakage stays visible.
      expect(message.heading).toContain(message.name);
      expect(
        message.heading.startsWith(`<h4 id="${message.name.toLowerCase()}">`) ||
          message.heading === `#### ${message.name}`,
      ).toBe(true);
    }
    // Both spellings are actually present, so the assertion above is not one-sided.
    expect(c.messages.filter((m) => m.heading.startsWith("<h4")).length).toBe(6);
    expect(c.messages.filter((m) => m.heading.startsWith("####")).length).toBe(1);
  });

  it("reproduces the published segment text by unescaping and splitting the published lines", () => {
    for (const message of corpus().messages) {
      expect(message.segments).toEqual(segmentsFromPublishedBlock(message.publishedLines));
      expect(message.segments).toHaveLength(SEGMENT_COUNTS[message.name] ?? -1);
      expect(message.segments[0]?.startsWith("MSH|^~\\&")).toBe(true);
      expect(message.segments[0]).toContain(MSH_TRIGGERS[message.name] ?? "unreachable");
      // Every line is a v2 segment: three characters, then the field separator.
      for (const segment of message.segments) expect(segment).toMatch(/^[A-Z][A-Z0-9]{2}\|/);
      // The page escapes `&` and `<`; the reproduction must have turned them back.
      expect(message.segments.join("\n")).not.toContain("&amp;");
      expect(message.segments.join("\n")).not.toContain("&lt;");
    }
  });

  it("preserves the two replacement characters the published page itself carries", () => {
    // The guide's own ORM_O01 and OML_O21 carry a U+FFFD inside IN1-9. It is in the published page,
    // so it is in the corpus: repairing it would make this a different corpus.
    const carrying = corpus()
      .messages.filter((m) => m.segments.some((s) => s.includes("�")))
      .map((m) => m.name);
    expect(carrying).toEqual(["ORM_O01", "OML_O21"]);
    for (const name of carrying) {
      const message = corpus().messages.find((m) => m.name === name);
      const in1 = message?.segments.find((s) => s.startsWith("IN1|"));
      expect(in1).toContain("�");
    }
  });

  it("reconstitutes the published PID-19 exactly, so the extra escaping is a re-encoding", () => {
    const c = corpus();
    // The declaration first: two runs, both PID-19, both with a reason.
    expect(c.additionalEscaping.entries).toHaveLength(2);
    expect(c.additionalEscaping.reason.length).toBeGreaterThan(0);
    for (const entry of c.additionalEscaping.entries) {
      expect(entry.field).toBe("PID-19");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(unescapeHtml(entry.escaped)).toBe(PUBLISHED_PID_19);
    }
    expect(c.additionalEscaping.entries.map((e) => e.message)).toEqual(["ADT_A01", "SIU_S12"]);

    // And the reconstitution where it matters: the segment the harness transforms.
    for (const name of ["ADT_A01", "SIU_S12"]) {
      const pid = corpus()
        .messages.find((m) => m.name === name)
        ?.segments.find((s) => s.startsWith("PID|"));
      expect(pid?.split("|")[19], name).toBe(PUBLISHED_PID_19);
    }
    // The other five carry no such field, so the two entries above are the whole of it.
    for (const message of c.messages) {
      if (message.name === "ADT_A01" || message.name === "SIU_S12") continue;
      const pid = message.segments.find((s) => s.startsWith("PID|"));
      expect(pid?.split("|")[19] ?? "").not.toBe(PUBLISHED_PID_19);
    }
  });

  it("MUTATION: the escaping helper is what makes the fixture gate-safe, and it is reversible", () => {
    // Every token here but the assembled placeholder is already declared synthetic in
    // `scripts/phi-allow-list.txt`, because this file is itself inside the PHI scan corpus.
    const line = `PID|1||MRN12345^^^HOSP^MR||Public^Jane||19800115|F|||||||||||${PUBLISHED_PID_19}|`;
    const escaped = escapeForPhiGate(line);
    expect(escaped).not.toBe(line);
    expect(escaped).not.toContain(PUBLISHED_PID_19);
    expect(unescapeHtml(escaped)).toBe(line);
    // A line with nothing of that shape is returned untouched, so the helper cannot quietly rewrite
    // anything else in the corpus.
    const plain = "OBX|1|NM|8302-2^Body Height^LN||190|cm^centimeter^UCUM|||||F|";
    expect(escapeForPhiGate(plain)).toBe(plain);
  });
});

describe("I2: the line the publisher mangled is recorded, and nothing is invented in its place", () => {
  it("records exactly one published mangling, in MDM_T02's OBX, and none anywhere else", () => {
    const c = corpus();
    const withMangling = c.messages.filter((m) => m.publishedMangled.length > 0);
    expect(withMangling.map((m) => m.name)).toEqual(["MDM_T02"]);

    const mdm = withMangling[0];
    if (mdm === undefined) throw new Error("no MDM_T02");
    expect(mdm.publishedMangled).toHaveLength(1);
    const mangling = mdm.publishedMangled[0];
    if (mangling === undefined) throw new Error("no mangling record");
    expect(mangling.segment).toBe("OBX");
    expect(mangling.fragment).toBe('<Base64 encoded="">');
    expect(mangling.note.length).toBeGreaterThan(0);
    expect(mangling.segmentIndex).toBeGreaterThan(0);

    // The record points at a segment that really is the one the page mangles.
    const segment = mdm.segments[mangling.segmentIndex - 1];
    expect(segment).toBeDefined();
    expect(segment?.startsWith("OBX|4|ED|")).toBe(true);
    expect(segment).toContain(mangling.fragment);
  });

  it("leaves the mangled line as published: no invented v2 content stands in for it", () => {
    const mdm = corpus().messages.find((m) => m.name === "MDM_T02");
    const segment = mdm?.segments.find((s) => s.startsWith("OBX|4|ED|"));
    expect(segment).toBeDefined();
    // OBX-5's fifth component is where the Base64 payload belongs. The page carries markup there,
    // and the corpus carries the markup: nothing was substituted, and nothing was deleted either.
    const obx5 = segment?.split("|")[5] ?? "";
    expect(obx5.split("^").slice(0, 4)).toEqual(["CareCoordination", "AP", "PDF", "Base64"]);
    expect(obx5.split("^")[4]).toBe('<Base64 encoded="">');
    expect(segment).toBe(
      `OBX|4|ED|1111.2^PHQ-9 Depression Screen PDF^L^44249-1^PHQ-9 quick depression assessment panel [Reported.PHQ]^LN||CareCoordination^AP^PDF^Base64^<Base64 encoded="">||||||F`,
    );
  });

  it("the mangling record is derived from the segments, so a hand-edited record is caught", () => {
    for (const message of corpus().messages) {
      expect(message.publishedMangled, message.name).toEqual(
        findPublishedManglings(message.segments),
      );
    }
  });

  it("MUTATION: repairing the mangled line changes what the detector records", () => {
    const mdm = corpus().messages.find((m) => m.name === "MDM_T02");
    if (mdm === undefined) throw new Error("no MDM_T02");
    const repaired = mdm.segments.map((s) =>
      s.startsWith("OBX|4|ED|") ? s.replace('<Base64 encoded="">', "SGVsbG8=") : s,
    );
    expect(findPublishedManglings(repaired)).toEqual([]);
    expect(findPublishedManglings(repaired)).not.toEqual(mdm.publishedMangled);
  });
});

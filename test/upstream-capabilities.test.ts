/**
 * What the parser tier makes available to this package, asserted rather than described.
 *
 * Two capabilities were recorded as ABSENT when the reverse direction shipped, and both absences
 * shaped what this package does today: there was no ADT assembly entry point, so the visit-carrying
 * `Patient` + `Encounter` ADT was deferred rather than hand-assembled here (which would have
 * inverted the tier split), and there was no typed composite encoder, so `src/reverse/v2.ts` hands
 * the serializer hand-built `RawField` component arrays.
 *
 * Both are present now. This suite is the EVIDENCE for that, kept as a compiling, running call
 * rather than a claim in a document: a reader can re-derive the answer by running it.
 *
 * ▶ IT IS A PROBE, NOT AN ADOPTION. Nothing here changes what `@cosyte/transform` emits, and
 *   neither capability is used by `src/`: the deferred ADT shape stays deferred and the reverse
 *   path keeps building its `RawField`s by hand. Moving either is a change to transformation logic
 *   and belongs to the work that decides to make it, not to a dependency refresh.
 */
import { describe, expect, it } from "vitest";

import { buildAdt, encodeComposite, parseHL7, type BuildAdtInit, type RawField } from "@cosyte/hl7";

describe("@cosyte/hl7 exposes an ADT message builder", () => {
  it("exports buildAdt as a callable function", () => {
    expect(typeof buildAdt).toBe("function");
  });

  it("assembles a PID + PV1 ADT that reads back the values it was given", () => {
    const init: BuildAdtInit = {
      sendingApp: "SENDAPP",
      receivingApp: "RCVAPP",
      patient: {
        identifiers: { idNumber: "MRN1", identifierTypeCode: "MR" },
        name: { familyName: "Doe", givenName: "Jane" },
        birthDateTime: "19900101",
        administrativeSex: "F",
      },
      visit: { patientClass: "I" },
    };
    const msg = buildAdt("A01", init);
    const wire = msg.toString();
    expect(wire.startsWith("MSH|")).toBe(true);
    expect(wire).toContain("PID|");
    expect(wire).toContain("PV1|");

    // It round-trips through the parser this package consumes, which is what makes it usable here.
    const round = parseHL7(wire);
    expect(round.meta.messageCode).toBe("ADT");
    expect(round.meta.triggerEvent).toBe("A01");
    expect(round.patient?.familyName).toBe("Doe");
    expect(round.visit?.patientClass).toBe("I");
  });
});

describe("@cosyte/hl7 exposes a typed composite encoder", () => {
  it("exports encodeComposite as a callable function", () => {
    expect(typeof encodeComposite).toBe("function");
  });

  it("encodes a composite this package's reverse path builds by hand today", () => {
    const field: RawField = encodeComposite("XPN", { familyName: "Doe", givenName: "Jane" });
    expect(field).toBeDefined();
  });

  it("escapes a delimiter inside a component instead of splitting the composite", () => {
    // The property `src/reverse/v2.ts` relies on the serializer for: a family name carrying `^`
    // must not become two components.
    const msg = buildAdt("A01", {
      sendingApp: "SENDAPP",
      receivingApp: "RCVAPP",
      patient: { name: { familyName: "Do^e", givenName: "Jane" } },
    });
    const round = parseHL7(msg.toString());
    expect(round.patient?.familyName).toBe("Do^e");
  });
});

// The inputs the benchmarks, the profile and the scaling gates share, in the shapes real traffic has.
// Every one is synthetic and built here in code from an index: no file is read, and every name,
// identifier and value is made up (the person-identifying literals are the ones
// scripts/phi-allow-list.txt names).
//
// v2 to FHIR:
// - an ADT^A01 admission of 15 segments, about 1 KiB: the message a feed sends all day;
// - an HL7 batch of those admissions, FHS/BHS to BTS/FTS: what a nightly or catch-up file carries;
// - an ORU^R01 lab result with many OBX lines: the dense large message;
// - an MDM^T02 whose note is many OBX TX lines: a long clinical document, the shape a C-CDA's
//   narrative reaches v2 in;
// - an ORU^R01 carrying one base64 PDF in an OBX of type ED: the large opaque payload.
// FHIR to v2:
// - a searchset Bundle of Observations, each written back to an ORU^R01 OBX;
// - a Patient, written back to an ADT^A28.

export const KIB = 1024;

const SEGMENT_SEPARATOR = "\r";

/** One segment, each value at its 1-indexed field position, so no fixture miscounts its pipes. */
export function seg(name, fields) {
  const positions = Object.keys(fields).map(Number);
  const max = positions.length === 0 ? 0 : Math.max(...positions);
  const parts = [name];
  for (let i = 1; i <= max; i++) parts.push(fields[i] ?? "");
  return parts.join("|");
}

/** The MSH of message `i`, for `type` (for example `ADT^A01^ADT_A01`). */
function msh(type, i) {
  return `MSH|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500||${type}|MSG${String(i).padStart(8, "0")}|P|2.5.1`;
}

/** A PID for message `i`: one of the allow-listed synthetic identities. */
function pid() {
  return seg("PID", {
    1: "1",
    3: "MRN12345^^^HOSP^MR",
    5: "Public^Jane^Q^^^^L",
    7: "19800115",
    8: "F",
    11: "123 Main St^Apt 4^Boston^MA^02101^USA^H",
    13: "^PRN^PH^^^617^5551234",
  });
}

/** The segments of a synthetic ADT^A01 admission: 15 segments, about 1 KiB. */
function adtSegments(i) {
  return [
    msh("ADT^A01^ADT_A01", i),
    seg("EVN", { 1: "A01", 2: "20260721143000-0500" }),
    pid(),
    seg("NK1", {
      1: "1",
      2: "Doe^John^^^^^L",
      3: "SPO^Spouse^HL70063",
      4: "456 Oak Ave^^Boston^MA^02101^USA^H",
    }),
    seg("PV1", {
      1: "1",
      2: "I",
      3: "WARD^101^A^HOSP",
      4: "E",
      7: "DOC123^Doe^Amy^^^^MD",
      10: "MED",
      19: `V${String(i).padStart(8, "0")}^^^HOSP^VN`,
      44: "20260721143000-0500",
    }),
    seg("PV2", { 3: "^Chest pain" }),
    seg("AL1", { 1: "1", 2: "DA", 3: "70618^Penicillin^RXNORM", 4: "SV", 5: "Hives" }),
    seg("AL1", { 1: "2", 2: "FA", 3: "256349002^Peanut^SCT", 4: "MO", 5: "Rash" }),
    seg("DG1", {
      1: "1",
      3: "R07.9^Chest pain, unspecified^I10",
      5: "20260721143000-0500",
      6: "A",
    }),
    seg("DG1", {
      1: "2",
      3: "I10^Essential hypertension^I10",
      5: "20260721143000-0500",
      6: "W",
    }),
    seg("PR1", {
      1: "1",
      3: "93000^Electrocardiogram^C4",
      5: "20260721150000-0500",
      6: "A",
    }),
    seg("OBX", {
      1: "1",
      2: "NM",
      3: "8867-4^Heart rate^LN",
      5: "88",
      6: "/min^/min^UCUM",
      11: "F",
    }),
    seg("OBX", {
      1: "2",
      2: "NM",
      3: "8480-6^Systolic blood pressure^LN",
      5: "142",
      6: "mm[Hg]^mm[Hg]^UCUM",
      8: "H",
      11: "F",
    }),
    seg("IN1", {
      1: "1",
      2: "PLAN01^Gold PPO^HL70072",
      3: "INSCO1^^^HOSP^XX",
      4: "Example Health Plan",
      12: "20260101",
      13: "20261231",
      17: "SEL^Self^HL70063",
      36: "POL0001",
    }),
    seg("GT1", { 1: "1", 3: "Public^Jane^Q" }),
  ];
}

/** A synthetic ADT^A01 admission of 15 segments, about 1 KiB: what a feed sends all day. */
export function admission(i) {
  return adtSegments(i).join(SEGMENT_SEPARATOR);
}

/**
 * A synthetic HL7 batch file of `messages` admissions: FHS and BHS, the messages, then BTS and FTS
 * with the count. `@cosyte/hl7`'s `splitBatch` splits it into its messages.
 */
export function admissionBatch(i, messages) {
  const lines = [
    "FHS|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500",
    "BHS|^~\\&|SENDAPP|SENDFAC|RCVAPP|RCVFAC|20260721143000-0500",
  ];
  for (let k = 0; k < messages; k++) lines.push(admission(i * messages + k));
  lines.push(`BTS|${String(messages)}`, "FTS|1");
  return lines.join(SEGMENT_SEPARATOR);
}

/** The OBX lines of a lab result, cycling through four analytes so a result is not one line repeated. */
const ANALYTES = [
  [
    "2093-3^Cholesterol^LN",
    "NM",
    (k) => `${String(150 + (k % 90))}.${String(k % 10)}0`,
    "mg/dL^mg/dL^UCUM",
    "<200",
  ],
  [
    "718-7^Hemoglobin^LN",
    "NM",
    (k) => `${String(11 + (k % 6))}.${String(k % 10)}`,
    "g/dL^g/dL^UCUM",
    "12.0-16.0",
  ],
  ["5778-6^Color of Urine^LN", "CWE", () => "YELLOW^Yellow^L", "", ""],
  ["8251-1^Service comment^LN", "ST", (k) => `Specimen ${String(k)} received`, "", ""],
];

function resultLine(k) {
  const [code, type, value, units, range] = ANALYTES[k % ANALYTES.length];
  return seg("OBX", {
    1: String(k + 1),
    2: type,
    3: code,
    5: value(k),
    6: units,
    7: range,
    8: type === "NM" && k % 7 === 0 ? "H" : "",
    11: "F",
    14: "20260721143000-0500",
  });
}

/** The head of an ORU^R01: MSH, PID, PV1, ORC and OBR. */
function oruHead(i, service) {
  return [
    msh("ORU^R01^ORU_R01", i),
    pid(),
    seg("PV1", { 1: "1", 2: "O" }),
    seg("ORC", { 1: "RE", 2: `PLC${String(i)}`, 3: `FIL${String(i)}` }),
    seg("OBR", {
      1: "1",
      2: `PLC${String(i)}`,
      3: `FIL${String(i)}`,
      4: service,
      7: "20260721143000-0500",
      22: "20260721150000-0500",
      24: "LAB",
      25: "F",
    }),
  ];
}

/** A synthetic ORU^R01 lab result of `results` OBX lines: the dense shape. */
export function labResult(i, results) {
  const lines = oruHead(i, "24331-1^Lipid Panel^LN");
  for (let k = 0; k < results; k++) lines.push(resultLine(k));
  return lines.join(SEGMENT_SEPARATOR);
}

/** A line of a synthetic clinical note: plain words, no names, varied by line. */
function noteLine(k) {
  return `Line ${String(k + 1)}: the patient reports no new symptoms since the last visit; vitals stable, plan unchanged.`;
}

/**
 * A synthetic MDM^T02 whose note is `lines` OBX lines of type TX: a long clinical document, the shape
 * the narrative of a C-CDA reaches v2 in.
 */
export function longNote(i, lines) {
  const out = [
    msh("MDM^T02^MDM_T02", i),
    seg("EVN", { 1: "T02", 2: "20260721143000-0500" }),
    pid(),
    seg("PV1", { 1: "1", 2: "O" }),
    seg("TXA", {
      1: "1",
      2: "DS^Discharge summary^HL70270",
      3: "text/plain",
      4: "20260721143000-0500",
      12: `DOC${String(i)}^^HOSP`,
      17: "AU",
      19: "AV",
    }),
  ];
  for (let k = 0; k < lines; k++) {
    out.push(
      seg("OBX", {
        1: String(k + 1),
        2: "TX",
        3: "18842-5^Discharge summary^LN",
        5: noteLine(k),
        11: "F",
      }),
    );
  }
  return out.join(SEGMENT_SEPARATOR);
}

/**
 * `bytes` generated bytes, base64: a stand-in for an embedded PDF. A fixed linear congruential
 * sequence, so every run builds the same bytes and no file is read.
 */
export function base64Document(bytes, seed) {
  const data = Buffer.alloc(bytes);
  let state = (seed * 2654435761 + 1) >>> 0;
  for (let k = 0; k < bytes; k++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[k] = state >>> 24;
  }
  return data.toString("base64");
}

/**
 * A synthetic ORU^R01 carrying one PDF of `bytes` bytes, base64, in an OBX of type ED: how a real
 * message usually reaches a MiB, one large field rather than many lines. The large opaque payload.
 */
export function reportWithPdf(i, bytes) {
  const lines = oruHead(i, "11502-2^Laboratory report^LN");
  lines.push(
    seg("OBX", {
      1: "1",
      2: "TX",
      3: "11502-2^Laboratory report^LN",
      5: "Report attached",
      11: "F",
    }),
    seg("OBX", {
      1: "2",
      2: "ED",
      3: "11502-2^Laboratory report^LN",
      5: `^AP^PDF^Base64^${base64Document(bytes, i)}`,
      11: "F",
      14: "20260721150000-0500",
    }),
  );
  return lines.join(SEGMENT_SEPARATOR);
}

const UCUM = "http://unitsofmeasure.org";
const LOINC = "http://loinc.org";

/** One synthetic Observation as JSON, varied by `k`: quantities, a code and a string in turn. */
function observationJson(i, k) {
  const base = {
    resourceType: "Observation",
    id: `obs-${String(i)}-${String(k)}`,
    status: k % 11 === 0 ? "amended" : "final",
    effectiveDateTime: "2026-07-21T14:30:00-05:00",
  };
  switch (k % 4) {
    case 0:
      return {
        ...base,
        code: { coding: [{ system: LOINC, code: "2093-3", display: "Cholesterol" }] },
        valueQuantity: { value: 150 + (k % 90), unit: "mg/dL", system: UCUM, code: "mg/dL" },
        referenceRange: [{ text: "<200" }],
        interpretation: [
          {
            coding: [
              {
                system: "http://terminology.hl7.org/CodeSystem/v3-ObservationInterpretation",
                code: k % 8 === 0 ? "H" : "N",
              },
            ],
          },
        ],
      };
    case 1:
      return {
        ...base,
        code: { coding: [{ system: LOINC, code: "718-7", display: "Hemoglobin" }] },
        valueQuantity: { value: 11 + (k % 6), unit: "g/dL", system: UCUM, code: "g/dL" },
        referenceRange: [{ text: "12.0-16.0" }],
      };
    case 2:
      return {
        ...base,
        code: { coding: [{ system: LOINC, code: "5778-6", display: "Color of Urine" }] },
        valueCodeableConcept: {
          coding: [{ system: "http://snomed.info/sct", code: "371244009", display: "Yellow" }],
        },
      };
    default:
      return {
        ...base,
        code: { coding: [{ system: LOINC, code: "8251-1", display: "Service comment" }] },
        valueString: `Specimen ${String(k)} received`,
      };
  }
}

/**
 * A synthetic searchset Bundle of `entries` Observations as JSON text, one entry a line: what a FHIR
 * server returns for a patient's results, each of which the reverse path writes back to an OBX.
 */
export function observationBundle(i, entries) {
  const lines = [];
  for (let k = 0; k < entries; k++) {
    lines.push(
      JSON.stringify({
        fullUrl: `urn:uuid:00000000-0000-4000-8000-${String(i * 100_000 + k).padStart(12, "0")}`,
        resource: observationJson(i, k),
        search: { mode: "match" },
      }),
    );
  }
  return `{"resourceType":"Bundle","type":"searchset","total":${String(entries)},"entry":[\n${lines.join(",\n")}\n]}`;
}

/** A synthetic Patient as JSON text: the input the reverse path's ADT^A28 starts from. */
export function patientJson(i) {
  return JSON.stringify({
    resourceType: "Patient",
    id: `pat-${String(i)}`,
    identifier: [
      {
        system: "urn:oid:2.16.840.1.113883.19",
        value: "MRN12345",
        type: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" }] },
      },
    ],
    name: [{ use: "official", family: "Public", given: ["Jane", "Q"] }],
    birthDate: "1980-01-15",
    gender: "female",
    address: [
      {
        use: "home",
        line: ["123 Main St", "Apt 4"],
        city: "Boston",
        state: "MA",
        postalCode: "02101",
      },
    ],
  });
}

/** The namespace mnemonics the synthetic messages use, as `createNamingSystem` takes them. */
export const AUTHORITIES = {
  authorities: {
    HOSP: "urn:oid:2.16.840.1.113883.19",
    INSCO1: "urn:oid:2.16.840.1.113883.19.1",
  },
  codeSystems: { I10: "http://hl7.org/fhir/sid/icd-10-cm", C4: "http://www.ama-assn.org/go/cpt" },
};

/** The reverse path's assigning authorities, the inverse of {@link AUTHORITIES}. */
export const REVERSE_OPTIONS = {
  assigningAuthorities: { "urn:oid:2.16.840.1.113883.19": "HOSP" },
  envelope: { sendingApp: "EHR", sendingFacility: "MAIN" },
};

/**
 * The `$translate`-shaped ConceptMap-application engine + the **license-clean** v2-table → FHIR
 * value maps it applies. This is the layer that value-**translates** a coded v2
 * field — not merely carrying its code structurally, but mapping the source table code to the FHIR
 * target coding the IG's segment-map `mappedVia` ConceptMap prescribes.
 *
 * **Grounded firsthand on the raw published IG ConceptMaps** (`hl7.fhir.uv.v2mappings`, STU1 —
 * `ConceptMap-table-*.json`). Each shipped map below cites the exact IG ConceptMap it transcribes and
 * was verified against that resource's JSON (its `group.element[].target[]` rows and its `unmatched`
 * `(unmapped)` group). The engine is **fail-safe by refusal**: a source code the IG map has **no
 * target** for (its `(unmapped)` group) is never coerced to a plausible neighbor — the caller flags it
 * and preserves the raw coding, or withholds the value, but a target is **never fabricated**.
 *
 * **License posture.** Only maps whose target CodeSystem is **freely redistributable** are
 * shipped here: the HL7 THO v2 tables (`v2-0162`, `v2-0550`, `v2-0277`, `v2-0161`) and HL7 v3
 * (`v3-RouteOfAdministration`) are HL7's own, license-clean. The IG's `*-to-sct` value maps —
 * **RXR-4 method** (`table-hl70165-to-sct`) and **SCH-7 reason** (`table-hl70276-to-sct`) — translate
 * **into SNOMED CT**, which is **license-encumbered and is NOT bundled**; those fields stay
 * structurally carried (BYO ConceptMap), never value-translated here (see their message modules).
 *
 * **Additive, never mutating.** A successful translation preserves the raw source coding
 * (its code, display, version, and any `CWE.4/5/6` alternate triplet) and *adds* the derived target
 * coding — recognition never overwrites or discards what the message said; it augments it with the
 * IG-mapped equivalent. And it only fires when the field's primary coding is genuinely from the map's
 * **bound source table** (CWE.3 absent, or naming that table): a field that declares a *foreign*
 * coding system (a local `99…`, SNOMED, …) is carried structurally and flagged — its code is **never**
 * asserted to be the standard concept just because the string happens to collide with a table code.
 *
 * @packageDocumentation
 */

import { complex, primitive, list, type FhirComplex, type FhirNode } from "@cosyte/fhir";

import {
  buildCoding,
  toFhirCodeableConcept,
  type CodedElement,
} from "../datatypes/codeable-concept.js";
import type { TransformIssue } from "../diagnostics/issue.js";
import type { ConvertResult } from "../diagnostics/result.js";
import type { TransformContext } from "./context.js";

// ── Target CodeSystem canonical URIs (all license-clean HL7 THO / v3) ────────────────────────────

/** HL7 v2 Table 0162 (Route of Administration) THO CodeSystem URI. */
export const V2_0162_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0162";
/** HL7 v3 RouteOfAdministration CodeSystem URI (the IG's remap target for the six common routes). */
export const V3_ROUTE_OF_ADMINISTRATION_SYSTEM =
  "http://terminology.hl7.org/CodeSystem/v3-RouteOfAdministration";
/** HL7 v2 Table 0550 (Body Parts) THO CodeSystem URI. */
export const V2_0550_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0550";
/** HL7 v2 Table 0277 (Appointment Type Codes) THO CodeSystem URI. */
export const V2_0277_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0277";
/** HL7 v2 Table 0161 (Allow Substitution) THO CodeSystem URI. */
export const V2_0161_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0161";

/** A translated FHIR target coding: the target CodeSystem URI + code, and the IG's target display. */
export interface CodedTarget {
  /** The FHIR target CodeSystem canonical URI. */
  readonly system: string;
  /** The FHIR target code. */
  readonly code: string;
  /** The IG map's target display, when it carries one (absent for the identity table maps). */
  readonly display?: string;
}

/**
 * A license-clean v2-table → FHIR value ConceptMap: it translates a **source table code** to its
 * {@link CodedTarget}, or `undefined` when the code is not in the map's *mapped* group (the IG's
 * `(unmapped)` group). Never fabricates a target.
 */
export interface CodedValueMap {
  /** The IG ConceptMap id this map transcribes (its citation). */
  readonly name: string;
  /** The source table's canonical CodeSystem URI (what the raw v2 code is a member of when mapped). */
  readonly sourceSystem: string;
  /**
   * The CWE.3 (`nameOfCodingSystem`) mnemonics that denote this map's **bound source table** — the
   * HL7 forms (`"HL70162"`, `"0162"`, …). Translation applies **only** when the field's primary
   * coding is from the bound table: CWE.3 absent/empty (a positionally-bound bare code) **or** CWE.3 ∈
   * this set. A CWE that declares a **different** coding system (a local `99…`, or SNOMED) is not a
   * source-table code, so the map is not applied to it — the raw coding is carried structurally + its
   * system flagged, never asserted as the standard concept.
   */
  readonly sourceMnemonics: ReadonlySet<string>;
  /** Translate a source table code to its FHIR target, or `undefined` when the IG map has no target. */
  readonly translate: (code: string) => CodedTarget | undefined;
}

/** Build a {@link CodedValueMap} from an explicit source-code → target table + its bound mnemonics. */
function valueMap(
  name: string,
  sourceSystem: string,
  sourceMnemonics: readonly string[],
  targets: Readonly<Record<string, CodedTarget>>,
): CodedValueMap {
  return Object.freeze({
    name,
    sourceSystem,
    sourceMnemonics: new Set(sourceMnemonics),
    translate: (code: string): CodedTarget | undefined =>
      Object.hasOwn(targets, code) ? targets[code] : undefined,
  });
}

/** Build an identity target table (each code maps to itself in `system`) from a code list. */
function identityTargets(system: string, codes: readonly string[]): Record<string, CodedTarget> {
  const t: Record<string, CodedTarget> = {};
  for (const code of codes) t[code] = { system, code };
  return t;
}

// ── The shipped, license-clean value maps (each verified firsthand against its IG ConceptMap) ────

/**
 * **RXR-1 Route** — IG `ConceptMap/table-hl70162-to-v2-0162`. Two IG groups, transcribed verbatim:
 * a 41-code **identity** group (source `v2-0162` → target `v2-0162`, each `equivalent`) and a 6-code
 * **remap** group into `v3-RouteOfAdministration` (`ID→IDINJ`, `IM→IM`, `IV→IVINJ`, `PO→PO`, `SC→SQ`,
 * `TD→TRNSDERM`, each `equivalent`, with the IG target displays). The two source-code sets are
 * disjoint. Any other v2-0162 code (or a non-table code) is unmapped → the raw coding is preserved
 * and flagged, never coerced.
 */
export const ROUTE_VALUE_MAP: CodedValueMap = valueMap(
  "table-hl70162-to-v2-0162",
  V2_0162_SYSTEM,
  ["HL70162", "0162"],
  {
    ...identityTargets(V2_0162_SYSTEM, [
      "AP",
      "B",
      "DT",
      "EP",
      "ET",
      "GTT",
      "GU",
      "IMR",
      "IA",
      "IB",
      "IC",
      "ICV",
      "IH",
      "IHA",
      "IN",
      "IO",
      "IP",
      "IS",
      "IT",
      "IU",
      "MTH",
      "MM",
      "NS",
      "NG",
      "NP",
      "NT",
      "OP",
      "OT",
      "OTH",
      "PF",
      "PR",
      "RM",
      "SD",
      "SL",
      "TP",
      "TRA",
      "TL",
      "UR",
      "VG",
      "VM",
      "WND",
    ]),
    ID: {
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "IDINJ",
      display: "Injection, intradermal",
    },
    IM: {
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "IM",
      display: "Injection, intramuscular",
    },
    IV: {
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "IVINJ",
      display: "Injection, intravenous",
    },
    PO: { system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM, code: "PO", display: "Swallow, oral" },
    SC: {
      system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM,
      code: "SQ",
      display: "Injection, subcutaneous",
    },
    TD: { system: V3_ROUTE_OF_ADMINISTRATION_SYSTEM, code: "TRNSDERM", display: "Transdermal" },
  },
);

/**
 * **RXR-2 Administration Site** — IG `ConceptMap/table-hl70550-to-v2-0550`. A single **identity**
 * group of 443 body-part codes (source `v2-0550` → target `v2-0550`, each `equivalent`), transcribed
 * verbatim from the published STU1 ConceptMap — **including** its as-published data-quality artifacts
 * (`CHESTÂ`, a lone `Â`, `KIDNÂ`, where a stray U+00C2 leaked from the IG's source
 * encoding). They are preserved for source-fidelity; they are inert (a clean `CHEST`/`KIDN` simply
 * falls through to unmapped). A code not in the table is unmapped → raw coding preserved + flagged.
 */
export const SITE_VALUE_MAP: CodedValueMap = valueMap(
  "table-hl70550-to-v2-0550",
  V2_0550_SYSTEM,
  ["HL70550", "0550"],
  identityTargets(V2_0550_SYSTEM, [
    "JUGE",
    "ADB",
    "ACET",
    "ACHIL",
    "ADE",
    "ADR",
    "AMN",
    "AMS",
    "ANAL",
    "ANKL",
    "ANTEC",
    "ANTECF",
    "ANTR",
    "ANUS",
    "AORTA",
    "AR",
    "AV",
    "APDX",
    "AREO",
    "ARM",
    "ARTE",
    "ASCIT",
    "ASCT",
    "ATR",
    "AURI",
    "AXI",
    "BACK",
    "BARTD",
    "BARTG",
    "BRTGF",
    "BPH",
    "BID",
    "BIFL",
    "BLAD",
    "BLOOD",
    "BLDA",
    "BLDC",
    "BLDV",
    "CBLD",
    "BLD",
    "BDY",
    "BON",
    "BMAR",
    "BOWEL",
    "BOWLA",
    "BOWSM",
    "BRA",
    "BRAIN",
    "BCYS",
    "BRST",
    "BRSTFL",
    "BRO",
    "BROCH",
    "BRONC",
    "BRV",
    "BUCCA",
    "BURSA",
    "BURSF",
    "BUTT",
    "CALF",
    "CANAL",
    "CANLI",
    "CNL",
    "CANTH",
    "CDM",
    "CARO",
    "CARP",
    "CAVIT",
    "CHE",
    "CECUM",
    "CSF",
    "CVX",
    "CERVUT",
    "CHEEK",
    "CHES",
    "CHESTÂ",
    "CHIN",
    "CIRCU",
    "CLAVI",
    "CLITO",
    "CLIT",
    "COCCG",
    "COCCY",
    "COLON",
    "COLOS",
    "COS",
    "CDUCT",
    "CONJ",
    "CORAL",
    "COR",
    "CORD",
    "CORN",
    "CRANE",
    "CRANF",
    "CRANO",
    "CRANP",
    "CRANS",
    "CRANT",
    "CUBIT",
    "CUFF",
    "CULD",
    "CULDO",
    "DELT",
    "DENTA",
    "DEN",
    "DIAF",
    "DPH",
    "DIGIT",
    "DISC",
    "DORS",
    "DUFL",
    "DUODE",
    "DUR",
    "EAR",
    "EARBI",
    "EARBM",
    "EARBS",
    "EARLO",
    "ELBOW",
    "ELBOWJ",
    "ENDC",
    "EC",
    "EOLPH",
    "ENDM",
    "ET",
    "EUR",
    "EOS",
    "EPICA",
    "EPICM",
    "EPD",
    "EPIDU",
    "EPIGL",
    "ESOPG",
    "ESO",
    "ETHMO",
    "Â",
    "EYE",
    "BROW",
    "EYELI",
    "FACE",
    "FBINC",
    "FBLAC",
    "FBMAX",
    "FBNAS",
    "FBPAL",
    "FBVOM",
    "FBZYG",
    "FALLT",
    "FEMOR",
    "FMH",
    "FEMUR",
    "FET",
    "FIBU",
    "FING",
    "FINGN",
    "FOL",
    "FOOT",
    "FOREA",
    "FOREH",
    "FORES",
    "FOURC",
    "GB",
    "GEN",
    "GVU",
    "GENC",
    "GL",
    "GENL",
    "GLAND",
    "GLANS",
    "GLUTE",
    "GLUT",
    "GLUTM",
    "GROIN",
    "GUM",
    "HAR",
    "HAL",
    "HAND",
    "HEAD",
    "HART",
    "HV",
    "HVB",
    "HVT",
    "HEEL",
    "HEM",
    "HIP",
    "HIPJ",
    "HUMER",
    "HYMEN",
    "ILC",
    "ILE",
    "ILEOS",
    "ILEUM",
    "ILIAC",
    "ILCR",
    "ILCON",
    "INGUI",
    "JUGI",
    "INT",
    "ICX",
    "INASA",
    "INTRU",
    "INTRO",
    "ISCHI",
    "JAW",
    "KIDNÂ",
    "KNEE",
    "KNEEF",
    "KNEEJ",
    "LABIA",
    "LABMA",
    "LABMI",
    "LACRI",
    "LAM",
    "INSTL",
    "LARYN",
    "LEG",
    "LENS",
    "WBC",
    "LING",
    "LINGU",
    "LIP",
    "STOOLL",
    "LIVER",
    "LOBE",
    "LOCH",
    "ISH",
    "LUMBA",
    "LMN",
    "LUNG",
    "LN",
    "LNG",
    "LYM",
    "MAC",
    "MALLE",
    "MANDI",
    "MAR",
    "MAST",
    "MAXIL",
    "MAXS",
    "MEATU",
    "MEC",
    "MEDST",
    "MEDU",
    "MOU",
    "MPB",
    "METAC",
    "METAT",
    "MILK",
    "MITRL",
    "MOLAR",
    "MP",
    "MONSU",
    "MONSV",
    "MOUTH",
    "MRSA2",
    "MYO",
    "NAIL",
    "NAILB",
    "NAILF",
    "NAILT",
    "NARES",
    "NASL",
    "NSS",
    "NLACR",
    "NP",
    "NTRAC",
    "NAVEL",
    "NECK",
    "NERVE",
    "NIPPL",
    "NOS",
    "NOSE",
    "NOSTR",
    "OCCIP",
    "OLECR",
    "OMEN",
    "ORBIT",
    "ORO",
    "OSCOX",
    "OVARY",
    "PALAT",
    "PLATH",
    "PLATS",
    "PALM",
    "PANCR",
    "PAFL",
    "PAS",
    "PARAT",
    "PARIE",
    "PARON",
    "PAROT",
    "PATEL",
    "PELV",
    "PENSH",
    "PENIS",
    "PANAL",
    "PERI",
    "PCARD",
    "PCLIT",
    "PERIH",
    "PNEAL",
    "PERIN",
    "PNEPH",
    "PNM",
    "PORBI",
    "PERRA",
    "PERIS",
    "PER",
    "PERT",
    "PERIT",
    "PTONS",
    "PERIU",
    "PERIV",
    "PHALA",
    "PILO",
    "PINNA",
    "PLC",
    "PLACF",
    "PLACM",
    "PLANT",
    "PLEUR",
    "PLEU",
    "PLR",
    "POPLI",
    "PREAU",
    "PRERE",
    "PRST",
    "PROS",
    "PUBIC",
    "PUL",
    "RADI",
    "RADIUS",
    "RECTL",
    "RECTU",
    "RBC",
    "RENL",
    "RNP",
    "RPERI",
    "RIB",
    "SACRA",
    "SACRO",
    "SACIL",
    "SACRU",
    "SALGL",
    "SCALP",
    "SCAPU",
    "SCLER",
    "SCROT",
    "SEMN",
    "SEM",
    "SEPTU",
    "SEROM",
    "SHIN",
    "SHOLJ",
    "SHOL",
    "SIGMO",
    "SINUS",
    "SKM",
    "SKENE",
    "SKULL",
    "INSTS",
    "SOLE",
    "SPRM",
    "SPHEN",
    "SPCOR",
    "SPLN",
    "STER",
    "STOM",
    "USTOM",
    "STOMA",
    "STUMP",
    "SCLV",
    "SDP",
    "SUB",
    "SUBD",
    "SGF",
    "SUBM",
    "SUBX",
    "SUBME",
    "SUBPH",
    "SPX",
    "SCLAV",
    "SUPRA",
    "SUPB",
    "SWT",
    "SWTG",
    "SYNOL",
    "SYN",
    "SYNOV",
    "TARS",
    "TDUCT",
    "TEAR",
    "TEMPL",
    "TEMPO",
    "TML",
    "TESTI",
    "THIGH",
    "THORA",
    "THRB",
    "THUMB",
    "TNL",
    "THM",
    "THYRD",
    "TIBIA",
    "TOE",
    "TOEN",
    "TONG",
    "TONS",
    "TOOTH",
    "TSK",
    "TRCHE",
    "TBRON",
    "TCN",
    "ULNA",
    "UMB",
    "UMBL",
    "URET",
    "URTH",
    "UTERI",
    "SAC",
    "UTER",
    "VAGIN",
    "VCUFF",
    "VGV",
    "VAL",
    "VAS",
    "VASTL",
    "VAULT",
    "VEIN",
    "VENTG",
    "VCSF",
    "VERMI",
    "VERTC",
    "VERTL",
    "VERTT",
    "VESI",
    "VESCL",
    "VESFLD",
    "VESTI",
    "VITR",
    "VOC",
    "VULVA",
    "WRIST",
  ]),
);

/**
 * **SCH-8 Appointment Type** — IG `ConceptMap/table-hl70277-to-v2-0277`. A single **identity** group
 * of the three v2-0277 codes (`Normal`, `Tentative`, `Complete` → themselves, each `equivalent`,
 * source and target both `v2-0277`). Any other code is unmapped → raw coding preserved + flagged.
 */
export const APPOINTMENT_TYPE_VALUE_MAP: CodedValueMap = valueMap(
  "table-hl70277-to-v2-0277",
  V2_0277_SYSTEM,
  ["HL70277", "0277"],
  identityTargets(V2_0277_SYSTEM, ["Normal", "Tentative", "Complete"]),
);

/**
 * **RXO-9 Allow Substitutions** — IG `ConceptMap/table-hl70161-to-v2-0161`. A single **identity**
 * group of the three v2-0161 codes (`N` NOT authorized, `G` generic, `T` therapeutic → themselves,
 * each `equivalent`, source and target both `v2-0161`), the target for
 * `MedicationRequest.substitution.allowedCodeableConcept`. Any other code is unmapped → the
 * substitution is withheld + flagged, never a fabricated substitution permission.
 */
export const SUBSTITUTION_VALUE_MAP: CodedValueMap = valueMap(
  "table-hl70161-to-v2-0161",
  V2_0161_SYSTEM,
  ["HL70161", "0161"],
  identityTargets(V2_0161_SYSTEM, ["N", "G", "T"]),
);

// ── Application: the $translate-shaped, additive, fail-safe engine ────────────────────────────────

/** Build a FHIR `Coding` node (system, optional version, code, optional display). */
function codingFrom(
  system: string,
  code: string,
  display: string | undefined,
  version?: string,
): FhirComplex {
  const props: { name: string; value: FhirNode }[] = [{ name: "system", value: primitive(system) }];
  if (version !== undefined && version !== "")
    props.push({ name: "version", value: primitive(version) });
  props.push({ name: "code", value: primitive(code) });
  if (display !== undefined && display !== "")
    props.push({ name: "display", value: primitive(display) });
  return complex(props);
}

/**
 * The bound-table target for a coded element's **primary** coding, or `undefined` when the map does
 * not faithfully apply — i.e. the primary declares a coding system that is **not** this map's bound
 * table (CWE.3 present and not in {@link CodedValueMap.sourceMnemonics}), the primary code is empty, or
 * the code is in the IG map's `(unmapped)` group. Never asserts a standard translation for a foreign
 * coding system, and never fabricates a target.
 *
 * @param cwe - The parsed coded element (its `identifier` is the candidate source-table code).
 * @param map - The license-clean value map to consider applying.
 * @example
 * ```ts
 * import { translateBound, ROUTE_VALUE_MAP } from "@cosyte/transform";
 * translateBound({ identifier: "IM" }, ROUTE_VALUE_MAP)?.code; // "IM" (v3 route)
 * translateBound({ identifier: "IM", nameOfCodingSystem: "99LOCAL" }, ROUTE_VALUE_MAP); // undefined
 * ```
 */
export function translateBound(cwe: CodedElement, map: CodedValueMap): CodedTarget | undefined {
  const mnemonic = cwe.nameOfCodingSystem;
  const fromBoundTable =
    mnemonic === undefined || mnemonic === "" || map.sourceMnemonics.has(mnemonic);
  if (!fromBoundTable) return undefined;
  const code = cwe.identifier;
  return code === undefined || code === "" ? undefined : map.translate(code);
}

/**
 * Build a FHIR `CodeableConcept` node for a {@link CodedTarget} — the single translated coding, with
 * an optional free-`text`. Used by translate-or-withhold callers (e.g. substitution) that build the
 * CodeableConcept only on a successful translation.
 *
 * @param target - The translated target coding.
 * @param text - The original free text (`CWE.9`) to carry as `CodeableConcept.text`, if any.
 * @example
 * ```ts
 * import { codeableConceptFromTarget, V2_0161_SYSTEM } from "@cosyte/transform";
 * const cc = codeableConceptFromTarget({ system: V2_0161_SYSTEM, code: "G" });
 * void cc;
 * ```
 */
export function codeableConceptFromTarget(target: CodedTarget, text?: string): FhirComplex {
  const props: { name: string; value: FhirNode }[] = [
    { name: "coding", value: list([codingFrom(target.system, target.code, target.display)]) },
  ];
  if (text !== undefined && text !== "") props.push({ name: "text", value: primitive(text) });
  return complex(props);
}

/**
 * Value-translate a coded v2 element to a FHIR `CodeableConcept` **via** a license-clean
 * {@link CodedValueMap}, **additively** and fail-safe — never mutating or discarding what the message
 * said:
 *
 * - **Primary code recognized as a bound-table code** ({@link translateBound} — CWE.3 absent or names
 *   the bound table, and the code is in the IG map's mapped group) → the **primary** coding is emitted
 *   in the recognized source-table system (`map.sourceSystem`, carrying `CWE.7` version) and the
 *   **derived** target coding is *appended* when it differs (a remap such as `SC→SQ`); the **alternate
 *   triplet** (`CWE.4/5/6`, via {@link buildCoding}, with its own system resolution + flags) and the
 *   original `CWE.9` text are preserved. No primary unmapped flag — the value was faithfully recognized.
 * - **Otherwise** — the primary declares a **foreign** coding system (not the bound table), the code is
 *   empty, or it is in the IG's `(unmapped)` group → this defers entirely to the **structural**
 *   {@link toFhirCodeableConcept}, which preserves the raw coding (and its `CWE.4/5/6` alternate and
 *   `CWE.7` version) and flags it ({@link ISSUE_CODES.TRANSFORM_CODE_UNMAPPED} /
 *   `TRANSFORM_CODE_SYSTEM_UNRESOLVED`). A target is **never** fabricated, and a code that declares a
 *   foreign system is **never** asserted to be the standard concept.
 *
 * @param cwe - The parsed `@cosyte/hl7` coded element (its `identifier` is the candidate table code).
 * @param map - The license-clean value map to apply (e.g. {@link ROUTE_VALUE_MAP}).
 * @param ctx - The transform context (threaded to the structural path + the alternate-triplet resolver).
 * @example
 * ```ts
 * import { toFhirCodeableConceptVia, ROUTE_VALUE_MAP } from "@cosyte/transform";
 * const { value } = toFhirCodeableConceptVia({ identifier: "IM" }, ROUTE_VALUE_MAP);
 * // coding === [{ system: ".../v2-0162", code: "IM" },
 * //            { system: ".../v3-RouteOfAdministration", code: "IM", display: "Injection, intramuscular" }]
 * void value;
 * ```
 */
export function toFhirCodeableConceptVia(
  cwe: CodedElement,
  map: CodedValueMap,
  ctx: TransformContext = {},
): ConvertResult<FhirComplex> {
  const target = translateBound(cwe, map);

  if (target === undefined) {
    // Foreign coding system, empty code, or IG-unmapped → structural carry (raw preserved + flagged).
    return toFhirCodeableConcept(cwe, ctx);
  }

  const issues: TransformIssue[] = [];
  const codings: FhirComplex[] = [];

  // Primary coding — recognized as a bound-table code: emitted in the source-table system (no flag),
  // carrying the CWE.2 display and CWE.7 version.
  codings.push(
    codingFrom(map.sourceSystem, cwe.identifier as string, cwe.text, cwe.codingSystemVersionId),
  );

  // Derived (translated) target coding — appended only for a remap (target ≠ the primary coding);
  // for an identity map the primary already IS the target, so no duplicate is added.
  const isIdentity = target.system === map.sourceSystem && target.code === cwe.identifier;
  if (!isIdentity) codings.push(codingFrom(target.system, target.code, target.display));

  // Alternate triplet (CWE.4/5/6 + CWE.8 version) — preserved via the same structural builder the
  // datatype path uses, so its system resolution and fail-safe flags are identical, never dropped.
  const alternate = buildCoding(
    {
      code: cwe.alternateIdentifier,
      display: cwe.alternateText,
      mnemonic: cwe.nameOfAlternateCodingSystem,
      version: cwe.alternateCodingSystemVersionId,
    },
    ctx,
    "CWE.4",
    "CWE.6",
    issues,
  );
  if (alternate !== undefined) codings.push(alternate);

  const props: { name: string; value: FhirNode }[] = [{ name: "coding", value: list(codings) }];
  if (cwe.originalText !== undefined && cwe.originalText !== "") {
    props.push({ name: "text", value: primitive(cwe.originalText) });
  }
  return { value: complex(props), issues };
}

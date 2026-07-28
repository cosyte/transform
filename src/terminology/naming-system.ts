/**
 * The NamingSystem registry — how an HL7 v2 identity/coding namespace becomes a FHIR canonical URI.
 *
 * Two resolutions live here, and both are **fail-safe by refusal**:
 *
 * 1. **Assigning authority (HD) → `Identifier.system`.** The IG's CX→Identifier map says CX.4 maps to
 *    `Identifier.system` *only when the authority is in an identifier registry* — the URI comes from a
 *    NamingSystem lookup, **not** string concatenation. There is no deterministic algorithm from an
 *    HD to a URI, so this resolver **never synthesizes a system from HD.1 (the bare namespace
 *    mnemonic) alone** — doing so would let two hospitals reusing "MR"/"HOSPMRN" collide and merge two
 *    patients. The *only* auto-derivations are the unambiguous ones: `urn:oid:<oid>` when HD.2 is a
 *    valid OID with HD.3 = `ISO`, and `urn:uuid:<uuid>` when HD.3 = `UUID`. Everything else must be an
 *    explicit, caller-seeded registry entry, or it resolves to `undefined` and the caller emits a
 *    typed issue.
 *
 * 2. **v2 coding-system mnemonic → canonical URI.** CWE.3/CWE.6 carry a v2 Table 0396 mnemonic
 *    (`LN`, `SCT`, …); FHIR needs the canonical URI (`http://loinc.org`, …). {@link DEFAULT_V2_CODE_SYSTEMS}
 *    seeds a small, license-clean set of the universally-fixed FHIR-core systems; an unrecognized
 *    mnemonic resolves to `undefined` (the caller preserves the raw code and flags it — a URI is
 *    never invented). The full HL7 THO crosswalk is not bundled.
 *
 * @packageDocumentation
 */

import type { HD } from "@cosyte/hl7";

/**
 * The HL7 v2 Table 0203 identifier-type code system canonical URI — used to build `Identifier.type`.
 * (FHIR R4 terminologies-systems.html)
 */
export const V2_0203_SYSTEM = "http://terminology.hl7.org/CodeSystem/v2-0203";

/**
 * A small, license-clean seed of v2 Table 0396 coding-system mnemonic → canonical URI, for the
 * FHIR-core-fixed systems whose URIs are universally cited (FHIR R4 terminologies-systems.html).
 * The full HL7 THO NamingSystem crosswalk is not bundled; callers extend this via
 * {@link createNamingSystem}. **No terminology *content* is bundled — only identity URIs.**
 */
export const DEFAULT_V2_CODE_SYSTEMS: Readonly<Record<string, string>> = Object.freeze({
  LN: "http://loinc.org",
  SCT: "http://snomed.info/sct",
  RXNORM: "http://www.nlm.nih.gov/research/umls/rxnorm",
  CVX: "http://hl7.org/fhir/sid/cvx",
  UCUM: "http://unitsofmeasure.org",
});

/** A seed for {@link createNamingSystem}: extra coding systems and explicit assigning authorities. */
export interface NamingSystemSeed {
  /** Extra v2 coding-system mnemonic → canonical URI entries (merged over the defaults). */
  readonly codeSystems?: Readonly<Record<string, string>>;
  /**
   * Explicit assigning-authority entries, keyed by **HD.1 namespace mnemonic** and/or **HD.2
   * universal ID (OID)** → the `Identifier.system` URI. This is the safe, caller-vetted path the IG
   * calls for; the registry never derives a system from a mnemonic on its own.
   */
  readonly authorities?: Readonly<Record<string, string>>;
}

/** The resolver consulted by the identity- and code-conversion paths. */
export interface NamingSystemRegistry {
  /**
   * Resolve an assigning authority (HD) to a FHIR `Identifier.system` URI, or `undefined` when it
   * cannot be resolved safely. **Never** synthesizes a URI from HD.1 alone.
   */
  readonly resolveAssigningAuthority: (hd: HD) => string | undefined;
  /** Resolve a v2 coding-system mnemonic to a canonical URI, or `undefined` when unrecognized. */
  readonly resolveCodeSystem: (mnemonic: string) => string | undefined;
}

/** A syntactically-valid ISO OID: dot-separated arcs, first arc 0–2, no leading zeros on multi-digit arcs. */
function isOid(value: string): boolean {
  return /^[0-2](\.(0|[1-9]\d*))+$/.test(value);
}

/** A syntactically-valid UUID (any case). */
function isUuid(value: string): boolean {
  return /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(
    value,
  );
}

/**
 * Create a {@link NamingSystemRegistry}. With no seed it resolves the built-in FHIR-core code systems
 * and the two unambiguous HD auto-derivations (OID/UUID); a seed adds caller-vetted code systems and
 * explicit assigning-authority URIs.
 *
 * @example
 * ```ts
 * import { createNamingSystem } from "@cosyte/transform";
 * const registry = createNamingSystem({
 *   authorities: { HOSPMRN: "urn:oid:1.2.840.114350.1.13.1" },
 * });
 * registry.resolveCodeSystem("LN"); // => "http://loinc.org"
 * ```
 */
export function createNamingSystem(seed: NamingSystemSeed = {}): NamingSystemRegistry {
  const codeSystems: Record<string, string> = { ...DEFAULT_V2_CODE_SYSTEMS, ...seed.codeSystems };
  const authorities: Record<string, string> = { ...seed.authorities };

  return Object.freeze({
    resolveCodeSystem(mnemonic: string): string | undefined {
      if (mnemonic === "") return undefined;
      return Object.hasOwn(codeSystems, mnemonic) ? codeSystems[mnemonic] : undefined;
    },

    resolveAssigningAuthority(hd: HD): string | undefined {
      // 1. Explicit, caller-vetted registry entries win (by OID first, then by namespace mnemonic).
      if (hd.universalId !== undefined && Object.hasOwn(authorities, hd.universalId)) {
        return authorities[hd.universalId];
      }
      if (hd.namespaceId !== undefined && Object.hasOwn(authorities, hd.namespaceId)) {
        return authorities[hd.namespaceId];
      }
      // 2. The only safe auto-derivations — from the *universal* ID, never from HD.1.
      if (hd.universalId !== undefined && hd.universalId !== "") {
        if (hd.universalIdType === "ISO" && isOid(hd.universalId)) {
          return `urn:oid:${hd.universalId}`;
        }
        if (hd.universalIdType === "UUID" && isUuid(hd.universalId)) {
          return `urn:uuid:${hd.universalId.toLowerCase()}`;
        }
      }
      // 3. HD.1-only, or an unrecognized/unsafe universal ID → unresolved. Never synthesized.
      return undefined;
    },
  });
}

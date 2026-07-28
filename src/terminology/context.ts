/**
 * The options and context threaded through the datatype converters.
 *
 * These are **types only** — no runtime behavior. {@link TransformOptions} carries the policy knobs a
 * caller can set; {@link TransformContext} additionally carries the
 * {@link NamingSystemRegistry} the identity- and code-resolution paths consult.
 *
 * @packageDocumentation
 */

import type { NamingSystemRegistry } from "./naming-system.js";

/**
 * Caller/profile policy for a conversion.
 *
 * @remarks
 * `assumeTimezoneOffsetMinutes` is the **only** way a naked v2 timestamp acquires a time-of-day in
 * FHIR: the caller asserts the sender's offset (in minutes east of UTC — e.g. `-300` for US Eastern
 * standard time). It is a *sender-asserted* value, flagged as such; absent it, a naked timestamp is
 * reduced to date precision, **never** assumed to be UTC.
 */
export interface TransformOptions {
  /** The sender's UTC offset in minutes, asserted by the caller to resolve naked timestamps. */
  readonly assumeTimezoneOffsetMinutes?: number;
  /**
   * The {@link NamingSystemRegistry} the message-level transform threads into every datatype
   * conversion (HD → `Identifier.system`, v2 mnemonic → canonical URI). When omitted, a default
   * registry (`createNamingSystem()`) is used — it resolves only the FHIR-core-fixed systems and the
   * two unambiguous HD auto-derivations, so an un-seeded assigning authority surfaces a typed issue
   * rather than a guessed system.
   */
  readonly namingSystem?: NamingSystemRegistry;
  /**
   * Allocator for the `urn:uuid:` `Bundle.entry.fullUrl` / reference identities the assembler mints.
   * Defaults to `crypto.randomUUID`. Inject a deterministic generator to make bundle output
   * reproducible (e.g. for golden fixtures). It must return a fresh, unique value per call — the
   * assembler relies on uniqueness for intra-bundle reference integrity.
   */
  readonly generateId?: () => string;
}

/**
 * The context a converter consults. Carries the {@link NamingSystemRegistry} used to resolve an
 * assigning authority (HD) to an `Identifier.system` and a v2 coding-system mnemonic to a canonical
 * URI, plus the {@link TransformOptions}.
 */
export interface TransformContext {
  /** The registry used to resolve HD → system and v2 mnemonic → canonical URI. */
  readonly namingSystem?: NamingSystemRegistry;
  /** Conversion policy. */
  readonly options?: TransformOptions;
}

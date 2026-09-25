# Examples

Small runnable programs, one per job the package does. Each one imports `@cosyte/transform` by its
published name, so it runs against the built package exactly as a consumer installs it, together
with its two peer dependencies, `@cosyte/hl7` and `@cosyte/fhir`. Each prints what it produced and
checks its own output: a mismatch exits non-zero. Every message and resource in them is synthetic,
built from the identifiers this repository's test fixtures use.

Build once, then run them all:

```bash
pnpm install
pnpm build
pnpm examples
```

| File                                             | What it shows                                                                                                                                             | Run                                       |
| ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| [`convert-a-datatype.ts`](convert-a-datatype.ts) | Convert a name, a timestamp, an identifier and a quantity, and see the fail-safe rule raise an issue instead of guessing a zone, a system or a UCUM unit. | `pnpm tsx examples/convert-a-datatype.ts` |
| [`admission-to-fhir.ts`](admission-to-fhir.ts)   | Turn a parsed ADT^A01 into a FHIR message Bundle with a `MessageHeader`, `Patient` and `Encounter`, every reference resolving inside the Bundle.          | `pnpm tsx examples/admission-to-fhir.ts`  |
| [`lab-result-to-fhir.ts`](lab-result-to-fhir.ts) | Turn an ORU^R01 into a `DiagnosticReport` referencing one `Observation` per OBX, with the magnitude `210.50` kept exactly as sent.                        | `pnpm tsx examples/lab-result-to-fhir.ts` |
| [`fhir-to-v2.ts`](fhir-to-v2.ts)                 | Emit an ADT^A28 from a FHIR `Patient` with `toV2Patient`, parse it back with `@cosyte/hl7`, and see a missing trigger refused.                            | `pnpm tsx examples/fhir-to-v2.ts`         |

CI runs `pnpm typecheck:examples`, `pnpm lint:examples`, `pnpm examples` and `pnpm phi-scan:examples`
after `pnpm build` on every pull request, so an example that drifts from the package fails the build.

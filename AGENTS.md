# AGENTS.md

`@cosyte/transform` turns an HL7 v2 message parsed by `@cosyte/hl7` into FHIR R4 resources built
with `@cosyte/fhir`, mapped from the HL7 Version 2 to FHIR Implementation Guide, with a narrow FHIR
to v2 path back. We publish it to npm under MIT from this repository.

## Build and test

Use the pnpm that `packageManager` in `package.json` pins, and Node.js 22.22.2 or later (the shared
tooling in `@cosyte/process` needs it; the published package itself runs on any Node.js 22).

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm test
```

## The gate

Run these from the repo root, in this order, before you push. CI runs the same checks on Node.js 22,
24, and 26.

```sh
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm phi-scan
pnpm test
pnpm test:coverage
pnpm build
pnpm attw
pnpm typecheck:examples
pnpm lint:examples
pnpm examples
pnpm phi-scan:examples
pnpm check:readme
pnpm check:claude-card
pnpm check:catalog
pnpm check:process
pnpm check:no-emdash
pnpm check:no-internal-refs
```

## Data

Synthetic data only: real patient data never enters this repository, in a fixture, a test, an
example, an issue, or a log.

## Contributing

See [CONTRIBUTING.md](https://github.com/cosyte/.github/blob/main/CONTRIBUTING.md).

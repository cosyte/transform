---
id: installation
title: Installation
sidebar_position: 1
---

# Installation

`@cosyte/transform` ships dual **ESM + CJS** builds with per-condition type declarations, so it works
from either module system without configuration. Its own **third-party runtime dependencies are
zero**: it depends only on two cosyte siblings.

> **Status:** published on npm, and so are both of its peer dependencies, so the command below
> installs it. For the current published version, ask the registry
> (`npm view @cosyte/transform version`). See [Peer dependencies](#peer-dependencies) below.

## Prerequisites

- **Node.js >= 22** (the whole `@cosyte/*` suite targets ES2023 / Node 22+).
- A package manager: `pnpm`, `npm`, or `yarn`.

## Install

```bash
npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir
```

## Peer dependencies

`@cosyte/hl7` and `@cosyte/fhir` are declared as **peer dependencies**: `transform` maps between the
models they own, so a consumer supplies them. Both are on the registry, and the command above
installs them beside this package.

This repo's own tests install both peers from the registry, exactly as a consumer does.

## Smoke test

Once it is installed, confirm the package resolves and reports the release you actually have:

```ts
import { VERSION } from "@cosyte/transform";

console.log(VERSION);
```

`VERSION` is the package's own `version`, kept in lockstep with it by the release tooling, so from
the next release onward what it prints is the release you are running.

> **Every release up to and including `0.0.4` prints `0.0.0`.** They all went out with the constant
> stuck at its scaffold value, and a published version is never re-published, so those copies stay
> wrong on the registry. So `0.0.0` does not identify _which_ of them you have: it only tells you the
> constant is lying, not your install. Read the manifest instead, which was always correct:
> `node -p "require('@cosyte/transform/package.json').version"`.

Head to the [Quickstart](./quickstart).

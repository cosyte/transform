---
id: installation
title: Install @cosyte/transform
sidebar_label: Installation
description: "Install @cosyte/transform beside its two peer dependencies, @cosyte/hl7 and @cosyte/fhir, and check which release you have."
---

# Install @cosyte/transform

`@cosyte/transform` ships dual **ESM + CJS** builds with per-condition type declarations, so it works
from either module system without configuration. Its own **third-party runtime dependencies are
zero**: it depends only on two Cosyte siblings.

> **Status:** published on npm, and so are both of its peer dependencies, so the command below
> installs it. For the current published version, ask the registry
> (`npm view @cosyte/transform version`). See [Peer dependencies](#peer-dependencies) below.

## Prerequisites

- **Node.js 22 or later, tested on 22, 24, and 26** (the whole `@cosyte/*` suite targets ES2023).
- A package manager: `pnpm`, `npm`, or `yarn`.

## Install

```bash
npm install @cosyte/transform @cosyte/hl7 @cosyte/fhir
```

## Peer dependencies

`@cosyte/hl7` and `@cosyte/fhir` are declared as **peer dependencies**: `transform` maps between the
models they own, so a consumer supplies them. Both are on the registry, and the command above
installs them beside this package. `@cosyte/fhir` must be 0.1.12 or later: the emit gate hands
`validateResource` a schema registry it builds once, an option older releases do not read.

This repo's own tests install both peers from the registry, exactly as a consumer does.

## Smoke test

Once it is installed, confirm the package resolves and reports the release you actually have:

```ts runnable
import { VERSION } from "@cosyte/transform";

console.log(VERSION);
typeof VERSION; // => "string"
```

`VERSION` is the package's own `version`, kept in lockstep with it by the release tooling, so from
the next release onward what it prints is the release you are running.

> **Every release up to and including `0.0.4` prints `0.0.0`.** They all went out with the constant
> stuck at its scaffold value, and a published version is never re-published, so those copies stay
> wrong on the registry. So `0.0.0` does not identify _which_ of them you have: it only tells you the
> constant is lying, not your install. Read the manifest instead, which was always correct:
> `node -p "require('@cosyte/transform/package.json').version"`.

Next, the [Quickstart](./quickstart.md) converts a name and then a whole message. The
[reference](./api/README.md#version) documents `VERSION`.

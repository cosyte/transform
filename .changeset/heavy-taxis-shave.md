---
"@cosyte/transform": patch
---

The publish gate that checks this package's type declarations now fails when the packed tarball carries no types, instead of passing. `attw` prints "This package does not contain types." and exits 0, because an untyped package is a legitimate npm package. For a package that ships types it means the declarations were left out of the tarball, which is a broken publish reported as a pass.

`@arethetypeswrong/cli` opens `getExitCode()` with `if (!analysis.types) return 0`, returning before the problem list is read at all. No `--profile`, `--ignore-rules` or config setting reaches that early return, so the fix is a wrapper rather than a different invocation. Reproduced here on a quiet box with nothing else running, against the old bare `attw --pack .`: deleting `dist/`, and deleting only `dist/index.d.ts` and `dist/index.d.cts`, both print the sentence and exit 0.

The second is the realistic one. `tsup` writes the ESM and CJS bundles in one pass and the declarations in a later pass, so every build of this package has a window where `dist/` holds JavaScript and no `.d.ts` at all: 1,600 ms, 1,646 ms and 2,018 ms on three consecutive builds measured here. Anything that runs the gate inside that window sees an untyped package. That is why the answer is not a build lock. The gate has to be able to report that its own inputs were missing, whatever removed them.

The gate now carries two nets. A preflight checks that every relative path `package.json` promises (`main`, `module`, `types`, `typings`, and every string leaf of `exports`) exists and is non-empty before `attw` runs, and names the missing file. A post-check promotes an untyped result to a failure, covering what the preflight structurally cannot: declarations present on disk but excluded from the tarball by `files` or `.npmignore`. The post-check reads printed output, so the arguments and config settings that were measured to hide it (`--quiet`, `--format json`, and a `.attw.json` setting either) are refused rather than tolerated.

No library code, public API, issue code, mapping or transformed value changes.

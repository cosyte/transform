The `attw` gate section of `CLAUDE.md`, relocated unchanged so the always-read file stays
inside its byte budget. `CLAUDE.md` keeps the heading and points here. Paths are written
relative to the repository root, as they were where this text came from.

### The `attw` gate

- **▶ `attw` SAYS "does not contain types" AND EXITS 0, SO THE `attw` SCRIPT IS A WRAPPER, NOT THE
  BARE CLI.** `getExitCode.js` returns 0 before the problem list is read; no `--profile`,
  `--ignore-rules` or config setting reaches that early return. For a package that ships types, that
  sentence means **a broken publish reported as a pass**.
- **The race only supplies the condition**: every `tsup` build has a **~1.6–2.0 s** window with no
  `.d.ts` on disk, reproduced with zero concurrency. **So the answer is not a lock, a lease or a
  build queue:** the gate must be able to say its own inputs were missing, whatever removed them.
- **`scripts/attw.mjs` carries two nets that catch different things**: a path preflight (catches the
  build window and _names_ the missing file) and a post-check on the untyped sentence (catches
  declarations on disk but excluded from the tarball). **Do not collapse them into one.**
- **The post-check reads a string, so what would hide that string is refused by option NAME,
  wholesale, not by value**: `--quiet`, `--format`, `--config-path`, and `.attw.json` settings.
  A harmless value is refused anyway; that is the deliberate trade.
- **Do not reduce the wrapper to the bare CLI**: it reds 10 of `test/scripts/attw-gate.test.ts`'s 13
  tests, which is how the suite was checked for bite rather than assumed to have it.
- **A green `attw` has never meant a consumer can install the peer**: measured, `attw` never
  resolves `@cosyte/fhir` at all. And a **complete but stale `dist/`** passes both nets.
- **This is a per-repo script and the prose does NOT port with the code.** Re-measure every number on
  the package you port it to. Derive who still runs the bare CLI:
  `rg -l --glob '**/package.json' '"attw":' /workspace`.

The agent-instruction contract gate section of `CLAUDE.md`, relocated unchanged so the always-read file stays
inside its byte budget. `CLAUDE.md` keeps the heading and points here. Paths are written
relative to the repository root, as they were where this text came from.

### The agent-instruction contract gate

- **▶ THIS FILE AND `documentation/agent-notes.md` ARE A CHECKED CONTRACT**:
  `pnpm check:agent-notes`. Refuses a missing archive, an empty section, a dead `#anchor`, an
  unresolvable file pointer here, an archive `##` nothing here points at. Exit `2` = could not
  decide, `1` = violations.
- **▶ EXISTENCE IS NOT OBSERVATION**, and **a count cannot detect it**: a count counts the roots
  that DID exist. It reconciles what it OPENED against `git ls-files`. **Never re-add a
  `tracked.has()` pre-check before a read**: that made every branch unreachable, at zero firings,
  while this line sold it as protection.
- **▶ EACH SPACE IS ITS OWN HYPHEN in an anchor slug; runs do NOT collapse.** Collapsing passed a
  dead pointer and reddened a working one; our spaced-em-dash headings are that shape.
- **It proves a heading is POINTED AT, never that the one-liner says what the section says**: the
  deliberate-omission trap has no identifier to grep for. **Enumerate those by hand.**
- **Two routes, not removable by one edit**: the suite in `ci / verify` (which inherits the two
  levers above) and a step in `no-internal-refs` (which does not). `verify.sh` runs only the first.

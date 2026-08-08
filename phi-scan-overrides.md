# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. The scanner refuses to honor a `--allow-fixture <path>`
flag UNLESS this file contains a `### <path>` subsection referencing the same
path. The committed log is intentionally annoying: it discourages bypass and
creates an audit trail. Prefer extending `scripts/phi-allow-list.txt` (a
token-level, reviewed declaration) over a whole-file bypass, which silences
_every_ check for that file.

> **What the scanner detects, so a bypass is judged against the real gate rather
> than a template.** Two passes run on every target, on all three routes: the
> cross-cutting SSN/email floor, and an HL7 v2 structured pass over a NAMED SET
> of PID / NK1 / GT1 / IN1 fields, checked against `scripts/phi-allow-list.txt`.
> Segment literals are found inline, because this package ships no standalone
> `.hl7` file: every message in its corpus is a `.ts` string literal.
>
> **Read the set before you judge a bypass against it, and read it as the whole
> of the coverage.** The banner at the top of `scripts/phi-scan.ts` enumerates
> exactly which fields are read and states that anything not named there is not
> checked: two refuter passes measured the opposite shape, a list of what is NOT
> covered, incomplete in the false-confidence direction. A bypass here silences
> the named set AND the floor for that path.

## Format

Each entry is a markdown subsection:

```
### <path>

- **Date:** <YYYY-MM-DD>
- **Reason:** <one-line justification>
- **Approved by:** <committer name>
- **Expires:** <YYYY-MM-DD or "permanent">
```

## Entries

(none yet)

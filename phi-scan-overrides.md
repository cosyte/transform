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
> cross-cutting SSN/email floor, and an HL7 v2 structured pass over PID / NK1 /
> GT1 / IN1 checking names, date of birth, MRN / member id / SSN, address and
> phone against `scripts/phi-allow-list.txt`. Segment literals are found inline,
> because this package ships no standalone `.hl7` file: every message in its
> corpus is a `.ts` string literal. What it still does NOT see is written out in
> the banner at the top of `scripts/phi-scan.ts`, and a bypass here silences all
> of it for that path.

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

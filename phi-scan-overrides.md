# phi-scan bypass log

This file logs every `--allow-fixture <path>` bypass invocation of
`scripts/phi-scan.ts`. A bypass is **RECORDED AND REFUSED, never honored**, and
that is two rules rather than one:

1. The scanner refuses a `--allow-fixture <path>` flag outright UNLESS this file
   contains a `### <path>` subsection referencing the same path. An unlogged
   bypass is rejected (exit 2) before any target is read.
2. A **logged** bypass buys an audit trail and nothing else. The run reads and
   reports every target it did not withdraw, and then exits **2**, the
   could-not-complete code, naming what it withdrew. `--allow-fixture` cannot
   reach exit 0 in any mode.

**Why a withdrawal cannot report clean.** A withdrawn target is a file the run
enumerated and then never opened, and a scan that did not open a file has no
verdict about it. While the flag was honored it left no trace in the exit code,
so the same invocation over a corpus whose only violator was withdrawn reported
"OK: no hits" and exited 0.

So the only instrument that can subtract a detection and still leave a run able
to report clean is `scripts/phi-allow-list.txt` (a token-level, reviewed
declaration). Reach for that, never for a whole-file bypass, which silences
_every_ check for that file and refuses the run on top.

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

An entry is what makes a withdrawal legible afterwards: who signed for it, over
which path, and until when. It is not a grant, and the run it belongs to still
refuses.

## Entries

(none yet)

---
"@cosyte/transform": patch
---

Fix the PHI pre-commit gate reporting clean over a staged rename into a scan root.

`R` (rename) and `C` (copy) records are returned by neither `AM` nor `AMT`, so the `--staged`
route's `--diff-filter=AMT` deleted the whole two-path record before any mode or any content was
read. Measured on this repo's own scanner before the fix: `git mv notes/leak.txt src/leak.ts` over a
symbolic link to a name-bearing synthetic payload staged as `R100` at mode `120000` and printed
`OK - no hits` / exit 0, and a `git mv` of an ordinary file full of the same payload passed
identically. The hook is `phi-scan --staged`, so the gap is at pre-commit; the all-mode walk CI runs
does enumerate the renamed entry, which bounds the exposure to a local commit or a pushed branch
rather than a merge.

The remedy is `--no-renames`. With detection off git cannot emit `R` or `C` at all, so the
destination arrives as an ordinary single-path `A` and the source as a `D` the filter drops: no
two-path record shape, no stride work, and the enumeration is a strict superset of the previous one
under every `diff.renames` setting tested. Unmerged (`U`) records were dropped by the same filter
and are now refused instead, since a conflicted path has no single staged blob to scan.

Also fixes the scanner exiting `1`, its code for hits found, when it could not run at all: a missing
allow-list or an unreadable directory under a walk root threw out of the process on node's
uncaught-exception status. Every failure to complete now exits `2`.

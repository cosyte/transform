---
"@cosyte/transform": patch
---

No runtime impact: a repository-internal CI check now verifies this repository's own contributor instructions, which are not part of the published package.

The instructions live in two files, one always read and one read on demand, and until now nothing checked that the second one existed, that the sections it declares had any content, or that the cross-references between the two resolved. A new check refuses all three, refuses a cross-reference pointing at a file or path the repository does not carry, and refuses a relocated section that nothing points at any more.

It also refuses to report a clean run over a corpus it did not actually open: the files it read are reconciled against the list of files tracked by version control, and an empty or unreadable list is treated as a failure to run rather than as nothing to check.

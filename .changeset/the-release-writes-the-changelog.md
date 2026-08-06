---
"@cosyte/transform": patch
---

The published changelog no longer describes its own contents as unreleased: a release now writes its own version heading and its own entry into `CHANGELOG.md`.

`CHANGELOG.md` ships inside the npm tarball, and for the whole of this package's public history it carried no version heading at all. A single `[Unreleased]` heading spanned everything, and the preamble above it said the first pre-alpha release "will ship" the API surface listed below it, in a tarball that had already shipped that surface several versions earlier. Changesets now generates the changelog, so a release writes the version heading and the entry, and there is no hand-maintained section left to go stale.

The hand-written history is kept verbatim beneath a `Released before this file was generated` divider, with generated release sections above it, newest first. No entry was reworded, re-sorted or removed. What was dropped was scaffolding for the old hand-written workflow: the file's former header, the `[Unreleased]` heading and its link definition, the note beneath that heading promising a first release which had in fact already shipped, and the empty section stubs that existed to receive the next hand-written entry.

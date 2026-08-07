---
"@cosyte/transform": patch
---

The npm `description` no longer carries an em dash (`EMDASH-CONFORMANCE`).

The brand rule bans U+2014 on every cosyte surface, and this string is the most visible one the
package has: it is the subtitle on the npm package page and the one line shown in every npm search
result. It now reads with a colon, which is what the rule's own remedy list names first.

The `→` in the same string is U+2192, not an em dash, and it is load-bearing: it names the direction
of the transformation. It stays.

Scoped deliberately to the description alone. The full tree sweep for this repo is a separate unit,
still queued, and lands with the CI gate that keeps it swept.

---
"@cosyte/transform": patch
---

No runtime impact: punctuation only, plus a new repository-internal check that keeps it that way.

The Cosyte brand voice does not use the em dash (U+2014). This package carried 659 of them across
75 of its 98 tracked files, including the README, every documentation page that publishes to the
documentation site, and the source doc comments that compile into the shipped type declarations and
render in an editor on hover. All 609 that were in scope are rewritten with a period, a colon, a
comma or parentheses, chosen by what each sentence meant rather than by one blanket substitution.

No exported name, type, issue code, fatal code or documented behaviour changed. Two strings changed
punctuation and nothing else, and both belong to developer tooling rather than to the published
package: the PHI scanner's clean-run line, and one diagnostic from the check that verifies this
repository's own contributor instructions.

Two files still carry the character and each is an exemption with a written reason. The changelog's
dated archive below its "Released before this file was generated" heading is a frozen record whose
entries are byte identical to the tarballs they shipped in, and rewriting it would destroy the
evidence a changelog exists to hold. The vendored third-party tarball under `vendor/` holds the
character's bytes by coincidence inside a compressed stream, which no edit can remove.

The check that enforces the rule lands in the same change as the sweep, on purpose: a check arriving
before its sweep turns the build red on arrival, and a sweep arriving before its check lets the
character grow back. It reads bytes directly rather than shelling out, refuses to report a clean
result whenever it cannot prove it read its subject, and holds its own source to the same rule by
assembling every banned spelling at runtime instead of writing one down.

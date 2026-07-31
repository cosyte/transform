---
"@cosyte/transform": patch
---

The README no longer claims the package is unpublished, a few lines above its own `npm install`
instructions.

On the npm page that sentence rendered directly beneath npm's own header, which shows the version it
is serving, so the page argued with itself and a reader had no way to tell which half was current.
The corrected sentence names no version on purpose: a version written into prose is the part that
goes stale, and the registry is the only thing that knows which one is current.

---
"@cosyte/transform": patch
---

The PHI commit-gate now refuses a scan when an in-scope entry is not a regular file, instead of reading it as clean. A symbolic link under a scan root pointing at a file full of PHI passed both of the scanner's enumerating routes: the working-tree walk enumerates regular files only, and git stores a link as its target path under mode 120000, so reading the staged blob hands back the path text rather than the target's bytes.

Every entry the scan enumerates, and every path named directly, is now refused if it is not a regular file. Following one instead would read bytes the enumeration does not control — outside the repository, a loop, a device, or a FIFO that blocks the gate forever — and git does not carry those bytes anyway, so a hit on them would be a claim about something no commit contains. Refusing states the only true thing available: there is an entry here the scan cannot account for, so the scan is not clean. The mode that scans a path named on the command line did dereference, and reported hits from the far side of a link rather than reading it as clean; it is narrowed in the same change.

That is the whole of the claim, and it is deliberately not the broader one. Classifying an entry answers for the final path component, so a named path whose ancestor component is a symlink, and a plain absolute or parent-relative argument, are still followed and read. Both predate this change and neither is narrowed by it, because closing them means resolving and containing every path, which is a larger guard than the defect it would fix. Neither of the two modes that gate a commit reaches either.

Reading the staged side now admits a typechange. Replacing a tracked regular file with a link is neither an add nor a modify, so the record was being filtered away before any file mode could be read, and a mode-120000 blob passed green. Admitting it also covers the other direction, a tracked link replaced by a real file that carries PHI, which is a scan that must happen rather than a refusal.

A refusal names every offender by its own path in the repository plus a fixed token for its kind, and never the link target. A target path is working-tree text that can itself carry PHI, and a diagnostic about a PHI leak is itself a PHI surface. The scope of each route is unchanged: this narrows what those scopes admit, it does not widen them.

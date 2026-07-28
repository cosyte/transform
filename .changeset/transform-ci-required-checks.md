---
"@cosyte/transform": patch
---

CodeQL, actionlint and the rest of this repository's pull-request checks now block the merge, and
Dependabot watches its dependencies weekly.

The branch this package publishes from carried one binding rule, on a documentation check. Everything
that decides whether the code is correct was advisory: the typecheck, lint, format, PHI-scan, test,
gating-coverage, build, `attw` and dual ESM/CJS gates, the workflow lint, and the CodeQL analysis
could every one go red and the merge would still land. A repository ruleset now requires all of them,
each restricted to the GitHub Actions app so a status of the same name cannot be posted by anything
else, and it blocks branch deletion and force-push.

There was also no Dependabot configuration, so zero open update pull requests meant nothing was
looking rather than nothing being stale. Weekly version updates are now watched for both the npm
manifest and the workflow actions. That is not the same as automatic security-fix pull requests, and
it does not cover the two sibling packages this library reads and emits, which are installed for
development from local tarballs that no updater resolves; the configuration says so rather than
implying cover it does not have.

Stated narrowly: this makes a red check binding. It does not make a check correct, and it is not
observable from inside the package.

No library code, public export, issue code, mapping or emitted FHIR value changed. Nothing here is
observable by someone installing this package, which is why the opening sentence names the internal
gates by the words the shared release-note renderer classifies as internal-only: the entry records
the patch bump and is dropped from the published release body rather than reworded into it.

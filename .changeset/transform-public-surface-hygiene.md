---
"@cosyte/transform": patch
---

Documentation, JSDoc and diagnostic message text no longer describe internal build stages. The
README, the docs site pages, the module and converter doc comments a consumer's editor renders on
hover, and one runtime message all dropped that framing: `TRANSFORM_ELEMENT_DROPPED` told a reader
an element's conversion was "deferred to a later phase" and now says it is "not implemented". Where
a stage label was the only thing a heading said, the heading now names the capability instead: "The
six datatype converters", "Assemble a message". Citations pointing into planning documents a
consumer cannot open were removed from the same text.

No API, code or mapping change: every export, every issue code, every mapping and every clinical
value the transform derives is unchanged. **One thing to check if you snapshot it:** that message
text is carried on `TransformIssue.message` for every issue this code raises, is readable from
`ISSUE_REGISTRY[TRANSFORM_ELEMENT_DROPPED].message`, and is copied by `toOperationOutcome` into
`OperationOutcome.issue[].details.text`. All three read differently now. The code itself, which is
what you should branch on, did not change.

`pnpm check:no-internal-refs` now enforces this on every pull request, over the README, `LICENSE`,
`docs-content/`, the npm `description` and `keywords`, `src/` doc comments and `src/` message
strings.

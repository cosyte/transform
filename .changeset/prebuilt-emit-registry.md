---
"@cosyte/transform": patch
---

`toFhir` no longer rebuilds a schema registry for every resource it checks. Its emit gate handed
`@cosyte/fhir`'s `validateResource` the resource's own emit schema as `schemas`, which merges it with
the built-in schemas into a new registry on every call. It now builds one registry per emit schema
with `buildRegistry`, the first time it checks a resource of that type, and passes it as `registry`
to every later call. Every bundle, resource and issue is the same as before. The `@cosyte/fhir` peer
dependency now needs 0.1.12 or later, the first release whose `validateResource` reads a `registry`:
if you pin an older `@cosyte/fhir`, upgrade it to 0.1.12 or later with this release. The public API
is unchanged.

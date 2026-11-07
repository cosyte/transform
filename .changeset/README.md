# Changesets

This folder is managed by [Changesets](https://github.com/changesets/changesets). Changesets drives
the **version bump**, the **publish**, and the **release section in `CHANGELOG.md`** for
`@cosyte/transform`: a release writes its own version heading there from the changesets it consumed.
So **the changeset summary is the changelog entry**. Write it there and do not hand-edit
`CHANGELOG.md`, whose sections above `## Released before this file was generated` are generated
output.

Add a changeset for every meaningful change:

```bash
pnpm changeset
```

The package is on the 0.1 line. Below 1.0, pick **minor** for a breaking change (renaming or
removing an export, an option, a result shape or an issue code), which the changeset calls out,
and **patch** for a fix that changes no emitted value, as the 0.1.0 entry in `CHANGELOG.md`
promises. The release rules every Cosyte package follows are in the umbrella's
`plans/standards.md` (ST16 and ST35).

# docs/superpowers — purged 2026-07-12 (owner directive)

The 93 specs / plans / handoffs / audits that lived here were session
artifacts, superseded by the current-state notes in `docs/design/*.md`.
They were removed in the 2026-07-12 repo cleanup; **every file remains in
git history**.

To read a purged file:

```
# find the deletion commit
git log --oneline --diff-filter=D -- docs/superpowers | head -1

# show a file as it was just before deletion (replace <hash> with that commit)
git show <hash>~1:docs/superpowers/plans/2026-06-04-god-component-decomposition.md
```

Any `docs/superpowers/...` path cited in `docs/debt.md`, the design
notes, code comments, or memory files resolves this way. Do not re-add
new session specs/plans here — route per CLAUDE.md → "Maintaining this
file" (design state → `docs/design/`, debt → `docs/debt.md`, lessons →
`docs/lessons-learned.md`).

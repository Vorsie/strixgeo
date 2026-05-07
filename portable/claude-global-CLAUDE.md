# User-level Claude Code instructions
# Applies to every project unless overridden by a project CLAUDE.md.

## Maintenance Rules

These apply to every task, without being asked:

- **Keep CLAUDE.md current** — whenever code structure, conventions, or architecture decisions change, update the relevant section in the same commit. Never let the file drift from the actual codebase.
- **Keep settings files current** — if permissions or hooks change, update `.claude/settings.json` or `.claude/settings.local.json` accordingly.
- **One file per commit** — stage and commit files individually, always following Conventional Commits format.

---

## Git Workflow — Conventional Commits

```
<type>(<scope>): <description>
```

| Type | Use |
|---|---|
| `feat` | new feature |
| `fix` | bug fix |
| `docs` | documentation |
| `refactor` | restructure, no behaviour change |
| `test` | tests |
| `chore` | config, dependencies, build |
| `perf` | performance |

Rules: present tense, lowercase, no trailing period, ≤ 72 chars on first line.

---

## Issue Format

**Title:** `[type] short description`

**Body:**
```markdown
## Description
## Acceptance Criteria
- [ ] ...
## Notes
```

**Labels:** type (`feat`, `bug`, ...) + layer + phase if applicable

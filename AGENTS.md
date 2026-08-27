# AGENTS.md — pointer only

**The project rules live in [CLAUDE.md](CLAUDE.md). Read that file, not this one.**

This file exists because several tools (Cursor, Codex, and others) look for
`AGENTS.md` by convention. It used to be a full 36 KB COPY of `CLAUDE.md`,
which drifted out of sync within days — by 2026-08-23 the two disagreed, and a
second normative file that contradicts the first is worse than no second file
at all. So it is a pointer now, and must stay one.

## Where everything is

| What you need | File |
|---|---|
| Architecture map + hard-rules digest for any AI agent | `AI.md` |
| Project rules, architecture, conventions, Definition of Done | `CLAUDE.md` |
| Current session state, owner decisions, open dogfeed items | `CLAUDE.local.md` (gitignored) |
| The debt backlog (canonical) | `docs/debt.md` |
| Current-state design of a subsystem | `docs/design/*.md` |
| Transferable engineering lessons | `docs/lessons-learned.md` |
| Timings / baselines | `docs/benchmarks-journal.md` |

There is no `Codex.local.md`. Session state has only ever been in
`CLAUDE.local.md` — an earlier version of this file pointed at a filename that
does not exist.

## Two rules that bite hardest, repeated here on purpose

Everything else is in `CLAUDE.md`, but these two destroy data if missed:

1. **Never run `pytest tests/integration` directly.** Use
   `.\scripts\run-integration-tests.ps1`. A bare run TRUNCATEs whatever
   `DATABASE_URL` points at — including the dev database.
2. **Run `vitest` from `desktop/`, never the repo root.** A stray worktree at
   the root gets swept in and reports thousands of phantom failures.

## If your tool is not Claude Code

The git hooks (`.githooks/pre-commit`, `.githooks/pre-push`) are git-level and
fire in any client — enable once per clone with
`git config core.hooksPath .githooks`.

The formatting hooks are NOT. Claude Code auto-runs `ruff format` and
`ruff check --fix` after every Python write, and a length check after every
`desktop/**/*.ts(x)` write, via `.claude/settings*.json`. No other agent fires
those, so run them by hand:

```
uv run ruff format <file>
uv run ruff check --fix <file>
```

Otherwise the pre-commit hook is the first thing that notices, later and louder.

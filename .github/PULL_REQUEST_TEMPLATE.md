## Summary

<!-- What changes and why, in a few sentences. Link the issue: Closes #123 -->

## What the tests prove

<!-- One line per test or test file: the behaviour it pins, in the words of the rule. -->
- 

## Checklist

- [ ] Title follows Conventional Commits: `type(scope): description` (feat, fix, docs, refactor, test, chore, perf)
- [ ] Every behaviour change has a test, written before the fix and seen red
- [ ] Docs updated where the behaviour is described (docs/, CLAUDE.md sections, i18n catalogues NL + EN)
- [ ] No design calculation added (bearing capacity, settlement, slope, piles, walls stay out of scope)
- [ ] Every commit carries `Signed-off-by` (DCO: `git commit -s`)
- [ ] `uv run ruff check src tests`, `uv run ruff format --check src tests`, `uv run mypy src`, `uv run pytest tests/unit`, `npm test` and the three `tsc` configs pass locally

---
name: strix-suggestion-eval
description: Use when you changed or want to validate a Strix suggestion algorithm (pinch-out / body-detect / litho-segmenter / correlation) and a real project already has the correct answer hand-marked — i.e. you would otherwise open the section, eyeball the algorithm output against your manual marks, and count where it diverges. Triggers on "run the algorithm and compare it to my manual marks", "did my rule change make it better or worse", "39/42", regression-checking a suggestion rule.
---

# Strix Suggestion Eval

## Overview

Strix suggestion algorithms (the R1 pinch-out rule, body detection, the Robertson
litho segmenter, auto-correlation) emit candidates the engineer accepts or rejects.
You grade them the slow way: open a `.strix` section you've hand-marked, eyeball the
ghosts against your marks, count misses in your head.

**This skill generates the algorithm output AND grades it against your marks in one
pass** — confusion matrix, precision/recall per decision, and the misses *with
geological context*, so you see the *pattern* ("all misses are 1-member thin lenses"),
not a bare score. Your marks are the labels; the algorithm is under test.

**Core principle:** an answer isn't trustworthy until it's graded against ground truth
you control. Generate and verify are one step.

## When to Use

- You edited a suggestion rule and want to know if it helped or regressed — **before**
  committing.
- You hand-marked the correct answer in a real project (`test2.strix` CS1, the "39/42"
  reference) and want the algorithm scored against it.
- You're about to claim "it matches my intent now" — grade it first.

**Not for:** no hand-marks exist yet (mark the section first), or you're checking
rendering/behaviour rather than algorithm *decisions* (use the Playwright e2e suite).

## Deterministic vs judgment (what is script, what is AI)

The fixed, repeatable work is a committed script — same result every run, zero tokens.
AI is reserved for the calls that need geological judgment.

| Step | Owner | Why |
|---|---|---|
| Extract ground truth (`provenance='user'` extents) | **script** | Fixed SQL. |
| Run algorithm un-suppressed in a rolled-back txn | **script** | Mechanical; must never mutate. |
| Confusion matrix, precision/recall, miss list | **script** | Pure arithmetic. |
| Is the miss *pattern* meaningful or noise? | AI | Needs domain reading. |
| Is the rule change an improvement / overfit? | AI | Judgment across sections. |

Script: **`scripts/eval_suggestions.py`** (run it; don't re-derive its output by hand).

## Ground truth per target

| `--target` | Algorithm | Ground-truth marker | Status |
|---|---|---|---|
| `pinch_out` | `SuggestBodyPinchOuts` (R1) | `body.extent_*_provenance='user'` | shipped |
| body detect | `DetectBodies` / resolver | `litho_layer.body_id` vs your correlations | add branch |
| correlation | auto-correlate | `litho_contact_correlation_edge.user_approved` | add branch |
| litho segment | Robertson segmenter | `litho_layer.status='accepted'` soil code | add branch |

Same shape for all four — extend the script's `--target`, never fork the skill.

## Workflow

1. Hand-mark the correct answer in the section (those marks are the labels).
2. Run — auto-selects the model you were just dogfeeding:
   ```
   uv run python scripts/eval_suggestions.py --target pinch_out --section-id <uuid>
   ```
   **Pass `--section-id`** — R1's "open at the section's first/last column" is
   section-relative; without it, edge units never get an `open` candidate and every
   `open` mark reads as a false miss.
3. Read the **misses column**, not just the match count — a pattern localises the bug.
4. Change the rule, re-run, diff the two reports. Improvement = match count up *without*
   a new miss pattern. Re-run on a second marked project to catch overfit.

The harness mutates nothing: it nulls user extents inside a transaction, runs the
algorithm un-suppressed, collects candidates, then **rolls back**.

## Verification Step

The report IS the verification. Before trusting any "it's better" claim, confirm:

- **Match fraction is printed against real marks** (`matched 39/42`), not asserted.
- **Misses have a stated pattern or are declared noise** — "3 misses, all thin-lens
  picks" is a finding; "3 misses" is not.
- **A second marked project agrees**, or you explicitly accept single-section scope.

You are NOT done if: you eyeballed a screenshot instead of running it; the run had
`support 0` on the decision you care about (blind, not passing); or you tuned to 100%
on one section without checking a second.

**Composes with `superpowers:verification-before-completion`** — same evidence-before-
assertions rule; this skill is its Strix-algorithm instance, not a re-statement.

## Worked example (real run, this repo)

```
ALGORITHM vs YOUR MARKS — matched 12/32

confusion (row = your mark, col = algorithm):
            band   pinch    open
   pinch       5      12       0
    open      11       3       0      ← algorithm emitted ZERO opens
```

The empty `open` column instantly localised the bug to the section-edge branch — a
finding the visual eyeball missed across several dogfeed turns. Re-run with
`--section-id` to grade `open` fairly.

## Common Mistakes

| Mistake | Fix |
|---|---|
| Reading only the match count | The miss *pattern* is the finding. |
| Judging a section-scoped decision model-wide | Pass `--section-id`. |
| Tuning to 100% on one section | Re-run on a second marked project — that's overfit. |
| Eyeballing a screenshot | The harness caught the empty-`open` bug screenshots missed. |
| Treating `support 0` as a pass | Zero marks = blind, not correct. |
| Mutating the project to run the algo | The harness rolls back — never commit the null step. |

## Self-check

If you ran the eval, said the rule was good, and the user then dogfeeds **2+ rounds of
the same divergence** → the eval's ground-truth mapping or section scoping is missing
the case the user keeps seeing. Stop tuning; invoke `superpowers:writing-skills` and
extend `eval_suggestions.py` to grade that case before continuing.

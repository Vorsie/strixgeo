import { describe, expect, it } from 'vitest'

import { reconcileLumping } from './recoveryReconcile'
import type { StratigraphyLumping } from './projectFile'

// The design's reconciliation table (docs/design/autosave-recovery.md §3)
// has exactly four rows, and the rule it states first is the one these tests
// are shaped around: "revision wins, never the clock". Each test below
// paraphrases one row of that table in the table's own words.

function lumping(map: Record<string, string>): StratigraphyLumping {
  return { schema_version: 1, applied_at: '2026-08-02T10:00:00Z', map }
}

describe('reconcileLumping', () => {
  it('revisions equal → no discrepancy, skip entirely (the common case)', () => {
    const map = lumping({ a: 'A' })
    const outcome = reconcileLumping(
      { lumping: map, revision: 7 },
      { lumping: lumping({ a: 'A' }), revision: 7 },
    )
    expect(outcome.action).toBe('skip')
  })

  it('file revision higher → the PATCH never landed, so the file wins', () => {
    const fileMap = lumping({ a: 'A', b: 'B' })
    const outcome = reconcileLumping(
      { lumping: fileMap, revision: 9 },
      { lumping: lumping({ a: 'A' }), revision: 7 },
    )
    expect(outcome).toEqual({
      action: 'replay-file',
      revision: 9,
      lumping: fileMap,
      reason: expect.any(String),
    })
  })

  it('DB revision higher → the crash beat the debounce, so the DB wins', () => {
    const outcome = reconcileLumping(
      { lumping: lumping({ a: 'A' }), revision: 4 },
      { lumping: lumping({ a: 'A', b: 'B' }), revision: 8 },
    )
    expect(outcome.action).toBe('prefer-database')
    if (outcome.action === 'prefer-database') expect(outcome.conflict).toBe(false)
  })

  it('equal revision, different content → a bug not a conflict: prefer the DB, loudly', () => {
    const outcome = reconcileLumping(
      { lumping: lumping({ a: 'A' }), revision: 5 },
      { lumping: lumping({ a: 'DIFFERENT' }), revision: 5 },
    )
    expect(outcome.action).toBe('prefer-database')
    // ``conflict`` is what makes the caller log at error rather than debug —
    // the design says this row is a bug and must be noisy.
    if (outcome.action === 'prefer-database') expect(outcome.conflict).toBe(true)
  })

  it('treats a never-staged side as lower than any staged one (null is not zero)', () => {
    // A null revision means "never staged by a revision-aware client". It has
    // to lose to any real revision, and two nulls have to compare as equal —
    // the design forbids falling back to a clock to break the tie.
    const fileMap = lumping({ a: 'A' })
    const fileWins = reconcileLumping(
      { lumping: fileMap, revision: 1 },
      { lumping: null, revision: null },
    )
    expect(fileWins.action).toBe('replay-file')

    const dbWins = reconcileLumping(
      { lumping: null, revision: null },
      { lumping: fileMap, revision: 2 },
    )
    expect(dbWins.action).toBe('prefer-database')

    const bothNever = reconcileLumping(
      { lumping: fileMap, revision: null },
      { lumping: lumping({ a: 'A' }), revision: null },
    )
    expect(bothNever.action).toBe('skip')
  })
})

import { describe, expect, it } from 'vitest'

import { formatRecoveryAge } from './recoveryAge'

// The recovery prompt has to answer "how old is this?" at a glance. The
// engineer's question is never "how many milliseconds" — it is "is this from
// the session I just lost, or from last week?" — so the phrasing is
// day-relative near the present and calendar-dated further back.

describe('formatRecoveryAge', () => {
  it('says "today" plus the wall time for a file written earlier the same day', () => {
    const now = new Date(2026, 7, 2, 18, 5)
    const written = new Date(2026, 7, 2, 14, 32)
    expect(formatRecoveryAge(written.toISOString(), now)).toBe('today 14:32')
  })

  it('says "yesterday" for the previous calendar day, not "24 hours ago"', () => {
    const now = new Date(2026, 7, 2, 9, 0)
    const written = new Date(2026, 7, 1, 23, 5)
    expect(formatRecoveryAge(written.toISOString(), now)).toBe('yesterday 23:05')
  })

  it('falls back to a calendar date once the file is older than yesterday', () => {
    const now = new Date(2026, 7, 2, 9, 0)
    const written = new Date(2026, 6, 12, 8, 7)
    expect(formatRecoveryAge(written.toISOString(), now)).toBe('12 Jul 08:07')
  })

  it('degrades to a neutral phrase rather than throwing on an unreadable stamp', () => {
    // The timestamp comes off disk. A corrupt one must cost the age line, not
    // the recovery offer.
    expect(formatRecoveryAge('not-a-date', new Date(2026, 7, 2))).toBe('an unknown time')
  })
})

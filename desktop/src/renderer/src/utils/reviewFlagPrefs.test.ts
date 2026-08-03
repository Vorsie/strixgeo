import { describe, expect, it } from 'vitest'

import {
  addDismissedReviewFlag,
  buildReviewFlagPatch,
  readDismissedReviewFlags,
  reviewFlagId,
} from './reviewFlagPrefs'

describe('reviewFlagPrefs', () => {
  it('reviewFlagId is a stable layerId|gap|side key', () => {
    expect(reviewFlagId({ layerId: 'L1', gapIndex: 2, side: 'left' })).toBe('L1|2|left')
    expect(reviewFlagId({ layerId: 'L1', gapIndex: 2, side: 'right' })).toBe('L1|2|right')
  })

  it('reads an empty set from missing / malformed view_state', () => {
    expect(readDismissedReviewFlags(null).size).toBe(0)
    expect(readDismissedReviewFlags(undefined).size).toBe(0)
    expect(readDismissedReviewFlags({}).size).toBe(0)
    expect(readDismissedReviewFlags({ review_flags: { dismissed: 'not-an-array' } }).size).toBe(0)
  })

  it('reads the dismissed id set out of the bag (strings only)', () => {
    const set = readDismissedReviewFlags({ review_flags: { dismissed: ['L1|2|left', 'L2|0|right', 42] } })
    expect(set.has('L1|2|left')).toBe(true)
    expect(set.has('L2|0|right')).toBe(true)
    expect(set.size).toBe(2) // the non-string 42 is dropped
  })

  it('buildReviewFlagPatch shallow-merges only the review_flags key', () => {
    const patch = buildReviewFlagPatch(new Set(['L1|2|left']))
    expect(patch).toEqual({ review_flags: { dismissed: ['L1|2|left'] } })
    expect(Object.keys(patch)).toEqual(['review_flags'])
  })

  // "Keep separate" is persisted so the flag does not re-nag. Two clicks in a row
  // must therefore leave BOTH flags dismissed — the section row only catches up
  // after its PATCH comes back, so the second click cannot build its patch from the
  // row alone or the first flag comes back on the next refresh.
  it('dismissing a second flag before the first PATCH returns keeps BOTH dismissed', () => {
    const rowBeforeAnyPatch = { review_flags: { dismissed: ['old|0|left'] } }
    const afterFirst = addDismissedReviewFlag(rowBeforeAnyPatch, new Set(), 'A|1|left')
    // The row has NOT caught up — the second click sees the same stale view_state.
    const afterSecond = addDismissedReviewFlag(rowBeforeAnyPatch, afterFirst, 'B|2|right')
    expect([...afterSecond].sort()).toEqual(['A|1|left', 'B|2|right', 'old|0|left'])
  })

  it('keeps a dismissal the server has already stored plus one still in flight', () => {
    // The first PATCH landed, so the row now carries A; B is still in flight.
    const rowAfterFirst = { review_flags: { dismissed: ['A|1|left'] } }
    const merged = addDismissedReviewFlag(rowAfterFirst, new Set(['B|2|right']), 'C|3|left')
    expect([...merged].sort()).toEqual(['A|1|left', 'B|2|right', 'C|3|left'])
  })

  it('dismissing the same flag twice is a no-op', () => {
    const first = addDismissedReviewFlag(null, new Set(), 'A|1|left')
    const second = addDismissedReviewFlag(null, first, 'A|1|left')
    expect([...second]).toEqual(['A|1|left'])
  })

  it('round-trips: read(build(set)) === set', () => {
    const original = new Set(['A|0|left', 'B|1|right'])
    const patch = buildReviewFlagPatch(original)
    const readback = readDismissedReviewFlags(patch as Record<string, unknown>)
    expect(readback).toEqual(original)
  })
})

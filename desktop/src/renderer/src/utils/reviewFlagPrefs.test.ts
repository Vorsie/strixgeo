import { describe, expect, it } from 'vitest'

import { buildReviewFlagPatch, readDismissedReviewFlags, reviewFlagId } from './reviewFlagPrefs'

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

  it('round-trips: read(build(set)) === set', () => {
    const original = new Set(['A|0|left', 'B|1|right'])
    const patch = buildReviewFlagPatch(original)
    const readback = readDismissedReviewFlags(patch as Record<string, unknown>)
    expect(readback).toEqual(original)
  })
})

// Unit pins for formatAcceptParentSummary (debt #87) and formatStraddleSummary (debt #76).

import { describe, expect, it } from 'vitest'

import type { AcceptLithoSuggestionsResponse } from '../api/client'
import { formatAcceptParentSummary, formatStraddleSummary } from './acceptLithoSummary'

function base(): AcceptLithoSuggestionsResponse {
  return {
    created_formation_ids: [],
    found_formation_ids: [],
    created_contact_ids: [],
    found_contact_ids: [],
    straddle_split_count: 0,
    stale_tin_fallback_count: 0,
    updated_section: null,
  }
}

describe('formatAcceptParentSummary', () => {
  it('A1 — returns null when neither list is present', () => {
    expect(formatAcceptParentSummary(base())).toBeNull()
  })

  it('A2 — returns null when both arrays are empty', () => {
    expect(
      formatAcceptParentSummary({
        ...base(),
        extrapolated_formation_ids: [],
        orphan_formation_ids: [],
      }),
    ).toBeNull()
  })

  it('A3 — extrapolated only: singular wording', () => {
    const s = formatAcceptParentSummary({
      ...base(),
      extrapolated_formation_ids: ['f-1'],
    })
    expect(s?.kind).toBe('warning')
    expect(s?.extrapolatedCount).toBe(1)
    expect(s?.orphanCount).toBe(0)
    expect(s?.message).toBe('1 parent extrapolated — review in Lithology inspector')
  })

  it('A4 — extrapolated only: plural wording', () => {
    const s = formatAcceptParentSummary({
      ...base(),
      extrapolated_formation_ids: ['a', 'b', 'c'],
    })
    expect(s?.message).toBe('3 parents extrapolated — review in Lithology inspector')
  })

  it('A5 — orphan only: count + wording', () => {
    const s = formatAcceptParentSummary({
      ...base(),
      orphan_formation_ids: ['a', 'b'],
    })
    expect(s?.extrapolatedCount).toBe(0)
    expect(s?.orphanCount).toBe(2)
    expect(s?.message).toBe('2 unassigned — review in Lithology inspector')
  })

  it('A6 — both: combined wording in fixed order', () => {
    const s = formatAcceptParentSummary({
      ...base(),
      extrapolated_formation_ids: ['a'],
      orphan_formation_ids: ['x', 'y'],
    })
    expect(s?.message).toBe(
      '1 parent extrapolated, 2 unassigned — review in Lithology inspector',
    )
  })
})

// ---------------------------------------------------------------------------
// formatStraddleSummary — debt #76
// ---------------------------------------------------------------------------
//
// S1  Returns null when straddle_split_count is 0.
// S2  Returns null when straddle_split_count is absent (undefined).
// S3  Returns a message for count = 1 with singular wording.
// S4  Returns a message for count > 1 with plural wording.

describe('formatStraddleSummary', () => {
  it('S1 — returns null when straddle_split_count is 0', () => {
    expect(formatStraddleSummary(base())).toBeNull()
  })

  it('S2 — returns null when straddle_split_count is absent (undefined)', () => {
    // Simulate an older response payload that doesn't carry the field.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r: any = { ...base() }
    delete r.straddle_split_count
    expect(formatStraddleSummary(r as ReturnType<typeof base>)).toBeNull()
  })

  it('S3 — singular message for count = 1', () => {
    const msg = formatStraddleSummary({ ...base(), straddle_split_count: 1 })
    expect(msg).toBe('1 layer split at a formation boundary — expected (each produces 2 contacts)')
  })

  it('S4 — plural message for count > 1', () => {
    const msg = formatStraddleSummary({ ...base(), straddle_split_count: 3 })
    expect(msg).toBe('3 layers split at a formation boundary — expected (each produces 2 contacts)')
  })
})

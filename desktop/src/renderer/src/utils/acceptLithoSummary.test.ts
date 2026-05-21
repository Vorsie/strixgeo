// Unit pins for formatAcceptParentSummary (debt #87).

import { describe, expect, it } from 'vitest'

import type { AcceptLithoSuggestionsResponse } from '../api/client'
import { formatAcceptParentSummary } from './acceptLithoSummary'

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

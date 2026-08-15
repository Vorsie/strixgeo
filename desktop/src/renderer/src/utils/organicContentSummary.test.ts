// Owner ask (dogfeed 2026-08-15): "maybe put organic matter content some where
// in the psd popup on hover too".
//
// Organic MATTER and organic CARBON are different quantities, so the pick has
// to carry which one it found — a carbon value shown under a matter label is a
// wrong number, not a wrong word.
//
//   OC1  a row with matter → matter
//   OC2  a row with only carbon → carbon, named as carbon
//   OC3  matter is preferred across the whole list, not just the first row
//   OC4  a row with both reports the matter it measured
//   OC5  nothing measured → nothing to show

import { describe, expect, it } from 'vitest'

import { selectOrganicContent } from './organicContentSummary'
import type { OrganicContentResponse } from '../api/clients/borehole'

const test = (
  id: string,
  carbon_pct: number | null,
  matter_pct: number | null,
): OrganicContentResponse => ({ id, carbon_pct, matter_pct, method: null, test_date: null })

describe('selectOrganicContent', () => {
  it('OC1 — a matter reading is reported as matter', () => {
    expect(selectOrganicContent([test('o-1', null, 4.2)])).toEqual({
      quantity: 'matter',
      pct: 4.2,
    })
  })

  it('OC2 — a carbon-only reading is reported as carbon', () => {
    expect(selectOrganicContent([test('o-1', 2.4, null)])).toEqual({
      quantity: 'carbon',
      pct: 2.4,
    })
  })

  it('OC3 — matter anywhere in the list beats a carbon-only first row', () => {
    expect(selectOrganicContent([test('o-1', 2.4, null), test('o-2', null, 4.2)])).toEqual({
      quantity: 'matter',
      pct: 4.2,
    })
  })

  it('OC4 — a row carrying both reports its matter', () => {
    expect(selectOrganicContent([test('o-1', 2.4, 4.2)])).toEqual({
      quantity: 'matter',
      pct: 4.2,
    })
  })

  it('OC5 — no reading at all is nothing to show', () => {
    expect(selectOrganicContent([])).toBeNull()
    expect(selectOrganicContent([test('o-1', null, null)])).toBeNull()
  })
})

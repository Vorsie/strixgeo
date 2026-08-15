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
//
// Owner (dogfeed 2026-08-15): "impossible, i'm 100% sure some have gehalte aan
// organisch materiaal, it's even under organic matter content in the data
// stage". He was right: on his project the typed organic family is EMPTY and
// the reading sits in the scalar catch-all instead, under a DOV parameter name
// that repeats itself. The card must find it there too.
//
//   OC6  the typed family still wins whenever it carries a reading
//   OC7  typed empty → the scalar catch-all supplies the value
//   OC8  the doubled DOV parameter string matches
//   OC9  a scalar row with no number is not a reading
//   OC10 a different scalar parameter is never mistaken for organic matter

import { describe, expect, it } from 'vitest'

import { selectOrganicContent } from './organicContentSummary'
import type {
  OrganicContentResponse,
  ScalarLabTestResponse,
} from '../api/clients/borehole'

const test = (
  id: string,
  carbon_pct: number | null,
  matter_pct: number | null,
): OrganicContentResponse => ({ id, carbon_pct, matter_pct, method: null, test_date: null })

/**
 * The parameter string his DOV data actually carries — the name is repeated
 * inside its own parentheses, so an equality match would never fire.
 */
const DOV_ORGANIC_MATTER = 'Gehalte Organische stoffen (Gehalte Organische stoffen)'

const scalar = (
  parameter: string,
  value_numeric: number | null,
  id = 'sc-1',
): ScalarLabTestResponse => ({
  id,
  parameter_group: 'Onderkenning - proeven',
  parameter,
  value_numeric,
  value_text: null,
  unit: '%',
  method: null,
  test_date: null,
  detection_condition: null,
})

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
    // Neither family carrying anything is still nothing to show.
    expect(selectOrganicContent([], [])).toBeNull()
  })

  it('OC6 — a project whose parser DID route the typed family keeps working', () => {
    // The typed reading is the one the parser understood; the catch-all row is
    // the same measurement seen raw. Typed wins so a project that has both
    // reads exactly as it did before the catch-all was consulted at all.
    expect(
      selectOrganicContent([test('o-1', null, 4.2)], [scalar(DOV_ORGANIC_MATTER, 9.9)]),
    ).toEqual({ quantity: 'matter', pct: 4.2 })
  })

  it('OC7 — "it\'s even under organic matter content in the data stage": the scalar row is read', () => {
    // His live project: zero typed organic rows, the number sitting in the
    // catch-all. The DOV quantity is organic MATTER (percent), so it must be
    // reported as matter — never under the carbon label.
    expect(selectOrganicContent([], [scalar(DOV_ORGANIC_MATTER, 3.7)])).toEqual({
      quantity: 'matter',
      pct: 3.7,
    })
  })

  it('OC8 — the doubled DOV parameter string matches, whatever its case', () => {
    expect(
      selectOrganicContent([], [scalar(DOV_ORGANIC_MATTER.toUpperCase(), 1.25)]),
    ).toEqual({ quantity: 'matter', pct: 1.25 })
  })

  it('OC9 — a scalar row with no number is not a reading', () => {
    // A row that exists but was never measured must render nothing, exactly as
    // an absent test does — never a "0 %" the engineer would read as measured.
    expect(selectOrganicContent([], [scalar(DOV_ORGANIC_MATTER, null)])).toBeNull()
  })

  it('OC10 — the calcareous-content row is never mistaken for organic matter', () => {
    // The neighbouring DOV parameter in the same group is doubled the same way
    // and also reports a percent — matching loosely would print the lime
    // content under an organic label.
    expect(
      selectOrganicContent(
        [],
        [scalar('Gehalte Kalkachtige stoffen (Gehalte Kalkachtige stoffen)', 12.5)],
      ),
    ).toBeNull()
  })
})

// The two confirmations of the PDF borehole import, in the owner's words
// (rulings 2026-10-08, 3 and 4):
//
//   C1  X/Y printed without a system is Lambert 72 "but the user confirms it at
//       import": a flagged row is NOT ready until a CRS choice is made.
//   C2  the three choices: "this test is Lambert 72", "all tests in this report
//       are Lambert 72", "another CRS" + a dropdown; each becomes the body's
//       ``crs: {epsg, scope}``.
//   C3  "all tests in this report" answers every flagged row at once.
//   C4  a bare water level ("GWS: 380") reads as cm below ground, "shown to the
//       user for confirmation": not ready until confirmed; the body says so.
//   C5  a row with no assumption needs nothing and sends no confirmation.
//   C6  ruling 5: two prints of one borehole ticked together is a clash.

import { describe, expect, it } from 'vitest'

import type { BoreholePdfRow } from '../../api/clients/boreholePdf'
import {
  applyCrsChoice,
  buildImportItems,
  initialSelection,
  missingConfirmations,
  repeatClash,
  type RowDecisions,
} from './boreholePdfConfirmations'

function row(over: Partial<BoreholePdfRow>): BoreholePdfRow {
  return {
    key: 'B-1@p1',
    name: 'B-1',
    profile: 'boorprofiel',
    pages: [1],
    text_verdict: 'text',
    parses_rows: true,
    x: 1,
    y: 2,
    epsg: 31370,
    crs_assumed: false,
    ground_level_m: 6.5,
    z_epsg: 5710,
    date_text: null,
    date_iso: null,
    driller: null,
    project_code: null,
    project_name: null,
    depth_top_m: 0,
    depth_base_m: 5,
    repeat_of: null,
    repeat_differences: [],
    parsed: true,
    n_intervals: 3,
    n_samples: 0,
    water_level_m: null,
    water_unit_assumed: false,
    findings: [],
    importable: true,
    ...over,
  }
}

const FLAGGED = row({ key: 'B-2@p1', name: 'B-2', crs_assumed: true, water_unit_assumed: true, water_level_m: 3.8 })
const OTHER_FLAGGED = row({ key: 'B-3@p2', name: 'B-3', crs_assumed: true })
const PLAIN = row({ key: 'B-1@p1' })

describe('borehole PDF confirmations', () => {
  it('C1/C4: a flagged row waits for both confirmations', () => {
    expect(missingConfirmations(FLAGGED, {})).toEqual(['CRS_ASSUMED', 'WATER_UNIT_ASSUMED'])
    const decided: RowDecisions = { 'B-2@p1': { crs: { kind: 'this' }, waterConfirmed: true } }
    expect(missingConfirmations(FLAGGED, decided)).toEqual([])
  })

  it('C2: each choice becomes crs {epsg, scope} in the body', () => {
    const rows = [FLAGGED]
    const pick = (crs: RowDecisions[string]['crs']) =>
      buildImportItems(rows, new Set(['B-2@p1']), { 'B-2@p1': { crs, waterConfirmed: true } })[0]
    expect(pick({ kind: 'this' }).crs).toEqual({ epsg: 31370, scope: 'this' })
    expect(pick({ kind: 'report' }).crs).toEqual({ epsg: 31370, scope: 'report' })
    expect(pick({ kind: 'other', epsg: 28992 }).crs).toEqual({ epsg: 28992, scope: 'this' })
    expect(pick({ kind: 'this' }).water_unit_confirmed).toBe(true)
  })

  it('C3: "all boreholes of this report" answers every flagged row', () => {
    const decisions = applyCrsChoice([FLAGGED, OTHER_FLAGGED, PLAIN], {}, 'B-2@p1', { kind: 'report' })
    expect(decisions['B-2@p1'].crs).toEqual({ kind: 'report' })
    expect(decisions['B-3@p2'].crs).toEqual({ kind: 'report' })
    expect(decisions['B-1@p1']).toBeUndefined()
    expect(missingConfirmations(OTHER_FLAGGED, decisions)).toEqual([])
  })

  it('C3: a later "this test" on one row changes that row only', () => {
    const all = applyCrsChoice([FLAGGED, OTHER_FLAGGED], {}, 'B-2@p1', { kind: 'report' })
    const one = applyCrsChoice([FLAGGED, OTHER_FLAGGED], all, 'B-3@p2', { kind: 'other', epsg: 28992 })
    expect(one['B-2@p1'].crs).toEqual({ kind: 'report' })
    expect(one['B-3@p2'].crs).toEqual({ kind: 'other', epsg: 28992 })
  })

  it('C5: a row with no assumption needs nothing and sends no confirmation', () => {
    expect(missingConfirmations(PLAIN, {})).toEqual([])
    const [item] = buildImportItems([PLAIN], new Set(['B-1@p1']), {})
    expect(item).toEqual({ key: 'B-1@p1' })
  })

  it('C6: two ticked prints of one borehole clash; one print alone does not', () => {
    const first = row({ key: 'B-9@p3', name: 'B-9' })
    const repeat = row({ key: 'B-9@p40', name: 'B-9', repeat_of: 'B-9@p3' })
    expect(repeatClash([first, repeat], new Set(['B-9@p3', 'B-9@p40']))).toBe(true)
    expect(repeatClash([first, repeat], new Set(['B-9@p40']))).toBe(false)
  })

  it('starts with the importable rows ticked, a differing repeat and an unparsed row unticked', () => {
    const repeat = row({ key: 'B-1@p9', name: 'B-1', repeat_of: 'B-1@p1' })
    const generic = row({ key: 'X@p5', parsed: false, importable: false })
    expect([...initialSelection([PLAIN, repeat, generic])]).toEqual(['B-1@p1'])
  })
})

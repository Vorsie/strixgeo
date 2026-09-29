// The borehole track editor's rules (owner 2026-09-29: "i want to be able to
// add or change any track"), in the session main's words:
//
// * a hand-made track is "manual"; an imported track that was edited keeps its
//   DOV origin and reads "edited by hand";
// * the sections draw ONE track per kind: the manual one wins, else the newest
//   edited, else today's rule — the backend orders the detail so the first of a
//   kind is the drawn one;
// * top < base, no overlap within a track (block), gaps allowed with a warning,
//   deeper than the drilled depth warns but does not block, 1 mm grain;
// * a coded track cannot be saved with a token outside the DOV codelist;
// * a new row starts where the last one ended.
import { describe, expect, it } from 'vitest'

import type { BoreholeDetailResponse } from '../api/client'
import { makeFixtureBorehole } from '../test/fixtures/borehole'
import { allowedTokens } from './dovTrackCodelists'
import {
  listBoreholeTracks,
  newRowAfter,
  rowsFromIntervals,
  rowsToIntervals,
  validateTrackRows,
  type TrackEditorRow,
} from './boreholeTracks'

function row(partial: Partial<TrackEditorRow>): TrackEditorRow {
  return {
    key: Math.random().toString(36),
    top: '',
    base: '',
    value: '',
    description: '',
    color: '',
    mainSoil: [''],
    admixtures: [],
    ...partial,
  }
}

function codes(issues: ReadonlyArray<{ code: string }>): string[] {
  return issues.map(i => i.code)
}

const describeAllowed = (kind: string) => (field: Parameters<typeof allowedTokens>[1]) =>
  allowedTokens(kind, field, {})

describe('listBoreholeTracks — source badges and the drawn track', () => {
  function detailWithTracks(): BoreholeDetailResponse {
    const bh = makeFixtureBorehole()
    const dov = { ...bh.observations[0], id: 'obs-dov', source: 'dov', edited_manually_at: null }
    const edited = {
      ...bh.observations[0],
      id: 'obs-edited',
      observation_type: 'formal_stratigraphy',
      source: 'dov',
      edited_manually_at: '2026-09-29T10:00:00Z',
    }
    const manual = {
      ...bh.observations[0],
      id: 'obs-manual',
      source: 'manual',
      edited_manually_at: '2026-09-29T11:00:00Z',
    }
    // Backend order: the manual coded track leads its kind (track preference).
    return { ...bh, observations: [manual, dov, edited] }
  }

  it('badges a hand-made track manual, an edited import edited, an untouched import DOV', () => {
    const tracks = listBoreholeTracks(detailWithTracks())
    const byId = Object.fromEntries(tracks.map(t => [t.trackId, t.badge]))
    expect(byId['obs-manual']).toBe('manual')
    expect(byId['obs-edited']).toBe('edited')
    expect(byId['obs-dov']).toBe('dov')
  })

  it('marks the first track of each kind as the one the sections draw', () => {
    const tracks = listBoreholeTracks(detailWithTracks())
    const drawn = Object.fromEntries(tracks.map(t => [t.trackId, t.drawnInSections]))
    expect(drawn).toMatchObject({ 'obs-manual': true, 'obs-dov': false, 'obs-edited': true })
  })

  it('groups the field log into one track per kind', () => {
    const tracks = listBoreholeTracks(makeFixtureBorehole())
    const fieldLog = tracks.filter(t => t.family === 'field_log')
    expect(fieldLog.map(t => t.trackId).sort()).toEqual(
      [...new Set(makeFixtureBorehole().field_log_intervals.map(r => `field_log:${r.kind}`))].sort(),
    )
    expect(fieldLog.every(t => t.badge === 'dov')).toBe(true)
  })
})

describe('validateTrackRows — the interval rules', () => {
  const allowed = describeAllowed('lithological_description')

  it('a clean contiguous track has nothing to say', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '0', base: '1.2', description: 'zand' }), row({ top: '1.2', base: '3', description: 'klei' })],
      { totalDepthM: 5, allowed },
    )
    expect(result.errors).toEqual([])
    expect(result.warnings).toEqual([])
  })

  it('refuses a base that is not below its top', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '2', base: '2', description: 'klei' })],
      { totalDepthM: null, allowed },
    )
    expect(codes(result.errors)).toEqual(['base_not_below_top'])
    expect(result.errors[0]).toMatchObject({ row: 0, field: 'base' })
  })

  it('blocks two rows that overlap', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '1', base: '2.5', description: 'a' }), row({ top: '2', base: '3', description: 'b' })],
      { totalDepthM: null, allowed },
    )
    expect(codes(result.errors)).toEqual(['intervals_overlap'])
    expect(result.errors[0]).toMatchObject({ row: 1, field: 'top' })
  })

  it('allows a gap, with a warning', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '0', base: '1', description: 'a' }), row({ top: '1.5', base: '2', description: 'b' })],
      { totalDepthM: null, allowed },
    )
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toEqual(['gap_between_intervals'])
  })

  it('warns, never blocks, when a row goes deeper than the drilled depth', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '0', base: '6', description: 'a' })],
      { totalDepthM: 5, allowed },
    )
    expect(result.errors).toEqual([])
    expect(codes(result.warnings)).toEqual(['below_total_depth'])
  })

  it('judges depths on the 1 mm grain: 1.0001 to 1.0004 is no interval', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: '1.0001', base: '1.0004', description: 'a' })],
      { totalDepthM: null, allowed },
    )
    expect(codes(result.errors)).toEqual(['base_not_below_top'])
  })

  it('refuses a depth that is not a number', () => {
    const result = validateTrackRows(
      'lithological_description',
      [row({ top: 'abc', base: '1', description: 'a' })],
      { totalDepthM: null, allowed },
    )
    expect(codes(result.errors)).toEqual(['invalid_number'])
  })

  it('refuses a coded row whose main soil is outside the DOV codelist', () => {
    const result = validateTrackRows(
      'coded_lithology',
      [row({ top: '0', base: '1', mainSoil: ['QQ'] })],
      { totalDepthM: null, allowed: describeAllowed('coded_lithology') },
    )
    expect(codes(result.errors)).toEqual(['not_in_codelist'])
    expect(result.errors[0].params).toMatchObject({ token: 'QQ' })
  })

  it('refuses an admixture amount outside the DOV steps', () => {
    const result = validateTrackRows(
      'coded_lithology',
      [
        row({
          top: '0',
          base: '1',
          mainSoil: ['FZ'],
          admixtures: [{ soil_code: 'KL', amount: 'XX', locally: false }],
        }),
      ],
      { totalDepthM: null, allowed: describeAllowed('coded_lithology') },
    )
    expect(codes(result.errors)).toEqual(['not_in_codelist'])
  })

  it('refuses a consistency outside the DOV list and a coded row without a main soil', () => {
    const consistency = validateTrackRows(
      'consistency',
      [row({ top: '0', base: '1', value: 'stevig' })],
      { totalDepthM: null, allowed: describeAllowed('consistency') },
    )
    expect(codes(consistency.errors)).toEqual(['not_in_codelist'])
    const noSoil = validateTrackRows(
      'coded_lithology',
      [row({ top: '0', base: '1', mainSoil: [''] })],
      { totalDepthM: null, allowed: describeAllowed('coded_lithology') },
    )
    expect(codes(noSoil.errors)).toEqual(['missing_main_soil_code'])
  })

  it('refuses an empty track', () => {
    expect(
      codes(validateTrackRows('color', [], { totalDepthM: null, allowed: describeAllowed('color') }).errors),
    ).toEqual(['no_intervals'])
  })
})

describe('editor rows', () => {
  it('a new row starts at the last row base, so typing a column is one depth per row', () => {
    const next = newRowAfter([row({ top: '0', base: '1.25' }), row({ top: '1.25', base: '3.4' })])
    expect(next.top).toBe('3.4')
    expect(next.base).toBe('')
  })

  it('the first row of an empty track starts at the collar', () => {
    expect(newRowAfter([]).top).toBe('0')
  })

  it('round-trips an imported coded track and sends the payload on the 1 mm grain', () => {
    const intervals = makeFixtureBorehole().observations[0].layers.map(l => ({
      top_m: l.top_m,
      base_m: l.base_m,
      color: l.color,
      main_soil_codes: l.main_soil_codes,
      description: l.description,
      admixtures: l.admixtures,
    }))
    const rows = rowsFromIntervals(intervals)
    rows[0] = { ...rows[0], base: '1.23449' }
    rows[1] = { ...rows[1], top: '1.23449' }
    const payload = rowsToIntervals('coded_lithology', rows)
    expect(payload[0]).toEqual({
      top_m: 0,
      base_m: 1.234,
      color: 'bruin',
      main_soil_codes: ['ZF'],
      admixtures: [{ soil_code: 'KL', amount: 'sporadisch', locally: false }],
    })
    expect(payload[1].top_m).toBe(1.234)
  })

  it('a field-log payload carries only the value', () => {
    expect(rowsToIntervals('moisture', [row({ top: '0', base: '2', value: 'vochtig' })])).toEqual([
      { top_m: 0, base_m: 2, value: 'vochtig' },
    ])
  })
})

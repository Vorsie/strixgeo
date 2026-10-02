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
  MAX_ADMIXTURES_PER_INTERVAL,
  listBoreholeTracks,
  newRowAfter,
  referenceIntervalText,
  referenceOverlapsRow,
  rowsFromTemplate,
  rowsFromIntervals,
  rowsNeedingCheck,
  rowsToIntervals,
  unreadDescriptions,
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

describe('the admixture cap (owner 2026-09-30: "i want max 3 admixtures in coded lithology")', () => {
  const coded = (n: number) =>
    row({
      top: '0',
      base: '1',
      mainSoil: ['FZ'],
      admixtures: ['KL', 'LE', 'GL', 'HU'].slice(0, n).map(soil_code => ({ soil_code, amount: 'W', locally: false })),
    })

  it('three admixtures on a coded row are the limit, and allowed', () => {
    expect(MAX_ADMIXTURES_PER_INTERVAL).toBe(3)
    const result = validateTrackRows('coded_lithology', [coded(3)], { totalDepthM: null, allowed: () => null })
    expect(result.errors).toEqual([])
  })

  it('a fourth admixture on a coded row is refused, like the backend', () => {
    const result = validateTrackRows('coded_lithology', [coded(4)], { totalDepthM: null, allowed: () => null })
    expect(result.errors.map(e => e.code)).toEqual(['too_many_admixtures'])
    expect(result.errors[0]).toMatchObject({ row: 0, field: 'admixtures' })
  })
})

describe('"Start from…" a track as template (owner 2026-09-30: "copy another track as template")', () => {
  const codedSource = {
    kind: 'coded_lithology',
    intervals: [
      { top_m: 0, base_m: 1.5, color: 'bruin', main_soil_codes: ['FZ'], admixtures: [{ soil_code: 'KL', amount: 'W', locally: false }] },
      { top_m: 1.5, base_m: 3, color: null, main_soil_codes: ['KL'], admixtures: [] },
    ],
  }
  const descSource = {
    kind: 'lithological_description',
    intervals: [
      { top_m: 0, base_m: 1.5, description: 'fijn zand' },
      { top_m: 1.5, base_m: 3, description: 'klei' },
    ],
  }

  // Owner 2026-10-01 overruled "depths only" ("parse the description into
  // codes" + "make sure the person using it checks everything").
  it('a coded lithology started from a description reads the codes from the text, each row to check', () => {
    const rows = rowsFromTemplate('coded_lithology', descSource)
    expect(rows.map(r => [r.top, r.base])).toEqual([['0', '1.5'], ['1.5', '3']])
    expect(rows.map(r => r.mainSoil)).toEqual([['FZ'], ['KL']])
    expect(rows.map(r => r.description)).toEqual(['', ''])
    expect(rows.map(r => r.sourceText)).toEqual(['fijn zand', 'klei'])
    expect(rows.map(r => r.needsCheck)).toEqual([true, true])
    expect(rowsNeedingCheck(rows)).toBe(2)
    // The saved track is a normal one: the editor-only fields never reach it.
    expect(rowsToIntervals('coded_lithology', rows)[0]).toEqual({
      top_m: 0,
      base_m: 1.5,
      color: null,
      main_soil_codes: ['FZ'],
      admixtures: [],
    })
  })

  // Owner 2026-10-02 after a real borehole read 0 of 17: "if i'm getting 0
  // matches then it is better not to do it". When fewer than half of the
  // intervals give a main soil, Start from gives depths only, no markers.
  const unreadable = {
    kind: 'lithological_description',
    intervals: [
      { top_m: 0, base_m: 1, description: 'opgevuld gat' },
      { top_m: 1, base_m: 2, description: 'idem' },
      { top_m: 2, base_m: 3, description: 'klei' },
    ],
  }

  it('fewer than half of the descriptions read: ALL rows depths only, no check markers', () => {
    const rows = rowsFromTemplate('coded_lithology', unreadable)
    expect(rows.map(r => [r.top, r.base])).toEqual([['0', '1'], ['1', '2'], ['2', '3']])
    expect(rows.map(r => r.mainSoil)).toEqual([[''], [''], ['']])
    expect(rows.map(r => r.sourceText)).toEqual([undefined, undefined, undefined])
    expect(rowsNeedingCheck(rows)).toBe(0)
    expect(unreadDescriptions('coded_lithology', unreadable)).toEqual({ unread: 2, total: 3 })
  })

  it('half or more read: the codes are filled and no "could not read" line', () => {
    const half = { ...unreadable, intervals: [...unreadable.intervals, { top_m: 3, base_m: 4, description: 'fijn zand' }] }
    expect(rowsFromTemplate('coded_lithology', half).map(r => r.mainSoil)).toEqual([[''], [''], ['KL'], ['FZ']])
    expect(unreadDescriptions('coded_lithology', half)).toBeNull()
    // Not a description into a coded lithology: never a "could not read" line.
    expect(unreadDescriptions('informal_stratigraphy', unreadable)).toBeNull()
  })

  it('a coded track started from another coded track copies the codes too', () => {
    const rows = rowsFromTemplate('geotechnical_coding', codedSource)
    expect(rows.map(r => r.mainSoil)).toEqual([['FZ'], ['KL']])
    expect(rows[0].color).toBe('bruin')
    expect(rows[0].admixtures).toEqual([{ soil_code: 'KL', amount: 'W', locally: false }])
  })

  it('a description started from a description copies the text; from a coded track only the depths', () => {
    expect(rowsFromTemplate('informal_stratigraphy', descSource).map(r => r.description)).toEqual(['fijn zand', 'klei'])
    expect(rowsFromTemplate('lithological_description', codedSource).map(r => r.description)).toEqual(['', ''])
  })

  it('a formal stratigraphy never inherits free text (its cells are DOV unit codes)', () => {
    expect(rowsFromTemplate('formal_stratigraphy', descSource).map(r => r.description)).toEqual(['', ''])
  })

  it('a colour field log started from a coded track takes the coded colour (the same DOV colour list)', () => {
    const rows = rowsFromTemplate('color', codedSource)
    expect(rows.map(r => r.value)).toEqual(['bruin', ''])
  })
})

describe('the reference pane (owner 2026-09-30: "see the info that is already there in other tracks")', () => {
  it('reads an interval as the value, the description, or the compact code', () => {
    expect(referenceIntervalText({ top_m: 0, base_m: 1, value: 'grijs' })).toBe('grijs')
    expect(referenceIntervalText({ top_m: 0, base_m: 1, description: 'fijn zand' })).toBe('fijn zand')
    expect(
      referenceIntervalText({
        top_m: 0,
        base_m: 1,
        color: 'bruin',
        main_soil_codes: ['FZ', 'MZ'],
        admixtures: [{ soil_code: 'KL', amount: 'W', locally: true }],
      }),
    ).toBe('FZ/MZ + KL(W, locally) · bruin')
  })

  it('a reference interval overlaps the row being typed when their depths share a slice', () => {
    const typed = row({ top: '1.5', base: '3.2' })
    expect(referenceOverlapsRow({ top_m: 0, base_m: 1.5 }, typed)).toBe(false)
    expect(referenceOverlapsRow({ top_m: 1.5, base_m: 3.2 }, typed)).toBe(true)
    expect(referenceOverlapsRow({ top_m: 3, base_m: 5 }, typed)).toBe(true)
    expect(referenceOverlapsRow({ top_m: 3.2, base_m: 5 }, typed)).toBe(false)
  })

  it('a row with only a top highlights the interval that contains that depth', () => {
    const typed = row({ top: '2', base: '' })
    expect(referenceOverlapsRow({ top_m: 1.5, base_m: 3.2 }, typed)).toBe(true)
    expect(referenceOverlapsRow({ top_m: 0, base_m: 1.5 }, typed)).toBe(false)
  })
})

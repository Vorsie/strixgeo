// The "Divide boreholes" success toast, pinned in the owner's words.
//
// Owner ruling 2026-08-14: "those cpt to cpt ties should be replaced by cpt to
// borehole to borehole to cpt ties once i click subdivide boreholes" / "just
// delete all". The deletion is silent in the DB, so the toast must OWN it —
// spanning tie lines vanishing without a word would read as lost work.

import { describe, expect, it } from 'vitest'

import { divideBoreholesToastMessage } from './divideBoreholesToast'

const base = {
  geotech_model_id: 'gm-1',
  divided_borehole_count: 3,
  single_band_borehole_count: 1,
  layer_count: 12,
  created_formation_ids: [],
}

describe('divideBoreholesToastMessage', () => {
  it('names the jump ties the chain replaced', () => {
    const msg = divideBoreholesToastMessage(
      { ...base, reanchored_tie_count: 2, superseded_jump_tie_count: 4 },
      true,
    )
    expect(msg).toBe(
      'Boreholes divided — 3 split, 1 single-band, 2 accepted ties kept, ' +
        '4 jump ties replaced by the borehole chain.',
    )
  })

  it('speaks singular for one replaced jump tie', () => {
    const msg = divideBoreholesToastMessage({ ...base, superseded_jump_tie_count: 1 }, true)
    expect(msg).toBe(
      'Boreholes divided — 3 split, 1 single-band, 1 jump tie replaced by the borehole chain.',
    )
  })

  it('says nothing about jump ties when none were replaced', () => {
    const msg = divideBoreholesToastMessage({ ...base, superseded_jump_tie_count: 0 }, true)
    expect(msg).toBe('Boreholes divided — 3 split, 1 single-band.')
  })

  it('survives a backend that predates the field', () => {
    // superseded_jump_tie_count and reanchored_tie_count both absent.
    const msg = divideBoreholesToastMessage(base, false)
    expect(msg).toBe('Borehole divided — 3 split, 1 single-band.')
  })
})

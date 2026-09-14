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

  // Owner ruling 2026-08-24: "if no hops can be made, you just auto delete the
  // crossing correlation". Phase 8.6 deletes them silently in the DB, so the
  // toast owns the count — same contract as the jump-tie deletion above.
  it('names the crossing ties the divide auto-deleted', () => {
    const msg = divideBoreholesToastMessage({ ...base, deleted_crossing_span_count: 2 }, true)
    expect(msg).toBe(
      'Boreholes divided — 3 split, 1 single-band, 2 crossing ties auto-deleted.',
    )
  })

  it('speaks singular for one auto-deleted crossing tie', () => {
    const msg = divideBoreholesToastMessage({ ...base, deleted_crossing_span_count: 1 }, true)
    expect(msg).toBe(
      'Boreholes divided — 3 split, 1 single-band, 1 crossing tie auto-deleted.',
    )
  })

  // Owner installer #37 dogfeed 2026-09-14: pressing "Divide boreholes" on a
  // borehole that already has bands "doesn't overwrite ... i manually deleted
  // and now it did it". A machine borehole IS re-derived; one the engineer
  // hand-edited is kept — and the divide was silent about which, so the toast
  // must SAY how many were re-derived (split + single-band) and how many kept
  // their hand edits.
  it('says how many boreholes kept their hand edits', () => {
    const msg = divideBoreholesToastMessage({ ...base, skipped_existing_borehole_count: 2 }, true)
    expect(msg).toBe(
      'Boreholes divided — 3 split, 1 single-band, 2 kept their hand edits.',
    )
  })

  it('speaks singular for one borehole that kept its hand edits', () => {
    const msg = divideBoreholesToastMessage({ ...base, skipped_existing_borehole_count: 1 }, false)
    expect(msg).toBe('Borehole divided — 3 split, 1 single-band, 1 kept its hand edits.')
  })

  it('says nothing about hand edits when every borehole was re-derived', () => {
    const msg = divideBoreholesToastMessage({ ...base, skipped_existing_borehole_count: 0 }, true)
    expect(msg).toBe('Boreholes divided — 3 split, 1 single-band.')
  })
})

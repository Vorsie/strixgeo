import { describe, expect, it, beforeEach } from 'vitest'

import {
  BORELOG_HIDDEN_TRACKS_KEY,
  parseHiddenTracks,
  TOGGLEABLE_TRACK_IDS,
} from './useHiddenBoreholeLogTracks'

// We test ``parseHiddenTracks`` (the parse-guard) and the storage key
// contract directly. The hook itself is a thin composition of
// ``usePersistedJSON`` + the guard — the integration is validated by
// the BoreholeLog component tests.

beforeEach(() => {
  localStorage.clear()
})

describe('parseHiddenTracks — parse-guard', () => {
  it('returns empty set for non-array input (corrupt storage)', () => {
    expect(parseHiddenTracks(null)).toEqual(new Set())
    expect(parseHiddenTracks(42)).toEqual(new Set())
    expect(parseHiddenTracks({ drill_method: true })).toEqual(new Set())
    expect(parseHiddenTracks('drill_method')).toEqual(new Set())
  })

  it('returns empty set for empty array', () => {
    expect(parseHiddenTracks([])).toEqual(new Set())
  })

  it('accepts known track ids', () => {
    const result = parseHiddenTracks(['drill_method', 'field_log'])
    expect(result.has('drill_method')).toBe(true)
    expect(result.has('field_log')).toBe(true)
  })

  it('silently drops unknown ids (forward-compat)', () => {
    // An id from a future or renamed track must not crash the guard.
    const result = parseHiddenTracks(['drill_method', 'some_future_track', 123])
    expect(result.has('drill_method')).toBe(true)
    expect(result.size).toBe(1)
  })

  it('accepts all canonical track ids', () => {
    const all = [...TOGGLEABLE_TRACK_IDS]
    const result = parseHiddenTracks(all)
    expect(result.size).toBe(TOGGLEABLE_TRACK_IDS.length)
    for (const id of TOGGLEABLE_TRACK_IDS) {
      expect(result.has(id)).toBe(true)
    }
  })

  it('ignores duplicate entries in the array', () => {
    const result = parseHiddenTracks(['drill_method', 'drill_method'])
    expect(result.size).toBe(1)
  })
})

describe('BORELOG_HIDDEN_TRACKS_KEY', () => {
  it('uses the canonical key', () => {
    expect(BORELOG_HIDDEN_TRACKS_KEY).toBe('groundmodel.borelog.hidden_tracks')
  })
})

describe('cant-hide-depth-axis guard — depth axis id is not in TOGGLEABLE_TRACK_IDS', () => {
  it('depth axis id "depth" is not toggleable', () => {
    // The mTAW / depth axis id must never appear in the toggleable list.
    // If it did, the user could make the borelog structurally empty.
    const ids = new Set(TOGGLEABLE_TRACK_IDS as readonly string[])
    expect(ids.has('depth')).toBe(false)
    expect(ids.has('mtaw')).toBe(false)
    expect(ids.has('depth_axis')).toBe(false)
  })
})

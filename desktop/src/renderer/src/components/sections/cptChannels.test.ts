// Unit tests for the pure helpers in cptChannels.ts.
//
// These functions feed both the section's column-nudge layout and
// the per-CPT shared-band render, so a quiet regression here would
// silently misalign every column on the section view. The trade-off
// rules (band width is 0 when no applicable channel is enabled,
// type-gated channels stay accounted for) are subtle enough that a
// few targeted tests beat a re-read of the implementation.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_BOREHOLE_CHANNELS,
  DEFAULT_CPT_CHANNELS,
  cptBandFullWidth,
  cptBandHalfWidth,
  enabledBoreholeChannelCount,
  readBoreholeChannels,
  readColumnSpacing,
  readCptChannels,
} from './cptChannels'

describe('cptBandHalfWidth — zoom-responsive band geometry', () => {
  it('returns the anchor half-width at scaleH = 5 px/m (factor = 1.0)', () => {
    // 24 * 1.0 = 24 px — single-side extent from the column axis.
    expect(cptBandHalfWidth(5)).toBe(24)
  })

  it('clamps the factor floor at 0.6 (anything below ~3 px/m bottoms out)', () => {
    // factor = max(0.6, scaleH / 5). At scaleH = 1 the un-clamped
    // factor is 0.2; the clamp keeps the band legible.
    // 24 * 0.6 = 14.4 → rounds to 14.
    expect(cptBandHalfWidth(1)).toBe(14)
  })

  it('caps the factor at 3.0 (anything above ~15 px/m caps)', () => {
    // 24 * 3 = 72.
    expect(cptBandHalfWidth(100)).toBe(72)
  })
})

describe('cptBandFullWidth — applicable-channel gate', () => {
  const halfWidth = cptBandHalfWidth(5) // = 24

  it('returns 0 when no channels are enabled', () => {
    expect(
      cptBandFullWidth('CPTU', {
        qc: false,
        rf: false,
        fs: false,
        u2: false,
        qTotal: false,
      }, halfWidth),
    ).toBe(0)
  })

  it('returns 2 * halfWidth when qc is enabled (universal channel)', () => {
    const channels = { qc: true, rf: false, fs: false, u2: false, qTotal: false }
    expect(cptBandFullWidth('CPTU', channels, halfWidth)).toBe(2 * halfWidth)
    expect(cptBandFullWidth('CPTM', channels, halfWidth)).toBe(2 * halfWidth)
  })

  it('returns 2 * halfWidth when only rf is enabled (Rf applies to any CPT)', () => {
    const channels = { qc: false, rf: true, fs: false, u2: false, qTotal: false }
    expect(cptBandFullWidth('CPTM', channels, halfWidth)).toBe(2 * halfWidth)
  })

  it('ignores fs on a CPTM cone (sleeve friction is CPTU/CPTE-only)', () => {
    const channels = { qc: false, rf: false, fs: true, u2: false, qTotal: false }
    expect(cptBandFullWidth('CPTU', channels, halfWidth)).toBe(2 * halfWidth)
    expect(cptBandFullWidth('CPTE', channels, halfWidth)).toBe(2 * halfWidth)
    // CPTM mechanical cone — fs doesn't apply, no other channel on,
    // so the column contributes no band width to the layout.
    expect(cptBandFullWidth('CPTM', channels, halfWidth)).toBe(0)
  })

  it('ignores u2 on non-CPTU cones (pore-pressure is CPTU-only)', () => {
    const channels = { qc: false, rf: false, fs: false, u2: true, qTotal: false }
    expect(cptBandFullWidth('CPTU', channels, halfWidth)).toBe(2 * halfWidth)
    expect(cptBandFullWidth('CPTE', channels, halfWidth)).toBe(0)
    expect(cptBandFullWidth('CPTM', channels, halfWidth)).toBe(0)
  })

  it('ignores qTotal on non-CPTM cones', () => {
    const channels = { qc: false, rf: false, fs: false, u2: false, qTotal: true }
    expect(cptBandFullWidth('CPTM', channels, halfWidth)).toBe(2 * halfWidth)
    expect(cptBandFullWidth('CPTU', channels, halfWidth)).toBe(0)
  })

  it('handles null / undefined cptType (e.g. CPT with no kind tag yet)', () => {
    const channels = { ...DEFAULT_CPT_CHANNELS }
    // qc + rf still apply universally; kind-gated channels drop out.
    expect(cptBandFullWidth(null, channels, halfWidth)).toBe(2 * halfWidth)
  })
})

describe('readBoreholeChannels — parse + default fallback', () => {
  it('returns the documented defaults when view_state is null', () => {
    expect(readBoreholeChannels(null)).toEqual(DEFAULT_BOREHOLE_CHANNELS)
  })

  it('returns the defaults when borehole_channels key is missing', () => {
    expect(readBoreholeChannels({ cpt_channels: {} })).toEqual(DEFAULT_BOREHOLE_CHANNELS)
  })

  it('returns the defaults when value is not an object', () => {
    expect(readBoreholeChannels({ borehole_channels: 'yes' })).toEqual(
      DEFAULT_BOREHOLE_CHANNELS,
    )
  })

  it('parses a full toggle bag verbatim', () => {
    const persisted = {
      borehole_channels: {
        geotech: false,
        formal_strat: true,
        informal_strat: false,
      },
    }
    expect(readBoreholeChannels(persisted)).toEqual(persisted.borehole_channels)
  })

  it('falls back to the per-key default when a key is missing or non-boolean', () => {
    const partial = { borehole_channels: { geotech: 'oops' } }
    expect(readBoreholeChannels(partial)).toEqual({
      geotech: DEFAULT_BOREHOLE_CHANNELS.geotech, // string ignored, default
      formal_strat: DEFAULT_BOREHOLE_CHANNELS.formal_strat,
      informal_strat: DEFAULT_BOREHOLE_CHANNELS.informal_strat,
    })
  })
})

describe('enabledBoreholeChannelCount', () => {
  it('returns 0 when no channel is enabled', () => {
    expect(
      enabledBoreholeChannelCount({
        geotech: false,
        formal_strat: false,
        informal_strat: false,
      }),
    ).toBe(0)
  })

  it('counts each enabled channel', () => {
    expect(
      enabledBoreholeChannelCount({
        geotech: true,
        formal_strat: false,
        informal_strat: true,
      }),
    ).toBe(2)
  })

  it('the default channel bag has count 1 (geotech on)', () => {
    expect(enabledBoreholeChannelCount(DEFAULT_BOREHOLE_CHANNELS)).toBe(1)
  })
})

describe('readColumnSpacing — clamp to [MIN, MAX] with default fallback', () => {
  it('returns the default (1.0) when view_state is null', () => {
    expect(readColumnSpacing(null)).toBe(1.0)
  })

  it('returns the default when column_spacing key is missing', () => {
    expect(readColumnSpacing({ cpt_channels: {} })).toBe(1.0)
  })

  it('returns the default when value is not a finite number', () => {
    expect(readColumnSpacing({ column_spacing: 'tight' })).toBe(1.0)
    expect(readColumnSpacing({ column_spacing: Number.NaN })).toBe(1.0)
    expect(readColumnSpacing({ column_spacing: Number.POSITIVE_INFINITY })).toBe(1.0)
  })

  it('clamps below MIN (0.0) so hand-edited bundles can’t go negative', () => {
    expect(readColumnSpacing({ column_spacing: -0.5 })).toBe(0.0)
  })

  it('clamps above MAX (1.0)', () => {
    expect(readColumnSpacing({ column_spacing: 5 })).toBe(1.0)
  })

  it('returns the value unchanged when inside the range', () => {
    expect(readColumnSpacing({ column_spacing: 0.6 })).toBe(0.6)
    expect(readColumnSpacing({ column_spacing: 0 })).toBe(0)
    expect(readColumnSpacing({ column_spacing: 1.0 })).toBe(1.0)
  })
})

describe('readCptChannels — parse persisted toggles from view_state', () => {
  it('returns the documented defaults when view_state is null', () => {
    expect(readCptChannels(null)).toEqual(DEFAULT_CPT_CHANNELS)
  })

  it('returns the defaults when view_state has no cpt_channels key', () => {
    expect(readCptChannels({ dem_overlay: true })).toEqual(DEFAULT_CPT_CHANNELS)
  })

  it('returns the defaults when cpt_channels is not an object', () => {
    expect(readCptChannels({ cpt_channels: 'oops' })).toEqual(DEFAULT_CPT_CHANNELS)
  })

  it('parses a full bag verbatim', () => {
    const persisted = {
      cpt_channels: { qc: false, rf: true, fs: true, u2: false, qTotal: false },
    }
    expect(readCptChannels(persisted)).toEqual(persisted.cpt_channels)
  })

  it('falls back to the per-key default when a key is missing or non-boolean', () => {
    const partial = {
      cpt_channels: { qc: false, fs: 'yes' /* typo type */ },
    }
    expect(readCptChannels(partial)).toEqual({
      qc: false, // honoured — bool
      rf: DEFAULT_CPT_CHANNELS.rf,
      fs: DEFAULT_CPT_CHANNELS.fs, // string ignored
      u2: DEFAULT_CPT_CHANNELS.u2,
      qTotal: DEFAULT_CPT_CHANNELS.qTotal,
    })
  })
})

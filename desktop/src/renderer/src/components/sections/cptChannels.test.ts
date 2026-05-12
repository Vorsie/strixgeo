// Unit tests for the pure helpers in cptChannels.ts (debt #34).
//
// These functions feed into both the section's column-nudge layout
// and the per-track rendering, so a quiet regression here would
// silently misalign every CPT column on the section view. The
// trade-off rules (q_total overlay on qc, fs/u2 gated by cone type)
// are subtle enough that a few targeted tests beat a re-read of the
// implementation.

import { describe, expect, it } from 'vitest'

import {
  DEFAULT_CPT_CHANNELS,
  cptDataTrackWidth,
  cptTrackWidths,
  readCptChannels,
} from './cptChannels'

describe('cptTrackWidths — zoom-responsive width scaling', () => {
  it('returns the anchor widths at scaleH = 5 px/m (factor = 1.0)', () => {
    const w = cptTrackWidths(5)
    expect(w.qc).toBe(28)
    expect(w.rf).toBe(18)
    expect(w.fs).toBe(14)
    expect(w.u2).toBe(14)
    expect(w.qTotal).toBe(18)
  })

  it('clamps the factor floor at 0.6 (anything below ~3 px/m bottoms out)', () => {
    // factor = max(0.6, scaleH / 5). At scaleH = 1 the un-clamped
    // factor is 0.2; the clamp keeps widths legible.
    const w = cptTrackWidths(1)
    // 28 * 0.6 = 16.8 → rounds to 17.
    expect(w.qc).toBe(17)
  })

  it('caps the factor at 3.0 (anything above ~15 px/m caps)', () => {
    const w = cptTrackWidths(100)
    // 28 * 3 = 84.
    expect(w.qc).toBe(84)
    expect(w.rf).toBe(54)
  })
})

describe('cptDataTrackWidth — additive enabled-channel widths', () => {
  const widths = cptTrackWidths(5) // anchor values for readability

  it('returns 0 when no channels are enabled', () => {
    expect(
      cptDataTrackWidth('CPTU', {
        qc: false,
        rf: false,
        fs: false,
        u2: false,
        qTotal: false,
      }, widths),
    ).toBe(0)
  })

  it('sums qc + rf for any CPT kind (universal tracks)', () => {
    const w = cptDataTrackWidth('CPTE', { ...DEFAULT_CPT_CHANNELS, fs: false, u2: false, qTotal: false }, widths)
    expect(w).toBe(widths.qc + widths.rf)
  })

  it('adds fs only when cptType is CPTU or CPTE (sleeve-friction families)', () => {
    const channels = { qc: true, rf: false, fs: true, u2: false, qTotal: false }
    expect(cptDataTrackWidth('CPTU', channels, widths)).toBe(widths.qc + widths.fs)
    expect(cptDataTrackWidth('CPTE', channels, widths)).toBe(widths.qc + widths.fs)
    // CPTM mechanical cone — no fs channel exists; fs flag is ignored.
    expect(cptDataTrackWidth('CPTM', channels, widths)).toBe(widths.qc)
  })

  it('adds u2 only for CPTU (pore-pressure measurement is CPTU-only)', () => {
    const channels = { qc: true, rf: false, fs: false, u2: true, qTotal: false }
    expect(cptDataTrackWidth('CPTU', channels, widths)).toBe(widths.qc + widths.u2)
    expect(cptDataTrackWidth('CPTE', channels, widths)).toBe(widths.qc)
    expect(cptDataTrackWidth('CPTM', channels, widths)).toBe(widths.qc)
  })

  it('qTotal contributes a slot only on CPTM AND only when qc is OFF', () => {
    // qTotal-on, qc-on → q_total overlays qc, no extra width.
    expect(
      cptDataTrackWidth(
        'CPTM',
        { qc: true, rf: false, fs: false, u2: false, qTotal: true },
        widths,
      ),
    ).toBe(widths.qc)
    // qTotal-on, qc-off → q_total gets its own slot.
    expect(
      cptDataTrackWidth(
        'CPTM',
        { qc: false, rf: false, fs: false, u2: false, qTotal: true },
        widths,
      ),
    ).toBe(widths.qTotal)
    // Non-CPTM cones ignore qTotal entirely.
    expect(
      cptDataTrackWidth(
        'CPTU',
        { qc: false, rf: false, fs: false, u2: false, qTotal: true },
        widths,
      ),
    ).toBe(0)
  })

  it('handles null / undefined cptType (e.g. CPT with no kind tag yet)', () => {
    const channels = { ...DEFAULT_CPT_CHANNELS }
    // qc + rf still count; the kind-gated channels drop out.
    const w = cptDataTrackWidth(null, channels, widths)
    expect(w).toBe(widths.qc + widths.rf)
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

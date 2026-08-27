// Pins for the shared axis-tick helper — owner ruling S3, 2026-08-27,
// verbatim: "I want more sublabels on all axis ticks not too many."
//
// ONE source for tick steps (this module), derived from the axis span —
// never hardcoded per panel. Aim ~5–9 labels per axis.
//
// TK1 — the derived ticks REPRODUCE the DOV convention on the three fixed
//       CPT axes (qc 0/5/…/40, fs 0/0.2/…/1.0, Rf 0/2/…/10), so the panels
//       and the chart cannot drift apart.
// TK2 — "not too many": a spread of spans all land in the 5–9 label window.
// TK3 — an elevation-style span (not zero-anchored) gets metre-round ticks
//       inside the span, at a readable density.
// TK4 — (S1) the fit-to-data axis max is the pooled max rounded UP to a
//       sensible step — never below the data, so nothing is off axis in fit
//       mode by construction.
// TK5 — (S1) no data falls back to the fixed axis exactly (the revert
//       target stays intact).
// TK6 — sub-1 steps format with enough decimals ("0.2", never "0").

import { describe, expect, it } from 'vitest'

import {
  FS_AXIS_MAX_MPA,
  FS_AXIS_TICKS_MPA,
  QC_AXIS_MAX_MPA,
  QC_AXIS_TICKS_MPA,
  RF_AXIS_MAX_PCT,
  RF_AXIS_TICKS_PCT,
  axisTickValues,
  fitAxisMax,
  formatTickLabel,
} from './cptAxisScales'

describe('axisTickValues — sublabels on all axis ticks, not too many', () => {
  it('TK1 — reproduces the DOV convention on the three fixed CPT axes', () => {
    expect(axisTickValues(0, QC_AXIS_MAX_MPA)).toEqual([...QC_AXIS_TICKS_MPA])
    expect(axisTickValues(0, FS_AXIS_MAX_MPA)).toEqual([...FS_AXIS_TICKS_MPA])
    expect(axisTickValues(0, RF_AXIS_MAX_PCT)).toEqual([...RF_AXIS_TICKS_PCT])
  })

  it('TK2 — a spread of zero-anchored spans all yield 5–9 labels', () => {
    for (const max of [1, 2.5, 3.5, 6, 7, 10, 12, 14, 25, 40, 60, 100, 350]) {
      const ticks = axisTickValues(0, max)
      expect(ticks.length, `max=${max}`).toBeGreaterThanOrEqual(5)
      expect(ticks.length, `max=${max}`).toBeLessThanOrEqual(9)
      // Zero stays the anchor and the end is labelled.
      expect(ticks[0]).toBe(0)
      expect(ticks[ticks.length - 1]).toBeCloseTo(max, 9)
    }
  })

  it('TK3 — an elevation span gets metre-round ticks inside it, readable density', () => {
    // A unit from −7.3 to +4.8 mTAW at the identification panels' density.
    const ticks = axisTickValues(-7.3, 4.8, 4)
    expect(ticks.length).toBeGreaterThanOrEqual(3)
    expect(ticks.length).toBeLessThanOrEqual(9)
    for (const t of ticks) {
      expect(t).toBeGreaterThanOrEqual(-7.3)
      expect(t).toBeLessThanOrEqual(4.8)
      // Metre-round: every tick is a whole multiple of the (round) step.
      expect(Math.abs(t - Math.round(t))).toBeCloseTo(0, 9)
    }
  })

  it('TK4 — fit axis max rounds the pooled max UP to a step, never below it', () => {
    expect(fitAxisMax(11.3, 40)).toBe(12)
    expect(fitAxisMax(0.43, 1)).toBeCloseTo(0.5, 9)
    expect(fitAxisMax(60, 40)).toBe(60)
    // Never below the data — fit mode has nothing off axis by construction.
    for (const max of [0.07, 3.3, 9.7, 11.3, 37, 60, 123]) {
      expect(fitAxisMax(max, 40)).toBeGreaterThanOrEqual(max)
    }
  })

  it('TK5 — no data falls back to the fixed axis exactly', () => {
    expect(fitAxisMax(0, QC_AXIS_MAX_MPA)).toBe(QC_AXIS_MAX_MPA)
    expect(fitAxisMax(-1, QC_AXIS_MAX_MPA)).toBe(QC_AXIS_MAX_MPA)
    expect(fitAxisMax(Number.NaN, QC_AXIS_MAX_MPA)).toBe(QC_AXIS_MAX_MPA)
  })

  it('TK6 — sub-1 steps keep their decimals in the label', () => {
    expect(formatTickLabel(0.2, 0.2)).toBe('0.2')
    expect(formatTickLabel(0.05, 0.05)).toBe('0.05')
    expect(formatTickLabel(5, 5)).toBe('5')
    expect(formatTickLabel(0, 0.2)).toBe('0')
  })

  it('TK7 — the end tick is always part of a zero-anchored fitted axis', () => {
    // The fitted max is a multiple of the step the ticks re-derive, so the
    // axis end always carries a label (no dangling unlabelled wall).
    for (const dataMax of [0.9, 2.7, 4.9, 6.9, 8.2, 11.3, 13, 20.1, 34, 41]) {
      const max = fitAxisMax(dataMax, 40)
      const ticks = axisTickValues(0, max)
      expect(ticks[ticks.length - 1], `dataMax=${dataMax}`).toBeCloseTo(max, 9)
    }
  })
})

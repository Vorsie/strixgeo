/**
 * lensReach.test.ts — unit tests for the 0-corr lens reach (ruling 8b → 8b-rev).
 *
 * Ruling 8b-rev (design partition-engine-v2.md §8, owner 2026-07-19): the DEFAULT
 * lens reach is 0.45 of the gap for EVERY lens. The ~2× thickness cap is NOT the
 * default any more — it applies ONLY as a COLLISION shortener (a lens whose flank/
 * wedge would cross tie/band line art shortens to ~2× thickness, then halves further
 * if still colliding). ``lensReachFraction`` is the DEFAULT reach; on the flag-ON
 * product path it returns the flat 0.45 (``LENS_PINCH_FRACTION``). The flag-OFF seam
 * engine keeps the OLD ruling-8b ``min(0.45, 2t/gap)`` cap byte-identical (the cut-over
 * is per-section behind ``twoSidedTerminations``), so the cap functions live on for it.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { enclosedLensReach, interiorLensReachToTies, lensReachFraction, lensReachM, type ReachTie } from './lensReach'
import { setTwoSidedTerminations } from './tileFlags'

afterEach(() => {
  // Never let a flag flip leak into the deterministic byte-identical checks.
  setTwoSidedTerminations(false)
})

describe('lensReachFraction — 8b-rev flag-ON default is a FLAT 0.45', () => {
  it('flag-ON: a thin unit in a broad gap reaches 0.45 (NOT thickness-capped)', () => {
    // 8b-rev: the 2×thickness cap is no longer the default. A 5 m unit in a 100 m gap
    // reaches 0.45 (was 0.10 under the old min(0.45, 2·5/100) cap).
    const prev = setTwoSidedTerminations(true)
    try {
      expect(lensReachFraction(5, 100)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('flag-ON: a thick unit also reaches exactly 0.45', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      expect(lensReachFraction(30, 20)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('flag-ON: degenerate zero-width gap → still 0.45, never NaN', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      const f = lensReachFraction(5, 0)
      expect(Number.isFinite(f)).toBe(true)
      expect(f).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})

describe('lensReachM / lensReachFraction — flag-OFF keeps the OLD ruling-8b cap (byte-identical)', () => {
  it('flag-OFF: thin unit in a broad gap → thickness-capped (2× thickness)', () => {
    // gap 100 m, unit 5 m thick: 0.45×100 = 45 m vs 2×5 = 10 m → min = 10 m.
    expect(lensReachM(5, 100)).toBeCloseTo(10, 6)
  })

  it('flag-OFF: thick unit → 0.45-capped (unchanged from the flat reach)', () => {
    expect(lensReachM(30, 20)).toBeCloseTo(0.45 * 20, 6)
  })

  it('flag-OFF: boundary case — 2× thickness equals 0.45× gap → 0.45 reach', () => {
    expect(lensReachM(9, 40)).toBeCloseTo(0.45 * 40, 6)
  })

  it('flag-OFF: thin unit fraction well below 0.45', () => {
    expect(lensReachFraction(5, 100)).toBeCloseTo(0.1, 6)
  })

  it('flag-OFF: thick unit → clamped at 0.45', () => {
    expect(lensReachFraction(30, 20)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
  })

  it('flag-OFF: degenerate zero-width gap → epsilon floor, never NaN / never 0', () => {
    const f = lensReachFraction(5, 0)
    expect(Number.isFinite(f)).toBe(true)
    expect(f).toBeGreaterThan(0)
  })

  it('flag-OFF: zero-thickness unit → epsilon floor, never a zero-area lens', () => {
    const f = lensReachFraction(0, 100)
    expect(f).toBeGreaterThan(0)
  })
})

describe('8b-rev collision shortener — interior lens (tie / facing competitor)', () => {
  it('UNCONTESTED wide-gap thin lens reaches 0.45 (no tie, no competitor)', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // 5 m thick unit, 100 m gap, NO gap ties, facing NOT a competitor → the 8b-rev default.
      // Was thickness-capped to 0.10 under the old ruling-8b; 8b-rev keeps the full 0.45.
      expect(interiorLensReachToTies(5, 0, 100, 5, 7.5, 2.5, [], false)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('a tie CROSSING the diamond shortens the lens so its apex stays inside the tie', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // Unit [base 2 .. top 8], mid 5, gap 100 m. A tie runs from elev 4.5 on the own column (below
      // mid 5, inside the extent) UP to elev 6 on the facing — a base bracket ``baseAt(f)=4.5+1.5f``.
      // At the 0.45 default apex it is 5.175 > mid 5 → does NOT fit (the apex would sit ABOVE the
      // rising tie); the shortener drops to the 2× thickness rung (2·6/100 = 0.12), where baseAt is
      // 4.68 < mid → fits. So the reach shortens to a POSITIVE value below 0.45 (stay inside the line).
      const tie: ReachTie = { left: { x: 0, y: 4.5 }, right: { x: 100, y: 6 } }
      const r = interiorLensReachToTies(6, 0, 100, 5, 8, 2, [tie], false)
      expect(r).toBeGreaterThan(0)
      expect(r).toBeLessThan(LENS_PINCH_FRACTION)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('a FACING third-litho competitor caps the reach at ~2× thickness (hug)', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // 3 m thick unit, 100 m gap, facing carries a competing litho → the 2× thickness hug
      // (2·3/100 = 0.06), well below the 0.45 default.
      const r = interiorLensReachToTies(3, 0, 100, 5, 6.5, 3.5, [], true)
      expect(r).toBeCloseTo(0.06, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})

describe('8b-rev enclosed-lens reach — facing matrix vs competitor', () => {
  it('facing carries the SAME matrix (full-width band) → keeps 0.45', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      expect(enclosedLensReach(2, 100, false)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('facing carries a DIFFERENT competing litho → 2× thickness hug', () => {
    const prev = setTwoSidedTerminations(true)
    try {
      // 2 m thick unit, 100 m gap, facing differs → 2·2/100 = 0.04.
      expect(enclosedLensReach(2, 100, true)).toBeCloseTo(0.04, 6)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })

  it('flag-OFF: enclosed-lens reach ignores the facing arg → original cap (byte-identical)', () => {
    // Flag-OFF must keep min(0.45, 2t/gap) regardless of the facingDiffers flag.
    expect(enclosedLensReach(2, 100, true)).toBeCloseTo(0.04, 6)
    expect(enclosedLensReach(30, 20, true)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
  })
})

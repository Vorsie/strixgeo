/**
 * lensReach.test.ts — unit tests for the ruling-8b 0-corr lens-reach cap.
 *
 * Ruling 8b (design partition-engine-v2.md §8): a 0-corr unit renders as a SMALL
 * LENS AROUND THE UNIT — auto lens reach = min(LENS_PINCH_FRACTION 0.45 × gap,
 * ~2× the unit's own thickness), computed in REAL alongM metres, so thin units
 * get a hugging halo and wide gaps stop producing long tongues. Thick units
 * (where 2× thickness ≥ 0.45× gap) keep the 0.45 reach unchanged.
 */

import { describe, expect, it } from 'vitest'

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { lensReachFraction, lensReachM } from './lensReach'

describe('lensReachM — ruling 8b reach in metres', () => {
  it('thin unit in a broad gap → thickness-capped (2× thickness)', () => {
    // gap 100 m, unit 5 m thick: 0.45×100 = 45 m vs 2×5 = 10 m → min = 10 m.
    expect(lensReachM(5, 100)).toBeCloseTo(10, 6)
  })

  it('thick unit → 0.45-capped (unchanged from the flat reach)', () => {
    // gap 20 m, unit 30 m thick: 0.45×20 = 9 m vs 2×30 = 60 m → min = 9 m (0.45× gap).
    expect(lensReachM(30, 20)).toBeCloseTo(0.45 * 20, 6)
  })

  it('boundary case — 2× thickness equals 0.45× gap → 0.45 reach', () => {
    // gap 40 m; thickness such that 2×t = 0.45×40 = 18 → t = 9.
    expect(lensReachM(9, 40)).toBeCloseTo(0.45 * 40, 6)
  })
})

describe('lensReachFraction — the cap expressed as an apex fraction', () => {
  it('thin unit → fraction well below 0.45', () => {
    // 2×5 / 100 = 0.10 < 0.45 → 0.10.
    expect(lensReachFraction(5, 100)).toBeCloseTo(0.1, 6)
  })

  it('thick unit → clamped at 0.45 (never exceeds LENS_PINCH_FRACTION)', () => {
    expect(lensReachFraction(30, 20)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
  })

  it('boundary case → exactly 0.45', () => {
    expect(lensReachFraction(9, 40)).toBeCloseTo(LENS_PINCH_FRACTION, 6)
  })

  it('degenerate zero-width gap → epsilon floor, never NaN / never 0', () => {
    const f = lensReachFraction(5, 0)
    expect(Number.isFinite(f)).toBe(true)
    expect(f).toBeGreaterThan(0)
  })

  it('zero-thickness unit → epsilon floor, never a zero-area lens', () => {
    const f = lensReachFraction(0, 100)
    expect(f).toBeGreaterThan(0)
  })
})

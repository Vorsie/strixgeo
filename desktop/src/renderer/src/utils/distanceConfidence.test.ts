import { describe, expect, it } from 'vitest'

import {
  CONFIDENCE_FALLOFF_M,
  distanceAlphaMultiplier,
  distanceConfidence,
  nearestDistance2D,
} from './distanceConfidence'
import { CONFIDENCE_FLOOR, LOW_CONFIDENCE_ALPHA_MULTIPLIER } from './tinConfidence'

describe('distanceConfidence', () => {
  it('is full confidence (1) at the data location', () => {
    expect(distanceConfidence(0, 50)).toBeCloseTo(1, 6)
  })
  it('drops to the floor at/after the falloff distance', () => {
    expect(distanceConfidence(50, 50)).toBeCloseTo(CONFIDENCE_FLOOR, 6)
    expect(distanceConfidence(120, 50)).toBeCloseTo(CONFIDENCE_FLOOR, 6)
  })
  it('falls linearly between 0 and the falloff', () => {
    // Halfway → halfway between 1 and the floor.
    expect(distanceConfidence(25, 50)).toBeCloseTo(1 - (1 - CONFIDENCE_FLOOR) * 0.5, 6)
  })
  it('treats a non-positive falloff as full confidence (fade disabled)', () => {
    expect(distanceConfidence(999, 0)).toBeCloseTo(1, 6)
  })
})

describe('distanceAlphaMultiplier', () => {
  it('is 1 at the data location and the low multiplier at the falloff', () => {
    expect(distanceAlphaMultiplier(0, 50)).toBeCloseTo(1, 6)
    expect(distanceAlphaMultiplier(50, 50)).toBeCloseTo(LOW_CONFIDENCE_ALPHA_MULTIPLIER, 6)
  })
})

describe('nearestDistance2D', () => {
  it('returns the distance to the closest point', () => {
    expect(nearestDistance2D(0, 0, [[3, 4], [10, 10]])).toBeCloseTo(5, 6)
  })
  it('returns Infinity when there are no points (nothing to be near)', () => {
    expect(nearestDistance2D(0, 0, [])).toBe(Infinity)
  })
})

describe('CONFIDENCE_FALLOFF_M', () => {
  it('has a sane positive default', () => {
    expect(CONFIDENCE_FALLOFF_M).toBeGreaterThan(0)
  })
})

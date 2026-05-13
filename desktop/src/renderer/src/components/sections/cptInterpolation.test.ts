// Unit tests for the shared CPT depth-series interpolation helper.
//
// Both ContactPickBar's hover readout and ContactsLayer's drag
// readout consume this — the bracket walks + null-fall-through are
// subtle enough that an isolated test grid pays for itself.

import { describe, expect, it } from 'vitest'

import { lookupCptValueAtDepth } from './cptInterpolation'

describe('lookupCptValueAtDepth', () => {
  const depths = [0, 1, 2, 3, 4, 5]
  const qc = [0, 2, 4, 6, 8, 10]

  it('returns null when depths or values are empty', () => {
    expect(lookupCptValueAtDepth([], [], 1)).toBe(null)
    expect(lookupCptValueAtDepth([1, 2, 3], [], 2)).toBe(null)
    expect(lookupCptValueAtDepth([], [1, 2, 3], 2)).toBe(null)
  })

  it('clamps below the first sample to the first value', () => {
    expect(lookupCptValueAtDepth(depths, qc, -1)).toBe(0)
  })

  it('clamps above the last sample to the last value', () => {
    expect(lookupCptValueAtDepth(depths, qc, 10)).toBe(10)
  })

  it('returns an exact sample value when the depth lands on one', () => {
    expect(lookupCptValueAtDepth(depths, qc, 3)).toBeCloseTo(6, 5)
  })

  it('linearly interpolates between two samples', () => {
    // halfway between depths[1]=1 (qc=2) and depths[2]=2 (qc=4) →
    // expected qc = 3.
    expect(lookupCptValueAtDepth(depths, qc, 1.5)).toBeCloseTo(3, 5)
  })

  it('falls through a null low-side neighbour to the high neighbour', () => {
    // depth 2.5 brackets [2 (null), 3 (6)] — shallower is null,
    // so the helper returns the deeper neighbour's value.
    const values = [0, 2, null, 6, 8, 10]
    expect(lookupCptValueAtDepth(depths, values, 2.5)).toBe(6)
  })

  it('falls through a null high-side neighbour to the low neighbour', () => {
    // depth 1.5 brackets [1 (2), 2 (null)] — deeper is null, so
    // the helper returns the shallower neighbour's value.
    const values = [0, 2, null, 6, 8, 10]
    expect(lookupCptValueAtDepth(depths, values, 1.5)).toBe(2)
  })

  it('returns null when bracketed by two nulls', () => {
    const values = [0, null, null, 6, 8, 10]
    expect(lookupCptValueAtDepth(depths, values, 1.5)).toBe(null)
  })
})

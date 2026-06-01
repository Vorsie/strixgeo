// Unit tests for computeDipExtrapolationEndpoint — mirrors the 5 backend cases.
//
//   DE1  horizontal body → endpoint at neighbour along, same mid-elevation.
//   DE2  dipping body → endpoint at neighbour along at mid-elevation (v1 simplification).
//   DE3  missing neighbour surface elevation → returns null.
//   DE4  collinear source contacts (zero thickness) → returns null.
//   DE5  same along as source → returns null (no extrapolation distance).

import { describe, expect, it } from 'vitest'

import { computeDipExtrapolationEndpoint } from './dipExtrapolationFrontend'

describe('computeDipExtrapolationEndpoint', () => {
  it('DE1 — horizontal body returns endpoint at neighbour along, body mid-elevation', () => {
    const result = computeDipExtrapolationEndpoint({
      sourceAboveAlong: 10,
      sourceAboveElevation: 5,
      sourceBelowAlong: 10,
      sourceBelowElevation: 3,
      neighbourAlong: 40,
      neighbourSurfaceElevation: 8,
    })
    expect(result).not.toBeNull()
    expect(result!.along).toBeCloseTo(40, 9)
    // mid-elevation = (5 + 3) / 2 = 4.0
    expect(result!.elevation).toBeCloseTo(4.0, 9)
  })

  it('DE2 — dipping body still lands at neighbour along at mid-elev (v1 simplification)', () => {
    // Above at different along — still uses mid-elev (v1 horizontal projection).
    const result = computeDipExtrapolationEndpoint({
      sourceAboveAlong: 10,
      sourceAboveElevation: 6,
      sourceBelowAlong: 10,
      sourceBelowElevation: 2,
      neighbourAlong: 50,
      neighbourSurfaceElevation: 7,
    })
    expect(result).not.toBeNull()
    expect(result!.along).toBeCloseTo(50, 9)
    // mid-elevation = (6 + 2) / 2 = 4.0
    expect(result!.elevation).toBeCloseTo(4.0, 9)
  })

  it('DE3 — null neighbour surface elevation returns null', () => {
    const result = computeDipExtrapolationEndpoint({
      sourceAboveAlong: 10,
      sourceAboveElevation: 5,
      sourceBelowAlong: 10,
      sourceBelowElevation: 3,
      neighbourAlong: 40,
      neighbourSurfaceElevation: null,
    })
    expect(result).toBeNull()
  })

  it('DE4 — collinear source contacts (zero thickness) returns null', () => {
    const result = computeDipExtrapolationEndpoint({
      sourceAboveAlong: 10,
      sourceAboveElevation: 5,
      sourceBelowAlong: 10,
      sourceBelowElevation: 5, // same elevation → zero thickness
      neighbourAlong: 40,
      neighbourSurfaceElevation: 8,
    })
    expect(result).toBeNull()
  })

  it('DE5 — neighbour at the same along as source returns null', () => {
    const result = computeDipExtrapolationEndpoint({
      sourceAboveAlong: 10,
      sourceAboveElevation: 5,
      sourceBelowAlong: 10,
      sourceBelowElevation: 3,
      neighbourAlong: 10, // same as sourceAboveAlong
      neighbourSurfaceElevation: 8,
    })
    expect(result).toBeNull()
  })
})

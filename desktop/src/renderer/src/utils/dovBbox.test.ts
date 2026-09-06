// A drawn DOV import box only reaches the server when it would pass the
// request schema — a degenerate, out-of-range, or oversized box is refused in
// the renderer instead of coming back 422.
//
// The rule, in the owner's words: "a click without a drag does not start an
// import". A click without a drag hands BboxDrawer a zero-extent box (its
// south-west and north-east corners coincide), so west === east and
// south === north; the request schema rejects that with east <= west, and this
// helper must mirror the schema so the box never leaves the renderer.
//
// The source of truth is the server schema:
//   src/groundmodel/api/schemas/cpt/import_dov_request.py (ImportDovRequest)
//   src/groundmodel/infrastructure/parsers/dov/dov_common.py
//     (validate_wgs84_import_bbox, DOV_MAX_BBOX_SIDE_KM / _AREA_KM2)

import { describe, expect, it } from 'vitest'

import { DOV_MAX_BBOX_SIDE_KM, dovBboxProblem, isValidDovBbox } from './dovBbox'

// A real small box over Flanders: ~0.05 deg lon (~3.5 km) x 0.03 deg lat
// (~3.3 km) = ~11 km², well inside the 625 km² import limit.
const GOOD = { west: 3.0, south: 51.0, east: 3.05, north: 51.03 }

describe('isValidDovBbox — the box only leaves the renderer when it would pass the schema', () => {
  it('a click without a drag does not start an import', () => {
    // Zero-extent box: BboxDrawer collapses a click to identical corners.
    const clickNoDrag = { west: 3.0, south: 51.0, east: 3.0, north: 51.0 }
    expect(isValidDovBbox(clickNoDrag)).toBe(false)
    expect(dovBboxProblem(clickNoDrag)).toBe('degenerate')
  })

  it('a zero-HEIGHT drag (same latitude twice) does not start an import', () => {
    const flat = { west: 3.0, south: 51.0, east: 3.05, north: 51.0 }
    expect(isValidDovBbox(flat)).toBe(false)
    expect(dovBboxProblem(flat)).toBe('degenerate')
  })

  it('a real small box over Flanders would pass the schema', () => {
    expect(isValidDovBbox(GOOD)).toBe(true)
    expect(dovBboxProblem(GOOD)).toBeNull()
  })

  it('a box larger than 25 km x 25 km is refused as too large', () => {
    // ~0.5 deg lon (~35 km) x 0.4 deg lat (~44 km) = ~1540 km² > 625 km².
    const huge = { west: 3.0, south: 51.0, east: 3.5, north: 51.4 }
    expect(isValidDovBbox(huge)).toBe(false)
    expect(dovBboxProblem(huge)).toBe('too_large')
  })

  it('a box with a corner outside the WGS84 degree range is refused', () => {
    const offWorld = { west: 3.0, south: 51.0, east: 200, north: 51.1 }
    expect(isValidDovBbox(offWorld)).toBe(false)
    expect(dovBboxProblem(offWorld)).toBe('out_of_range')
  })

  it('a non-finite corner is refused, never sent', () => {
    const nan = { west: 3.0, south: 51.0, east: Number.NaN, north: 51.1 }
    expect(isValidDovBbox(nan)).toBe(false)
  })

  it('mirrors the schema side limit (25 km)', () => {
    expect(DOV_MAX_BBOX_SIDE_KM).toBe(25)
  })
})

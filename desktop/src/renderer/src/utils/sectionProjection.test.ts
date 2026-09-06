import { describe, expect, it } from 'vitest'

import {
  investigationsOnSection,
  projectionFoot,
  projectPointOntoLine,
  sectionLength,
} from './sectionProjection'

// Section endpoints used throughout — a 1000m horizontal line from
// (0, 0) to (1000, 0) in some CRS. Makes the math easy to reason
// about: along = pointX, offset = -pointY (because the line's left
// side is +Y in the cross-product convention).

const HORIZONTAL_1KM = {
  start_x: 0,
  start_y: 0,
  end_x: 1000,
  end_y: 0,
}

describe('sectionLength', () => {
  it('returns the Euclidean length of the endpoints', () => {
    expect(sectionLength(HORIZONTAL_1KM)).toBeCloseTo(1000)
  })

  it('handles oblique lines', () => {
    expect(
      sectionLength({ start_x: 0, start_y: 0, end_x: 300, end_y: 400 }),
    ).toBeCloseTo(500)
  })

  it('returns 0 for a degenerate line (endpoints coincide)', () => {
    expect(sectionLength({ start_x: 5, start_y: 5, end_x: 5, end_y: 5 })).toBe(0)
  })
})

describe('projectPointOntoLine', () => {
  it('a point on the line projects to (along=x, offset=0)', () => {
    const r = projectPointOntoLine(HORIZONTAL_1KM, 250, 0)
    expect(r).not.toBeNull()
    expect(r!.along).toBeCloseTo(250)
    expect(r!.offset).toBeCloseTo(0)
  })

  it('a point above the line (positive Y) yields negative offset', () => {
    // Line direction is +X, so the "left" side (cross-product
    // positive) is +Y. A point at +Y should have offset > 0.
    // Wait — vx*uy - vy*ux with v=(0, 50) and u=(1, 0) gives
    // 0*0 - 50*1 = -50. So +Y points are on the *right* of the
    // line direction by our convention.
    const r = projectPointOntoLine(HORIZONTAL_1KM, 500, 50)
    expect(r).not.toBeNull()
    expect(r!.along).toBeCloseTo(500)
    expect(r!.offset).toBeCloseTo(-50)
  })

  it('a point below the line (negative Y) yields positive offset', () => {
    const r = projectPointOntoLine(HORIZONTAL_1KM, 500, -75)
    expect(r).not.toBeNull()
    expect(r!.along).toBeCloseTo(500)
    expect(r!.offset).toBeCloseTo(75)
  })

  it('projects beyond the section endpoints when the point is past either end', () => {
    // along can be negative or > length; the caller filters those.
    const before = projectPointOntoLine(HORIZONTAL_1KM, -100, 0)
    expect(before!.along).toBeCloseTo(-100)
    const after = projectPointOntoLine(HORIZONTAL_1KM, 1500, 0)
    expect(after!.along).toBeCloseTo(1500)
  })

  it('returns null for a zero-length section', () => {
    expect(projectPointOntoLine({ start_x: 5, start_y: 5, end_x: 5, end_y: 5 }, 0, 0)).toBeNull()
  })

  it('oblique line — projection math reduces to the standard formula', () => {
    // Line from (0,0) to (3,4) — direction unit vector (0.6, 0.8),
    // length 5. Point (3, 0) projects onto (1.08, 1.44) — along=1.8,
    // offset = signed distance to the line.
    const r = projectPointOntoLine(
      { start_x: 0, start_y: 0, end_x: 3, end_y: 4 },
      3,
      0,
    )
    expect(r).not.toBeNull()
    expect(r!.along).toBeCloseTo(1.8)
    // Cross product vx*uy - vy*ux = 3*0.8 - 0*0.6 = 2.4
    expect(r!.offset).toBeCloseTo(2.4)
  })
})

describe('investigationsOnSection', () => {
  const section = { ...HORIZONTAL_1KM, projection_buffer_m: 50 }

  it('keeps points within the buffer and along the line span', () => {
    const inside = { id: 'a', location_x: 400, location_y: 20 }
    const tooFar = { id: 'b', location_x: 400, location_y: 200 }
    const result = investigationsOnSection(section, [inside, tooFar])
    expect(result.map(r => r.item.id)).toEqual(['a'])
    expect(result[0].along).toBeCloseTo(400)
    expect(result[0].offset).toBeCloseTo(-20)
  })

  it('drops points whose projection falls before the section start', () => {
    const before = { id: 'before', location_x: -50, location_y: 0 }
    expect(investigationsOnSection(section, [before])).toEqual([])
  })

  it('drops points whose projection falls past the section end', () => {
    const past = { id: 'past', location_x: 1500, location_y: 0 }
    expect(investigationsOnSection(section, [past])).toEqual([])
  })

  it('keeps points exactly at the endpoints (inclusive bounds)', () => {
    const atStart = { id: 'start', location_x: 0, location_y: 0 }
    const atEnd = { id: 'end', location_x: 1000, location_y: 0 }
    expect(
      investigationsOnSection(section, [atStart, atEnd]).map(r => r.item.id),
    ).toEqual(['start', 'end'])
  })

  it('keeps a test sitting exactly at a section endpoint despite floating-point overshoot', () => {
    // Owner ruling 2026-09-06: a tie section drawn THROUGH two tests must
    // catch BOTH. On real oblique Lambert-72 coords the far-endpoint test's
    // computed ``along`` lands ~1e-8 m beyond the computed section length
    // (float rounding of the dot product vs the sqrt), so a strict
    // ``along > length`` filter silently drops it — the "Koppelprofiel 4
    // contains one test (GEO-15/159-S5)" bug. Here S5 is the start and S11
    // the end of the owner's Tie-section 4; both must be members.
    const tie = {
      start_x: 109404.31,
      start_y: 188782.15,
      end_x: 109425.71,
      end_y: 188709.83,
      projection_buffer_m: 7,
    }
    const s5 = { id: 'S5', location_x: 109404.31, location_y: 188782.15 }
    const s11 = { id: 'S11', location_x: 109425.71, location_y: 188709.83 }
    expect(
      investigationsOnSection(tie, [s5, s11]).map(r => r.item.id).sort(),
    ).toEqual(['S11', 'S5'])
  })

  it('honours the excluded-ids set — user-chosen hides take precedence', () => {
    const a = { id: 'a', location_x: 100, location_y: 0 }
    const b = { id: 'b', location_x: 200, location_y: 0 }
    const result = investigationsOnSection(section, [a, b], new Set(['a']))
    expect(result.map(r => r.item.id)).toEqual(['b'])
  })

  it('preserves input order — callers sort by along when they care', () => {
    const items = [
      { id: 'right', location_x: 800, location_y: 0 },
      { id: 'left', location_x: 200, location_y: 0 },
      { id: 'centre', location_x: 500, location_y: 0 },
    ]
    expect(
      investigationsOnSection(section, items).map(r => r.item.id),
    ).toEqual(['right', 'left', 'centre'])
  })

  it('returns [] when the section has zero length', () => {
    const degenerate = { ...HORIZONTAL_1KM, end_x: 0, projection_buffer_m: 50 }
    const points = [{ id: 'a', location_x: 0, location_y: 0 }]
    expect(investigationsOnSection(degenerate, points)).toEqual([])
  })
})

describe('projectionFoot', () => {
  it('walks ``along`` metres from start along the line direction', () => {
    const r = projectionFoot(HORIZONTAL_1KM, 250)
    expect(r).not.toBeNull()
    expect(r!.x).toBeCloseTo(250)
    expect(r!.y).toBeCloseTo(0)
  })

  it('handles oblique lines — 3-4-5 triangle at along=2.5', () => {
    // Line from (0,0) to (3,4): direction (0.6, 0.8). At along=2.5
    // the foot is (1.5, 2.0).
    const r = projectionFoot(
      { start_x: 0, start_y: 0, end_x: 3, end_y: 4 },
      2.5,
    )
    expect(r).not.toBeNull()
    expect(r!.x).toBeCloseTo(1.5)
    expect(r!.y).toBeCloseTo(2.0)
  })

  it('returns null for a zero-length section', () => {
    expect(
      projectionFoot({ start_x: 1, start_y: 1, end_x: 1, end_y: 1 }, 10),
    ).toBeNull()
  })
})

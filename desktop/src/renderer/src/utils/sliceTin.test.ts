// Behaviour tests for the in-browser TIN slice — mirrors the
// Python tests in tests/unit/domain/services/test_tin_surface.py
// so the JS port stays semantically equivalent.

import { describe, expect, it } from 'vitest'

import type { FormationSurfaceResponse } from '../api/client'
import { sliceTin, type SectionLine2D } from './sliceTin'

function _surface(
  vertices: [number, number, number][],
  triangles: [number, number, number][],
): FormationSurfaceResponse {
  return {
    id: 's',
    model_id: 'm',
    formation_id: 'f',
    method: 'tin',
    vertices,
    triangles,
    source_contact_count: vertices.length,
    created_at: '2026-05-14T00:00:00Z',
    updated_at: '2026-05-14T00:00:00Z',
  }
}

const _line = (
  startX: number,
  startY: number,
  endX: number,
  endY: number,
): SectionLine2D => ({ startX, startY, endX, endY })

describe('sliceTin', () => {
  it('empty triangles → empty polyline', () => {
    const surface = _surface([[0, 0, 5]], [])
    expect(sliceTin(surface, _line(0, 0, 100, 0))).toEqual([])
  })

  it('zero-length section line → empty polyline', () => {
    const surface = _surface(
      [
        [0, 0, 5],
        [10, 0, 6],
        [5, 10, 4],
      ],
      [[0, 1, 2]],
    )
    expect(sliceTin(surface, _line(50, 50, 50, 50))).toEqual([])
  })

  it('section line through one triangle produces two crossings', () => {
    const surface = _surface(
      [
        [0, 0, 5],
        [10, 0, 6],
        [5, 10, 4],
      ],
      [[0, 1, 2]],
    )
    const poly = sliceTin(surface, _line(-5, 5, 15, 5))
    expect(poly).toHaveLength(2)
    expect(poly[0].alongM).toBeLessThan(poly[1].alongM)
    for (const p of poly) {
      expect(p.elevationM).toBeGreaterThanOrEqual(4)
      expect(p.elevationM).toBeLessThanOrEqual(6)
    }
  })

  it('off-line picks contribute via their triangle', () => {
    // Square 10x10, two triangles. Section line cuts horizontally
    // through y=5 — touches both triangles even though no vertex
    // sits on the line.
    const surface = _surface(
      [
        [0, 0, 5],
        [10, 0, 6],
        [10, 10, 7],
        [0, 10, 4],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    )
    const poly = sliceTin(surface, _line(-2, 5, 12, 5))
    expect(poly.length).toBeGreaterThanOrEqual(2)
    for (const p of poly) {
      expect(p.elevationM).toBeGreaterThanOrEqual(4)
      expect(p.elevationM).toBeLessThanOrEqual(7)
    }
  })

  it('polyline is sorted by along distance', () => {
    const surface = _surface(
      [
        [0, 0, 5],
        [10, 0, 6],
        [10, 10, 7],
        [0, 10, 4],
      ],
      [
        [0, 1, 2],
        [0, 2, 3],
      ],
    )
    const poly = sliceTin(surface, _line(-5, 5, 15, 5))
    const alongs = poly.map(p => p.alongM)
    const sorted = [...alongs].sort((a, b) => a - b)
    expect(alongs).toEqual(sorted)
  })

  it('linearly interpolates elevation between edge endpoints', () => {
    // Single triangle: one vertex at z=10, the others at z=0. A
    // section line through the y=5 mid-line cuts the two slanted
    // edges, each at the midpoint → expected z ≈ 5.0.
    const surface = _surface(
      [
        [0, 0, 0],
        [10, 0, 0],
        [5, 10, 10],
      ],
      [[0, 1, 2]],
    )
    const poly = sliceTin(surface, _line(-5, 5, 15, 5))
    expect(poly).toHaveLength(2)
    for (const p of poly) {
      expect(p.elevationM).toBeCloseTo(5, 5)
    }
  })
})

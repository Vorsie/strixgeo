// Behaviour tests for the seam-aware stroke pass (S60 Stage B).
//
// Owner rule (clause 5, merge touching lithos — the approved merged view):
// the finished section shows ONLY boundaries between DIFFERENT lithologies.
// A line segment renders ONLY where the regions on its two sides have
// different lithology, or where it borders unfilled space. Interior seams of
// a merged same-litho body (the lens/onlap construction diagonals) carry NO
// stroke — the doubled self-colour stroke on those shared edges was the
// visible "helper line" inside the sand mass.
//
//   SS1  two same-formation quads sharing a diagonal edge: NEITHER strokes the
//        shared edge; their outer edges keep the stroke.
//   SS2  different formations sharing an edge: BOTH stroke it (the hairline-
//        closing self-stroke at a real litho boundary is preserved).
//   SS3  a lone region (borders unfilled space everywhere): all edges stroked.

import { describe, expect, it } from 'vitest'

import { computeSeamStrokePaths, type SeamStrokeElement } from './sectionSeamStrokes'

/** True when the path d contains a segment whose midpoint is ~(mx, my). */
function hasSegmentAt(d: string, mx: number, my: number): boolean {
  for (const m of d.matchAll(/M ([\d.-]+),([\d.-]+) L ([\d.-]+),([\d.-]+)/g)) {
    const cx = (Number(m[1]) + Number(m[3])) / 2
    const cy = (Number(m[2]) + Number(m[4])) / 2
    if (Math.abs(cx - mx) < 0.5 && Math.abs(cy - my) < 0.5) return true
  }
  return false
}

describe('computeSeamStrokePaths — boundaries only between different lithologies', () => {
  // Shared DIAGONAL edge from (50,0) to (100,100): left quad and right quad
  // abut along it (a termination-line seam inside one sand mass).
  const leftSand: SeamStrokeElement = {
    formationId: 'fSand',
    points: [
      { x: 0, y: 0 },
      { x: 50, y: 0 },
      { x: 100, y: 100 },
      { x: 0, y: 100 },
    ],
  }
  const rightSand: SeamStrokeElement = {
    formationId: 'fSand',
    points: [
      { x: 50, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
      { x: 100, y: 100 },
    ],
  }
  const rightClay: SeamStrokeElement = { ...rightSand, formationId: 'fClay' }

  it('SS1: an interior same-litho boundary is not stroked; outer edges are', () => {
    const [dLeft, dRight] = computeSeamStrokePaths([leftSand, rightSand])
    // The shared diagonal (midpoint 75,50) carries NO stroke on either side.
    expect(hasSegmentAt(dLeft, 75, 50)).toBe(false)
    expect(hasSegmentAt(dRight, 75, 50)).toBe(false)
    // Outer edges keep the hairline-closing stroke (border unfilled space):
    // left quad's left vertical (0,50) and top (25,0); right quad's right
    // vertical (200,50).
    expect(hasSegmentAt(dLeft, 0, 50)).toBe(true)
    expect(hasSegmentAt(dLeft, 25, 0)).toBe(true)
    expect(hasSegmentAt(dRight, 200, 50)).toBe(true)
  })

  it('SS2: a cross-litho boundary is stroked on both sides', () => {
    const [dLeft, dRight] = computeSeamStrokePaths([leftSand, rightClay])
    expect(hasSegmentAt(dLeft, 75, 50)).toBe(true)
    expect(hasSegmentAt(dRight, 75, 50)).toBe(true)
  })

  it('SS3: a lone region strokes all its edges (borders unfilled space)', () => {
    const [d] = computeSeamStrokePaths([leftSand])
    expect(hasSegmentAt(d, 0, 50)).toBe(true)
    expect(hasSegmentAt(d, 25, 0)).toBe(true)
    expect(hasSegmentAt(d, 75, 50)).toBe(true)
    expect(hasSegmentAt(d, 50, 100)).toBe(true)
  })
})

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
import { fillIdentityOf } from './sectionFillIdentity'

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

// #274 — the pale helper line on the geotech axis: the self-colour seam stroke
// drawn on BOTH sides of an edge shared by two SAME-CLASS regions. The geotech
// subdivide keeps one formation ROW per (class, litho parent) — provenance by
// design — so a single packing class lives under several row ids and the shared
// edge between two of its rows kept its doubled 0.62-opacity stroke, which read
// as a line inside one class mass (the B3 seam). The caller maps every region
// identity through `fillIdentityOf` before this pass, collapsing the rows of one
// class onto one identity, so the pass drops the shared edge exactly as it drops
// a same-formation litho seam. `sectionFillIdentity.test.ts` (FI1) pins the
// identity collapse and `SS1` pins the drop — this wires the two END TO END, the
// coverage the doubled-stroke report was really about.
describe('computeSeamStrokePaths — geotech same-class dissolve (#274)', () => {
  // Two quads abutting along the diagonal (50,0)–(100,100); its midpoint (75,50)
  // is the shared edge the stroke pass must not double.
  const leftQuad = [
    { x: 0, y: 0 },
    { x: 50, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ]
  const rightQuad = [
    { x: 50, y: 0 },
    { x: 200, y: 0 },
    { x: 200, y: 100 },
    { x: 100, y: 100 },
  ]

  it('#274 — two ROWS of one packing class do not stroke their shared edge (drawn once = zero)', () => {
    // Same class (SILT|13), two provenance rows: the identity collapse makes the
    // shared edge interior to one mass → NO stroke on either side.
    const oneClass = new Map<string, string>([
      ['row-under-b3', 'SILT|13'],
      ['row-under-s9', 'SILT|13'],
    ])
    const [dLeft, dRight] = computeSeamStrokePaths([
      { formationId: fillIdentityOf('row-under-b3', oneClass), points: leftQuad },
      { formationId: fillIdentityOf('row-under-s9', oneClass), points: rightQuad },
    ])
    expect(hasSegmentAt(dLeft, 75, 50)).toBe(false)
    expect(hasSegmentAt(dRight, 75, 50)).toBe(false)
    // The outer edges (borders unfilled space) still close their hairline.
    expect(hasSegmentAt(dLeft, 0, 50)).toBe(true)
    expect(hasSegmentAt(dRight, 200, 50)).toBe(true)
  })

  it('#274 — a real class boundary (different colour) still strokes both sides', () => {
    // SILT|13 vs SILT|14 = different NAD class = different colour = a true
    // boundary: the hairline-closing stroke is preserved on both sides.
    const twoClasses = new Map<string, string>([
      ['row-sf', 'SILT|13'],
      ['row-mf', 'SILT|14'],
    ])
    const [dLeft, dRight] = computeSeamStrokePaths([
      { formationId: fillIdentityOf('row-sf', twoClasses), points: leftQuad },
      { formationId: fillIdentityOf('row-mf', twoClasses), points: rightQuad },
    ])
    expect(hasSegmentAt(dLeft, 75, 50)).toBe(true)
    expect(hasSegmentAt(dRight, 75, 50)).toBe(true)
  })
})

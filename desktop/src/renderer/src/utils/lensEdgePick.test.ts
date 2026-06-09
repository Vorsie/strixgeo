import { describe, expect, it } from 'vitest'
import { nearerLensEdge } from './lensEdgePick'

// A pinch-out wedge: source column edge on the left (x=0), apex to the right (x=100).
// Upper edge runs from the source TOP corner to the apex; lower edge from the apex
// back to the source BASE corner. When the user clicks an add-strip to drop a ghost
// node, the node must land on the edge PHYSICALLY NEAREST the click — not on whichever
// strip happens to win SVG z-order. On a thin wedge the two strips overlap, so z-order
// silently grabbed the wrong (lower) edge every time ("grabs the pinchout at both sides").
const UPPER: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 0, y: 0 },
  { x: 100, y: 50 },
]
const LOWER: [{ x: number; y: number }, { x: number; y: number }] = [
  { x: 100, y: 50 },
  { x: 0, y: 100 },
]

describe('nearerLensEdge', () => {
  it('a click hugging the upper edge adds to the upper edge', () => {
    expect(nearerLensEdge({ x: 20, y: 12 }, UPPER, LOWER)).toBe('upper')
  })

  it('a click hugging the lower edge adds to the lower edge', () => {
    expect(nearerLensEdge({ x: 20, y: 88 }, UPPER, LOWER)).toBe('lower')
  })

  it('a click below the lower edge still resolves to lower (not z-order)', () => {
    expect(nearerLensEdge({ x: 10, y: 95 }, UPPER, LOWER)).toBe('lower')
  })

  it('an exact tie on the wedge midline is deterministic (upper)', () => {
    // Symmetric wedge: the midline click is equidistant from both edges.
    expect(nearerLensEdge({ x: 0, y: 50 }, UPPER, LOWER)).toBe('upper')
  })
})

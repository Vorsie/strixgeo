// Unit tests for baseContactEdge — the add-strip's base-contact geometry (S104).
//
// The owner dogfeed (2026-07-24): "grabbing the marker is a bit hard though, the
// grab box seems to be ABOVE the marker." The visible marker (handle / preview dot)
// rides the sand/clay contact — the LOWER boundary of the upper region's fill. The
// grab box (add-strip) is placed on ``baseContactEdge``. When the base contact is
// BENT (a stored node bends it, so the base run is a polyline, not one flat segment),
// the old ``Y_SLACK=1`` filter found only ONE vertex at the deepest y, fell back to
// "all vertices", and picked the two extreme-x vertices — which include the region's
// TOP corners. The add-strip then sloped from a top corner down to the base, sitting
// ABOVE the real contact (the marker). This test pins the base line to the visible
// contact so the grab box is centred on the marker.
//
//   BC1 flat full-width band → the base edge is the flat base contact (unchanged).
//   BC2 BENT base (a bent contact through an interior node) → the base line follows
//       the contact chain, NOT a top corner (the owner's "grab box above the marker").
//   BC3 a click ON the visible contact (the marker) is ON the base line (dist ≈ 0).

import { describe, expect, it } from 'vitest'

import { baseContactEdge } from './partitionFillOverlayHelpers'

/** Perpendicular distance from p to the nearest point on a polyline. */
function distToPolyline(p: { x: number; y: number }, line: readonly { x: number; y: number }[]): number {
  let best = Infinity
  for (let i = 0; i < line.length - 1; i++) {
    const a = line[i]
    const b = line[i + 1]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const lenSq = dx * dx + dy * dy
    const t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
    const c = Math.max(0, Math.min(1, t))
    const ex = p.x - (a.x + c * dx)
    const ey = p.y - (a.y + c * dy)
    best = Math.min(best, Math.sqrt(ex * ex + ey * ey))
  }
  return best
}

describe('baseContactEdge — the add-strip rides the visible base contact (S104)', () => {
  it('BC1 — a flat full-width band yields its flat base contact left→right', () => {
    // v2 full-width band winds topL → baseL → baseR → topR. Base = the deep flat span.
    const band = [
      { x: 20, y: 50 }, // topL
      { x: 20, y: 90 }, // baseL
      { x: 80, y: 90 }, // baseR
      { x: 80, y: 50 }, // topR
    ]
    const base = baseContactEdge(band)
    expect(base).not.toBeNull()
    // Base line spans the full width along y=90 (the deep contact), never a top corner.
    for (const p of base!) expect(p.y).toBeCloseTo(90, 3)
    expect(Math.min(...base!.map((p) => p.x))).toBeCloseTo(20, 3)
    expect(Math.max(...base!.map((p) => p.x))).toBeCloseTo(80, 3)
  })

  it('BC2 — a BENT base contact follows the contact chain, not a top corner', () => {
    // The exact owner repro (from the DOM instrumentation): the sand region winds
    //   topL(20,0) → baseL(20,50) → bentNode(40,55) → baseR(80,60) → topR(80,0).
    // The visible sand/clay contact (the marker's line) is baseL → bentNode → baseR:
    //   (20,50) → (40,55) → (80,60). The OLD baseContactEdge returned (20,0)→(80,60):
    // it grabbed the TOP-LEFT corner (20,0), so the add-strip sloped from the surface
    // down to the base — 35px ABOVE the marker at x=40.
    const sand = [
      { x: 20, y: 0 }, // topL (surface — must NOT be on the base line)
      { x: 20, y: 50 }, // baseL
      { x: 40, y: 55 }, // bent contact node (the marker)
      { x: 80, y: 60 }, // baseR
      { x: 80, y: 0 }, // topR (surface)
    ]
    const base = baseContactEdge(sand)
    expect(base).not.toBeNull()
    // No point on the returned base line may be a TOP corner (y ≈ 0).
    for (const p of base!) expect(p.y).toBeGreaterThan(40)
    // The base line must pass through the bent contact node (40,55) — the marker.
    expect(distToPolyline({ x: 40, y: 55 }, base!)).toBeLessThan(0.5)
    // And through the two base ends.
    expect(distToPolyline({ x: 20, y: 50 }, base!)).toBeLessThan(0.5)
    expect(distToPolyline({ x: 80, y: 60 }, base!)).toBeLessThan(0.5)
  })

  it('BC3 — a click ON the visible marker is ON the base line (the grab box is centred on the marker)', () => {
    const sand = [
      { x: 20, y: 0 },
      { x: 20, y: 50 },
      { x: 40, y: 55 }, // marker
      { x: 80, y: 60 },
      { x: 80, y: 0 },
    ]
    const base = baseContactEdge(sand)!
    // A click exactly on the marker (40,55): the grab box (base line) is right there.
    expect(distToPolyline({ x: 40, y: 55 }, base)).toBeLessThan(0.01)
  })
})

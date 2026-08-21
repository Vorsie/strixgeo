// The owner's pale line, as geometry.
//
// 2026-08-21 late night, on the B3|S9 gap: "it is all silted, the crack has a
// boundary at the bottom but not at the top, it shouldn't be there, no holes
// in the model remember." The geometric hole audit says the ground IS painted;
// what he sees is the merged ring walking out to a wedge apex and back along
// almost the same path, and the seam-stroke pass drawing that zero-width
// detour as a hairline that ends in mid-region.
//
// NS1 uses his actual ring, verbatim from the live CS1 dump.

import { describe, expect, it } from 'vitest'

import { dropNeedleSpurs } from './dropNeedleSpurs'

/** Signed area × 2 — the spur must cost nothing to remove. */
function twiceArea(ring: readonly { fraction: number; elevation: number }[]): number {
  let total = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    total += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(total)
}

const at = (fraction: number, elevation: number) => ({ fraction, elevation })

describe('dropNeedleSpurs', () => {
  it('NS1 — the real B3|S9 silt ring loses its apex detour and keeps its area', () => {
    // CS1 gap 12, SILT-13 after the merge. The detour is
    // (0.182,6.484) → (0.450,7.230) → (0.166,6.440): out to the wedge apex and
    // straight back, enclosing 7e-5 of area — the line he circled.
    const ring = [
      at(0.45, 7.23),
      at(0.166, 6.44),
      at(0.5, 6.36),
      at(1.0, 6.23),
      at(1.0, 11.73),
      at(0.8, 11.98),
      at(0.5, 12.36),
      at(0.0, 12.98),
      at(0.0, 11.98),
      at(0.45, 10.23),
      at(0.0, 8.48),
      at(0.0, 6.48),
      at(0.182, 6.484),
    ]
    const before = twiceArea(ring)

    const cleaned = dropNeedleSpurs(ring)

    expect(cleaned.some((p) => p.fraction === 0.45 && p.elevation === 7.23)).toBe(false)
    // The spur carried no ground: the area may not move by more than the spur.
    expect(twiceArea(cleaned)).toBeCloseTo(before, 3)
    // Everything else survives — including the CLAY LENS notch at (0.45,10.23),
    // which is a real void in the silt and reverses direction just as sharply.
    expect(cleaned.some((p) => p.fraction === 0.45 && p.elevation === 10.23)).toBe(true)
    expect(cleaned).toHaveLength(ring.length - 1)
  })

  it('NS2 — a wedge that encloses real ground is never touched', () => {
    // A pinch wedge, 8 m thick at its column and still 1 m at mid-gap.
    // Its corners turn as sharply as a needle apex; only the ENCLOSED GROUND
    // tells the two apart, and this one carries plenty.
    const wedge = [at(0, 10), at(0.5, 6.5), at(0.5, 5.5), at(0, 2)]
    expect(dropNeedleSpurs(wedge)).toBe(wedge)
  })

  it('NS3 — a plain rectangle is returned unchanged, by identity', () => {
    const rect = [at(0, 0), at(1, 0), at(1, 5), at(0, 5)]
    expect(dropNeedleSpurs(rect)).toBe(rect)
  })

  it('NS4 — several spurs on one ring all go', () => {
    // Two out-and-back detours along the top edge: each walks left and comes
    // straight back, exactly like the real one.
    const ring = [
      at(0, 0),
      at(1, 0),
      at(1, 6),
      at(0.5, 6.0001),
      at(0.99, 6),
      at(0.4, 6),
      at(0.1, 6.00005),
      at(0.39, 6),
      at(0, 6),
    ]
    const cleaned = dropNeedleSpurs(ring)
    expect(cleaned.some((p) => p.elevation > 6)).toBe(false)
    expect(cleaned).toHaveLength(ring.length - 2)
  })

  it('NS5 — a ring is never reduced below a triangle', () => {
    // Pathological: every vertex qualifies. The loop must stop at three.
    const degenerate = [at(0, 0), at(0.5, 1e-9), at(1, 0), at(0.5, -1e-9)]
    expect(dropNeedleSpurs(degenerate).length).toBeGreaterThanOrEqual(3)
  })
})

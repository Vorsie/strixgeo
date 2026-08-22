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

import { dropNeedleSpurs, isNeedleRegion } from './dropNeedleSpurs'

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

/** A generic 100 m gap — the codebase's own convention (e.g. ``ALONG``). */
const GAP_100M = 100

describe('dropNeedleSpurs', () => {
  it('NS1 — the real B3|S9 silt ring loses its apex detour and keeps its area', () => {
    // CS1 gap 12, SILT-13 after the merge, its real width (34.832 m). The
    // detour is (0.182,6.484) → (0.450,7.230) → (0.166,6.440): out to the
    // wedge apex and straight back, enclosing 7e-5 of fraction-space area —
    // the line he circled.
    const GAP_12_WIDTH_M = 34.832
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

    const cleaned = dropNeedleSpurs(ring, GAP_12_WIDTH_M)

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
    expect(dropNeedleSpurs(wedge, GAP_100M)).toBe(wedge)
  })

  it('NS3 — a plain rectangle is returned unchanged, by identity', () => {
    const rect = [at(0, 0), at(1, 0), at(1, 5), at(0, 5)]
    expect(dropNeedleSpurs(rect, GAP_100M)).toBe(rect)
  })

  it('NS4 — several spurs on one ring all go', () => {
    // Two out-and-back detours along the top edge: each walks left and comes
    // straight back, exactly like the real one. Near-HORIZONTAL spurs — a
    // 0.5 m-of-fraction run (50 m of real ground) but only a tenth-of-a-mm
    // step in elevation — this is exactly the shape the anisotropy fix
    // targets: their true height decides, not how far they run.
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
    const cleaned = dropNeedleSpurs(ring, GAP_100M)
    expect(cleaned.some((p) => p.elevation > 6)).toBe(false)
    expect(cleaned).toHaveLength(ring.length - 2)
  })

  it('NS5 — a ring is never reduced below a triangle', () => {
    // Pathological: every vertex qualifies. The loop must stop at three.
    const degenerate = [at(0, 0), at(0.5, 1e-9), at(1, 0), at(0.5, -1e-9)]
    expect(dropNeedleSpurs(degenerate, GAP_100M).length).toBeGreaterThanOrEqual(3)
  })

  it('NS6 — a near-VERTICAL spur is caught at the same true height as a near-horizontal one', () => {
    // Owner code-hunt finding F6, 2026-08-22: the old measure was 300x more
    // permissive horizontally than vertically, an accident of comparing
    // fraction directly against elevation. A near-vertical spur — tiny
    // fraction width, real elevation extent — must be judged by its TRUE
    // metre width (fraction x gap width), not its bare fraction value. At a
    // 1000 m gap, a fraction width of 4e-4 is 0.4 m of real ground — NOT
    // debris — and must survive; the same bare fraction at a 1 m gap is
    // 0.4 mm and must go.
    const tallSpur = (fraction: number) => [
      at(0, 0),
      at(fraction, 20),
      at(0, 20),
      at(-0.2, 10),
    ]
    expect(dropNeedleSpurs(tallSpur(4e-4), 1000).length, 'real ground at a wide gap').toBe(4)
    expect(dropNeedleSpurs(tallSpur(4e-4), 1).length, 'sub-mm debris at a narrow gap').toBe(3)
  })

  it('NS7 — a genuine sharp corner (not a reversal) is never touched at any orientation', () => {
    // A real 60-degree wedge apex, sized well above the floor in every
    // direction — the reversal pre-filter alone cannot tell this from a
    // needle (it also turns sharply); only the now-isotropic size test does.
    const apex = [at(0, 0), at(0.5, 0), at(0.25, 10)]
    expect(dropNeedleSpurs(apex, GAP_100M)).toBe(apex)
  })

  it('NS8 — a legally minimum-thickness layer (1 mm) survives isNeedleRegion with margin', () => {
    // The backend's own floor (docs/data-integrity.md, BE clamp 0.001 m) — a
    // real lens can be exactly this thin. NEEDLE_WIDTH_M sits at 0.5 mm
    // specifically so a real 1 mm-thick sliver is never mistaken for debris
    // (the finding this fixes, C1b: the OLD threshold had zero margin at all
    // against this exact case).
    const oneMillimetreThick = [at(0, 5.001), at(0.6, 5.001), at(0.6, 5), at(0, 5)]
    expect(isNeedleRegion(oneMillimetreThick, GAP_100M)).toBe(false)
    // A tenth of that (0.1 mm) is genuine debris.
    const pointOneMillimetre = [at(0, 5.0001), at(0.6, 5.0001), at(0.6, 5), at(0, 5)]
    expect(isNeedleRegion(pointOneMillimetre, GAP_100M)).toBe(true)
  })
})

/**
 * THE FRAME — one family's constructs, cut to that family's own litho cover.
 * Nothing may exceed the frame; what no rule can answer stays residual; and the
 * two together tile the cover exactly.
 *
 * CF4, CF5 and CF6 are ported verbatim in intent from the post-hoc clip
 * (``clipPartitionToLithoFrame``, retired 2026-08-18) and then from the
 * per-family clip (``clipFamilyToFrameGap``, retired 2026-08-19 with the
 * constructive fill): the cover is now an INPUT to the arrangement rather than
 * a stage after it, so the confinement is structural — but the property being
 * pinned is the same one, and it is pinned on the module that owns it now.
 * CF7 pins the interior-point sampler itself, which is unchanged.
 */
import { describe, expect, it } from 'vitest'

import { fillGap } from './constructive/fillGap'
import type { RunColumn } from './constructive/constructs'
import { interiorPoint } from './frameClipGeometry'
import type { SectionRegion } from '../sectionPartition'

const region = (
  gapIndex: number,
  formationId: string,
  pts: [number, number][],
  kind: SectionRegion['kind'] = 'quad',
): SectionRegion => ({
  gapIndex,
  formationId,
  bodyId: null,
  kind,
  polygon: pts.map(([fraction, elevation]) => ({ fraction, elevation })),
})

const rect = (f0: number, f1: number, eTop: number, eBase: number): [number, number][] => [
  [f0, eTop],
  [f1, eTop],
  [f1, eBase],
  [f0, eBase],
]

/** One banded test carrying a single class over ``top..base``. */
const column = (ci: number, x: number, formationId: string, top: number, base: number): RunColumn => ({
  ci,
  x,
  bands: [{ layerId: `L${ci}`, formationId, bodyId: null, top, base, ci, x }],
})

const area = (r: { polygon: readonly { fraction: number; elevation: number }[] }): number => {
  let a = 0
  const p = r.polygon
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].fraction * q.elevation - q.fraction * p[i].elevation
  }
  return Math.abs(a) / 2
}

/** Ray-cast containment, keyhole-ring aware. */
const covers = (
  r: { polygon: readonly { fraction: number; elevation: number }[] },
  f: number,
  e: number,
): boolean => {
  let inside = false
  const ring = r.polygon
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]
    const b = ring[j]
    if (
      a.elevation > e !== b.elevation > e &&
      f < a.fraction + ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

const run = (
  cover: SectionRegion[],
  left: RunColumn,
  right: RunColumn,
  gapPaint = cover,
): ReturnType<typeof fillGap> =>
  fillGap({
    gapIndex: 0,
    xa: 0,
    xb: 100,
    cover,
    gapPaint,
    run: { left, right },
    ties: [],
    coverTies: [],
    columns: [left, right],
    stacks: new Map([
      [left.ci, left.bands],
      [right.ci, right.bands],
    ]),
    massOf: (band) => ({ litho: 'litho-sand', packing: band.formationId }),
    closureBars: new Map(),
    })

describe('the family frame', () => {
  it('CF4 — packing material outside the family cover is dropped', () => {
    // The family's cover is the top half; both tests read the whole 10..0.
    // Everything below the cover must vanish: nothing may exceed the frame.
    const cover = [region(0, 'litho-sand', rect(0, 1, 10, 5))]
    const out = run(cover, column(0, 0, 'sand-n6', 10, 0), column(1, 100, 'sand-n6', 10, 0))
    expect(out.residual).toEqual([])
    for (const r of out.covered) {
      for (const p of r.polygon) expect(p.elevation).toBeGreaterThan(4.999)
    }
    expect(out.covered.reduce((s, r) => s + area(r), 0)).toBeCloseTo(5, 6)
  })

  it('CF5 — a litho lens overlay wins parent resolution over its matrix', () => {
    // The frame stacks a lens on its matrix; the LAST containing region owns
    // the sample, matching the render's own overlay order. Both belong to the
    // same family here, so the test is purely about which cover is consulted.
    const cover = [
      region(0, 'litho-sand', rect(0, 1, 10, 0)),
      region(0, 'litho-sand-lens', rect(0.3, 0.7, 7, 3), 'lens'),
    ]
    const out = run(cover, column(0, 0, 'sand-n6', 10, 0), column(1, 100, 'sand-n6', 10, 0))
    expect(out.covered.find((r) => covers(r, 0.5, 5))).toBeDefined()
    expect(out.covered.reduce((s, r) => s + area(r), 0)).toBeCloseTo(10, 6)
  })

  it('CF6 — the emitted faces tile the family cover exactly, once each', () => {
    // Sampling a grid, every point of the cover is claimed by EXACTLY one
    // emitted face — no void, no double paint. An area sum alone passes on
    // compensating errors.
    //
    // RE-PINNED 2026-08-19: the split it used to assert (half classed, half
    // residual) is not what the law does. *"then fill in the rest with the
    // dominant lithology"* — the ground below the band is the rest, the band is
    // the only mass this family has, so it fills. Nothing stays unclassed while
    // the family has a mass; the tiling invariant is what this pin is for.
    const cover = [region(0, 'litho-sand', rect(0, 1, 10, 0))]
    const out = run(cover, column(0, 0, 'sand-n6', 10, 5), column(1, 100, 'sand-n6', 10, 5))
    const all = [...out.covered, ...out.residual]
    const defects: string[] = []
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const f = i / 20 + 0.0031
        const e = (j / 20) * 10 + 0.0047
        const hits = all.filter((r) => covers(r, f, e)).length
        if (hits !== 1) defects.push(`(${f.toFixed(2)},${e.toFixed(2)}) covered ${hits}×`)
      }
    }
    expect(defects).toEqual([])
    expect(out.covered.reduce((s, r) => s + area(r), 0)).toBeCloseTo(10, 6)
    expect(out.residual).toEqual([])
  })

  it('CF7 — the interior sample of a ring with a degenerate corner lands strictly inside', () => {
    // The B4|S13 face VERBATIM from the live arrangement (owner dogfeed
    // 2026-08-18 evening, the clay triangle he circled): three vertices
    // cluster within 0.017 units at the corner where the litho silt|clay
    // boundary passes. The first-found convex ear was that micro-cluster,
    // its centroid WAS the corner, the sample landed a millimetre below the
    // boundary, and the whole SILT face parented to the CLAY band - so the
    // clip re-labelled a silt face KLEI and painted a clay triangle up the
    // silt. The sample of a face must never sit on the face's own boundary.
    const ring = [
      { x: 50, y: 6.36 },
      { x: 50, y: 6.359 },
      { x: 50.017, y: 6.359 },
      { x: 100, y: 6.69 },
      { x: 50, y: 12.540000000000001 },
    ]
    const p = interiorPoint(ring)
    // Far from the degenerate corner...
    expect(Math.hypot(p.x - 50, p.y - 6.36)).toBeGreaterThan(1)
    // ...and on the INTERIOR side of the bottom edge (50,6.36)->(100,6.69),
    // the edge the litho boundary runs along.
    expect(p.y).toBeGreaterThan(6.36 + ((p.x - 50) / 50) * 0.33 + 0.01)
  })
})

/**
 * The frame clip — one family's packing partition, cut to that family's own
 * litho cover. Nothing may exceed the frame; what the family did not classify
 * stays residual; and the two together tile the cover exactly.
 *
 * CF4, CF5 and CF6 are ported verbatim in intent from the post-hoc clip this
 * construction replaces (``clipPartitionToLithoFrame``, retired 2026-08-18) —
 * they pin the geometry half, which is the half that survives. Its CF1/CF2/CF3
 * pinned the SOIL re-labelling half, which no longer exists: a family run can
 * only ever emit its own soil, so there is nothing to re-label (see the
 * hierarchical fill's H1/H4/H6 for the pins that replace them).
 */
import { describe, expect, it } from 'vitest'

import { clipFamilyToFrameGap } from './frameClip'
import { interiorPoint } from './frameClipGeometry'
import type { SectionRegion } from '../partitionFill'

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

const area = (r: SectionRegion): number => {
  let a = 0
  const p = r.polygon
  for (let i = 0; i < p.length; i++) {
    const q = p[(i + 1) % p.length]
    a += p[i].fraction * q.elevation - q.fraction * p[i].elevation
  }
  return Math.abs(a) / 2
}

/** Ray-cast containment, keyhole-ring aware — a naive vertex centroid would
 * sit inside the keyhole and lie. */
const covers = (r: SectionRegion, f: number, e: number): boolean => {
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

describe('clipFamilyToFrameGap', () => {
  it('CF4 — packing material outside the family cover is dropped', () => {
    // The family's cover is the top half; its own run reached the whole gap.
    // Everything below the cover must vanish: nothing may exceed the frame.
    const frame = [region(0, 'litho-sand', rect(0, 1, 10, 5))]
    const geo = [region(0, 'sand-n6', rect(0, 1, 10, 0))]
    const out = clipFamilyToFrameGap(geo, frame, 0)
    expect(out.residual).toEqual([])
    for (const r of out.covered) {
      for (const p of r.polygon) expect(p.elevation).toBeGreaterThan(4.999)
    }
    const total = out.covered.reduce((s, r) => s + area(r), 0)
    expect(total).toBeCloseTo(5, 6)
  })

  it('CF5 — a litho lens overlay wins parent resolution over its matrix', () => {
    // The frame stacks a lens on its matrix; the LAST containing region owns
    // the sample, matching the render's own overlay order. Both belong to the
    // same family here, so the test is purely about which cover is consulted.
    const frame = [
      region(0, 'litho-sand', rect(0, 1, 10, 0)),
      region(0, 'litho-sand-lens', rect(0.3, 0.7, 7, 3), 'lens'),
    ]
    const geo = [region(0, 'sand-n6', rect(0, 1, 10, 0))]
    const out = clipFamilyToFrameGap(geo, frame, 0)
    const middle = out.covered.find((r) => covers(r, 0.5, 5))
    expect(middle).toBeDefined()
    expect(out.covered.reduce((s, r) => s + area(r), 0)).toBeCloseTo(10, 6)
  })

  it('CF6 — classed and residual faces together tile the family cover exactly', () => {
    // Half the cover carries a class, half does not. Sampling a grid, every
    // point of the cover is claimed by EXACTLY one emitted face — no void, no
    // double paint. An area sum alone passes on compensating errors.
    const frame = [region(0, 'litho-sand', rect(0, 1, 10, 0))]
    const geo = [region(0, 'sand-n6', rect(0, 1, 10, 5))]
    const out = clipFamilyToFrameGap(geo, frame, 0)
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
    expect(out.covered.reduce((s, r) => s + area(r), 0)).toBeCloseTo(5, 6)
    expect(out.residual.reduce((s, r) => s + area(r), 0)).toBeCloseTo(5, 6)
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

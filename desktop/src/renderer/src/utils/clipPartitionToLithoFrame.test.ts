/**
 * The litho frame clip — "keep exactly the litho model and only subdivide
 * bodies" (owner ruling 2026-08-14). Soil-consistency with the litho fill is
 * a CONSTRUCTION here, not a convergence target: every clipped face carries a
 * packing class of its litho region's own soil, or the litho colour.
 */
import { describe, expect, it } from 'vitest'

import { clipPartitionToLithoFrame } from './clipPartitionToLithoFrame'
import type { SectionRegion } from './partitionFill'

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

const GEO_SOIL = new Map<string, string | null>([
  ['sand-n6', 'ZAND'],
  ['sand-n7', 'ZAND'],
  ['silt-n13', 'SILT'],
])
const LITHO_SOIL = new Map<string, string | null>([
  ['litho-sand', 'ZAND'],
  ['litho-silt', 'SILT'],
])

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
      f <
        a.fraction +
          ((e - a.elevation) / (b.elevation - a.elevation)) * (b.fraction - a.fraction)
    ) {
      inside = !inside
    }
  }
  return inside
}

describe('clipPartitionToLithoFrame', () => {
  it('CF1 — same-soil subdivision inside a litho region survives untouched', () => {
    const litho = [region(0, 'litho-sand', rect(0, 1, 10, 0))]
    const geo = [
      region(0, 'sand-n6', rect(0, 1, 10, 6)),
      region(0, 'sand-n7', rect(0, 1, 6, 0)),
    ]
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    const byFormation = new Map<string, number>()
    for (const r of out.regions)
      byFormation.set(r.formationId, (byFormation.get(r.formationId) ?? 0) + area(r))
    expect(byFormation.get('sand-n6')).toBeCloseTo(4, 1)
    expect(byFormation.get('sand-n7')).toBeCloseTo(6, 1)
    expect(out.lithoFallback).toEqual([])
  })

  it('CF2 — a foreign-soil piece re-labels to a same-soil class of its litho region', () => {
    // Litho: silt over sand. Geotech: the sand's n7 balloons up into the silt
    // region (the CS1 gap-3 vacancy flood). The intruding part must come back
    // as the silt's own class, which exists right beside it.
    const litho = [
      region(0, 'litho-silt', rect(0, 1, 10, 5)),
      region(0, 'litho-sand', rect(0, 1, 5, 0)),
    ]
    const geo = [
      // Silt class covers only the left half of the litho silt region.
      region(0, 'silt-n13', rect(0, 0.5, 10, 5)),
      // The sand class floods the right half of the silt region + its own region.
      region(0, 'sand-n7', rect(0.5, 1, 10, 5)),
      region(0, 'sand-n7', rect(0, 1, 5, 0)),
    ]
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    // Inside the litho silt region nothing may stay sand.
    const siltRegionSand = out.regions.filter(
      (r) => r.formationId === 'sand-n7' && r.polygon.every((p) => p.elevation >= 5 - 1e-6),
    )
    expect(siltRegionSand).toEqual([])
    // The intruded area is re-labelled to the available silt class.
    const siltArea = out.regions
      .filter((r) => r.formationId === 'silt-n13')
      .reduce((s, r) => s + area(r), 0)
    expect(siltArea).toBeCloseTo(5, 1)
    // The sand region below is untouched.
    const sandArea = out.regions
      .filter((r) => r.formationId === 'sand-n7')
      .reduce((s, r) => s + area(r), 0)
    expect(sandArea).toBeCloseTo(5, 1)
  })

  it('CF3 — no same-soil class anywhere in the litho region → litho fallback piece', () => {
    const litho = [
      region(0, 'litho-silt', rect(0, 1, 10, 5)),
      region(0, 'litho-sand', rect(0, 1, 5, 0)),
    ]
    // The geotech model has ONLY sand bands; the silt region is bare.
    const geo = [region(0, 'sand-n7', rect(0, 1, 5, 0))]
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    const fallbackArea = out.lithoFallback.reduce((s, r) => s + area(r), 0)
    expect(fallbackArea).toBeCloseTo(5, 1)
    expect(out.lithoFallback.every((r) => r.formationId === 'litho-silt')).toBe(true)
  })

  it('CF4 — geotech material outside every litho region is dropped', () => {
    const litho = [region(0, 'litho-sand', rect(0, 1, 5, 0))]
    const geo = [region(0, 'sand-n7', rect(0, 1, 10, 0))] // sticks out above
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    const total = out.regions.reduce((s, r) => s + area(r), 0)
    expect(total).toBeCloseTo(5, 1)
    for (const r of out.regions)
      for (const p of r.polygon) expect(p.elevation).toBeLessThanOrEqual(5 + 1e-6)
  })

  it('CF5 — a litho lens overlay wins parent resolution over its matrix', () => {
    // A silt lens overlaying a sand matrix: faces inside the lens belong to
    // the SILT parent (painter order — lenses last), so sand classes there
    // re-label / fall back, never leak through the lens.
    const litho = [
      region(0, 'litho-sand', rect(0, 1, 10, 0)),
      region(0, 'litho-silt', rect(0.25, 0.75, 7, 3), 'lens'),
    ]
    const geo = [region(0, 'sand-n7', rect(0, 1, 10, 0))]
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    // No sand region covers the lens centre.
    for (const r of out.regions.filter((x) => x.formationId === 'sand-n7')) {
      expect(covers(r, 0.5, 5)).toBe(false)
    }
    // The lens area (no silt class exists in the geotech model) falls back.
    const fallbackArea = out.lithoFallback.reduce((s, r) => s + area(r), 0)
    expect(fallbackArea).toBeCloseTo(0.5 * 4, 1)
  })

  it('CF6 — the clipped output tiles the litho cover', () => {
    const litho = [
      region(0, 'litho-silt', rect(0, 1, 10, 5)),
      region(0, 'litho-sand', rect(0, 1, 5, 0)),
    ]
    const geo = [
      region(0, 'silt-n13', rect(0, 0.6, 10, 4)),
      region(0, 'sand-n6', rect(0.6, 1, 10, 4)),
      region(0, 'sand-n7', rect(0, 1, 4, 0)),
    ]
    const out = clipPartitionToLithoFrame(geo, litho, GEO_SOIL, LITHO_SOIL)
    // Spatial multiplicity, not aggregate area (audit P2-9): a summed-area
    // oracle passes when a void and an equal-area overlap compensate. Every
    // sample point of the litho cover (fraction 0..1 × elevation 0..10) must
    // sit inside EXACTLY one output piece; the fractional offsets keep the
    // samples off shared seams, where ray-cast containment is undefined.
    const pieces = [...out.regions, ...out.lithoFallback]
    const defects: string[] = []
    for (let i = 1; i < 20; i++) {
      for (let j = 1; j < 20; j++) {
        const f = i / 20 + 0.0137
        const e = (j / 20) * 10 + 0.0171
        if (f >= 1 || e >= 10) continue
        const hits = pieces.filter((r) => covers(r, f, e)).length
        if (hits !== 1) {
          defects.push(`(${f.toFixed(2)},${e.toFixed(2)}) → ${hits === 0 ? 'VOID' : `${hits}×`}`)
        }
      }
    }
    expect(defects).toEqual([])
    // The area sum stays as a cheap cross-check of the sampler itself.
    const total =
      out.regions.reduce((s, r) => s + area(r), 0) +
      out.lithoFallback.reduce((s, r) => s + area(r), 0)
    expect(total).toBeCloseTo(10, 1)
  })
})

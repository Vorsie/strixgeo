/**
 * partitionFillV2.parityCoverage.ts — PIP union-coverage helper for the A/B parity
 * reconciliation (design partition-engine-v2.md §6). Split out of the parity diag
 * runner to keep that file under the 500-line budget (debt #201).
 *
 * ``unionCoverageArea`` returns the dense point-in-polygon UNION coverage of one
 * engine's regions (each cell counted ONCE regardless of overlap). For a true
 * partition Σ region areas ≈ union; the excess Σ − union is exactly the
 * DOUBLE-PAINTED area (a v1 lens overlay claiming space on top of its matrix band).
 *
 * Pure module — no React, no I/O.
 */

import { type PartitionPoint, type SectionRegion } from './sectionPartition'

/** Nonzero-winding point-in-polygon (x=fraction, y=elevation) — the SVG fill rule. */
export function inPolygon(px: number, py: number, poly: readonly PartitionPoint[]): boolean {
  let wn = 0
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const isLeft =
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation)
    if (a.elevation <= py) {
      if (b.elevation > py && isLeft > 0) wn++
    } else {
      if (b.elevation <= py && isLeft < 0) wn--
    }
  }
  return wn !== 0
}

/**
 * Dense PIP-sampled UNION coverage area of one engine's regions across a whole
 * section (fraction·metre). A cell counts ONCE regardless of how many regions cover
 * it — so ``Σ region areas − union area`` is exactly the DOUBLE-PAINTED area (space a
 * v1 lens overlay claims on top of its matrix band). v2 is a true partition, so its
 * ``Σ areas ≈ union``; the residual v1 excess over v2's union is the real coverage
 * difference (v2's vacancy holes).
 *
 * Sampling is per-gap so each gap's fraction axis [0,1] maps to its own elevation
 * box; the cell area is ``(1/NX) × (elevRange/NY)`` per gap, summed. NX×NY = 200×400
 * gives fine granularity — well under the 0.05/section residual gate.
 *
 * Parameters
 * ----------
 * regions : readonly SectionRegion[]
 *     One engine's output for a whole section.
 *
 * Returns
 * -------
 * number
 *     Union coverage area in fraction·metre.
 */
export function unionCoverageArea(regions: readonly SectionRegion[]): number {
  const NX = 200
  const NY = 400
  const byGap = new Map<number, SectionRegion[]>()
  for (const r of regions) {
    const g = byGap.get(r.gapIndex) ?? []
    g.push(r)
    byGap.set(r.gapIndex, g)
  }
  let area = 0
  for (const regs of byGap.values()) {
    let minE = Infinity
    let maxE = -Infinity
    for (const r of regs)
      for (const p of r.polygon) {
        if (p.elevation < minE) minE = p.elevation
        if (p.elevation > maxE) maxE = p.elevation
      }
    if (!Number.isFinite(minE) || maxE - minE < 1e-9) continue
    const cellA = (1 / NX) * ((maxE - minE) / NY)
    for (let iy = 0; iy < NY; iy++) {
      const py = maxE - ((iy + 0.5) / NY) * (maxE - minE)
      for (let ix = 0; ix < NX; ix++) {
        const px = (ix + 0.5) / NX
        for (const r of regs) {
          if (inPolygon(px, py, r.polygon)) {
            area += cellA
            break
          }
        }
      }
    }
  }
  return area
}

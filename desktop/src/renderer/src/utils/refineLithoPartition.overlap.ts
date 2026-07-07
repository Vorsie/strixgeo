/**
 * Polygon-overlap detector for the geotech fraction-space refinement —
 * the WATERTIGHTNESS INVARIANT as executable code (owner-locked, 2026-07-06):
 * no two refinement polygons overlap, excluding by-design opaque overlays
 * (enclosed-class lenses, unmatched-span hlenses, and anything carved from an
 * engine litho-lens region — each only against fills of ITS OWN gap).
 *
 * Ported from the brainstorm's "instrument, don't guess" self-check (rev 8,
 * ``partitionFill.geotechBrainstorm.test.ts``). Consumed by the frozen-CS1
 * unit gate, the env-gated live CS1 gate, and the render harness — it is
 * test-support code, imported only from ``*.test.ts`` files.
 *
 * Coordinates are screen-ish: x in pixels (any linear map of along-position),
 * e in metres elevation. The thresholds (0.8 px × 0.04 m bbox, ≥2 of 25
 * sample hits) are the brainstorm's — they ignore rasterisation-scale slivers
 * (the parallel #228 engine-sliver work owns those) while catching every
 * visible overlap.
 */

import type { SectionRegion } from './partitionFill'
import type { RefinedPolygon } from './refineLithoPartition'

/** One polygon in detector space, tagged for blame attribution. */
export interface DetectorPoly {
  /**
   * Tag grammar (brainstorm-compatible):
   *   ``raw@<kind>#g<gap>``          — an engine litho region (blame: engine);
   *   ``<tag>@<kind>#g<gap>``        — a refinement polygon (blame: carve);
   *   ``substrate#c<col>``           — an under-TD substrate strip piece.
   */
  tag: string
  /** Fill identity — used for the same-colour coincident-substrate exclusion. */
  fill: string
  pts: { x: number; e: number }[]
}

export interface OverlapReport {
  message: string
  /** True when BOTH polygons are raw engine regions (blame: engine, #228). */
  rawOnly: boolean
}

const gapOf = (t: string): string => t.match(/#g(\d+)/)?.[1] ?? '?'
const isOverlayTag = (t: string): boolean =>
  t.startsWith('enclens') || t.startsWith('hlens') || t.includes('@lens')

function inPoly(px: number, pe: number, pts: readonly { x: number; e: number }[]): boolean {
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]
    const b = pts[j]
    if (a.e > pe !== b.e > pe && px < a.x + ((pe - a.e) / (b.e - a.e)) * (b.x - a.x))
      inside = !inside
  }
  return inside
}

/**
 * Name every pair of polygons that genuinely overlap.
 *
 * Exclusions (all by design, from the owner-accepted rev 8):
 *  - raw engine regions pair only with each other (engine-blame section), and
 *    raw×raw pairs involving an engine lens region are by-design overlays;
 *  - a refinement overlay (enclens / hlens / carved-from-lens-region) is
 *    by-design ONLY against polygons of ITS OWN gap — overlay×substrate and
 *    overlay×other-gap are genuine and reported;
 *  - same-fill substrate strips of coincident columns are invisible overlaps.
 */
export function detectRefinementOverlaps(
  polys: readonly DetectorPoly[],
  maxReports = 20,
): OverlapReport[] {
  const boxes = polys.map((d) => ({
    x0: Math.min(...d.pts.map((p) => p.x)),
    x1: Math.max(...d.pts.map((p) => p.x)),
    e0: Math.min(...d.pts.map((p) => p.e)),
    e1: Math.max(...d.pts.map((p) => p.e)),
  }))
  const reports: OverlapReport[] = []
  for (let i = 0; i < polys.length && reports.length < maxReports; i++) {
    for (let j = i + 1; j < polys.length && reports.length < maxReports; j++) {
      const A2 = polys[i]
      const B2 = polys[j]
      const rawA = A2.tag.startsWith('raw@')
      const rawB = B2.tag.startsWith('raw@')
      if (rawA !== rawB) continue
      if (rawA && rawB && (A2.tag.includes('@lens') || B2.tag.includes('@lens'))) continue
      const sameGap = A2.tag.includes('#g') && B2.tag.includes('#g') && gapOf(A2.tag) === gapOf(B2.tag)
      if ((isOverlayTag(A2.tag) || isOverlayTag(B2.tag)) && sameGap) continue
      // Same-colour substrate strips of coincident columns: invisible.
      if (A2.tag.startsWith('substrate') && B2.tag.startsWith('substrate') && A2.fill === B2.fill)
        continue
      const A = boxes[i]
      const B = boxes[j]
      const x0 = Math.max(A.x0, B.x0)
      const x1 = Math.min(A.x1, B.x1)
      const e0 = Math.max(A.e0, B.e0)
      const e1 = Math.min(A.e1, B.e1)
      if (x1 - x0 < 0.8 || e1 - e0 < 0.04) continue
      let hits = 0
      for (let u = 1; u <= 5; u++)
        for (let v = 1; v <= 5; v++) {
          const px = x0 + (u / 6) * (x1 - x0)
          const pe = e0 + (v / 6) * (e1 - e0)
          if (inPoly(px, pe, A2.pts) && inPoly(px, pe, B2.pts)) hits++
        }
      if (hits >= 2) {
        reports.push({
          message:
            `OVERLAP ${A2.tag}(${A2.fill}) x ${B2.tag}(${B2.fill}) ` +
            `at x≈${((x0 + x1) / 2).toFixed(0)} elev≈${((e0 + e1) / 2).toFixed(1)} hits=${hits}/25`,
          rawOnly: rawA && rawB,
        })
      }
    }
  }
  return reports
}

/**
 * Project raw engine regions + refinement polygons into detector space.
 *
 * ``gapScreenX(gapIndex)`` returns the gap's screen x-range, or ``null`` for a
 * DEGENERATE gap (screen width < 1 px) — those are skipped, mirroring the
 * renderer's degenerate-gap guard: a negative-width gap MIRRORS the fraction
 * mapping and spills polygons over the neighbouring gap, and sub-pixel gaps
 * draw nothing visible.
 */
export function detectorPolysFromRefinement(
  regions: readonly SectionRegion[],
  refined: readonly RefinedPolygon[],
  gapScreenX: (gapIndex: number) => { xl: number; xr: number } | null,
): DetectorPoly[] {
  const out: DetectorPoly[] = []
  for (const r of regions) {
    const g = gapScreenX(r.gapIndex)
    if (!g) continue
    out.push({
      tag: `raw@${r.kind}#g${r.gapIndex}`,
      fill: r.formationId,
      pts: r.polygon.map((p) => ({ x: g.xl + p.fraction * (g.xr - g.xl), e: p.elevation })),
    })
  }
  for (const p of refined) {
    const g = gapScreenX(p.gapIndex)
    if (!g) continue
    out.push({
      tag: `${p.tag}@${p.regionKind}#g${p.gapIndex}`,
      fill: p.formationId,
      pts: p.points.map((q) => ({ x: g.xl + q.fraction * (g.xr - g.xl), e: q.elevation })),
    })
  }
  return out
}

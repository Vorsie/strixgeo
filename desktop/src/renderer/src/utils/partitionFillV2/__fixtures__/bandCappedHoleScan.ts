/**
 * bandCappedHoleScan.ts — the shared "hole under a correlation band" scan of the two permanent
 * render gates over the real section fixtures (``bottomTieRenderHole.test.ts``,
 * ``zandGlSeamHole.test.ts``), extracted on the second copy.
 *
 * A "defect hole" is an interior coverage gap CAPPED ABOVE by a near-full-width band (fracSpan >=
 * 0.9) — a hole sitting directly under a correlation band. Interior holes bounded above only by
 * narrow floating lenses (the intended-empty wedge above a hand-tied first-unit top against a short
 * borehole, ruling 5 part 3) are excluded.
 *
 * THE FLOOR (owner 2026-09-23, "let's go with plain 2 / 1 / 0 everywhere"). Below a shallow test's
 * TD the deep unit tied to that TD onlaps only to the HALFWAY point of its bottom tie and the untied
 * units below pinch at their own level, so the space under the bottom tie past the tip and the
 * pinch is the no-data void BY RULING — not a defect. ``gapBottomTieFloor`` finds that tie and the
 * scan measures each hole only above it. A gap without a bottom tie is scanned whole, as before.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../../sectionPartition'

const HERE = dirname(fileURLToPath(import.meta.url))

export interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
export interface RawCol { investigationId: string; name?: string; surfaceElevM: number | null; units: RawUnit[] }
export interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }
export type Fixture = { sections: RawSection[]; formationNames: Record<string, string> }

/** Load a section-shaped fixture from this directory by file name. */
export function loadSections(file: string): Fixture {
  return JSON.parse(readFileSync(resolve(HERE, file), 'utf8')) as Fixture
}

/** Keep only tests with an elevation and litho, carrying the surviving alongM (mirrors the engine). */
export function prepareSection(sec: RawSection): { columns: PartitionColumn[]; alongM: number[]; names: string[]; edges: CorrelationEdge[] } {
  const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const names = keep.map(({ c }) => c.name ?? c.investigationId.slice(0, 8))
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
  return { columns, alongM, names, edges }
}

/** Elevation intervals a vertical scan-line at ``frac`` crosses inside one region polygon. */
export function crossAt(poly: readonly { fraction: number; elevation: number }[], frac: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction), hi = Math.max(a.fraction, b.fraction)
    if (frac < lo || frac > hi) continue
    const t = (frac - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let k = 0; k + 1 < ys.length; k += 2) out.push([ys[k], ys[k + 1]])
  return out
}

export const fracSpan = (r: SectionRegion): number => {
  const fs = r.polygon.map((p) => p.fraction)
  return Math.max(...fs) - Math.min(...fs)
}

/** Covered height on the vertical at ``frac`` counting only what lies below ``ceiling`` (mTAW). */
export const coveredHeightBelow = (regs: readonly SectionRegion[], frac: number, ceiling: number): number =>
  regs.reduce((sum, r) => sum + crossAt(r.polygon, frac).reduce((s, [a, b]) => s + Math.max(0, Math.min(b, ceiling) - a), 0), 0)

/** Regions in one gap that carry ``layerId`` in their provenance. */
export const regionsForLayer = (regs: readonly SectionRegion[], layerId: string): SectionRegion[] =>
  regs.filter((r) => (r.layerIds ?? []).includes(layerId))

const ELEV_EPS = 1e-6

/** A gap's bottom tie: the deep unit's TOP tied to the shallow column's TD, its base below that TD. */
export interface BottomTie {
  /** Elevation (mTAW) of the tie at the left column (fraction 0). */
  leftElev: number
  /** Elevation (mTAW) of the tie at the right column (fraction 1). */
  rightElev: number
  /** The deep unit whose top carries the tie. */
  deepLayerId: string
  /** Which column is the shallow one (the TD end of the tie). */
  shallowSide: 'left' | 'right'
  /** The tie's elevation at ``frac`` of the gap. */
  elevAt: (frac: number) => number
}

/**
 * Find the bottom tie of gap ``g`` (columns ``g`` and ``g + 1``): a tie whose shallow-column end is
 * that column's deepest contact (its TD) and whose deep-column end is the TOP of a unit extending
 * below that TD — the configuration the 2026-09-23 ruling reads as "onlap halfway, the rest is the
 * no-data void". ``null`` when the gap has none. With several, the highest one is returned (the
 * void starts under the highest).
 */
export function gapBottomTie(columns: readonly PartitionColumn[], edges: readonly CorrelationEdge[], g: number): BottomTie | null {
  const left = columns[g], right = columns[g + 1]
  if (!left || !right) return null
  const tdOf = (c: PartitionColumn): number => Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM))
  const tdL = tdOf(left), tdR = tdOf(right)
  const shallowSide: 'left' | 'right' = tdL >= tdR ? 'left' : 'right'
  const shallow = shallowSide === 'left' ? left : right
  const deep = shallowSide === 'left' ? right : left
  const shallowTD = tdOf(shallow)
  let best: BottomTie | null = null
  for (const e of edges) {
    // Orient the edge as (shallow unit, deep unit) whichever way it was drawn.
    const ends: [string, 'top' | 'base'][] = [[e.a, e.aSide ?? 'top'], [e.b, e.bSide ?? 'top']]
    for (const [sId, sSide] of ends) {
      const [dId, dSide] = ends.find(([id]) => id !== sId) ?? ends[0]
      const su = shallow.units.find((u) => u.layerId === sId)
      const du = deep.units.find((u) => u.layerId === dId)
      if (!su || !du) continue
      const sElev = sSide === 'top' ? shallow.surfaceElevM - su.topDepthM : shallow.surfaceElevM - su.baseDepthM
      if (sSide !== 'base' || Math.abs(sElev - shallowTD) > ELEV_EPS) continue
      if (dSide !== 'top') continue
      const dTop = deep.surfaceElevM - du.topDepthM
      const dBase = deep.surfaceElevM - du.baseDepthM
      if (!(dBase < shallowTD - ELEV_EPS)) continue
      const leftElev = shallowSide === 'left' ? sElev : dTop
      const rightElev = shallowSide === 'left' ? dTop : sElev
      const tie: BottomTie = { leftElev, rightElev, deepLayerId: dId, shallowSide, elevAt: (f) => leftElev + f * (rightElev - leftElev) }
      if (!best || tie.elevAt(0.5) > best.elevAt(0.5)) best = tie
    }
  }
  return best
}

/**
 * The worst interior coverage hole in one gap that is CAPPED ABOVE by a near-full-width band — a
 * hole sitting directly under a correlation band. Each hole is measured only above ``floorAt(f)``
 * (the gap's bottom tie, see the module note); pass nothing to scan the whole gap.
 */
export function worstBandCappedHole(
  regs: readonly SectionRegion[],
  floorAt?: (frac: number) => number,
): { frac: number; gap: number; lo: number; hi: number } {
  let worst = { frac: -1, gap: 0, lo: 0, hi: 0 }
  for (let f = 0.03; f < 0.98; f += 0.01) {
    const ivs: [number, number][] = []
    for (const r of regs) ivs.push(...crossAt(r.polygon, f))
    if (ivs.length === 0) continue
    ivs.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const iv of ivs) {
      const last = merged[merged.length - 1]
      if (last && iv[0] <= last[1] + 5e-3) last[1] = Math.max(last[1], iv[1])
      else merged.push([...iv])
    }
    const floor = floorAt ? floorAt(f) : -Infinity
    for (let k = 0; k + 1 < merged.length; k++) {
      const holeTop = merged[k + 1][0]
      const holeBottom = Math.max(merged[k][1], floor)
      const g = holeTop - holeBottom
      if (g <= worst.gap) continue
      // Capped above by a near-full-width band: a region spanning >= 90% of the gap whose base sits
      // on the top of the hole. That is a correlation band with an uncovered slot beneath it.
      const cappedByBand = regs.some(
        (r) => fracSpan(r) >= 0.9 && crossAt(r.polygon, f).some(([lo]) => Math.abs(lo - holeTop) < 0.02),
      )
      if (cappedByBand) worst = { frac: f, gap: g, lo: holeBottom, hi: holeTop }
    }
  }
  return worst
}

/** A few mm above the 1 mm arrangement snap grid; the smallest real defect measured was 38 mm. */
export const HOLE_TOL_M = 0.01

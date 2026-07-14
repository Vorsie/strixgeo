/**
 * partitionFillV2.shapeaudit.zerocorr.ts — the 0-CORR-FULL-WIDTH violation scan for the
 * model-wide shape audit (owner ruling 8, design partition-engine-v2.md §8).
 *
 * Extracted from ``partitionFillV2.shapeaudit.diag.test.ts`` to keep that diag under the
 * 500-line budget (debt #201). A v2 region that reaches FULL WIDTH (touches BOTH column
 * edges) whose formation has NO drawn correlation tie across its gap is a geometric
 * auto-matched band — exactly what ruling 8 retires. This scan counts them; the counter at
 * 0 is the ruling-8 acceptance target ("every band maps to a drawn tie").
 *
 * A tie authorises a band ONLY when it joins two units of that formation on the two facing
 * columns of the gap (same-side, per the band-authority rule). Substrate quads reaching full
 * width BELOW the shallow TD are the deep-to-deep substrate (owner §8 Q3) and are excluded —
 * they are bounded by the shallow TD floor, not a same-formation termination band.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'

/** A detected 0-corr full-width band (ruling-8 violation) for the audit dump. */
export interface ZeroCorrRow {
  section: string
  gap: number
  colLeft: string
  colRight: string
  formation: string
  kind: string
  /** Elevation extent of the offending region (for locating it on the section). */
  topElev: number
  baseElev: number
}

const FULL_EPS = 0.02

/** A region reaches full width when its fraction extent spans ~0 to ~1. */
function isFullWidth(poly: readonly { fraction: number; elevation: number }[]): boolean {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.fraction < lo) lo = p.fraction
    if (p.fraction > hi) hi = p.fraction
  }
  return lo <= FULL_EPS && hi >= 1 - FULL_EPS
}

/** Elevation extent [min,max] of a polygon ring. */
function elevExtent(poly: readonly { fraction: number; elevation: number }[]): [number, number] {
  let lo = Infinity
  let hi = -Infinity
  for (const p of poly) {
    if (p.elevation < lo) lo = p.elevation
    if (p.elevation > hi) hi = p.elevation
  }
  return [lo, hi]
}

/**
 * Whether formation ``fid`` has a drawn tie across gap ``gi`` — an edge joining a unit of
 * ``fid`` on column ``gi`` to a unit of ``fid`` on column ``gi+1`` (adjacent columns). Such
 * a tie authorises a full-width band of that formation.
 */
function formationHasTieAcrossGap(
  fid: string,
  gi: number,
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
): boolean {
  // layerId -> {colIndex, formationId} across all columns.
  const loc = new Map<string, { ci: number; fid: string }>()
  columns.forEach((c, ci) => {
    for (const u of c.units) loc.set(u.layerId, { ci, fid: u.formationId })
  })
  for (const e of edges) {
    const la = loc.get(e.a)
    const lb = loc.get(e.b)
    if (!la || !lb) continue
    const lo = Math.min(la.ci, lb.ci)
    const hi = Math.max(la.ci, lb.ci)
    if (lo !== gi || hi !== gi + 1) continue // not this gap's facing pair
    if (la.fid === fid && lb.fid === fid) return true
  }
  return false
}

/** Shallow TD (higher of the two columns' deepest base elevations) for a gap. */
function shallowTDForGap(gi: number, columns: readonly PartitionColumn[]): number {
  const tdOf = (ci: number): number => {
    const c = columns[ci]
    const last = c.units[c.units.length - 1]
    return (c.surfaceElevM as number) - last.baseDepthM
  }
  return Math.max(tdOf(gi), tdOf(gi + 1))
}

/**
 * Scan every gap of a section for v2 full-width regions whose formation has no drawn tie
 * across that gap (ruling-8 violations). Substrate quads wholly below the shallow TD are
 * excluded (owner §8 Q3).
 */
export function zeroCorrFullWidth(
  gaps: Map<number, SectionRegion[]>,
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[],
  colNames: readonly string[],
  section: string,
  fname: (id: string) => string,
): ZeroCorrRow[] {
  const rows: ZeroCorrRow[] = []
  for (const [gi, regs] of gaps) {
    const shallowTD = shallowTDForGap(gi, columns)
    for (const r of regs) {
      if (r.kind === 'lens') continue // a lens is a termination, never a band
      if (!isFullWidth(r.polygon)) continue
      const [lo, hi] = elevExtent(r.polygon)
      // Exclude substrate quads that sit entirely at/below the shallow TD.
      if (hi <= shallowTD + 1e-3) continue
      if (formationHasTieAcrossGap(r.formationId, gi, columns, edges)) continue
      rows.push({
        section,
        gap: gi,
        colLeft: colNames[gi] ?? `col${gi}`,
        colRight: colNames[gi + 1] ?? `col${gi + 1}`,
        formation: fname(r.formationId),
        kind: r.kind,
        topElev: Math.round(hi * 100) / 100,
        baseElev: Math.round(lo * 100) / 100,
      })
    }
  }
  return rows
}

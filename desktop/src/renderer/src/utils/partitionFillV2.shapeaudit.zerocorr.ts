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
 * OWNER RULING 8e (design partition-engine-v2.md §8) — SAME-FORMATION ENCLOSURE CONFORMS. A
 * full-width same-formation face enclosed by its OWN formation's legitimately-tied face is ONE
 * body by construction ("it should be one sand") — a gate FALSE POSITIVE, not a ruling-8
 * violation. This counter ALREADY implements that exemption: ``formationHasTieAcrossGap``
 * excludes any full-width whose formation carries a same-formation tie across the gap (line
 * ~191). What REMAINS flagged is exactly ruling 8's negative guard — a same-formation
 * full-width with NO tie of that formation in the gap (the retired geometric auto-match: two
 * untied same-formation units are OPPOSING LENSES, not one band). So the 8e rescope leaves this
 * counter numerically unchanged (the tied-face full-widths were never flagged); the remaining
 * ``same-form-enclosure`` rows are the UNTIED ruling-8 residual, correctly still flagged.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from './partitionFill'

/**
 * Sub-shape class of a ruling-8 residual (design partition-engine-v2.md §4 "Strict-2/1/0
 * residual" row, 2026-07-15 session):
 *
 *  - ``same-form-enclosure`` (a) — an untied minority enclosed by the SAME formation on its
 *    own column (or facing the same formation untied on both sides), which SHOULD pinch to a
 *    lens but paints full-width. The clean lone-stack case (Tie-6) is fixed; the RESIDUAL (a)
 *    cases are blocked on either the interbedded-facing annulus-routing wall (design §4) or a
 *    Track-2 body-model mismatch (the enclosing same-formation units carry DIFFERENT bodyIds,
 *    so the v2 column-level enclosed-lens extraction — which requires one body — cannot pull
 *    the minority; v1 does). Engine-only fixes cannot close these without the flagged wall.
 *  - ``mixed-bracket-awaiting-ruling`` (b) — a minority sitting between two DIFFERENT tied
 *    bands (one lithology bracketing above, another below). What floods the vacated width is
 *    an OWNER RULING pending (design §4); NOT a defect to fix this session.
 *  - ``surface-void`` (c) — a surface-boundary first unit (its top is the section surface) or a
 *    unit facing a shallow-TD void, which should terminate as a 0.45 lens (§8 Q3) but paints
 *    full-width. Terminating it risks leaving an above-TD coverage hole; judged per instance.
 */
export type ZeroCorrClass = 'same-form-enclosure' | 'mixed-bracket-awaiting-ruling' | 'surface-void'

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
  /** Sub-shape classification (separates ruled-pending (b) from defect (a)/(c)). */
  klass: ZeroCorrClass
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

/** One column's units as elevation spans + formation names (top→down). */
function columnElev(
  c: PartitionColumn,
  fname: (id: string) => string,
): { fid: string; top: number; base: number }[] {
  const s = c.surfaceElevM as number
  return c.units.map((u) => ({ fid: fname(u.formationId), top: s - u.topDepthM, base: s - u.baseDepthM }))
}

/**
 * Classify a residual full-width violation into its sub-shape (a)/(b)/(c). Reads the two
 * columns' stacks: whether the violating formation sits on both sides untied, is enclosed by
 * ONE lithology on its own column (a), sits between TWO DIFFERENT lithologies (mixed bracket,
 * b), or is a surface-boundary / shallow-facing-void unit (c). The classification separates
 * the OWNER-RULING-PENDING (b) rows from the (a)/(c) defect rows in the audit dump.
 */
function classifyViolation(
  fid: string,
  gi: number,
  lo: number,
  hi: number,
  columns: readonly PartitionColumn[],
  fname: (id: string) => string,
): ZeroCorrClass {
  const elL = columnElev(columns[gi], fname)
  const elR = columnElev(columns[gi + 1], fname)
  const band = (u: { top: number; base: number }): boolean => u.top > lo + 0.01 && hi > u.base + 0.01
  const idxL = elL.findIndex((u) => u.fid === fid && band(u))
  const idxR = elR.findIndex((u) => u.fid === fid && band(u))
  const onL = idxL >= 0
  const onR = idxR >= 0
  // The side the unit lives on (prefer the deeper stack when both).
  const own = onL ? elL : elR
  const idx = onL ? idxL : idxR
  const above = idx > 0 ? own[idx - 1].fid : 'SURF'
  const below = idx >= 0 && idx + 1 < own.length ? own[idx + 1].fid : 'TD'
  // (c) SURFACE-VOID: the unit's own TOP is the section surface (first unit), OR the facing side
  // bottoms out (shallow TD) above the unit's band — a genuine facing void (§8 Q3).
  const tdOther = onL
    ? Math.min(...elR.map((u) => u.base))
    : Math.min(...elL.map((u) => u.base))
  const facingShallowVoid = (onL !== onR) && tdOther > lo + 0.01
  if (above === 'SURF' || facingShallowVoid) return 'surface-void'
  // (a) SAME-FORMATION ENCLOSURE: enclosed by ONE lithology above AND below on its own column,
  // or present untied on BOTH sides (the retired geometric auto-match).
  const enclosedSame = above === below && above !== 'SURF' && below !== 'TD'
  if (enclosedSame || (onL && onR)) return 'same-form-enclosure'
  // (b) MIXED BRACKET: bracketed by two DIFFERENT lithologies, facing deep — owner ruling pending.
  return 'mixed-bracket-awaiting-ruling'
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
        klass: classifyViolation(fname(r.formationId), gi, lo, hi, columns, fname),
      })
    }
  }
  return rows
}

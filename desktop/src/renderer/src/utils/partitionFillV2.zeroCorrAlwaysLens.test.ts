/**
 * partitionFillV2.zeroCorrAlwaysLens.test.ts — RED-first behavioural gates for the owner's
 * corr-0 contract (ruling 8i(e), design partition-engine-v2.md §8): "corr 0 — emit that unit-
 * side's lens, always. No thresholds, no narrow-gap guards, no formation comparison." Every
 * corr-0 unit-side MUST emit its own phase-1 lens flank; NO comparison of the unit's litho
 * against its neighbours (same or different) or against the facing column may GATE that
 * emission. The lensAudit diag (MISSING == 0) is the letter-of-the-law over the 14 real
 * sections; these are the SYNTHETIC behavioural cases the audit's simplification (item 10)
 * pins as its RED targets for the surviving formation-comparison guards.
 *
 * Flag-ON (``setTwoSidedTerminations(true)``, restored in ``finally``).
 *
 * CAMPAIGN STATUS. These cases encode the owner's contract in his own words. The current
 * engine still carries three formation-comparison guards the audit ruled must be deleted:
 *   - the corr-0 ``isMinorityWide`` eligibility gate (``emitTerminationSweep`` ~line 243) +
 *     the boundary ``boundaryMinorityKind`` / ``emitBoundaryLens`` path: a boundary corr-0
 *     unit whose single interior neighbour is the SAME litho FLOODS instead of lensing — a
 *     formation comparison that gates emission (deleted S34).
 *   - the boundary ``facingMatrixLabel === null`` guard (``emitBoundaryLens``): a boundary
 *     corr-0 unit whose facing sample finds no lateral matrix draws NO flank (deleted S34).
 *   - the sub-TD M-in-M enclosure classifier (``emitSubTdLenses``): a corr-0 sub-TD unit only
 *     lenses when a clean single-formation annulus (same litho above AND below the run)
 *     encloses it — a MIXED enclosure (different litho above vs below) is skipped (deleted S35).
 * Each case below is verified RED against the current engine once (its guard-specific failure
 * recorded in REWRITE_STATE §38), then ``it.skip`` citing the fix session — exactly the
 * literalCorr (c)/(d) pattern. Un-skip in the session named in the skip reason. Cases that are
 * ALREADY green (the interior corr-0 minority already lenses via ``emitLens`` /
 * ``emitEnclosedLensCurves``) stay un-skipped as regression locks, documented in §38.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { emitCurves } from './partitionFillV2/emitCurves'
import { effectiveCorrForSide } from './partitionFillV2/effectiveCorr'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve } from './partitionFillV2/types'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const SAND = 'sand'
const CLAY = 'clay'
const SILT = 'silt'
const VEEN = 'veen'

interface U {
  top: number
  base: number
  f: string
  layerId: string
  body?: string | null
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({
      topDepthM: u.top,
      baseDepthM: u.base,
      formationId: u.f,
      layerId: u.layerId,
      bodyId: u.body ?? null,
    })),
  }
}

/** Flip the flag ON for the callback, restore after. */
function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => {
  setTwoSidedTerminations(false)
})

/**
 * A curve id whose face is a phase-1 LENS flank — the sweep's ``term``, the sub-TD
 * ``subtdlens``, the boundary-lens ``term``, or the enclosed-lens ``lens`` vocabulary. NOT
 * ``oflank`` (onlap, phase 2). Mirrors the lensAudit diag's ``isLensFlankId``.
 */
function isLensFlankId(id: string): boolean {
  return id.startsWith('subtdlens') || id.startsWith('lens') || id.startsWith('term')
}

/**
 * Whether a phase-1 lens flank exists at the unit's own column ``x`` touching its top OR base
 * contact elevation — the letter-of-the-law "the lens flank exists" test the lensAudit uses.
 */
function lensFlankAt(curves: readonly InputCurve[], x: number, topElev: number, baseElev: number): boolean {
  for (const c of curves) {
    if (!isLensFlankId(c.id)) continue
    for (const p of c.points) {
      if (Math.abs(p.x - x) > 0.005) continue
      if (Math.abs(p.y - topElev) < 0.005 || Math.abs(p.y - baseElev) < 0.005) return true
    }
  }
  return false
}

/** Find the geom unit index of the first unit whose formation is ``f`` on a column. */
function unitOf(units: readonly { formationId: string; topElev: number; baseElev: number }[], f: string): number {
  return units.findIndex((u) => u.formationId === f)
}

describe('ruling 8i(e) — corr 0: emit that unit-side lens, always', () => {
  it('(a) corr-0 INTERIOR minority (mixed enclosure) emits its lens flank — REGRESSION LOCK (already green)', () => {
    seq = 0
    // Column M: CLAY[0..2] / VEEN[2..4] / SAND[4..9]. VEEN[2..4] has CLAY above, SAND below (a
    // genuine interior minority, mixed enclosure — NOT extracted as an enclosed lens because
    // above ≠ below). Facing columns straight → VEEN reads corr 0 on both looks. ``emitLens``
    // already lenses it (``isMinorityWide`` true: both neighbours differ). This is the owner's
    // contract already satisfied for the interior case; kept as a lock so a future guard change
    // cannot silently drop it.
    const mClay = layer()
    const mVeen = layer()
    const mSand = layer()
    const lClay = layer()
    const rSand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [{ top: 0, base: 9, f: CLAY, layerId: lClay, body: 'clay-L' }]),
      col('M', 10, [
        { top: 0, base: 2, f: CLAY, layerId: mClay, body: 'clay-M' },
        { top: 2, base: 4, f: VEEN, layerId: mVeen, body: 'veen-M' },
        { top: 4, base: 9, f: SAND, layerId: mSand, body: 'sand-M' },
      ]),
      col('R', 10, [{ top: 0, base: 9, f: SAND, layerId: rSand, body: 'sand-R' }]),
    ]
    const edges: CorrelationEdge[] = []
    const alongM = [0, 40, 80]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves, activeTies } = withFlip(() => emitCurves(section))
    const g = section.columns
    const mLeft = effectiveCorrForSide(0, 'right', g[1], g[0], g[0], g[1], activeTies)
    const veenIdx = unitOf(g[1].units, VEEN)
    expect(veenIdx).toBeGreaterThanOrEqual(0)
    expect(mLeft[veenIdx].corr).toBe(0)
    const veen = g[1].units[veenIdx]
    expect(lensFlankAt(curves, g[1].x, veen.topElev, veen.baseElev)).toBe(true)
  })

  it('(d) corr-0 INTERIOR minority enclosed by ONE matrix (same litho above AND below) emits its lens flank — REGRESSION LOCK (enclosed-lens path)', () => {
    seq = 0
    // Column M: SAND[0..2] / CLAY[2..4] / SAND[4..9]. The CLAY minority is enclosed by SAND above
    // AND below → ``extractEnclosedLenses`` merges the SAND band + records the CLAY as an enclosed
    // lens → ``emitEnclosedLensCurves`` emits a ``lens``-prefixed flank. The enclosure is
    // SAME-formation (M-in-M), the opposite of (a)'s mixed case — proving neither enclosure kind
    // gates emission. Regression lock (already green via the enclosed-lens path).
    const mSandTop = layer()
    const mClay = layer()
    const mSandBot = layer()
    const lSand = layer()
    const rSand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [{ top: 0, base: 9, f: SAND, layerId: lSand, body: 'sand-L' }]),
      col('M', 10, [
        { top: 0, base: 2, f: SAND, layerId: mSandTop, body: 'sand-M-top' },
        { top: 2, base: 4, f: CLAY, layerId: mClay, body: 'clay-M' },
        { top: 4, base: 9, f: SAND, layerId: mSandBot, body: 'sand-M-bot' },
      ]),
      col('R', 10, [{ top: 0, base: 9, f: SAND, layerId: rSand, body: 'sand-R' }]),
    ]
    const edges: CorrelationEdge[] = []
    const alongM = [0, 40, 80]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const { curves } = withFlip(() => emitCurves(section))
    const g = section.columns
    // The CLAY was merged out of M's ``units`` (recorded as an enclosed lens). Its lens flank rides
    // M's column at the original CLAY contact elevations (elev 8 = top, elev 6 = base).
    const clayTopElev = 10 - 2
    const clayBaseElev = 10 - 4
    expect(g[1].enclosedLenses.some((el) => el.lens.formationId === CLAY)).toBe(true)
    expect(lensFlankAt(curves, g[1].x, clayTopElev, clayBaseElev)).toBe(true)
  })

  // (b) — the BOUNDARY (TD-last) corr-0 minority. Un-skipped in S34 (guard deletions A/B/C:
  // ``isMinorityWide`` + ``boundaryMinorityKind`` formation-comparison gates deleted; corr-0 now
  // dispatches unconditionally through ``emitCorr0Termination``, geometry from ui + extent only).
  describe('the corr-0 boundary emission must not be gated by a formation comparison (RED S33 → GREEN S34: emitCorr0Termination lenses a same-litho-neighbour boundary corr-0 unit)', () => {
    it('(b) corr-0 TD-BOUNDARY (last) unit whose single neighbour is the SAME litho emits its lens flank', () => {
      seq = 0
      // Column M's LAST unit is a corr-0 minority CLAY[8..9] at the base; its single interior
      // neighbour ABOVE is CLAY too (same litho). ``boundaryMinorityKind`` returns null on a
      // same-formation neighbour → no boundary lens; ``isMinorityWide`` returns false for a
      // boundary unit → floods. Owner's contract: the boundary geometry may shape the flank, never
      // suppress it. NOTE the same-formation adjacency would normally collapse — here the lower CLAY
      // is split off by being a distinct body so it survives as its own unit for the boundary test;
      // if collapse merges it the case reduces to a single CLAY unit still owing a lens at the TD.
      const mSand = layer()
      const mClayHi = layer()
      const mClayLo = layer()
      const lSand = layer()
      const rSand = layer()
      const columns: PartitionColumn[] = [
        col('L', 10, [{ top: 0, base: 9, f: SAND, layerId: lSand, body: 'sand-L' }]),
        col('M', 10, [
          { top: 0, base: 7, f: SAND, layerId: mSand, body: 'sand-M' },
          { top: 7, base: 8, f: CLAY, layerId: mClayHi, body: 'clay-M-hi' },
          { top: 8, base: 9, f: CLAY, layerId: mClayLo, body: 'clay-M-lo' },
        ]),
        col('R', 10, [{ top: 0, base: 9, f: SAND, layerId: rSand, body: 'sand-R' }]),
      ]
      const edges: CorrelationEdge[] = []
      const alongM = [0, 40, 80]
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { curves, activeTies } = withFlip(() => emitCurves(section))
      const g = section.columns
      const mLeft = effectiveCorrForSide(0, 'right', g[1], g[0], g[0], g[1], activeTies)
      const lastIdx = g[1].units.length - 1
      expect(g[1].units[lastIdx].formationId).toBe(CLAY)
      expect(mLeft[lastIdx].corr).toBe(0)
      const last = g[1].units[lastIdx]
      expect(lensFlankAt(curves, g[1].x, last.topElev, last.baseElev)).toBe(true)
    })
  })

  // (c) — the SUB-TD M-in-M classifier. Un-skipped S35 (audit item 4): the M-in-M eligibility
  // (no-above / same-above / no-matching-enclosure-below / bridge-run) is DELETED; every sub-TD
  // corr-0 unit lenses via the shared ``emitCorr0Termination`` (sub-TD flood context).
  describe('the corr-0 sub-TD emission must not require a clean same-formation enclosure (RED verified S33: emitSubTdLenses M-in-M classifier skips a mixed-enclosure sub-TD corr-0 run; un-skipped S35)', () => {
    it('(c) corr-0 SUB-TD unit with MIXED enclosure (no same-formation M-in-M annulus) emits its lens flank', () => {
      seq = 0
      // Column L is DEEP; column R is SHALLOW (TD at depth 4 → elev 6). Below R's TD, L carries a
      // minority run with a MIXED enclosure: SAND above the run and CLAY below it — NOT the M-in-M
      // single-formation annulus ``emitSubTdLenses`` requires (below ≠ above). The SILT[elev 2..-2]
      // sub-TD minority reads corr 0 (below the facing TD, untied). Ruling 8i(e) ("INCLUDING
      // sub-TD") mandates the lens even without a clean enclosure; the current M-in-M classifier
      // skips it (belowFid ≠ M) → RED.
      const lSandTop = layer()
      const lSilt = layer()
      const lClay = layer()
      const rSand = layer()
      const columns: PartitionColumn[] = [
        col('L', 10, [
          { top: 0, base: 8, f: SAND, layerId: lSandTop, body: 'sand-L-top' },
          { top: 8, base: 12, f: SILT, layerId: lSilt, body: 'silt-L' },
          { top: 12, base: 16, f: CLAY, layerId: lClay, body: 'clay-L' },
        ]),
        // R shallow: TD at depth 4 → elev 6. L's SILT[elev 2..-2] + CLAY[-2..-6] sit below it.
        col('R', 10, [{ top: 0, base: 4, f: SAND, layerId: rSand, body: 'sand-R' }]),
      ]
      const edges: CorrelationEdge[] = []
      const alongM = [0, 40]
      const section = buildSectionInput(columns, edges, undefined, alongM)
      const { curves, activeTies } = withFlip(() => emitCurves(section))
      const g = section.columns
      const siltIdx = unitOf(g[0].units, SILT)
      expect(siltIdx).toBeGreaterThanOrEqual(0)
      const silt = g[0].units[siltIdx]
      // Confirm the SILT is sub-TD (entirely below R's TD elev 6) and corr 0.
      expect(silt.topElev).toBeLessThanOrEqual(6)
      const lLook = effectiveCorrForSide(0, 'left', g[0], g[1], g[0], g[1], activeTies)
      expect(lLook[siltIdx].corr).toBe(0)
      expect(lensFlankAt(curves, g[0].x, silt.topElev, silt.baseElev)).toBe(true)
    })
  })
})

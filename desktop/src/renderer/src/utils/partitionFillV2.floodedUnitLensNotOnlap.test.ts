/**
 * partitionFillV2.floodedUnitLensNotOnlap.test.ts — the SAFE-DEFAULT repair draws a LENS, not an
 * onlap, for a flooded drilled unit.
 *
 * OWNER RULING 2026-09-04 (on the packaged build, looking at a SAND unit at the bottom of a column
 * with no correlation on either side that rendered as a half-band onlap with an amber "!"):
 * *"I can't correlate to left. zero ties = lens."* A drilled unit the repair has to rescue must
 * render as a LENS — a closed pinch-out inside the column's reach, apex at the unit's own elevation,
 * exactly what a 0-tie unit gets when nothing floods it — NEVER as a forced ONLAP.
 *
 * The repair (``detectFloodedUnits`` → ``forceLensUnits``) flags a drilled unit the enclosing flood
 * would paint a FOREIGN litho, then re-runs with it DEMOTED TO CORR-0 so the sweep draws its lens.
 * Before 2026-09-04 the repair instead re-emitted an ONLAP (it demoted a forced corr-2 to corr-1 and
 * bypassed the corr-1 8m same-litho skip — both ONLAP shapes). This gate pins the shape flip at the
 * emission level, exactly as the sibling ``zeroCorrAlwaysLens`` gate does (``emitCurves`` + the
 * lens-flank / onlap-flank id vocabulary): a corr-1 unit that draws an ONLAP flank (``oflank``) in
 * the ordinary pass draws a LENS flank (``term`` / ``lens``) and NO onlap flank once the repair
 * force-flags it — the ``forceLensUnits`` channel being exactly the keys ``detectFloodedUnits``
 * produces for a flooded unit.
 *
 * RED before the 2026-09-04 change (a force-flagged corr-1 onlap stayed an onlap), GREEN after.
 * Flag-ON path (``setTwoSidedTerminations(true)``, restored in ``finally``).
 *
 * NOTE ON THE TEST LEVEL. A genuine ``detectFloodedUnits`` trigger cannot be reproduced
 * synthetically — the hardened engine floods no small hand-built scene, and the sole real-data
 * trigger (Tie-section 11 g0) is a corr-2 BAND that renders a quad both before and after (the band
 * contour, not the sweep, owns its column edge). So this gate injects the repair's own force-key
 * channel (what ``detectFloodedUnits`` would produce) and pins the emission the sweep controls; the
 * live ``detectFloodedUnits`` trigger + the ruling-8k "own litho survives" invariant stay pinned by
 * ``partitionFillV2.drilledLithoSurvives`` / ``.dataLossRepair`` on real data.
 */

import { afterEach, describe, expect, it } from 'vitest'

import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { effectiveCorrForSide } from './partitionFillV2/effectiveCorr'
import { emitCurves } from './partitionFillV2/emitCurves'
import { clearForceLensUnits, forceLensKey, setForceLensUnits } from './partitionFillV2/forceLensUnits'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve } from './partitionFillV2/types'
import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'

let seq = 0
const layer = (): string => `L${seq++}`
const CLAY = 'clay'
const SAND = 'sand'
const SILT = 'silt'

interface U {
  top: number
  base: number
  f: string
  layerId: string
}
function col(id: string, surface: number, units: U[]): PartitionColumn {
  return {
    investigationId: id,
    surfaceElevM: surface,
    units: units.map((u) => ({ topDepthM: u.top, baseDepthM: u.base, formationId: u.f, layerId: u.layerId, bodyId: null })),
  }
}

/** A phase-1 LENS flank id (sweep ``term``, sub-TD ``subtdlens``, enclosed ``lens``) — NOT ``oflank``. */
function isLensFlankId(id: string): boolean {
  return id.startsWith('subtdlens') || id.startsWith('lens') || id.startsWith('term')
}
/** A phase-2 ONLAP flank id (``oflank``, the one extra line a corr-1 onlap draws). */
function isOnlapFlankId(id: string): boolean {
  return id.startsWith('oflank')
}
/** Whether a flank of the given kind touches ``x`` at the unit's top OR base contact. */
function flankAt(curves: readonly InputCurve[], x: number, topElev: number, baseElev: number, pred: (id: string) => boolean): boolean {
  for (const c of curves) {
    if (!pred(c.id)) continue
    for (const p of c.points) {
      if (Math.abs(p.x - x) > 0.02) continue
      if (Math.abs(p.y - topElev) < 0.02 || Math.abs(p.y - baseElev) < 0.02) return true
    }
  }
  return false
}
function withFlip<T>(fn: () => T): T {
  const prev = setTwoSidedTerminations(true)
  try {
    return fn()
  } finally {
    setTwoSidedTerminations(prev)
  }
}

afterEach(() => {
  clearForceLensUnits()
  setTwoSidedTerminations(false)
})

describe('safe-default repair: a flooded unit is re-drawn as a LENS, never a forced onlap (owner 2026-09-04)', () => {
  it('a corr-1 onlap unit the repair force-flags draws a LENS flank and NO onlap flank ("zero ties = lens")', () => {
    seq = 0
    // SILT present only on the LEFT, its TOP tied to the right sand-top → a corr-1 ONLAP that laps up
    // the tie and pinches into the gap (the "half-band" the owner objected to). The matched facing
    // contact below the tie is SAND — a DIFFERENT litho — so the 8m same-litho skip does not fire and
    // the ordinary pass draws SILT's onlap flank.
    const lClay = layer()
    const lSilt = layer()
    const lSand = layer()
    const rClay = layer()
    const rSand = layer()
    const columns: PartitionColumn[] = [
      col('L', 10, [
        { top: 0, base: 3, f: CLAY, layerId: lClay },
        { top: 3, base: 4, f: SILT, layerId: lSilt },
        { top: 4, base: 8, f: SAND, layerId: lSand },
      ]),
      col('R', 10, [
        { top: 0, base: 3, f: CLAY, layerId: rClay },
        { top: 3, base: 8, f: SAND, layerId: rSand },
      ]),
    ]
    const edges: CorrelationEdge[] = [{ a: lSilt, b: rSand, aSide: 'top', bSide: 'top' }]
    const alongM = [0, 40]
    const section = buildSectionInput(columns, edges, undefined, alongM)
    const g = section.columns
    const siltIdx = g[0].units.findIndex((u) => u.formationId === SILT)
    expect(siltIdx, 'the SILT unit is on the left column').toBeGreaterThanOrEqual(0)
    const silt = g[0].units[siltIdx]

    // Precondition: SILT reads corr 1 (one tie) — the onlap class the ruling re-shapes.
    const { activeTies } = withFlip(() => emitCurves(section))
    const leftLook = effectiveCorrForSide(0, 'left', g[0], g[1], g[0], g[1], activeTies)
    expect(leftLook[siltIdx].corr, 'SILT is a one-tie onlap unit').toBe(1)

    // Ordinary pass (no repair): SILT draws its ONLAP flank — the half-band shape.
    const ordinary = withFlip(() => emitCurves(section))
    expect(
      flankAt(ordinary.curves, g[0].x, silt.topElev, silt.baseElev, isOnlapFlankId),
      'SILT draws an onlap flank in the ordinary pass',
    ).toBe(true)

    // Repair pass: the enclosing flood would paint SILT foreign, so detectFloodedUnits force-flags it.
    // The repair demotes it to corr-0 → SILT is re-drawn as a LENS and its onlap flank is gone.
    setForceLensUnits(new Set([forceLensKey(silt.layerId, 0, 'left')]))
    const repaired = withFlip(() => emitCurves(section))

    expect(
      flankAt(repaired.curves, g[0].x, silt.topElev, silt.baseElev, isLensFlankId),
      'SILT draws a LENS flank after the repair ("zero ties = lens")',
    ).toBe(true)
    expect(
      flankAt(repaired.curves, g[0].x, silt.topElev, silt.baseElev, isOnlapFlankId),
      'SILT is NEVER a forced onlap after the repair',
    ).toBe(false)
  })
})

/**
 * partitionFillV2.rawUnitTerm.diag.test.ts — RULING 8r RED-then-GREEN gate (THROWAWAY, STAGE A).
 *
 * Owner (2026-07-19, paint-tool dogfeed on 23/125-S7's middle clay, verbatim): "the middle
 * clay should lens, i want the lines before the merge. (first fill then merge remember)". The
 * enclosed-lens pre-merge (``extractEnclosedLenses`` collapsing a same-formation sandwich into
 * ONE merged host BEFORE emission) violates the pipeline order: every picked unit — however
 * thin, however enclosed — gets its OWN 2/1/0 termination lines; the fill paints; THEN the merge
 * welds touching same-litho regions.
 *
 * THE S7 EXEMPLAR (CS1 col6 = GEO-23/125-S7, x=385.729, looking LEFT into gap5 toward S12
 * x=289.855). The RAW picked stack around the sand diamond is:
 *   - raw u2-SILT [6.37..5.79]: NEITHER contact tied (6.37 = KLEI-above base, 5.79 = the lens
 *     top) → corr-0 → LENS. Two flanks rooted at 6.37 and 5.79, apex ≈ (342.6, 6.08).
 *   - raw u3-ZAND [5.79..5.19]: the enclosed lens — emitted by ``emitEnclosedLensCurves``,
 *     UNCHANGED (out of this test's scope).
 *   - raw u4-SILT [5.19..4.07]: base 4.07 tied via tie0:5 → corr-1 → ONLAP rooted at ITS OWN
 *     TOP 5.19 (ruling 8i(d): one line, the free-top flank).
 *
 * The BUG (pre-8r): the sweep classifies on the MERGED host [6.37..4.07] whose base 4.07 is
 * tied, so the whole merged SILT emits ONE corr-1 onlap rooted at 6.37:
 * ``oflankterm9=(385.729,6.37)→(337.792,4.9)``. THIS IS THE 8r VIOLATION — a merged-host line.
 *
 * ORACLE-EQUIVALENT ASSERTIONS (raw-unit line art, in owner language):
 *   (1) the S7 middle silt above the sand LENSES left: a corr-0 lens with flanks rooted at
 *       6.37 AND 5.79 (raw u2-SILT);
 *   (2) the silt below the sand ONLAPS at its own top 5.19 (raw u4-SILT): an onlap flank rooted
 *       at 5.19, NOT at 6.37;
 *   (3) NO onlap flank is rooted at 6.37 for that SILT in gap5 (the 6.37-rooted merged-host
 *       onlap ``oflankterm9`` is GONE).
 *
 * Gate: SHAPE_AUDIT=1 (the allowed audit env var). Deterministic. Reads the CS1 real section
 * from ``scripts/diag_allsections_input.json``. THROWAWAY — may be deleted after STAGE A lands.
 * Run (desktop/):
 *   SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.rawUnitTerm.diag.test.ts
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from './sectionPartition'
import { emitCurves } from './partitionFillV2/emitCurves'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { type InputCurve, type Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** 1 mm — the arrangement snap grid; a root within this of an expected contact is "on it". */
const ROOT_TOL_M = 0.001

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawCol {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawSectionJson {
  sectionId: string
  name: string
  columns: RawCol[]
  alongM: number[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
}

function segEndpoints(c: InputCurve): { a: Point; b: Point } {
  const pts = c.points
  return { a: pts[0], b: pts[pts.length - 1] }
}

/** Whether an emitted curve has an endpoint within tolerance of ``root``. */
function rootsAt(c: InputCurve, root: Point): boolean {
  const { a, b } = segEndpoints(c)
  const near = (p: Point): boolean =>
    Math.abs(p.x - root.x) <= ROOT_TOL_M && Math.abs(p.y - root.y) <= ROOT_TOL_M
  return near(a) || near(b)
}

/** The onlap-flank family (``oflankterm*`` / ``oflanksubtdo*``). */
function isOnlapFlank(id: string): boolean {
  return id.startsWith('oflank')
}

/** A phase-1 lens closing (``term*`` / ``lens*`` / ``subtdlens*``) — NOT an onlap flank. */
function isLensClosing(id: string): boolean {
  return (id.startsWith('term') || id.startsWith('lens') || id.startsWith('subtdlens')) && !isOnlapFlank(id)
}

describe('v2 ruling 8r — raw-unit terminations on the S7 middle silt (RED-then-GREEN)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  it('S7 gap5: middle silt lenses (u2), silt-below onlaps at its own top 5.19 (u4), NO 6.37 onlap', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSectionJson[] }
    const cs1 = raw.sections.find((s) => s.name === 'Cross-section 1')
    expect(cs1).toBeDefined()
    if (!cs1) return

    // Drop empty/surface-less columns (the same ``prepare`` filter the engine's normaliser uses)
    // so the surviving-column indices + alongM match the engine.
    const keep = cs1.columns
      .map((c, i) => ({ c, i }))
      .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: c.units,
    }))
    const alongM = keep.map(({ i }) => cs1.alongM[i])
    const edges: CorrelationEdge[] = cs1.edges.map((e) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }))

    // Locate the S7 column by its known along-section x (385.729) — the ``investigationId`` is a raw
    // uuid, not the display name, so we index by geometry. S7 carries raw SILT pieces u2/u4 around the
    // enclosed ZAND lens at [5.79..5.19]; we read the RAW column stack (pre-merge) for their contacts.
    const s7Idx = alongM.findIndex((x) => Math.abs(x - 385.729) < 0.01)
    expect(s7Idx, 'S7 column at x=385.729 present in CS1').toBeGreaterThanOrEqual(0)
    if (s7Idx < 0) return
    const s7Keep = keep[s7Idx]
    const s7X = alongM[s7Idx]

    // Raw contact elevations for the S7 SILT pieces (surface − depth).
    const surf = s7Keep.c.surfaceElevM as number
    const rawUnits = s7Keep.c.units.map((u) => ({
      topElev: surf - u.topDepthM,
      baseElev: surf - u.baseDepthM,
      formationId: u.formationId,
    }))
    // u2-SILT [6.37..5.79], u3-ZAND [5.79..5.19], u4-SILT [5.19..4.07] — locate by elevation.
    const nearE = (a: number, b: number): boolean => Math.abs(a - b) < 0.02
    const u2 = rawUnits.find((u) => nearE(u.topElev, 6.37) && nearE(u.baseElev, 5.79))
    const u4 = rawUnits.find((u) => nearE(u.topElev, 5.19) && nearE(u.baseElev, 4.07))
    expect(u2, 'raw u2-SILT [6.37..5.79] present in S7 stack').toBeDefined()
    expect(u4, 'raw u4-SILT [5.19..4.07] present in S7 stack').toBeDefined()
    if (!u2 || !u4) return

    // Run the flag-ON engine on the NORMALISED (merged) section — the real production path.
    const prev = setTwoSidedTerminations(true)
    let curves: InputCurve[]
    try {
      const section = buildSectionInput(columns, edges, undefined, alongM)
      curves = emitCurves(section).curves
    } finally {
      setTwoSidedTerminations(prev)
    }

    // gap5 curves only (the S12↔S7 gap; S7 is its RIGHT column).
    const gap5 = curves.filter((c) => 'gapIndex' in c ? (c as { gapIndex?: number }).gapIndex === 5 : true)
    void gap5 // InputCurve has no gapIndex; filter by geometry at the S7 column x below.

    // Curves rooted at the S7 column x (x=385.729) — the termination line art on the S7 face.
    const atS7 = (c: InputCurve): boolean => {
      const { a, b } = segEndpoints(c)
      return Math.abs(a.x - s7X) <= ROOT_TOL_M || Math.abs(b.x - s7X) <= ROOT_TOL_M
    }

    // (3) NO onlap flank rooted at 6.37 for SILT in gap5 (oflankterm9-equivalent gone).
    const onlapAt637 = curves.filter(
      (c) => isOnlapFlank(c.id) && atS7(c) && rootsAt(c, { x: s7X, y: 6.37 }),
    )
    expect(
      onlapAt637.length,
      `NO onlap flank may root at 6.37 (the merged-host oflankterm9 violation). Found: ${onlapAt637
        .map((c) => `${c.id}=${JSON.stringify(segEndpoints(c))}`)
        .join('; ')}`,
    ).toBe(0)

    // (1) raw u2-SILT LENSES: a phase-1 lens closing rooted at 6.37 AND one rooted at 5.79.
    const lensAt637 = curves.filter((c) => isLensClosing(c.id) && atS7(c) && rootsAt(c, { x: s7X, y: 6.37 }))
    const lensAt579 = curves.filter((c) => isLensClosing(c.id) && atS7(c) && rootsAt(c, { x: s7X, y: 5.79 }))
    expect(
      lensAt637.length,
      'raw u2-SILT [6.37..5.79] top flank: a lens closing must root at 6.37',
    ).toBeGreaterThan(0)
    expect(
      lensAt579.length,
      'raw u2-SILT [6.37..5.79] base flank: a lens closing must root at 5.79',
    ).toBeGreaterThan(0)

    // (2) raw u4-SILT ONLAPS at its own top 5.19: an onlap flank rooted at 5.19.
    const onlapAt519 = curves.filter((c) => isOnlapFlank(c.id) && atS7(c) && rootsAt(c, { x: s7X, y: 5.19 }))
    expect(
      onlapAt519.length,
      'raw u4-SILT [5.19..4.07] onlap flank must root at its OWN top 5.19 (ruling 8i(d))',
    ).toBeGreaterThan(0)

    // Report evidence: dump the S7-rooted termination line art in gap5 (the 6.37/5.79 lens flanks +
    // the 5.19 onlap flank), so the STAGE-A report can cite the exact curves.
    const s7Term = curves
      .filter((c) => (isOnlapFlank(c.id) || isLensClosing(c.id)) && atS7(c))
      .map((c) => `${c.id}=${JSON.stringify(segEndpoints(c))}`)
    // eslint-disable-next-line no-console
    console.log('S7-ROOTED TERMINATIONS:', JSON.stringify(s7Term, null, 1))
  })
})

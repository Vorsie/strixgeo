/**
 * partitionFillV2.boundaryLensClosingLeg.diag.test.ts — THROWAWAY RED-first gate for ruling 8q
 * (owner, 2026-07-19: "lens lines first left and right … then you have a connected set of lines
 * and you don't have any gaps, you just need to fill like the fill tool in paint"). Session-54
 * STAGE C: the S8 boundary-lens closing leg becomes REAL line art.
 *
 * THE CASE (CS1, column x=456.066, unit u1-SILT [9.85..9.29], last unit, base = shallow-TD floor
 * 9.29, leftlook corr-0 → a TD boundary lens). Before STAGE C the sweep emits ONLY the free TOP
 * flank ``term`` = (441.064,9.29)→(456.066,9.85); the TD-riding tied leg (the base rides the
 * shallow-TD floor, from the column base corner (456.066,9.29) to the apex (441.064,9.29)) was
 * deliberately NOT emitted (ruling 8i(d): a second leg riding the polyline duplicates line art).
 * Ruling 8q OVERRIDES that: the paint tool sees a CLOSED lens — every termination loop must close
 * as REAL art, so the tied leg is exported as a second lens-family curve.
 *
 * THE OWNER-LANGUAGE ASSERTIONS:
 *   1. the lens loop closes as line art — a lens-family curve exists whose endpoints are the
 *      TD-riding closing leg ≈(456.066,9.29)→(441.064,9.29), IN ADDITION to the free flank
 *      ≈(441.064,9.29)→(456.066,9.85) (the paint tool sees a closed lens);
 *   2. regions unchanged: holes 0/0 + different-litho overlaps 0 across all 14 sections (the tied
 *      leg is EXACTLY coincident with the TD-floor polyline the arrangement already traces, so it
 *      unions in without a topology change).
 *
 * RED first: on the pre-STAGE-C engine assertion 1 FAILS (no lens-family curve rides the TD floor
 * from the base corner to the apex). Then build; then GREEN. Gate: SHAPE_AUDIT=1.
 *
 * Run (desktop/):
 *   SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.boundaryLensClosingLeg.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { emitCurves } from './partitionFillV2/emitCurves'
import { effectiveCorrForSide } from './partitionFillV2/effectiveCorr'
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve, type Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

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
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

/** The lens-family prefixes (phase-1 lens closings): the sweep's ``term`` (incl. its
 * ``oflank``-less boundary flank + the STAGE-C tied leg), the enclosed-lens ``lens``, the sub-TD
 * ``subtdlens``. NOT ``oflank`` (onlap, phase 2), NOT fill / band / tie / column / surface art. */
function isLensFamily(id: string): boolean {
  return id.startsWith('subtdlens') || id.startsWith('lens') || id.startsWith('term')
}

function prepare(sec: RawSection): {
  columns: PartitionColumn[]
  alongM: number[]
  edges: CorrelationEdge[]
} {
  const keep = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = keep.map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, alongM, edges }
}

/** Endpoints of a curve (its first + last point). */
function endpoints(c: InputCurve): { a: Point; b: Point } {
  const pts = c.points
  return { a: pts[0], b: pts[pts.length - 1] }
}

/** Whether a curve connects ``p`` and ``q`` (either endpoint order) within ``tol`` metres. */
function connects(c: InputCurve, p: Point, q: Point, tol: number): boolean {
  const { a, b } = endpoints(c)
  const near = (u: Point, v: Point): boolean => Math.abs(u.x - v.x) <= tol && Math.abs(u.y - v.y) <= tol
  return (near(a, p) && near(b, q)) || (near(a, q) && near(b, p))
}

// --- holes / overlaps scan helpers (mirror partitionFillV2.holes_overlaps.diag.test.ts) ---
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    const [x1, x2] = [a.fraction, b.fraction]
    if ((x1 <= f && x2 > f) || (x2 <= f && x1 > f)) {
      const t = (f - x1) / (x2 - x1)
      ys.push(a.elevation + t * (b.elevation - a.elevation))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}
function mergeIntervals(iv: [number, number][], eps: number): [number, number][] {
  const s = iv.filter(([a, b]) => b - a > 1e-9).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1] + eps) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b)
    else out.push([a, b])
  }
  return out
}

describe('v2 STAGE C — boundary-lens closing leg is real line art (ruling 8q)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  const rawAll = JSON.parse(readFileSync(INPUT, 'utf8')) as {
    sections: RawSection[]
    formationNames: Record<string, string>
  }

  it('CS1 S8 (x=456.066): the TD-riding closing leg exists as a lens-family curve alongside the free flank', () => {
    expect(existsSync(INPUT)).toBe(true)
    const cs1 = rawAll.sections.find((s) => s.name === 'Cross-section 1')
    expect(cs1, 'Cross-section 1 present in the input').toBeTruthy()

    const { columns, alongM, edges } = prepare(cs1!)
    // Locate the S8 column by its along-section x (the mandate's x=456.066).
    const s8Idx = alongM.findIndex((x) => Math.abs(x - 456.066) < 0.01)
    expect(s8Idx, `S8 column at x≈456.066 (found alongM=${JSON.stringify(alongM.map((v) => +v.toFixed(2)))})`).toBeGreaterThanOrEqual(0)
    const colX = alongM[s8Idx]

    const section = buildSectionInput(columns, edges, undefined, alongM)
    const prev = setTwoSidedTerminations(true)
    let curves: InputCurve[]
    try {
      curves = emitCurves(section).curves as InputCurve[]
    } finally {
      setTwoSidedTerminations(prev)
    }

    const freeFlankEnd: Point = { x: colX, y: 9.85 } // u1-SILT top contact (free flank column corner)
    const apex: Point = { x: 441.064, y: 9.29 } // the boundary-lens apex on the TD floor
    const baseCorner: Point = { x: colX, y: 9.29 } // u1-SILT base = shallow-TD floor corner

    const lensFamily = curves.filter((c) => isLensFamily(c.id))

    // The FREE flank (already emitted pre-STAGE-C): apex → free top corner.
    const freeFlank = lensFamily.find((c) => connects(c, apex, freeFlankEnd, 0.02))
    // The TIED closing leg (STAGE C): base corner → apex, riding the TD floor. RED before the build.
    const tiedLeg = lensFamily.find((c) => connects(c, baseCorner, apex, 0.02))

    console.log('\n########## CS1 S8 boundary-lens closing leg ##########')
    console.log(`  S8 colX = ${colX.toFixed(3)}`)
    console.log(`  free flank (apex→top corner) : ${freeFlank ? `${freeFlank.id} ${JSON.stringify(freeFlank.points)}` : 'ABSENT'}`)
    console.log(`  tied leg  (base corner→apex) : ${tiedLeg ? `${tiedLeg.id} ${JSON.stringify(tiedLeg.points)}` : 'ABSENT (RED — the closing loop is not line art)'}`)
    console.log('  --- all lens-family curves rooted at the S8 base corner (456.066,9.29) ---')
    for (const c of lensFamily) {
      const { a, b } = endpoints(c)
      const rootsBase =
        (Math.abs(a.x - colX) < 0.02 && Math.abs(a.y - 9.29) < 0.02) ||
        (Math.abs(b.x - colX) < 0.02 && Math.abs(b.y - 9.29) < 0.02)
      if (rootsBase) console.log(`    ${c.id}: ${JSON.stringify(c.points)}`)
    }

    expect(freeFlank, 'the free TOP flank (apex→top corner) is present (unchanged)').toBeTruthy()
    expect(
      tiedLeg,
      'the TD-riding tied leg (base corner→apex) is a lens-family curve — the paint tool sees a CLOSED lens (ruling 8q)',
    ).toBeTruthy()
  })

  it('regions unchanged: holes 0/0 + different-litho overlaps 0 across all 14 sections', () => {
    let holesAbove = 0
    let holesSub = 0
    let overlaps = 0
    const prev = setTwoSidedTerminations(true)
    try {
      for (const sec of rawAll.sections) {
        const { columns, edges, alongM } = prepare(sec)
        if (columns.length < 2) continue
        const tdElev = columns.map((c) => Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)))
        const regions = computeSectionFillV2(columns, edges, undefined, alongM)
        const byGap = new Map<number, typeof regions>()
        for (const r of regions) {
          if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
          byGap.get(r.gapIndex)!.push(r)
        }
        for (const [gi, regs] of byGap) {
          const shallowTD = Math.max(tdElev[gi] ?? -Infinity, tdElev[gi + 1] ?? -Infinity)
          for (let f = 0.02; f < 0.985; f += 0.02) {
            const all: [number, number][] = []
            for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
            const merged = mergeIntervals(all, 0.0005)
            for (let k = 0; k + 1 < merged.length; k++) {
              const holeTop = merged[k + 1][0]
              const holeBot = merged[k][1]
              const hole = holeTop - holeBot
              if (hole > 0.0005 && hole < 5) {
                if (holeTop <= shallowTD + 0.01) holesSub++
                else holesAbove++
              }
            }
            for (let a = 0; a < regs.length; a++)
              for (let b = a + 1; b < regs.length; b++) {
                if (regs[a].formationId === regs[b].formationId) continue
                const ia = coveredIntervals(regs[a].polygon, f)
                const ib = coveredIntervals(regs[b].polygon, f)
                for (const [a1, a2] of ia)
                  for (const [b1, b2] of ib) if (Math.min(a2, b2) - Math.max(a1, b1) > 0.001) overlaps++
              }
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    console.log(`\n########## regions: holesAbove=${holesAbove} holesSub=${holesSub} diffLithoOverlapSamples=${overlaps} ##########`)
    expect(holesAbove, 'above-TD holes must stay 0 (tied leg is coincident with the TD floor)').toBe(0)
    expect(holesSub, 'sub-TD holes must stay 0').toBe(0)
    expect(overlaps, 'different-litho overlap samples must stay 0').toBe(0)
  })

  it('model-wide: every boundary corr-0 lens (first/last unit) now carries the tied closing leg', () => {
    // A boundary corr-0 lens is a FIRST (ui 0, rides the top band) or LAST (ui last, rides the
    // shallow-TD floor) unit whose look-side corr is 0 — the exact ``emitBoundaryLens`` population.
    // For each, its tied leg is the lens-family curve horizontally coincident with the boundary
    // polyline near the unit's TIED contact (top for a first unit, base for a last unit): endpoints
    // both within snap of the tied elevation, one endpoint on the column corner.
    const nameOf = (id: string): string => id
    const fired: string[] = []
    const notFired: string[] = []
    const prev = setTwoSidedTerminations(true)
    try {
      for (const sec of rawAll.sections) {
        const { columns, edges, alongM } = prepare(sec)
        if (columns.length < 2) continue
        const section = buildSectionInput(columns, edges, undefined, alongM)
        const emitResult = emitCurves(section)
        const curves = emitResult.curves as InputCurve[]
        const geom = section.columns
        const lensFam = curves.filter((c) => isLensFamily(c.id))
        for (let ci = 0; ci < geom.length; ci++) {
          const col = geom[ci]
          for (const gi of [ci - 1, ci] as const) {
            if (gi < 0 || gi + 1 >= geom.length) continue
            const sideL: 'left' | 'right' = ci === gi ? 'left' : 'right'
            const facing = sideL === 'left' ? geom[gi + 1] : geom[gi]
            const left = sideL === 'left' ? col : facing
            const right = sideL === 'left' ? facing : col
            const corr = effectiveCorrForSide(gi, sideL, col, facing, left, right, emitResult.activeTies, emitResult.bridgeGapAnchored)
            for (let ui = 0; ui < col.units.length; ui++) {
              if ((corr[ui]?.corr ?? 0) !== 0) continue
              const isFirst = ui === 0
              const isLast = ui + 1 >= col.units.length
              if (!(isFirst || isLast) || (isFirst && isLast)) continue // interior / single-unit — not a boundary lens
              const u = col.units[ui]
              // The unit's TIED contact rides the boundary polyline: top band (FIRST) / shallow-TD
              // floor (LAST). The tied leg = a lens-family curve rooted at the column TIED corner
              // (col.x, tiedElev) whose OTHER endpoint is the apex laterally into the gap (the
              // boundary polyline can SLOPE for a surface unit, so we do NOT require it horizontal —
              // only that it roots at the tied corner and reaches laterally, distinguishing it from
              // the FREE flank which roots at the OTHER contact).
              const tiedElev = isFirst ? u.topElev : u.baseElev
              const tiedCorner: Point = { x: col.x, y: tiedElev }
              const leg = lensFam.find((c) => {
                const { a, b } = endpoints(c)
                const aAt = Math.abs(a.x - tiedCorner.x) < 0.02 && Math.abs(a.y - tiedCorner.y) < 0.02
                const bAt = Math.abs(b.x - tiedCorner.x) < 0.02 && Math.abs(b.y - tiedCorner.y) < 0.02
                const otherX = aAt ? b.x : a.x
                return (aAt || bAt) && Math.abs(otherX - col.x) > 0.05 // roots at tied corner + reaches laterally
              })
              const id = `${sec.name} gap${gi}[${sideL}] col#${ci} u${ui} ${isFirst ? 'FIRST/surface' : 'LAST/td'} el[${u.baseElev.toFixed(2)}..${u.topElev.toFixed(2)}]`
              if (leg) fired.push(`${id} -> ${leg.id} ${JSON.stringify(leg.points.map((p) => [+p.x.toFixed(3), +p.y.toFixed(2)]))}`)
              else notFired.push(id)
            }
          }
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    // De-dup (a boundary unit is looked at on both its left and right side; the leg is the same).
    const uniqFired = [...new Set(fired)]
    console.log(`\n########## MODEL-WIDE boundary corr-0 tied-leg firings (deduped) : ${uniqFired.length} ##########`)
    for (const f of uniqFired) console.log(`  FIRED  ${f}`)
    console.log(`########## boundary corr-0 sides with NO tied leg found : ${[...new Set(notFired)].length} ##########`)
    for (const n of [...new Set(notFired)]) console.log(`  ABSENT ${n}`)
    void nameOf
    // Every boundary corr-0 side must now carry the tied closing leg (ruling 8q — close the loop).
    expect([...new Set(notFired)].length, 'every boundary corr-0 lens carries the tied closing leg').toBe(0)
  })
})

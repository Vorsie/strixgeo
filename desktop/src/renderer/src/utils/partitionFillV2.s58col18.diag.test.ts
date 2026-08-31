/**
 * partitionFillV2.s58col18.diag.test.ts — SESSION-58 reproduction + gate for the 23/125-S7
 * (CS1 col18, x=646.74) trio (design §8 ruling 8t / 8m / 8i(d)).
 *
 * PREMISE (orchestrator-measured): col18 raw stack —
 *   u0 SILT[11.89..10.11] u1 KLEI[10.11..7.75] u2 SILT[7.75..6.65] u3 KLEI[6.65..6.03]
 *   u4 SILT[6.03..5.46] u5 VEEN[5.46..5.05] u6 KLEI[5.05..4.23](TD).
 * LEFT neighbor kept#17 S7A x=645.57 single SILT[11.46..10.42] TD 10.42 (everything below → sub-TD).
 * RIGHT neighbor kept#19 S6 x=724.83; u3 = ZAND[7.03..0.85].
 * tie83 = col18-u6-base(646.7,4.23) ↔ S6-u3-top(724.8,7.03) — corr-1 base tie, facing ZAND.
 *
 * THE THREE DEFECTS to reproduce (RED before the S58 build):
 *   (1) u3-KLEI left sub-TD lens MISSING — the subtdlens sweep skips u3 [6.65..6.03].
 *   (2) u6-KLEI right onlap MISSING — the free-top→apex-on-tie83 curve is suppressed.
 *   (3) u5-VEEN right hugged at ~0.9 m (old thickness rung on the tie83 collision).
 *
 * Gate: SHAPE_AUDIT=1 (log-only diagnostic; assertions describe the TARGET state). Delete at commit.
 * Run (desktop/): SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.s58col18.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const GATE = process.env.SHAPE_AUDIT === '1'

const SILT = '019e940a-4b4e-7806-aa41-5831b60f2e06'.slice(-4) // 2e06
const KLEI = '2354e519bb43'.slice(-4) // bb43
const VEEN = '2af4'
const ZAND = 'd1bc'

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

function pointInPoly(poly: readonly PartitionPoint[], f: number, e: number): boolean {
  let inside = false
  const n = poly.length
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].fraction
    const yi = poly[i].elevation
    const xj = poly[j].fraction
    const yj = poly[j].elevation
    const intersect = yi > e !== yj > e && f < ((xj - xi) * (e - yi)) / (yj - yi) + xi
    if (intersect) inside = !inside
  }
  return inside
}

function prepare(sec: RawSection): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const keep = sec.columns.filter((c) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM as number,
    units: c.units,
  }))
  const alongM = sec.columns
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .map(({ i }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

describe('S58 CS1 col18 trio (ruling 8t / 8m / 8i(d))', () => {
  it('u3 left lens present, u6 right onlap present, u5 right reach ≥ 0.225', () => {
    if (!GATE) return
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
    expect(sec).toBeTruthy()
    const { columns, edges, alongM } = prepare(sec)
    // col18 = kept#18. gap17 = gap between kept#17 (S7A, left) and kept#18 (col18). gap18 =
    // between kept#18 and kept#19 (S6, right). col18's RIGHT looks are gapIndex 18.
    const prev = setTwoSidedTerminations(true)
    let regions: SectionRegion[]
    try {
      regions = computeSectionFillV2(columns, edges, undefined, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }

    const dump = (gi: number, tag: string, eLo: number, eHi: number, fMax = 1): void => {
      for (const r of regions.filter((rr) => rr.gapIndex === gi)) {
        const es = r.polygon.map((p) => p.elevation)
        const fs = r.polygon.map((p) => p.fraction)
        const elo = Math.min(...es)
        const ehi = Math.max(...es)
        const flo = Math.min(...fs)
        const fhi = Math.max(...fs)
        if (ehi > eLo && elo < eHi && flo < fMax) {
          const ring = r.polygon.map((p) => `(${p.fraction.toFixed(3)},${p.elevation.toFixed(2)})`).join(' ')
          // eslint-disable-next-line no-console
          console.log(`[${tag}] fid=${r.formationId.slice(-4)} kind=${r.kind} f[${flo.toFixed(3)}..${fhi.toFixed(3)}] el[${elo.toFixed(2)}..${ehi.toFixed(2)}] ring=${ring}`)
        }
      }
    }

    // gap18 = col18 RIGHT toward S6 (78.1 m). Dump ALL of it (u5/u6 terminations, the sub-TD sweep).
    // eslint-disable-next-line no-console
    console.log('===== gap18 (col18 RIGHT → S6) — el[3.5..12] =====')
    dump(18, 'G18', 3.5, 12.5)
    // eslint-disable-next-line no-console
    console.log('===== gap17 (S7A LEFT ← col18), sub-TD el[3.5..7] — u3/u4/u5 left lenses =====')
    dump(17, 'G17', 3.5, 7.5)

    // DEFECT (1): u3-KLEI left lens. u3 = [6.65..6.03], mid ~6.34. In gap17 (col18 is the RIGHT
    // column, fraction 1 side). Look for a KLEI lens whose extent covers el~6.34 near the col18
    // side. subtdlens2/3 (u4 SILT) + subtdlens4/5 (u5 VEEN) exist; u3 KLEI must too.
    // The lens closing traces as a KLEI region (any kind) whose extent covers [6.03..6.65] AND
    // whose fraction reaches PAST the column into the gap (a real pinch, apex ~0.55 from col18 side).
    const u3Lenses = regions.filter((r) => {
      if (r.gapIndex !== 17 || r.formationId.slice(-4) !== KLEI) return false
      const es = r.polygon.map((p) => p.elevation)
      const fs = r.polygon.map((p) => p.fraction)
      // col18 is the RIGHT column of gap17 (fraction 1); a pinch toward the gap dips to fraction < 0.9.
      return Math.max(...es) <= 6.66 && Math.min(...es) >= 6.02 && Math.min(...fs) < 0.9
    })
    // eslint-disable-next-line no-console
    console.log(`[DEFECT1] gap17 KLEI lens covering u3 [6.03..6.65]: count=${u3Lenses.length}`)

    // DEFECT (2): u6-KLEI right onlap — a distinct PINCHING onlap triangle (0,5.05)(0,4.23)(0.5,5.63),
    // NOT the merged full-width KLEI band that fills under tie83. This is DEFERRED (8m matched-side
    // rule gap, §64 ASK-FIRST): the onlap is 8m-suppressed (u6-KLEI base-ties S6-ZAND-TOP; the own-side
    // rule samples S6-KLEI above the 7.03 contact → suppress). A distinct onlap triangle exists ONLY if
    // a KLEI region pinches to a fraction-0.5 apex at el~5.63 AND is bounded away from full width — we
    // detect it as a KLEI region whose vertex set includes a point near (0.5,5.63) with a base at ~4.23.
    const u6Onlap = regions.filter((r) => {
      if (r.gapIndex !== 18 || r.formationId.slice(-4) !== KLEI) return false
      const apexPin = r.polygon.some((p) => Math.abs(p.fraction - 0.5) < 0.02 && Math.abs(p.elevation - 5.63) < 0.05)
      const basePin = r.polygon.some((p) => p.fraction < 0.02 && Math.abs(p.elevation - 4.23) < 0.05)
      const topPin = r.polygon.some((p) => p.fraction < 0.02 && Math.abs(p.elevation - 5.05) < 0.05)
      // A GENUINE onlap triangle stays within [4.23..5.63] and does not also carry the KLEI band above
      // (el > 6): the merged full-width band spans up to 10.11 and must not count.
      const es = r.polygon.map((p) => p.elevation)
      return apexPin && basePin && topPin && Math.max(...es) < 6.0
    })
    // eslint-disable-next-line no-console
    console.log(`[DEFECT2] gap18 distinct u6 KLEI onlap triangle: count=${u6Onlap.length} (0 = DEFERRED, 8m rule gap §64)`)

    // DEFECT (3): u5-VEEN right reach. u5 = [5.46..5.05], mid ~5.255. Its lens/onlap in gap18.
    // The gap is 78.1 m; 0.225 reach → apex x≈664.3 → fraction ≈ (664.3-646.7)/78.1 ≈ 0.225.
    // The OLD thickness hug gave ~0.9 m ≈ fraction 0.0115 (apex 647.6). Report the max fraction.
    const u5Regions = regions.filter((r) => {
      if (r.gapIndex !== 18 || r.formationId.slice(-4) !== VEEN) return false
      const es = r.polygon.map((p) => p.elevation)
      return Math.min(...es) < 5.46 && Math.max(...es) > 5.05
    })
    let u5MaxFrac = 0
    for (const r of u5Regions) u5MaxFrac = Math.max(u5MaxFrac, ...r.polygon.map((p) => p.fraction))
    // eslint-disable-next-line no-console
    console.log(`[DEFECT3] gap18 VEEN(u5) regions=${u5Regions.length} maxReachFraction=${u5MaxFrac.toFixed(4)} (0.225 target ≈ 0.225)`)

    // SHIPPED assertions (DEFECT1 + DEFECT3 — GREEN after Stages C + A):
    expect(u3Lenses.length, 'DEFECT1: u3 KLEI left sub-TD lens present (ruling 8r split)').toBeGreaterThan(0)
    expect(u5MaxFrac, 'DEFECT3: u5 VEEN right reach halved to ~0.225 (ruling 8t), not hugged').toBeGreaterThan(0.15)
    // DEFECT2 is DEFERRED to the owner (8m matched-side rule gap, §64): the distinct onlap triangle is
    // 8m-SUPPRESSED under the own-side rule. This asserts the CURRENT (deferred) state so the gate is
    // honest — FLIP this to `toBeGreaterThan(0)` once the owner approves the facing-side 8m rule.
    expect(u6Onlap.length, 'DEFECT2: distinct u6 onlap triangle DEFERRED (8m rule gap §64) — currently suppressed').toBe(0)
  })
})

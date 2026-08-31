/**
 * partitionFillV2.lensCrushRelease.diag.test.ts — RULING 8s STAGE-B RED-then-GREEN gate
 * (THROWAWAY). Release the B4-u5 lens crush: a corr-0 lens fills to 0.45 unless a REAL DRAWN
 * correlation crosses it; the band DETOURS around the lens (owner ruling 8s, design
 * partition-engine-v2.md §8; session-54 STAGE B).
 *
 * OWNER LANGUAGE. "A lens fills to 0.45 distance. We only shorten a lens when it collides with a
 * real drawn correlation line. A matched-pair band's own base contour is drawn line art, but it is
 * NOT a reason to CRUSH the lens — the band DETOURS AROUND the lens (a lens is a detour in the
 * enclosing band's contour, 8g), and fill-between-the-lines makes overlap impossible."
 *
 * THE DEFECT (pre-STAGE-B, measured from ``scripts/diag_cs1_flip_walkthrough.json``): at CS1 gap3
 * (B4 x=101.562 → S13 x=191.944, width 90.38 m) B4's raw u5-SILT [0.608..0.232] lens is CRUSHED to
 * apex x≈102.316 (frac ≈ 0.008, a 0.7 m stub). The crusher is ``bandc37=(101.562,0.608)→
 * (191.944,−1.79)`` — the top-tied ZAND matched-pair band's OWN BASE contour, which S50's
 * ``gapBandContourBrackets`` treated as a lens-reach collision bracket. Ruling 8s: band contours
 * LEAVE the lens collision set; the band-base contour DETOURS around the corr-0 lens diamond
 * instead.
 *
 * ORACLE-EQUIVALENT ASSERTIONS (in owner language):
 *   (1) CS1 gap3 B4-u5-SILT [0.608..0.232]: its lens closing flanks reach the 0.45 apex at
 *       x ≈ 142.2 (frac 0.45 of the 90.38 m gap), NOT the crushed x ≈ 102.3.
 *   (2) CS2 gap13 KLEI interbed [−3.845..−4.42]: present as a lens at its (measured) 8b-rev reach
 *       — un-crushed (its own crusher, the ZAND band-base ``bandc139``, no longer caps it).
 *   (3) different-litho overlap pairs across ALL 14 sections == 0 (the band-contour DETOUR holds
 *       the true partition: releasing the crush does NOT reopen the CS2-g13 KLEI×ZAND overlap).
 *
 * Gate: SHAPE_AUDIT=1. Deterministic. Reads ``scripts/diag_allsections_input.json``. THROWAWAY —
 * may be deleted after STAGE B lands.
 * Run (desktop/):
 *   SHAPE_AUDIT=1 npx vitest run src/renderer/src/utils/partitionFillV2.lensCrushRelease.diag.test.ts
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
import { buildSectionInput } from './partitionFillV2/sectionGeom'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'
import { type InputCurve, type Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** Tolerance (metres) for an apex-x reach assertion — well above the 1 mm snap grid. */
const REACH_TOL_M = 0.5
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
interface RawSection {
  sectionId: string
  name: string
  columns: RawCol[]
  edges: { a: string; b: string; aSide?: string; bSide?: string }[]
  alongM: number[]
}

function segEndpoints(c: InputCurve): { a: Point; b: Point } {
  const pts = c.points
  return { a: pts[0], b: pts[pts.length - 1] }
}

/** A phase-1 lens closing (``term*`` / ``lens*`` / ``subtdlens*``) — NOT an onlap flank. */
function isLensClosing(id: string): boolean {
  return (
    (id.startsWith('term') || id.startsWith('lens') || id.startsWith('subtdlens')) &&
    !id.startsWith('oflank')
  )
}

/** Build the engine inputs for one raw section (the same ``prepare`` filter the normaliser uses). */
function sectionInputs(sec: RawSection): {
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
  keep: { c: RawCol; i: number }[]
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
  return { columns, edges, alongM, keep }
}

/**
 * The apex of the SPECIFIC corr-0 lens whose TOP contact is ``topElev`` and BASE contact is
 * ``baseElev`` on ``colX``. A lens is emitted as TWO closing flanks that meet at a shared apex
 * vertex (top corner → apex, apex → base corner) at the lens mid-elevation. This pairs the two
 * flanks by their shared apex — so it measures the RIGHT lens even when several lens flanks share
 * a column root elevation (e.g. the ZAND lens above B4-u5-SILT also roots a flank at 0.608, so a
 * "any far endpoint rooted at 0.608" measure picks the wrong lens — the STAGE-B stale-premise
 * trap).
 */
function lensApexXOf(
  curves: InputCurve[],
  colX: number,
  topElev: number,
  baseElev: number,
): { apexX: number; apexElev: number; ids: string[] } | null {
  const near = (p: Point, e: number): boolean =>
    Math.abs(p.x - colX) <= ROOT_TOL_M && Math.abs(p.y - e) <= ROOT_TOL_M
  const flanks = curves.filter((c) => isLensClosing(c.id))
  // The TOP flank has one endpoint at (colX, topElev); the BASE flank at (colX, baseElev). Their
  // OTHER endpoint is the shared apex (equal within snap tolerance for a well-formed lens).
  const topFlanks = flanks.filter((c) => {
    const { a, b } = segEndpoints(c)
    return near(a, topElev) || near(b, topElev)
  })
  const baseFlanks = flanks.filter((c) => {
    const { a, b } = segEndpoints(c)
    return near(a, baseElev) || near(b, baseElev)
  })
  const farOf = (c: InputCurve, rootElev: number): Point => {
    const { a, b } = segEndpoints(c)
    return near(a, rootElev) ? b : a
  }
  for (const tf of topFlanks) {
    const apexT = farOf(tf, topElev)
    for (const bf of baseFlanks) {
      if (bf.id === tf.id) continue
      const apexB = farOf(bf, baseElev)
      if (Math.abs(apexT.x - apexB.x) <= ROOT_TOL_M && Math.abs(apexT.y - apexB.y) <= ROOT_TOL_M) {
        return { apexX: apexT.x, apexElev: apexT.y, ids: [tf.id, bf.id] }
      }
    }
  }
  return null
}

/** Elevation intervals covered by a simple polygon at vertical line x=f (fraction space). */
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

describe('v2 ruling 8s STAGE B — release the B4-u5 lens crush (RED-then-GREEN)', () => {
  if (process.env.SHAPE_AUDIT !== '1') {
    it.skip('dormant (set SHAPE_AUDIT=1)', () => {})
    return
  }

  const raw = existsSync(INPUT)
    ? (JSON.parse(readFileSync(INPUT, 'utf8')) as {
        sections: RawSection[]
        formationNames: Record<string, string>
      })
    : null

  it('CS1 gap3: B4-u5-SILT [0.608..0.232] lens reaches the 0.45 apex (x≈142.2), NOT crushed to x≈102.3', () => {
    expect(existsSync(INPUT)).toBe(true)
    if (!raw) return
    const cs1 = raw.sections.find((s) => s.name === 'Cross-section 1')
    expect(cs1, 'Cross-section 1 present').toBeDefined()
    if (!cs1) return
    const { columns, edges, alongM } = sectionInputs(cs1)

    // B4 at x≈101.562, S13 at x≈191.944 — gap3 (B4 is the gap's LEFT column, looks RIGHT).
    const b4X = 101.562
    const s13X = 191.944
    const gapWidth = s13X - b4X
    const expectedApexX = b4X + 0.45 * gapWidth // ≈ 142.23

    const prev = setTwoSidedTerminations(true)
    let curves: InputCurve[]
    try {
      const section = buildSectionInput(columns, edges, undefined, alongM)
      curves = emitCurves(section).curves
    } finally {
      setTwoSidedTerminations(prev)
    }

    // The B4-u5-SILT lens [0.608..0.232] — paired by its OWN top+base flanks meeting at the apex
    // (mid ≈ 0.420), NOT any far endpoint rooted at 0.608 (the ZAND lens above also roots there).
    const reached = lensApexXOf(curves, b4X, 0.608, 0.232)
    expect(reached, 'the B4-u5-SILT lens [0.608..0.232] must emit a paired-flank diamond').not.toBeNull()
    if (!reached) return
    // eslint-disable-next-line no-console
    console.log(
      `B4-u5-SILT flanks=${reached.ids.join(',')} apexX=${reached.apexX.toFixed(3)} apexElev=${reached.apexElev.toFixed(3)} expected≈${expectedApexX.toFixed(3)} (crushed baseline≈102.316)`,
    )
    expect(
      Math.abs(reached.apexX - expectedApexX),
      `B4-u5-SILT lens must reach the 0.45 apex x≈${expectedApexX.toFixed(2)} (was crushed to x≈102.316 by bandc37). Got apexX=${reached.apexX.toFixed(3)}`,
    ).toBeLessThanOrEqual(REACH_TOL_M)

    // FATE OF bandc37 (the owner's "weird diagonal"): dump every ``bandc`` polyline whose left
    // endpoint is at B4 (x≈101.562) — after STAGE B the band-base contour that started at the SILT
    // lens top corner should now DETOUR around the lens apex (a crossIn→apex→crossOut kink).
    const bandcAtB4 = curves.filter((c) => {
      if (!c.id.startsWith('bandc')) return false
      const { a, b } = segEndpoints(c)
      return Math.abs(a.x - b4X) <= 0.01 || Math.abs(b.x - b4X) <= 0.01
    })
    // eslint-disable-next-line no-console
    console.log(
      'CS1 gap3 bandc @B4:',
      JSON.stringify(
        bandcAtB4.map((c) => `${c.id}=[${c.points.map((p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(' ')}]`),
        null,
        1,
      ),
    )
  })

  it('CS2 gap13: KLEI interbed [−3.845..−4.42] lens is present, un-crushed at its 8b-rev reach', () => {
    expect(existsSync(INPUT)).toBe(true)
    if (!raw) return
    const cs2 = raw.sections.find((s) => s.name === 'Cross-section 2')
    expect(cs2, 'Cross-section 2 present').toBeDefined()
    if (!cs2) return
    const { columns, edges, alongM } = sectionInputs(cs2)

    const prev = setTwoSidedTerminations(true)
    let curves: InputCurve[]
    try {
      const section = buildSectionInput(columns, edges, undefined, alongM)
      curves = emitCurves(section).curves
    } finally {
      setTwoSidedTerminations(prev)
    }

    // The KLEI interbed lens [−3.845..−4.42] (col13, gap13 LEFT column). Paired by its own top+base
    // flanks meeting at the apex (mid ≈ −4.13).
    const col13X = alongM[13]
    expect(col13X, 'col13 x present in CS2 alongM').toBeGreaterThan(0)
    const reached = lensApexXOf(curves, col13X, -3.845, -4.42)
    // eslint-disable-next-line no-console
    console.log(
      `CS2-g13 KLEI interbed col13X=${col13X?.toFixed(3)} flanks=${reached?.ids.join(',') ?? '(none)'} apexX=${reached?.apexX.toFixed(3) ?? '(none)'} apexElev=${reached?.apexElev.toFixed(3) ?? '(none)'}`,
    )
    expect(
      reached,
      'the KLEI interbed lens [−3.845..−4.42] must emit a paired-flank diamond (present, not absorbed)',
    ).not.toBeNull()

    // The detoured ZAND band-base contour (``bandc139`` equivalent): the bandc curve at col13
    // starting near −3.845 that now rides around the KLEI lens apex.
    const bandcAtCol13 = curves.filter((c) => {
      if (!c.id.startsWith('bandc')) return false
      const { a } = segEndpoints(c)
      return Math.abs(a.x - col13X) <= 0.01 && Math.abs(a.y - -3.845) <= 0.05
    })
    // eslint-disable-next-line no-console
    console.log(
      'CS2 gap13 ZAND band-base bandc @col13:',
      JSON.stringify(
        bandcAtCol13.map((c) => `${c.id}=[${c.points.map((p) => `(${p.x.toFixed(3)},${p.y.toFixed(3)})`).join(' ')}]`),
        null,
        1,
      ),
    )
  })

  it('all 14 sections: different-litho overlap pairs == 0 (the band-contour detour holds the partition)', () => {
    expect(existsSync(INPUT)).toBe(true)
    if (!raw) return
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const prev = setTwoSidedTerminations(true)
    const found: string[] = []
    try {
      for (const sec of raw.sections) {
        const { columns, edges, alongM } = sectionInputs(sec)
        const regions = computeSectionFillV2(columns, edges, undefined, alongM)
        const byGap = new Map<number, typeof regions>()
        for (const r of regions) {
          if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
          byGap.get(r.gapIndex)!.push(r)
        }
        for (const [gi, regs] of byGap) {
          const worst = new Map<string, number>()
          for (let f = 0.02; f < 0.985; f += 0.02) {
            for (let a = 0; a < regs.length; a++) {
              for (let b = a + 1; b < regs.length; b++) {
                if (regs[a].formationId === regs[b].formationId) continue
                const ia = coveredIntervals(regs[a].polygon, f)
                const ib = coveredIntervals(regs[b].polygon, f)
                for (const [a1, a2] of ia)
                  for (const [b1, b2] of ib) {
                    const v = Math.min(a2, b2) - Math.max(a1, b1)
                    if (v > 0.001) {
                      const key = `${sec.name} gap${gi} ${fname(regs[a].formationId)}(${regs[a].kind})×${fname(regs[b].formationId)}(${regs[b].kind})`
                      worst.set(key, Math.max(worst.get(key) ?? 0, v))
                    }
                  }
              }
            }
          }
          for (const [k, v] of worst) found.push(`${k} ${(v * 100).toFixed(1)}cm`)
        }
      }
    } finally {
      setTwoSidedTerminations(prev)
    }
    // eslint-disable-next-line no-console
    if (found.length) console.log('DIFF-LITHO OVERLAPS:', JSON.stringify(found, null, 1))
    expect(
      found.length,
      `different-litho overlaps must be 0 (the band-contour detour must hold the partition). Found: ${found.join('; ') || '(none)'}`,
    ).toBe(0)
  })
})

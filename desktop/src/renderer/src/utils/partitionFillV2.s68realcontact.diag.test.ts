/**
 * THROWAWAY DIAG (S68) — can the APP build a `contact:U|L@g` override from a REAL
 * CS1 matched two-band contact, and does the engine CONSUME it (both bands' shared
 * edge moves together, 0 holes / 0 overlaps)?
 *
 * This is S67's flagged WALL: the render bodyId ≠ engine UnitGeom bodyId, and no
 * clean matched two-band contact was found on the synthetic fixtures. Here we run
 * the REAL CS1 columns through the v2 engine, find every matched two-band contact
 * (a tie whose elevation is the BASE of an upper band body and the TOP of a lower
 * band body, both spanning the gap), and apply the exact `contact:U|L@g` key the
 * app would build. If the engine bends both, the wall is cleared.
 *
 * Run: S68_REAL=1 npx vitest run src/renderer/src/utils/partitionFillV2.s68realcontact.diag.test.ts --disableConsoleIntercept
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionPoint,
} from './sectionPartition'
import { contactApexOverrideKey } from './partitionFillV2/contactOverride'
import { computeSectionFillV2 } from './partitionFillV2/computeSectionFillV2'

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
    if (out.length && a <= out[out.length - 1][1] + eps) {
      out[out.length - 1][1] = Math.max(out[out.length - 1][1], b)
    } else out.push([a, b])
  }
  return out
}

function holesAndOverlaps(regions: ReturnType<typeof computeSectionFillV2>): {
  holes: number
  overlaps: number
} {
  const byGap = new Map<number, typeof regions>()
  for (const r of regions) {
    if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
    byGap.get(r.gapIndex)!.push(r)
  }
  let holes = 0
  let overlaps = 0
  for (const [, regs] of byGap) {
    for (let f = 0.02; f < 0.985; f += 0.02) {
      const all: [number, number][] = []
      for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
      const merged = mergeIntervals(all, 0.0005)
      for (let k = 0; k + 1 < merged.length; k++) {
        const hole = merged[k + 1][0] - merged[k][1]
        if (hole > 0.0005 && hole < 0.5) holes++
      }
      for (let a = 0; a < regs.length; a++) {
        for (let b = a + 1; b < regs.length; b++) {
          if (regs[a].formationId === regs[b].formationId) continue
          const ia = coveredIntervals(regs[a].polygon, f)
          const ib = coveredIntervals(regs[b].polygon, f)
          for (const [a1, a2] of ia)
            for (const [b1, b2] of ib) {
              const v = Math.min(a2, b2) - Math.max(a1, b1)
              if (v > 0.05) overlaps++
            }
        }
      }
    }
  }
  return { holes, overlaps }
}

describe('S68 — real CS1 matched two-band contact override consumption', () => {
  if (process.env.S68_REAL !== '1') {
    it.skip('dormant (set S68_REAL=1)', () => {})
    return
  }
  it('finds a real matched two-band contact + the engine bends both bands', () => {
    expect(existsSync(INPUT)).toBe(true)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const cs1 = raw.sections.find((s) => s.name === 'Cross-section 1')
    expect(cs1).toBeTruthy()
    const sec = cs1!

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

    // Baseline regions (no override).
    const base = computeSectionFillV2(columns, edges, undefined, alongM)
    const base0 = holesAndOverlaps(base)
    console.info(`\n=== CS1: ${base.length} regions, holes=${base0.holes} overlaps=${base0.overlaps}`)

    // ---- Find matched two-band CONTACTS from the RENDERED regions (the app's view). ----
    // A matched two-band contact in a gap: an upper full-width band region (kind quad,
    // spanning fraction 0..1) whose BASE elevation == a lower full-width band region's
    // TOP elevation. Both carry bodyIds. The app keys contactApexOverrideKey(upper.bodyId,
    // lower.bodyId, gap) — exactly what a click on that shared boundary would build.
    const byGap = new Map<number, typeof base>()
    for (const r of base) {
      if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
      byGap.get(r.gapIndex)!.push(r)
    }
    const spanY = (poly: readonly PartitionPoint[]): { top: number; base: number; f0: number; f1: number } => {
      let top = -Infinity
      let bot = Infinity
      let f0 = Infinity
      let f1 = -Infinity
      for (const p of poly) {
        if (p.elevation > top) top = p.elevation
        if (p.elevation < bot) bot = p.elevation
        if (p.fraction < f0) f0 = p.fraction
        if (p.fraction > f1) f1 = p.fraction
      }
      return { top, base: bot, f0, f1 }
    }

    interface Candidate {
      gap: number
      upperBodyId: string
      lowerBodyId: string
      contactElev: number
      upperTop: number
      lowerBase: number
    }
    const candidates: Candidate[] = []
    for (const [gi, regs] of byGap) {
      const bands = regs
        .filter((r) => r.kind === 'quad' && r.bodyId)
        .map((r) => ({ r, ...spanY(r.polygon) }))
        // full-width (spans the gap)
        .filter((b) => b.f0 <= 0.02 && b.f1 >= 0.98)
        .sort((a, b) => b.top - a.top) // shallow → deep
      for (let a = 0; a < bands.length; a++) {
        for (let b = a + 1; b < bands.length; b++) {
          const upper = bands[a]
          const lower = bands[b]
          if (Math.abs(upper.base - lower.top) <= 1e-3) {
            candidates.push({
              gap: gi,
              upperBodyId: upper.r.bodyId!,
              lowerBodyId: lower.r.bodyId!,
              contactElev: upper.base,
              upperTop: upper.top,
              lowerBase: lower.base,
            })
          }
        }
      }
    }

    console.info(`CS1 matched two-band contacts found: ${candidates.length}`)
    for (const c of candidates.slice(0, 10)) {
      console.info(
        `  gap${c.gap}: upper=${c.upperBodyId.slice(0, 8)} lower=${c.lowerBodyId.slice(0, 8)} contact=${c.contactElev.toFixed(2)} envelope[${c.lowerBase.toFixed(2)},${c.upperTop.toFixed(2)}]`,
      )
    }
    expect(candidates.length).toBeGreaterThan(0)

    // ---- Apply the override on the FIRST candidate + confirm the engine bends both. ----
    let consumedAny = false
    for (const c of candidates.slice(0, 12)) {
      // Bend the shared contact DOWN toward the lower band's base (midway).
      const targetElev = (c.contactElev + c.lowerBase) / 2
      const key = contactApexOverrideKey(c.upperBodyId, c.lowerBodyId, c.gap)
      const overrides = new Map<string, LensApexOverride>([
        [key, { fraction: 0.5, elevation: targetElev, upper: [], lower: [] } as unknown as LensApexOverride],
      ])
      const bent = computeSectionFillV2(columns, edges, overrides, alongM)
      const stats = holesAndOverlaps(bent)
      // Did the shared boundary move? Compare the rendered upper base / lower top at f=0.5.
      const bentGap = bent.filter((r) => r.gapIndex === c.gap)
      const upperR = bentGap.find((r) => r.bodyId === c.upperBodyId && r.kind === 'quad')
      const lowerR = bentGap.find((r) => r.bodyId === c.lowerBodyId && r.kind === 'quad')
      const midElevAt = (poly: readonly PartitionPoint[], pickBase: boolean): number => {
        const iv = coveredIntervals(poly, 0.5)
        if (iv.length === 0) return NaN
        // base = lowest y of the covered span; top = highest
        const flat = iv.flat()
        return pickBase ? Math.min(...flat) : Math.max(...flat)
      }
      const upperBaseMid = upperR ? midElevAt(upperR.polygon, true) : NaN
      const lowerTopMid = lowerR ? midElevAt(lowerR.polygon, false) : NaN
      const moved =
        Number.isFinite(upperBaseMid) &&
        Math.abs(upperBaseMid - c.contactElev) > 0.05
      const bothCoincident =
        Number.isFinite(upperBaseMid) &&
        Number.isFinite(lowerTopMid) &&
        Math.abs(upperBaseMid - lowerTopMid) < 0.05
      console.info(
        `  APPLY gap${c.gap} contact=${c.contactElev.toFixed(2)}→${targetElev.toFixed(2)}: ` +
          `upperBaseMid=${upperBaseMid.toFixed(3)} lowerTopMid=${lowerTopMid.toFixed(3)} ` +
          `moved=${moved} coincident=${bothCoincident} holes=${stats.holes} overlaps=${stats.overlaps}`,
      )
      if (moved && bothCoincident && stats.holes === 0 && stats.overlaps === 0) {
        consumedAny = true
        // The load-bearing assertion: the real contact bent, both bands followed, 0/0.
        expect(bothCoincident).toBe(true)
        expect(stats.holes).toBe(0)
        expect(stats.overlaps).toBe(0)
        break
      }
    }
    console.info(`CONSUMED a real CS1 contact: ${consumedAny}`)
    // The WALL check: if NO real contact is consumable, this fails LOUD (report the wall).
    expect(consumedAny).toBe(true)
  })
})

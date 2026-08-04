/**
 * THROWAWAY DIAGNOSTIC — geotech refinement defect taxonomy.
 *
 * Attributes every square metre of the refinement's three defect families
 * (interior voids, self-overlaps, coverage loss) to a MECHANISM, by re-running
 * ``refineLithoPartition`` ONE LITHO REGION AT A TIME. The engine's per-region
 * loop carries no cross-region state, so a single-region run reproduces exactly
 * the polygons that region contributes to the full run (asserted below), which
 * gives every refined polygon a parent region — an attribution the shipped
 * ``RefinedPolygon`` type does not carry.
 *
 * Dormant unless GEOTECH_TAX=1.
 *   cd desktop
 *   GEOTECH_TAX=1 npx vitest run src/renderer/src/utils/geotechDefectTaxonomy.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
  type RefinedPolygon,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_defect_taxonomy.json')

interface RawUnit {
  layerId: string
  topDepthM: number
  baseDepthM: number
  formationId: string
  bodyId: string | null
}
interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: RawUnit[]
}
interface RawEdge {
  a: string
  b: string
  aSide?: string
  bSide?: string
}
interface RawGeotechLayer {
  id: string
  investigationId: string
  depth_top_m: number
  depth_base_m: number
  formation_id: string
  body_id: string | null
}
interface RawSection {
  sectionId: string
  name: string
  kind: string
  columns: RawColumn[]
  edges: RawEdge[]
  alongM: number[]
  geotech: { columns: RawColumn[]; edges: RawEdge[]; alongM: number[] }
  refinement: { geotechLayers: RawGeotechLayer[] }
  anchor: string
}
interface RawFile {
  meta: Record<string, unknown>
  formationNames: Record<string, string>
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  bodyBoundaries: { litho: Record<string, BodyBoundaryResponse> }
  sections: RawSection[]
}

function assembleColumns(
  cols: readonly RawColumn[],
  alongM: readonly number[],
): { columns: PartitionColumn[]; alongM: number[] } {
  const paired = cols
    .map((c, i) => ({ c, a: alongM[i] }))
    .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    .sort((p, q) => p.a - q.a)
  return {
    columns: paired.map(({ c }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM as number,
      units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
    })),
    alongM: paired.map(({ a }) => a),
  }
}
function toEdges(raw: readonly RawEdge[]): CorrelationEdge[] {
  return raw.map((e) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
}

// --------------------------------------------------------------------------
// Interval geometry in (x metres, elevation)
// --------------------------------------------------------------------------

type Iv = [number, number] // [lo, hi] ascending elevation

function ringIntervals(pts: readonly { x: number; e: number }[], x: number): Iv[] {
  const ys: number[] = []
  const n = pts.length
  for (let i = 0; i < n; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % n]
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const t = (x - a.x) / (b.x - a.x)
      ys.push(a.e + t * (b.e - a.e))
    }
  }
  ys.sort((p, q) => p - q)
  const out: Iv[] = []
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-9) out.push([ys[i], ys[i + 1]])
  return out
}

function unionIv(list: readonly Iv[]): Iv[] {
  if (list.length === 0) return []
  const s = [...list].sort((a, b) => a[0] - b[0])
  const out: Iv[] = [[s[0][0], s[0][1]]]
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1]
    if (s[i][0] <= last[1] + 1e-9) last[1] = Math.max(last[1], s[i][1])
    else out.push([s[i][0], s[i][1]])
  }
  return out
}
function subtractIv(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  let cur = a.map((iv) => [iv[0], iv[1]] as Iv)
  for (const cut of b) {
    const next: Iv[] = []
    for (const iv of cur) {
      if (cut[1] <= iv[0] + 1e-9 || cut[0] >= iv[1] - 1e-9) {
        next.push(iv)
        continue
      }
      if (cut[0] > iv[0] + 1e-9) next.push([iv[0], cut[0]])
      if (cut[1] < iv[1] - 1e-9) next.push([cut[1], iv[1]])
    }
    cur = next
  }
  return cur.filter((iv) => iv[1] - iv[0] > 1e-9)
}
function intersectIv(a: readonly Iv[], b: readonly Iv[]): Iv[] {
  const out: Iv[] = []
  for (const p of a)
    for (const q of b) {
      const lo = Math.max(p[0], q[0])
      const hi = Math.min(p[1], q[1])
      if (hi - lo > 1e-9) out.push([lo, hi])
    }
  return unionIv(out)
}
const lenIv = (l: readonly Iv[]): number => l.reduce((s, iv) => s + (iv[1] - iv[0]), 0)

interface Poly {
  pts: { x: number; e: number }[]
  x0: number
  x1: number
}
function toPoly(points: readonly { fraction: number; elevation: number }[], left: number, right: number): Poly {
  const pts = points.map((p) => ({ x: left + p.fraction * (right - left), e: p.elevation }))
  return { pts, x0: Math.min(...pts.map((p) => p.x)), x1: Math.max(...pts.map((p) => p.x)) }
}

// --------------------------------------------------------------------------

const OVERLAY_TAGS = new Set(['hlens', 'enclens'])

interface VoidRun {
  x: number
  lo: number
  hi: number
  thickness: number
  xRel: number
  touchesTop: boolean
  touchesBase: boolean
  concaveHere: boolean
}

interface RegionReport {
  section: string
  gapIndex: number
  kind: SectionRegion['kind']
  formationId: string
  areaM2: number
  widthM: number
  nPolys: number
  tags: Record<string, number>
  /** area of the region NOT covered by ANY refined polygon of that region */
  lossM2: number
  /** loss ignoring overlays (the tiling-only loss the 3-D build would see) */
  lossTilingM2: number
  /** refined area falling OUTSIDE the parent region polygon (poke-out) */
  spillM2: number
  voidRuns: VoidRun[]
  /** loss split by descriptor bucket */
  bucket: Record<string, number>
  /** self-overlap area by tag pair, among this region's own polygons */
  selfOverlap: Record<string, number>
  selfOverlapPairs: number
}

const SUBSAMPLES = 220

describe('geotech refinement — defect taxonomy', () => {
  if (process.env.GEOTECH_TAX !== '1') {
    it.skip('dormant (set GEOTECH_TAX=1)', () => {})
    return
  }

  it('categorises every defect m2 by mechanism', () => {
    if (!existsSync(INPUT)) throw new Error(`${INPUT} not found — run dump_geotech_axis_inputs.py`)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const engineV2 = isPartitionEngineV2Active()
    console.log(`ENGINE ${engineV2 ? 'v2' : 'v1'}`)

    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [
        k,
        { nadClass: v.nadClass, soilCode: v.soilCode },
      ]),
    )
    const lithoSoil = new Map<string, string | null>(
      Object.entries(raw.refinementBundle.lithoSoilByFormationId),
    )
    const nameOf = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    const classOf = (id: string): string => {
      const m = nadMeta.get(id)
      if (m) return `${m.soilCode ?? '?'}/n${m.nadClass ?? '?'}`
      return `LITHO:${lithoSoil.get(id) ?? '?'}`
    }

    const regionReports: RegionReport[] = []
    // cross-region overlaps: refined polys of DIFFERENT parent regions in the same gap
    const crossOverlap = new Map<string, number>()
    let crossOverlapPairs = 0
    const crossWorst: { key: string; m2: number; detail: unknown }[] = []
    const lossWorst: Record<string, { m2: number; detail: unknown }[]> = {}
    const selfWorst: Record<string, { m2: number; detail: unknown }[]> = {}

    for (const sec of raw.sections) {
      const L = assembleColumns(sec.columns, sec.alongM)
      if (L.columns.length < 2) continue
      const lithoEdges = toEdges(sec.edges)
      const overrides = deriveSectionApexOverrides(
        L.columns,
        lithoEdges,
        L.alongM,
        new Map<string, BodyBoundaryResponse>(),
        engineV2,
      )
      const regions = computeSectionFillActive(L.columns, lithoEdges, overrides, L.alongM)
      if (regions.length === 0) continue

      const geoByInv = new Map<string, GeotechColumn['units'][number][]>()
      for (const l of sec.refinement.geotechLayers) {
        const arr = geoByInv.get(l.investigationId) ?? []
        arr.push({
          layerId: l.id,
          topDepthM: l.depth_top_m,
          baseDepthM: l.depth_base_m,
          formationId: l.formation_id,
          bodyId: l.body_id ?? null,
        })
        geoByInv.set(l.investigationId, arr)
      }
      const columnOrder = L.columns.map((c) => c.investigationId)
      const geoColByInv = new Map<string, GeotechColumn>()
      for (const c of L.columns)
        geoColByInv.set(c.investigationId, {
          investigationId: c.investigationId,
          surfaceElevM: c.surfaceElevM,
          units: geoByInv.get(c.investigationId) ?? [],
        })

      const opts = { alongM: L.alongM }
      const full = refineLithoPartition(regions, columnOrder, geoColByInv, nadMeta, lithoSoil, opts)

      // per-region re-run (attribution)
      const perRegion: RefinedPolygon[][] = regions.map((r) =>
        refineLithoPartition([r], columnOrder, geoColByInv, nadMeta, lithoSoil, opts),
      )
      const flatCount = perRegion.reduce((a, b) => a + b.length, 0)
      if (flatCount !== full.length)
        console.log(`  !! ${sec.name}: per-region ${flatCount} != full ${full.length}`)

      // ---- per-region analysis
      const gapPolys: { gi: number; ri: number; p: Poly; tag: string; fill: string }[] = []
      for (let ri = 0; ri < regions.length; ri++) {
        const r = regions[ri]
        const left = L.alongM[r.gapIndex]
        const right = L.alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const regPoly = toPoly(r.polygon, left, right)
        const outs = perRegion[ri]
        const oPolys = outs.map((p) => ({ p: toPoly(p.points, left, right), tag: p.tag, fill: p.formationId }))
        for (const o of oPolys) gapPolys.push({ gi: r.gapIndex, ri, p: o.p, tag: o.tag, fill: o.fill })

        const x0 = regPoly.x0
        const x1 = regPoly.x1
        const w = x1 - x0
        if (w <= 1e-9) continue
        const dx = w / SUBSAMPLES
        let areaM2 = 0
        let lossM2 = 0
        let lossTiling = 0
        let spillM2 = 0
        const voidRuns: VoidRun[] = []
        const bucket: Record<string, number> = {}
        const selfOverlap: Record<string, number> = {}
        let selfPairs = 0
        const seenPairs = new Set<string>()

        for (let k = 0; k < SUBSAMPLES; k++) {
          const x = x0 + (k + 0.5) * dx
          const reg = ringIntervals(regPoly.pts, x)
          if (reg.length === 0) continue
          const regU = unionIv(reg)
          areaM2 += lenIv(regU) * dx
          const covAll: Iv[] = []
          const covTiling: Iv[] = []
          const perPoly: { tag: string; fill: string; iv: Iv[]; idx: number }[] = []
          for (let pi = 0; pi < oPolys.length; pi++) {
            const o = oPolys[pi]
            if (x < o.p.x0 - 1e-9 || x > o.p.x1 + 1e-9) continue
            const iv = ringIntervals(o.p.pts, x)
            if (iv.length === 0) continue
            perPoly.push({ tag: o.tag, fill: o.fill, iv, idx: pi })
            covAll.push(...iv)
            if (!OVERLAY_TAGS.has(o.tag)) covTiling.push(...iv)
          }
          const covU = unionIv(covAll)
          spillM2 += lenIv(subtractIv(covU, regU)) * dx
          const gapsAll = subtractIv(regU, covU)
          lossM2 += lenIv(gapsAll) * dx
          lossTiling += lenIv(subtractIv(regU, unionIv(covTiling))) * dx
          const concave = regU.length > 1
          const regTop = regU[regU.length - 1][1]
          const regBase = regU[0][0]
          for (const g of gapsAll) {
            const th = g[1] - g[0]
            const run: VoidRun = {
              x,
              lo: g[0],
              hi: g[1],
              thickness: th,
              xRel: (x - x0) / w,
              touchesTop: Math.abs(g[1] - regTop) < 1e-6,
              touchesBase: Math.abs(g[0] - regBase) < 1e-6,
              concaveHere: concave,
            }
            voidRuns.push(run)
            const a = th * dx
            let b: string
            if (th < 0.02) b = 'A-hairline<2cm'
            else if (th < 0.10) b = 'B-thin<10cm'
            else if (run.touchesTop && run.touchesBase) b = 'C-full-thickness'
            else if (run.touchesTop) b = 'D-top-edge'
            else if (run.touchesBase) b = 'E-base-edge'
            else b = 'F-interior'
            bucket[b] = (bucket[b] ?? 0) + a
            if (run.xRel < 0.02 || run.xRel > 0.98) bucket['X-region-x-extreme'] = (bucket['X-region-x-extreme'] ?? 0) + a
          }
          // self-overlaps
          for (let i = 0; i < perPoly.length; i++)
            for (let j = i + 1; j < perPoly.length; j++) {
              const A = perPoly[i]
              const B = perPoly[j]
              const ov = lenIv(intersectIv(A.iv, B.iv))
              if (ov <= 1e-9) continue
              const key = `${A.tag}x${B.tag}${A.fill === B.fill ? ' (same fill)' : ' (DIFF fill)'}`
              selfOverlap[key] = (selfOverlap[key] ?? 0) + ov * dx
              const pk = `${A.idx}-${B.idx}`
              if (!seenPairs.has(pk)) {
                seenPairs.add(pk)
                selfPairs++
              }
            }
        }
        const rep: RegionReport = {
          section: sec.name,
          gapIndex: r.gapIndex,
          kind: r.kind,
          formationId: r.formationId,
          areaM2,
          widthM: w,
          nPolys: outs.length,
          tags: outs.reduce<Record<string, number>>((acc, p) => {
            acc[p.tag] = (acc[p.tag] ?? 0) + 1
            return acc
          }, {}),
          lossM2,
          lossTilingM2: lossTiling,
          spillM2,
          voidRuns: voidRuns.slice(0, 4),
          bucket,
          selfOverlap,
          selfOverlapPairs: selfPairs,
        }
        regionReports.push(rep)

        // record worst instances per bucket
        for (const [b, a] of Object.entries(bucket)) {
          const arr = (lossWorst[b] ??= [])
          arr.push({
            m2: a,
            detail: {
              section: sec.name,
              gapIndex: r.gapIndex,
              kind: r.kind,
              lithoFormation: nameOf(r.formationId),
              regionAreaM2: Number(areaM2.toFixed(2)),
              lossM2: Number(lossM2.toFixed(2)),
              tags: rep.tags,
              regionPolygonFraction: r.polygon,
              alongLeft: left,
              alongRight: right,
              sampleVoidRuns: voidRuns.slice(0, 3),
            },
          })
        }
        for (const [b, a] of Object.entries(selfOverlap)) {
          const arr = (selfWorst[b] ??= [])
          arr.push({
            m2: a,
            detail: {
              section: sec.name,
              gapIndex: r.gapIndex,
              kind: r.kind,
              lithoFormation: nameOf(r.formationId),
              tags: rep.tags,
              regionPolygonFraction: r.polygon,
              alongLeft: left,
              alongRight: right,
            },
          })
        }
      }

      // ---- cross-region overlaps within a gap
      const byGap = new Map<number, typeof gapPolys>()
      for (const g of gapPolys) {
        const a = byGap.get(g.gi) ?? []
        a.push(g)
        byGap.set(g.gi, a)
      }
      for (const [gi, list] of byGap) {
        for (let i = 0; i < list.length; i++)
          for (let j = i + 1; j < list.length; j++) {
            const A = list[i]
            const B = list[j]
            if (A.ri === B.ri) continue
            const lo = Math.max(A.p.x0, B.p.x0)
            const hi = Math.min(A.p.x1, B.p.x1)
            if (hi - lo <= 1e-6) continue
            const nn = 24
            const ddx = (hi - lo) / nn
            let ov = 0
            for (let k = 0; k < nn; k++) {
              const x = lo + (k + 0.5) * ddx
              ov += lenIv(intersectIv(ringIntervals(A.p.pts, x), ringIntervals(B.p.pts, x))) * ddx
            }
            if (ov <= 0.02) continue
            const kindA = regions[A.ri].kind
            const kindB = regions[B.ri].kind
            const key = `${A.tag}@${kindA} x ${B.tag}@${kindB}${A.fill === B.fill ? ' (same fill)' : ' (DIFF fill)'}`
            crossOverlap.set(key, (crossOverlap.get(key) ?? 0) + ov)
            crossOverlapPairs++
            crossWorst.push({
              key,
              m2: ov,
              detail: {
                section: sec.name,
                gapIndex: gi,
                a: { tag: A.tag, kind: kindA, litho: nameOf(regions[A.ri].formationId), fillClass: classOf(A.fill) },
                b: { tag: B.tag, kind: kindB, litho: nameOf(regions[B.ri].formationId), fillClass: classOf(B.fill) },
                aRegionPolygon: regions[A.ri].polygon,
                bRegionPolygon: regions[B.ri].polygon,
                aPoly: A.p.pts.map((p) => [Number(p.x.toFixed(3)), Number(p.e.toFixed(3))]),
                bPoly: B.p.pts.map((p) => [Number(p.x.toFixed(3)), Number(p.e.toFixed(3))]),
              },
            })
          }
      }
      console.log(`  ${sec.name}: ${regions.length} regions, ${full.length} refined polys`)
    }

    // ---------------- aggregate ----------------
    const totArea = regionReports.reduce((a, r) => a + r.areaM2, 0)
    const totLoss = regionReports.reduce((a, r) => a + r.lossM2, 0)
    const totLossTiling = regionReports.reduce((a, r) => a + r.lossTilingM2, 0)
    const totSpill = regionReports.reduce((a, r) => a + r.spillM2, 0)

    console.log('')
    console.log('='.repeat(90))
    console.log('COVERAGE / VOID — per parent litho region')
    console.log('='.repeat(90))
    console.log(`  litho region area (sum)        ${totArea.toFixed(1)} m2`)
    console.log(`  uncovered by ANY refined poly  ${totLoss.toFixed(1)} m2 (${((totLoss / totArea) * 100).toFixed(2)} %)`)
    console.log(`  uncovered by the TILING only   ${totLossTiling.toFixed(1)} m2 (overlays excluded)`)
    console.log(`  refined area OUTSIDE its region ${totSpill.toFixed(1)} m2`)

    const byKind = new Map<string, { area: number; loss: number; n: number; spill: number }>()
    for (const r of regionReports) {
      const e = byKind.get(r.kind) ?? { area: 0, loss: 0, n: 0, spill: 0 }
      e.area += r.areaM2
      e.loss += r.lossM2
      e.spill += r.spillM2
      e.n++
      byKind.set(r.kind, e)
    }
    console.log('')
    console.log('  by litho region kind:')
    for (const [k, v] of [...byKind].sort((a, b) => b[1].loss - a[1].loss))
      console.log(
        `    ${k.padEnd(10)} n=${String(v.n).padStart(4)} area ${v.area.toFixed(1).padStart(9)} m2  loss ${v.loss.toFixed(1).padStart(8)} m2  spill ${v.spill.toFixed(1).padStart(7)} m2`,
      )

    const totBucket = new Map<string, number>()
    for (const r of regionReports)
      for (const [b, a] of Object.entries(r.bucket)) totBucket.set(b, (totBucket.get(b) ?? 0) + a)
    console.log('')
    console.log('  void area by geometric bucket (X- is an overlapping annotation, not additive):')
    for (const [b, a] of [...totBucket].sort((x, y) => y[1] - x[1]))
      console.log(`    ${b.padEnd(24)} ${a.toFixed(1).padStart(9)} m2`)

    // regions with zero emitted polygons
    const dead = regionReports.filter((r) => r.nPolys === 0)
    console.log('')
    console.log(`  regions with ZERO emitted polygons: ${dead.length}, area ${dead.reduce((a, r) => a + r.areaM2, 0).toFixed(1)} m2`)
    // regions whose loss > 25 % of their own area
    const badly = regionReports.filter((r) => r.areaM2 > 1 && r.lossM2 / r.areaM2 > 0.25)
    console.log(`  regions losing >25 % of themselves: ${badly.length}, loss ${badly.reduce((a, r) => a + r.lossM2, 0).toFixed(1)} m2`)
    for (const r of badly.sort((a, b) => b.lossM2 - a.lossM2).slice(0, 12))
      console.log(
        `    ${r.section.padEnd(18)} gap ${String(r.gapIndex).padStart(3)} ${r.kind.padEnd(6)} area ${r.areaM2.toFixed(1).padStart(8)} loss ${r.lossM2.toFixed(1).padStart(8)} (${((r.lossM2 / r.areaM2) * 100).toFixed(0)} %) polys=${r.nPolys} ${JSON.stringify(r.tags)}`,
      )

    console.log('')
    console.log('='.repeat(90))
    console.log('SELF-OVERLAP — same parent region')
    console.log('='.repeat(90))
    const totSelf = new Map<string, number>()
    let totSelfPairs = 0
    for (const r of regionReports) {
      totSelfPairs += r.selfOverlapPairs
      for (const [k, v] of Object.entries(r.selfOverlap)) totSelf.set(k, (totSelf.get(k) ?? 0) + v)
    }
    console.log(`  overlapping polygon pairs (same region): ${totSelfPairs}`)
    for (const [k, v] of [...totSelf].sort((a, b) => b[1] - a[1]).slice(0, 20))
      console.log(`    ${k.padEnd(46)} ${v.toFixed(2).padStart(9)} m2`)

    console.log('')
    console.log('='.repeat(90))
    console.log('CROSS-REGION OVERLAP — different parent regions, same gap')
    console.log('='.repeat(90))
    console.log(`  overlapping pairs: ${crossOverlapPairs}`)
    for (const [k, v] of [...crossOverlap].sort((a, b) => b[1] - a[1]).slice(0, 20))
      console.log(`    ${k.padEnd(56)} ${v.toFixed(2).padStart(9)} m2`)

    // worst instances
    const pick = <T extends { m2: number }>(arr: T[] | undefined, n = 2): T[] =>
      (arr ?? []).sort((a, b) => b.m2 - a.m2).slice(0, n)
    const worst = {
      loss: Object.fromEntries(Object.entries(lossWorst).map(([k, v]) => [k, pick(v)])),
      selfOverlap: Object.fromEntries(Object.entries(selfWorst).map(([k, v]) => [k, pick(v)])),
      crossOverlap: (() => {
        const byKey = new Map<string, typeof crossWorst>()
        for (const c of crossWorst) {
          const a = byKey.get(c.key) ?? []
          a.push(c)
          byKey.set(c.key, a)
        }
        return Object.fromEntries([...byKey].map(([k, v]) => [k, pick(v, 2)]))
      })(),
    }
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          engine: engineV2 ? 'v2' : 'v1',
          totals: {
            regionAreaM2: totArea,
            lossM2: totLoss,
            lossTilingM2: totLossTiling,
            spillM2: totSpill,
            selfOverlapPairs: totSelfPairs,
            crossOverlapPairs,
          },
          bucket: Object.fromEntries(totBucket),
          selfOverlap: Object.fromEntries(totSelf),
          crossOverlap: Object.fromEntries(crossOverlap),
          worst,
          regions: regionReports.map((r) => ({ ...r, voidRuns: undefined })),
        },
        null,
        1,
      ),
      'utf8',
    )
    console.log('')
    console.log(`  detail -> ${OUT}`)
    expect(regionReports.length).toBeGreaterThan(0)
  }, 900_000)
})

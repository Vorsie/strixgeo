/**
 * THROWAWAY DIAGNOSTIC — attributes the render arm's INTERIOR VOIDS (the gate's
 * ``renderVoidM2``) to a mechanism.
 *
 * Replicates the agreement gate's void definition exactly (unpainted elevation
 * strictly between the shallowest and deepest paint at an along sample), then
 * asks of every void run:
 *   INSIDE-REGION   the void lies inside ONE litho region whose own refined
 *                   polygons failed to tile it  (band-walk / emitBand hole);
 *   BETWEEN-REGIONS the void lies inside no litho region, or spans two — the
 *                   litho partition itself has a seam there, or two regions
 *                   each lost their facing edge (end-strip mechanism);
 *   OUTSIDE-LITHO   the litho partition has no material there either (the
 *                   engine's own hole; not the carve's fault).
 *
 * Dormant unless GEOTECH_IVOID=1.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import { refineLithoPartition, type GeotechColumn, type NadFormationMeta } from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(HERE, '../../../../../scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(HERE, '../../../../../scripts/throwaway_geotech_ivoid.json')
const EPS = 1e-9

type XY = { x: number; e: number }
function sliceRing(pts: readonly XY[], x: number): [number, number][] {
  const ys: number[] = []
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % pts.length]
    if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
      const t = (x - a.x) / (b.x - a.x)
      ys.push(a.e + t * (b.e - a.e))
    }
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}
interface Seg {
  top: number
  base: number
  key: string
}
function stamp(existing: readonly Seg[], s: Seg): Seg[] {
  const out: Seg[] = []
  for (const e of existing) {
    if (e.base >= s.top - EPS || e.top <= s.base + EPS) {
      out.push(e)
      continue
    }
    if (e.top > s.top + EPS) out.push({ top: e.top, base: s.top, key: e.key })
    if (e.base < s.base - EPS) out.push({ top: s.base, base: e.base, key: e.key })
  }
  out.push(s)
  return out
}
function voidsOf(segs: readonly Seg[]): [number, number][] {
  if (segs.length < 2) return []
  const sorted = [...segs].sort((a, b) => b.top - a.top)
  const out: [number, number][] = []
  let cursor = sorted[0].base
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i]
    if (s.top < cursor - EPS) out.push([s.top, cursor])
    if (s.base < cursor) cursor = s.base
  }
  return out
}

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }[]
}

describe('geotech refinement — interior void attribution', () => {
  if (process.env.GEOTECH_IVOID !== '1') {
    it.skip('dormant', () => {})
    return
  }
  it('attributes', () => {
    if (!existsSync(INPUT)) throw new Error(`${INPUT} missing`)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      formationNames: Record<string, string>
      refinementBundle: {
        nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
        lithoSoilByFormationId: Record<string, string | null>
      }
      sections: {
        name: string
        columns: RawColumn[]
        edges: { a: string; b: string; aSide?: string; bSide?: string }[]
        alongM: number[]
        refinement: { geotechLayers: { id: string; investigationId: string; depth_top_m: number; depth_base_m: number; formation_id: string; body_id: string | null }[] }
      }[]
    }
    const engineV2 = isPartitionEngineV2Active()
    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [k, { nadClass: v.nadClass, soilCode: v.soilCode }]),
    )
    const lithoSoil = new Map<string, string | null>(Object.entries(raw.refinementBundle.lithoSoilByFormationId))
    const nameOf = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    const cat = new Map<string, { m2: number; worst: number; n: number }>()
    const add = (k: string, m2: number, th: number): void => {
      const e = cat.get(k) ?? { m2: 0, worst: 0, n: 0 }
      e.m2 += m2
      e.n++
      if (th > e.worst) e.worst = th
      cat.set(k, e)
    }
    const worstInstances: Record<string, unknown>[] = []
    let totVoid = 0

    for (const sec of raw.sections) {
      const paired = sec.columns
        .map((c, i) => ({ c, a: sec.alongM[i] }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
        .sort((p, q) => p.a - q.a)
      if (paired.length < 2) continue
      const columns = paired.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
      })) as unknown as PartitionColumn[]
      const alongM = paired.map(({ a }) => a)
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const ov = deriveSectionApexOverrides(columns, edges, alongM, new Map<string, BodyBoundaryResponse>(), engineV2)
      const regions = computeSectionFillActive(columns, edges, ov, alongM)
      if (!regions.length) continue
      const geoByInv = new Map<string, GeotechColumn['units'][number][]>()
      for (const l of sec.refinement.geotechLayers) {
        const arr = geoByInv.get(l.investigationId) ?? []
        arr.push({ layerId: l.id, topDepthM: l.depth_top_m, baseDepthM: l.depth_base_m, formationId: l.formation_id, bodyId: l.body_id ?? null })
        geoByInv.set(l.investigationId, arr)
      }
      const columnOrder = columns.map((c) => c.investigationId)
      const geoColByInv = new Map<string, GeotechColumn>()
      for (const c of columns) geoColByInv.set(c.investigationId, { investigationId: c.investigationId, surfaceElevM: c.surfaceElevM, units: geoByInv.get(c.investigationId) ?? [] })

      const ordered = [...regions].sort((a, b) => (a.kind === 'lens' ? 1 : 0) - (b.kind === 'lens' ? 1 : 0))
      // refined polys tagged with their PARENT region index
      const refPolys: { ri: number; pts: XY[]; x0: number; x1: number; tag: string }[] = []
      const regPolys: { ri: number; pts: XY[]; x0: number; x1: number; r: SectionRegion }[] = []
      for (let i = 0; i < ordered.length; i++) {
        const r = ordered[i]
        const left = alongM[r.gapIndex]
        const right = alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const W = right - left
        const rp = r.polygon.map((p) => ({ x: left + p.fraction * W, e: p.elevation }))
        regPolys.push({ ri: i, pts: rp, x0: Math.min(...rp.map((p) => p.x)), x1: Math.max(...rp.map((p) => p.x)), r })
        for (const p of refineLithoPartition([r], columnOrder, geoColByInv, nadMeta, lithoSoil, { alongM })) {
          const pts = p.points.map((q) => ({ x: left + q.fraction * W, e: q.elevation }))
          refPolys.push({ ri: i, pts, x0: Math.min(...pts.map((q) => q.x)), x1: Math.max(...pts.map((q) => q.x)), tag: p.tag })
        }
      }
      // PASS B — per region: area inside the region, NOT covered by the TILING
      // (band/bracket/fallback), but covered by an overlay (hlens/enclens).
      for (const rp of regPolys) {
        const mine = refPolys.filter((p) => p.ri === rp.ri)
        if (!mine.some((p) => p.tag === 'hlens' || p.tag === 'enclens')) continue
        const w = rp.x1 - rp.x0
        if (w <= 1e-9) continue
        const M = 200
        const ddx = w / M
        for (let k = 0; k < M; k++) {
          const x = rp.x0 + (k + 0.5) * ddx
          const reg = sliceRing(rp.pts, x)
          if (!reg.length) continue
          const til: [number, number][] = []
          const ovl: [number, number][] = []
          for (const p of mine) {
            if (x < p.x0 || x > p.x1) continue
            const iv = sliceRing(p.pts, x)
            if (p.tag === 'hlens' || p.tag === 'enclens') ovl.push(...iv)
            else til.push(...iv)
          }
          const fx = (x - rp.x0) / w
          const zone = fx < 0.05 ? 'END-STRIP left' : fx > 0.95 ? 'END-STRIP right' : 'INTERIOR strip'
          // sample the vertical finely
          const top = Math.max(...reg.map((r2) => r2[1]))
          const base = Math.min(...reg.map((r2) => r2[0]))
          const NV = 400
          const de = (top - base) / NV
          for (let v = 0; v < NV; v++) {
            const e = base + (v + 0.5) * de
            if (!reg.some(([a2, b2]) => e >= a2 && e <= b2)) continue
            if (til.some(([a2, b2]) => e >= a2 && e <= b2)) continue
            if (!ovl.some(([a2, b2]) => e >= a2 && e <= b2)) continue
            add(`PASS-B overlay-covered tiling hole / ${zone}`, de * ddx, de)
          }
        }
      }
      const xs = refPolys.flatMap((p) => [p.x0, p.x1])
      if (!xs.length) continue
      const lo = Math.min(...xs)
      const hi = Math.max(...xs)
      const n = Math.max(200, Math.min(3000, Math.round((hi - lo) / 0.25) || 200))
      const dx = (hi - lo) / n
      for (let k = 0; k < n; k++) {
        const x = lo + (k + 0.5) * dx
        let segs: Seg[] = []
        for (const p of refPolys) {
          if (x < p.x0 || x > p.x1) continue
          for (const [a, b] of sliceRing(p.pts, x)) if (b - a > EPS) segs = stamp(segs, { top: b, base: a, key: `${p.ri}` })
        }
        for (const [a, b] of voidsOf(segs)) {
          const th = b - a
          const m2 = th * dx
          totVoid += m2
          const mid = (a + b) / 2
          // which litho regions contain the void's midpoint?
          const inRegions = regPolys.filter((rp) => {
            if (x < rp.x0 || x > rp.x1) return false
            return sliceRing(rp.pts, x).some(([p, q]) => mid >= p - 1e-9 && mid <= q + 1e-9)
          })
          // how much of the void's THICKNESS is inside litho material?
          let lithoCov = 0
          for (const rp of regPolys) {
            if (x < rp.x0 || x > rp.x1) continue
            for (const [p, q] of sliceRing(rp.pts, x)) lithoCov += Math.max(0, Math.min(b, q) - Math.max(a, p))
          }
          let key: string
          let detail: Record<string, unknown> = {}
          if (lithoCov < th * 0.2) key = 'OUTSIDE-LITHO (engine hole, not the carve)'
          else if (inRegions.length === 1) {
            const rp = inRegions[0]
            const fx = (x - rp.x0) / Math.max(1e-9, rp.x1 - rp.x0)
            const zone = fx < 0.05 ? 'END-STRIP left' : fx > 0.95 ? 'END-STRIP right' : 'INTERIOR strip'
            const nParts = sliceRing(rp.pts, x).length
            key = `INSIDE-REGION ${rp.r.kind} / ${zone} / ${nParts > 1 ? `CONCAVE(${nParts} parts)` : 'simple'}`
            detail = { litho: nameOf(rp.r.formationId), gapIndex: rp.r.gapIndex, kind: rp.r.kind, fx: +fx.toFixed(4), polygon: rp.r.polygon }
          } else if (inRegions.length === 0) key = 'BETWEEN-REGIONS (litho seam, both edges lost)'
          else key = `SPANS ${inRegions.length} REGIONS`
          add(key, m2, th)
          if (th > 1.0)
            worstInstances.push({ key, section: sec.name, x: +x.toFixed(2), top: +b.toFixed(3), base: +a.toFixed(3), thickness: +th.toFixed(3), lithoCoverFrac: +(lithoCov / th).toFixed(3), ...detail })
        }
      }
    }
    console.log('')
    console.log(`  TOTAL interior void  ${totVoid.toFixed(1)} m2`)
    for (const [k, v] of [...cat].sort((a, b) => b[1].m2 - a[1].m2))
      console.log(`    ${k.padEnd(50)} ${v.m2.toFixed(1).padStart(8)} m2   worst run ${v.worst.toFixed(2)} m   ${v.n} runs`)
    console.log('')
    console.log('  worst void runs (>1 m thick):')
    for (const w of worstInstances.sort((a, b) => (b.thickness as number) - (a.thickness as number)).slice(0, 12))
      console.log(`    ${String(w.section).padEnd(18)} x=${String(w.x).padStart(8)} ${String(w.base)}..${String(w.top)} (${w.thickness} m) ${w.key} ${w.litho ?? ''} gap${w.gapIndex ?? '-'} lithoCov=${w.lithoCoverFrac}`)
    writeFileSync(OUT, JSON.stringify({ totVoid, cat: Object.fromEntries(cat), worst: worstInstances.sort((a, b) => (b.thickness as number) - (a.thickness as number)).slice(0, 25) }, null, 1), 'utf8')
    console.log(`\n  -> ${OUT}`)
    expect(totVoid).toBeGreaterThanOrEqual(0)
  }, 900_000)
})

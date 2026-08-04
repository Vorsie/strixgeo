/**
 * THROWAWAY DIAGNOSTIC — splits the refinement's coverage loss into
 *   (1) DISCRETISATION loss  — area the N-sample quad-strip decomposition of
 *       ``emitBand`` cannot represent at all (the region's nose beyond the first
 *       / last sample column, the chord between samples, the 2 cm ``sliceAt``
 *       part filter, and the ``clampReach`` apex rule), computed by replaying
 *       the engine's OWN sampling + inside-test on each region with a full-height
 *       band (ft=0, fb=1) — i.e. the best case ``emitBand`` could ever do; and
 *   (2) BAND-WALK loss — everything else: material inside the reachable envelope
 *       that the interval walk failed to fill.
 * Also counts self-overlapping polygon PAIRS per tag pair.
 *
 * Dormant unless GEOTECH_VOIDMECH=1.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'
import {
  refineLithoPartition,
  type GeotechColumn,
  type NadFormationMeta,
} from './refineLithoPartition'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_axis_inputs.json')
const OUT = resolve(REPO_ROOT, 'scripts/throwaway_geotech_voidmech.json')
const N = 20

type Pt = { fraction: number; elevation: number }

/** Verbatim replica of the engine's private sliceAt (refineLithoPartition.ts:172). */
function sliceAt(poly: readonly Pt[], f: number): { env: [number, number]; parts: [number, number][] } | null {
  const hits: number[] = []
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const df = b.fraction - a.fraction
    if (Math.abs(df) < 1e-9) continue
    const t = (f - a.fraction) / df
    if (t >= -1e-9 && t <= 1 + 1e-9) hits.push(a.elevation + t * (b.elevation - a.elevation))
  }
  if (hits.length < 2) return null
  hits.sort((p, q) => q - p)
  const parts: [number, number][] = []
  for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i] - hits[i + 1] > 0.02) parts.push([hits[i], hits[i + 1]])
  if (parts.length === 0) return null
  return { env: [parts[0][0], parts[parts.length - 1][1]], parts }
}

/** Verbatim replica of the engine's private insideAt (refineLithoPartition.ts:538). */
function insideAt(poly: readonly Pt[], fx: number, e: number): boolean {
  let inside = false
  for (let q2 = 0, q3 = poly.length - 1; q2 < poly.length; q3 = q2++) {
    const pa = poly[q2]
    const pb = poly[q3]
    if (
      pa.elevation > e !== pb.elevation > e &&
      fx < pa.fraction + ((e - pa.elevation) / (pb.elevation - pa.elevation)) * (pb.fraction - pa.fraction)
    )
      inside = !inside
  }
  return inside
}

/**
 * The maximum area ``emitBand`` can ever emit for one region: replay the sample
 * grid with a full-height band and the engine's own pairing / triangle rules.
 * Returns area in FRACTION x metres (multiply by gap width for m2).
 */
function gridReachableArea(poly: readonly Pt[]): { area: number; noseArea: number } {
  const samples: ({ env: [number, number]; parts: [number, number][] } | null)[] = []
  for (let k = 0; k <= N; k++) samples.push(sliceAt(poly, k / N))
  const cols = samples.map((sl, k) => ({ sx: k / N, pieces: sl ? sl.parts : [] }))
  const clampReach = (srcF: number, midX: number, e: number): number => {
    if (insideAt(poly, midX, e)) return midX
    let lo = srcF
    let hi = midX
    for (let it = 0; it < 14; it++) {
      const mid = (lo + hi) / 2
      if (insideAt(poly, mid, e)) lo = mid
      else hi = mid
    }
    return lo
  }
  let area = 0
  let noseArea = 0
  for (let i = 0; i + 1 < cols.length; i++) {
    const A = cols[i]
    const B = cols[i + 1]
    const midX = (A.sx + B.sx) / 2
    const w = B.sx - A.sx
    let ai = 0
    let bi = 0
    const closeTri = (a: [number, number]): void => {
      const e = (a[0] + a[1]) / 2
      const apex = clampReach(A.sx, midX, e)
      if (apex - A.sx < 1e-4) return
      area += 0.5 * (a[0] - a[1]) * (apex - A.sx)
      noseArea += 0.5 * (a[0] - a[1]) * (apex - A.sx)
    }
    const openTri = (b: [number, number]): void => {
      const e = (b[0] + b[1]) / 2
      const apex = clampReach(B.sx, midX, e)
      if (B.sx - apex < 1e-4) return
      area += 0.5 * (b[0] - b[1]) * (B.sx - apex)
      noseArea += 0.5 * (b[0] - b[1]) * (B.sx - apex)
    }
    while (ai < A.pieces.length && bi < B.pieces.length) {
      const a = A.pieces[ai]
      const b = B.pieces[bi]
      const ov = Math.min(a[0], b[0]) - Math.max(a[1], b[1])
      if (ov > 0.005) {
        area += 0.5 * (a[0] - a[1] + (b[0] - b[1])) * w
        ai++
        bi++
      } else if (a[1] > b[0]) {
        closeTri(a)
        ai++
      } else {
        openTri(b)
        bi++
      }
    }
    for (; ai < A.pieces.length; ai++) closeTri(A.pieces[ai])
    for (; bi < B.pieces.length; bi++) openTri(B.pieces[bi])
  }
  return { area, noseArea }
}

/** Exact polygon area (shoelace) in fraction x metres. */
function shoelace(poly: readonly Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    s += a.fraction * b.elevation - b.fraction * a.elevation
  }
  return Math.abs(s) / 2
}

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }[]
}
interface RawFile {
  formationNames: Record<string, string>
  refinementBundle: {
    nadMeta: Record<string, { nadClass: number | null; soilCode: string | null }>
    lithoSoilByFormationId: Record<string, string | null>
  }
  sections: {
    name: string
    kind: string
    columns: RawColumn[]
    edges: { a: string; b: string; aSide?: string; bSide?: string }[]
    alongM: number[]
    refinement: {
      geotechLayers: {
        id: string
        investigationId: string
        depth_top_m: number
        depth_base_m: number
        formation_id: string
        body_id: string | null
      }[]
    }
  }[]
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

describe('geotech refinement — void mechanism split', () => {
  if (process.env.GEOTECH_VOIDMECH !== '1') {
    it.skip('dormant', () => {})
    return
  }
  it('splits discretisation vs band-walk loss', () => {
    if (!existsSync(INPUT)) throw new Error(`${INPUT} missing`)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as RawFile
    const engineV2 = isPartitionEngineV2Active()
    const nadMeta = new Map<string, NadFormationMeta>(
      Object.entries(raw.refinementBundle.nadMeta).map(([k, v]) => [k, { nadClass: v.nadClass, soilCode: v.soilCode }]),
    )
    const lithoSoil = new Map<string, string | null>(Object.entries(raw.refinementBundle.lithoSoilByFormationId))
    const nameOf = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)

    let totRegion = 0
    let totReach = 0
    let totEmitted = 0
    let totNose = 0
    const rows: Record<string, unknown>[] = []
    // interior regions (touch neither column) — the §7 Q6 class
    let interiorArea = 0
    let interiorDiscr = 0
    let interiorWalk = 0
    const pairCount = new Map<string, number>()
    const pairArea = new Map<string, number>()
    const worstWalk: Record<string, unknown>[] = []
    const worstPair: Record<string, Record<string, unknown>[]> = {}

    for (const sec of raw.sections) {
      const L = assembleColumns(sec.columns, sec.alongM)
      if (L.columns.length < 2) continue
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const overrides = deriveSectionApexOverrides(L.columns, edges, L.alongM, new Map<string, BodyBoundaryResponse>(), engineV2)
      const regions = computeSectionFillActive(L.columns, edges, overrides, L.alongM)
      if (!regions.length) continue
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

      for (const r of regions) {
        const left = L.alongM[r.gapIndex]
        const right = L.alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const W = right - left
        const regionA = shoelace(r.polygon) * W
        const g = gridReachableArea(r.polygon)
        const reachA = g.area * W
        const out = refineLithoPartition([r], columnOrder, geoColByInv, nadMeta, lithoSoil, { alongM: L.alongM })
        // emitted area = SUM of polygon areas of tiling-tagged polys (band/bracket/
        // fallback). Overlaps are counted twice here on purpose; compared with the
        // measured union in the sibling diag this reveals double-emit.
        let emitted = 0
        for (const p of out) if (p.tag === 'band' || p.tag === 'bracket' || p.tag === 'fallback') emitted += shoelace(p.points) * W
        totRegion += regionA
        totReach += reachA
        totEmitted += emitted
        totNose += g.noseArea * W

        const touchesNeither = sliceAt(r.polygon, 0) === null && sliceAt(r.polygon, 1) === null
        const discr = regionA - reachA
        const walk = reachA - emitted
        if (touchesNeither) {
          interiorArea += regionA
          interiorDiscr += discr
          interiorWalk += walk
        }
        rows.push({
          section: sec.name,
          gapIndex: r.gapIndex,
          kind: r.kind,
          litho: nameOf(r.formationId),
          regionA,
          reachA,
          emitted,
          discr,
          walk,
          touchesNeither,
          nPolys: out.length,
          tags: out.reduce<Record<string, number>>((a, p) => {
            a[p.tag] = (a[p.tag] ?? 0) + 1
            return a
          }, {}),
        })
        if (walk > 0.5 && r.kind === 'quad')
          worstWalk.push({
            section: sec.name,
            gapIndex: r.gapIndex,
            litho: nameOf(r.formationId),
            regionA: +regionA.toFixed(2),
            reachA: +reachA.toFixed(2),
            emitted: +emitted.toFixed(2),
            walk: +walk.toFixed(2),
            touchesNeither,
            widthM: +W.toFixed(2),
            polygon: r.polygon,
            tags: out.reduce<Record<string, number>>((a, p) => {
              a[p.tag] = (a[p.tag] ?? 0) + 1
              return a
            }, {}),
          })

        // --- pair counting on the emitted polys of THIS region
        const polys = out.map((p) => ({
          tag: p.tag,
          fill: p.formationId,
          pts: p.points.map((q) => ({ x: left + q.fraction * W, e: q.elevation })),
        })) as { tag: string; fill: string; pts: { x: number; e: number }[] }[]
        for (let i = 0; i < polys.length; i++)
          for (let j = i + 1; j < polys.length; j++) {
            const A = polys[i]
            const B = polys[j]
            const ax0 = Math.min(...A.pts.map((p) => p.x))
            const ax1 = Math.max(...A.pts.map((p) => p.x))
            const bx0 = Math.min(...B.pts.map((p) => p.x))
            const bx1 = Math.max(...B.pts.map((p) => p.x))
            const lo = Math.max(ax0, bx0)
            const hi = Math.min(ax1, bx1)
            if (hi - lo <= 1e-9) continue
            const nn = 16
            const dd = (hi - lo) / nn
            let ov = 0
            for (let k = 0; k < nn; k++) {
              const x = lo + (k + 0.5) * dd
              const ia = ringIv(A.pts, x)
              const ib = ringIv(B.pts, x)
              for (const p of ia)
                for (const q of ib) {
                  const l2 = Math.max(p[0], q[0])
                  const h2 = Math.min(p[1], q[1])
                  if (h2 > l2) ov += (h2 - l2) * dd
                }
            }
            if (ov <= 1e-4) continue
            const key = `${[A.tag, B.tag].sort().join(' x ')}${A.fill === B.fill ? ' same-fill' : ' DIFF-fill'}`
            pairCount.set(key, (pairCount.get(key) ?? 0) + 1)
            pairArea.set(key, (pairArea.get(key) ?? 0) + ov)
            const w = (worstPair[key] ??= [])
            w.push({
              m2: +ov.toFixed(3),
              section: sec.name,
              gapIndex: r.gapIndex,
              kind: r.kind,
              litho: nameOf(r.formationId),
              aTag: A.tag,
              bTag: B.tag,
              aFill: nameOf(A.fill),
              bFill: nameOf(B.fill),
              aPoly: A.pts.map((p) => [+p.x.toFixed(3), +p.e.toFixed(3)]),
              bPoly: B.pts.map((p) => [+p.x.toFixed(3), +p.e.toFixed(3)]),
              regionPolygonFraction: r.polygon,
              alongLeft: left,
              alongRight: right,
            })
          }
      }
    }

    console.log('')
    console.log('='.repeat(88))
    console.log('COVERAGE LOSS SPLIT (m2, all 14 sections)')
    console.log('='.repeat(88))
    console.log(`  litho region area                       ${totRegion.toFixed(1)}`)
    console.log(`  grid-REACHABLE area (emitBand ceiling)  ${totReach.toFixed(1)}`)
    console.log(`  DISCRETISATION loss (region - reach)    ${(totRegion - totReach).toFixed(1)}`)
    console.log(`     of which taper/apex triangles emit   ${totNose.toFixed(1)} (already inside reach)`)
    console.log(`  emitted tiling area (sum, dbl-counts overlaps) ${totEmitted.toFixed(1)}`)
    console.log(`  BAND-WALK loss (reach - emitted)        ${(totReach - totEmitted).toFixed(1)}`)
    console.log('')
    console.log(`  interior regions (touch NEITHER column): area ${interiorArea.toFixed(1)}, discr ${interiorDiscr.toFixed(1)}, walk ${interiorWalk.toFixed(1)}`)

    console.log('')
    console.log('  self-overlap pairs by tag pair (count, m2):')
    for (const [k, c] of [...pairCount].sort((a, b) => b[1] - a[1]))
      console.log(`    ${k.padEnd(36)} ${String(c).padStart(6)} pairs  ${(pairArea.get(k) ?? 0).toFixed(2).padStart(9)} m2`)

    console.log('')
    console.log('  worst band-walk losers:')
    for (const r of worstWalk.sort((a, b) => (b.walk as number) - (a.walk as number)).slice(0, 15))
      console.log(
        `    ${String(r.section).padEnd(18)} gap ${String(r.gapIndex).padStart(3)} ${String(r.litho).padEnd(16)} regionA ${String(r.regionA).padStart(8)} reach ${String(r.reachA).padStart(8)} emitted ${String(r.emitted).padStart(8)} walk ${String(r.walk).padStart(7)} interior=${r.touchesNeither} ${JSON.stringify(r.tags)}`,
      )

    writeFileSync(
      OUT,
      JSON.stringify(
        {
          totals: {
            regionA: totRegion,
            reachA: totReach,
            emitted: totEmitted,
            discretisation: totRegion - totReach,
            bandWalk: totReach - totEmitted,
            taperTriangles: totNose,
            interior: { area: interiorArea, discr: interiorDiscr, walk: interiorWalk },
          },
          pairs: Object.fromEntries([...pairCount].map(([k, v]) => [k, { count: v, m2: pairArea.get(k) }])),
          worstWalk: worstWalk.sort((a, b) => (b.walk as number) - (a.walk as number)).slice(0, 10),
          worstPair: Object.fromEntries(
            Object.entries(worstPair).map(([k, v]) => [
              k,
              v.sort((a, b) => (b.m2 as number) - (a.m2 as number)).slice(0, 2),
            ]),
          ),
          rows,
        },
        null,
        1,
      ),
      'utf8',
    )
    console.log(`\n  detail -> ${OUT}`)
    expect(rows.length).toBeGreaterThan(0)
  }, 900_000)
})

function ringIv(pts: readonly { x: number; e: number }[], x: number): [number, number][] {
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
  for (let i = 0; i + 1 < ys.length; i += 2) if (ys[i + 1] - ys[i] > 1e-12) out.push([ys[i], ys[i + 1]])
  return out
}

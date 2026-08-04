/**
 * THROWAWAY DIAGNOSTIC — isolates the END-STRIP mechanism.
 *
 * The v2 engine emits region polygons inset from the gap edges by ~1e-6 of the
 * gap (its 1 mm along-metre snap), so ``sliceAt(poly, 0)`` / ``sliceAt(poly, 1)``
 * find fewer than two crossings and return null. ``emitBand``'s sample column
 * k=0 / k=N then carries NO pieces, and the boundary strip degenerates to a
 * midpoint triangle instead of a quad.
 *
 * Measures: loss in strip 0 + strip N-1 vs the interior strips; how many
 * regions have a null end sample; and how many regions take the "reaches
 * NEITHER column" branch purely because of the inset.
 *
 * Dormant unless GEOTECH_ENDSTRIP=1.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import type { BodyBoundaryResponse } from '../api/clients/geology.types'
import { deriveSectionApexOverrides } from './buildVoxelRequest'
import type { CorrelationEdge, PartitionColumn } from './partitionFill'
import { computeSectionFillActive, isPartitionEngineV2Active } from './partitionEngineSelect'

const HERE = dirname(fileURLToPath(import.meta.url))
const INPUT = resolve(HERE, '../../../../../scripts/throwaway_geotech_axis_inputs.json')
const N = 20
type Pt = { fraction: number; elevation: number }

function sliceAt(poly: readonly Pt[], f: number, minPart = 0.02): [number, number][] | null {
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
  for (let i = 0; i + 1 < hits.length; i += 2) if (hits[i] - hits[i + 1] > minPart) parts.push([hits[i], hits[i + 1]])
  return parts.length ? parts : null
}
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
function reachStrip(poly: readonly Pt[], i: number): number {
  const A = sliceAt(poly, i / N) ?? []
  const B = sliceAt(poly, (i + 1) / N) ?? []
  const sx = i / N
  const ex = (i + 1) / N
  const midX = (sx + ex) / 2
  const w = ex - sx
  const cr = (srcF: number, e: number): number => {
    if (insideAt(poly, midX, e)) return midX
    let lo = srcF
    let hi = midX
    for (let it = 0; it < 14; it++) {
      const m = (lo + hi) / 2
      if (insideAt(poly, m, e)) lo = m
      else hi = m
    }
    return lo
  }
  let area = 0
  let ai = 0
  let bi = 0
  const close = (a: [number, number]): void => {
    const e = (a[0] + a[1]) / 2
    const ap = cr(sx, e)
    if (ap - sx >= 1e-4) area += 0.5 * (a[0] - a[1]) * (ap - sx)
  }
  const open = (b: [number, number]): void => {
    const e = (b[0] + b[1]) / 2
    const ap = cr(ex, e)
    if (ex - ap >= 1e-4) area += 0.5 * (b[0] - b[1]) * (ex - ap)
  }
  while (ai < A.length && bi < B.length) {
    const a = A[ai]
    const b = B[bi]
    if (Math.min(a[0], b[0]) - Math.max(a[1], b[1]) > 0.005) {
      area += 0.5 * (a[0] - a[1] + (b[0] - b[1])) * w
      ai++
      bi++
    } else if (a[1] > b[0]) {
      close(a)
      ai++
    } else {
      open(b)
      bi++
    }
  }
  for (; ai < A.length; ai++) close(A[ai])
  for (; bi < B.length; bi++) open(B[bi])
  return area
}
function trueStrip(poly: readonly Pt[], i: number): number {
  const sx = i / N
  const w = 1 / N
  let ta = 0
  const M = 400
  for (let k = 0; k < M; k++) {
    const s = sliceAt(poly, sx + ((k + 0.5) * w) / M, 0)
    if (s) for (const p of s) ta += ((p[0] - p[1]) * w) / M
  }
  return ta
}

interface RawColumn {
  investigationId: string
  surfaceElevM: number | null
  units: { topDepthM: number; baseDepthM: number; formationId: string }[]
}

describe('geotech refinement — end-strip mechanism', () => {
  if (process.env.GEOTECH_ENDSTRIP !== '1') {
    it.skip('dormant', () => {})
    return
  }
  it('isolates', () => {
    if (!existsSync(INPUT)) throw new Error(`${INPUT} missing`)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      formationNames: Record<string, string>
      sections: { name: string; columns: RawColumn[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[]; alongM: number[] }[]
    }
    const engineV2 = isPartitionEngineV2Active()
    let endLoss = 0
    let midLoss = 0
    let totArea = 0
    let nNullEnd = 0
    let nRegions = 0
    let nFalseInterior = 0
    let falseInteriorArea = 0
    let nTrueInterior = 0
    let trueInteriorArea = 0
    const insets: number[] = []
    const worstEnd: { s: string; g: number; f: string; loss: number; area: number; poly: Pt[]; W: number }[] = []
    const worstMid: { s: string; g: number; f: string; strip: number; loss: number; poly: Pt[]; W: number }[] = []

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
      for (const r of computeSectionFillActive(columns, edges, ov, alongM)) {
        const left = alongM[r.gapIndex]
        const right = alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const W = right - left
        nRegions++
        const s0 = sliceAt(r.polygon, 0)
        const s1 = sliceAt(r.polygon, 1)
        const fmin = Math.min(...r.polygon.map((p) => p.fraction))
        const fmax = Math.max(...r.polygon.map((p) => p.fraction))
        if (s0 === null || s1 === null) nNullEnd++
        if (s0 === null && s1 === null) {
          // spans (essentially) the whole gap but both end samples missed it
          if (fmin < 1e-4 && fmax > 1 - 1e-4) {
            nFalseInterior++
            falseInteriorArea += 0
          } else {
            nTrueInterior++
          }
        }
        if (s0 === null && fmin < 1e-4) insets.push(fmin)
        if (s1 === null && fmax > 1 - 1e-4) insets.push(1 - fmax)
        let ra = 0
        for (let i = 0; i < N; i++) {
          const t = trueStrip(r.polygon, i) * W
          const e = reachStrip(r.polygon, i) * W
          ra += t
          const l = t - e
          if (i === 0 || i === N - 1) {
            endLoss += l
            if (l > 5) worstEnd.push({ s: sec.name, g: r.gapIndex, f: raw.formationNames[r.formationId] ?? r.formationId.slice(0, 8), loss: l, area: t, poly: r.polygon, W })
          } else {
            midLoss += l
            if (l > 3) worstMid.push({ s: sec.name, g: r.gapIndex, f: raw.formationNames[r.formationId] ?? r.formationId.slice(0, 8), strip: i, loss: l, poly: r.polygon, W })
          }
        }
        totArea += ra
        // count area of the false-interior class
        if (s0 === null && s1 === null && fmin < 1e-4 && fmax > 1 - 1e-4) falseInteriorArea += ra
        if (s0 === null && s1 === null && !(fmin < 1e-4 && fmax > 1 - 1e-4)) trueInteriorArea += ra
      }
    }
    console.log('')
    console.log(`  regions ${nRegions}, area ${totArea.toFixed(1)} m2`)
    console.log(`  regions with a NULL end sample (sliceAt(0) or sliceAt(1) === null): ${nNullEnd}`)
    console.log(`  LOSS in the two END strips  ${endLoss.toFixed(1)} m2`)
    console.log(`  LOSS in the 18 interior strips ${midLoss.toFixed(1)} m2`)
    console.log('')
    console.log(`  "reaches NEITHER column" branch:`)
    console.log(`     FALSE interior (fmin<1e-4 AND fmax>1-1e-4, i.e. it DOES span the gap): ${nFalseInterior} regions, ${falseInteriorArea.toFixed(1)} m2`)
    console.log(`     TRUE interior  (genuinely inset):                                     ${nTrueInterior} regions, ${trueInteriorArea.toFixed(1)} m2`)
    if (insets.length)
      console.log(`  observed end insets: n=${insets.length} min ${Math.min(...insets).toExponential(2)} max ${Math.max(...insets).toExponential(2)} median ${insets.sort((a, b) => a - b)[insets.length >> 1].toExponential(2)}`)
    console.log('')
    console.log('  worst END-strip instances:')
    for (const w of worstEnd.sort((a, b) => b.loss - a.loss).slice(0, 6))
      console.log(`    ${w.s.padEnd(18)} gap ${String(w.g).padStart(3)} ${w.f.padEnd(8)} lost ${w.loss.toFixed(1).padStart(6)} of ${w.area.toFixed(1)} m2 in one end strip; gapW ${w.W.toFixed(1)} m; poly=${JSON.stringify(w.poly.map((p) => [p.fraction, p.elevation]))}`)
    console.log('')
    console.log('  worst INTERIOR-strip instances (piece birth/death at midpoint):')
    for (const w of worstMid.sort((a, b) => b.loss - a.loss).slice(0, 6))
      console.log(`    ${w.s.padEnd(18)} gap ${String(w.g).padStart(3)} ${w.f.padEnd(8)} strip ${w.strip} lost ${w.loss.toFixed(1)} m2; gapW ${w.W.toFixed(1)} m; poly=${JSON.stringify(w.poly.map((p) => [p.fraction, p.elevation]))}`)
    expect(nRegions).toBeGreaterThan(0)
  }, 900_000)
})

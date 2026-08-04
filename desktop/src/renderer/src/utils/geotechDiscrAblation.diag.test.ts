/**
 * THROWAWAY DIAGNOSTIC — ablates the DISCRETISATION half of the refinement's
 * coverage loss into its sub-mechanisms, by recomputing the ``emitBand`` sample
 * grid ceiling with one knob changed at a time:
 *   base      N=20, 0.02 m sliceAt part filter, clampReach apex rule  (SHIPPED)
 *   nofilter  N=20, part filter -> 0                                  (isolates the 2 cm drop)
 *   noclamp   N=20, triangles always reach the midpoint               (isolates clampReach)
 *   N=200     resolution only
 *   N=2000    asymptote
 * Also breaks the loss down by the region's fraction-width (how many of the 21
 * sample columns land inside it).
 *
 * Dormant unless GEOTECH_ABL=1.
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

type Pt = { fraction: number; elevation: number }

function sliceAt(poly: readonly Pt[], f: number, minPart: number): [number, number][] | null {
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
function reach(poly: readonly Pt[], n: number, minPart: number, clamp: boolean, ownDomain = false): number {
  const cols: { sx: number; pieces: [number, number][] }[] = []
  // ownDomain: sample over the region's OWN fraction extent (inset by a hair so the
  // end samples find crossings) instead of the gap's [0,1] — the candidate fix.
  const f0 = ownDomain ? Math.min(...poly.map((p) => p.fraction)) : 0
  const f1 = ownDomain ? Math.max(...poly.map((p) => p.fraction)) : 1
  const eps = ownDomain ? (f1 - f0) * 1e-9 : 0
  for (let k = 0; k <= n; k++) {
    const f = Math.min(f1 - eps, Math.max(f0 + eps, f0 + ((f1 - f0) * k) / n))
    cols.push({ sx: f, pieces: sliceAt(poly, f, minPart) ?? [] })
  }
  const cr = (srcF: number, midX: number, e: number): number => {
    if (!clamp) return midX
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
  for (let i = 0; i + 1 < cols.length; i++) {
    const A = cols[i]
    const B = cols[i + 1]
    const midX = (A.sx + B.sx) / 2
    const w = B.sx - A.sx
    if (w <= 0) continue
    let ai = 0
    let bi = 0
    const close = (a: [number, number]): void => {
      const e = (a[0] + a[1]) / 2
      const apex = cr(A.sx, midX, e)
      if (apex - A.sx < 1e-4) return
      area += 0.5 * (a[0] - a[1]) * (apex - A.sx)
    }
    const open = (b: [number, number]): void => {
      const e = (b[0] + b[1]) / 2
      const apex = cr(B.sx, midX, e)
      if (B.sx - apex < 1e-4) return
      area += 0.5 * (b[0] - b[1]) * (B.sx - apex)
    }
    while (ai < A.pieces.length && bi < B.pieces.length) {
      const a = A.pieces[ai]
      const b = B.pieces[bi]
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
    for (; ai < A.pieces.length; ai++) close(A.pieces[ai])
    for (; bi < B.pieces.length; bi++) open(B.pieces[bi])
  }
  return area
}
/** Area emitBand reaches in ONE strip [i/20, (i+1)/20]. */
function reachStrip(poly: readonly Pt[], i: number): number {
  const N = 20
  const A = sliceAt(poly, i / N, 0.02) ?? []
  const B = sliceAt(poly, (i + 1) / N, 0.02) ?? []
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
    if (ap - sx < 1e-4) return
    area += 0.5 * (a[0] - a[1]) * (ap - sx)
  }
  const open = (b: [number, number]): void => {
    const e = (b[0] + b[1]) / 2
    const ap = cr(ex, e)
    if (ex - ap < 1e-4) return
    area += 0.5 * (b[0] - b[1]) * (ex - ap)
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
  units: {
    layerId: string
    topDepthM: number
    baseDepthM: number
    formationId: string
    bodyId: string | null
  }[]
}

describe('geotech refinement — discretisation ablation', () => {
  if (process.env.GEOTECH_ABL !== '1') {
    it.skip('dormant', () => {})
    return
  }
  it('ablates', () => {
    if (!existsSync(INPUT)) throw new Error(`${INPUT} missing`)
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      formationNames: Record<string, string>
      sections: {
        name: string
        columns: RawColumn[]
        edges: { a: string; b: string; aSide?: string; bSide?: string }[]
        alongM: number[]
      }[]
    }
    const engineV2 = isPartitionEngineV2Active()
    const acc = { region: 0, base: 0, nofilter: 0, noclamp: 0, n200: 0, n2000: 0, own: 0, own200: 0 }
    const byCols = new Map<string, { area: number; loss: number; n: number }>()
    const worst: { s: string; g: number; litho: string; area: number; loss: number; cols: number; fw: number; poly: Pt[] }[] = []

    for (const sec of raw.sections) {
      const paired = sec.columns
        .map((c, i) => ({ c, a: sec.alongM[i] }))
        .filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
        .sort((p, q) => p.a - q.a)
      if (paired.length < 2) continue
      const columns: PartitionColumn[] = paired.map(({ c }) => ({
        investigationId: c.investigationId,
        surfaceElevM: c.surfaceElevM as number,
        units: [...c.units].sort((a, b) => a.topDepthM - b.topDepthM),
      })) as PartitionColumn[]
      const alongM = paired.map(({ a }) => a)
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const ov = deriveSectionApexOverrides(columns, edges, alongM, new Map<string, BodyBoundaryResponse>(), engineV2)
      const regions = computeSectionFillActive(columns, edges, ov, alongM)
      for (const r of regions) {
        const left = alongM[r.gapIndex]
        const right = alongM[r.gapIndex + 1]
        if (left === undefined || right === undefined || right - left <= 0) continue
        const W = right - left
        const A = shoelace(r.polygon) * W
        const b = reach(r.polygon, 20, 0.02, true) * W
        acc.region += A
        acc.base += b
        acc.nofilter += reach(r.polygon, 20, 0, true) * W
        acc.noclamp += reach(r.polygon, 20, 0.02, false) * W
        acc.n200 += reach(r.polygon, 200, 0.02, true) * W
        acc.n2000 += reach(r.polygon, 2000, 0.02, true) * W
        acc.own += reach(r.polygon, 20, 0.02, true, true) * W
        acc.own200 += reach(r.polygon, 200, 0.02, true, true) * W
        const fmin = Math.min(...r.polygon.map((p) => p.fraction))
        const fmax = Math.max(...r.polygon.map((p) => p.fraction))
        // TRUE sample count: how many of the 21 grid columns sliceAt resolves.
        let nCols = 0
        let maxParts = 1
        for (let k = 0; k <= 20; k++) {
          const s = sliceAt(r.polygon, k / 20, 0.02)
          if (s) {
            nCols++
            if (s.length > maxParts) maxParts = s.length
          }
        }
        const key =
          `${nCols >= 21 ? '21' : nCols >= 16 ? '16-20' : nCols >= 11 ? '11-15' : nCols >= 6 ? '6-10' : nCols >= 3 ? '3-5' : String(nCols)} samples` +
          `${maxParts > 1 ? ' / CONCAVE' : ' / simple'}`
        const e = byCols.get(key) ?? { area: 0, loss: 0, n: 0 }
        e.area += A
        e.loss += A - b
        e.n++
        byCols.set(key, e)
        if (A - b > 2)
          worst.push({ s: sec.name, g: r.gapIndex, litho: raw.formationNames[r.formationId] ?? r.formationId.slice(0, 8), area: A, loss: A - b, cols: nCols, fw: fmax - fmin, poly: r.polygon })
      }
    }
    console.log('')
    console.log(`  region area        ${acc.region.toFixed(1)}`)
    console.log(`  base   (N=20)      ${acc.base.toFixed(1)}   loss ${(acc.region - acc.base).toFixed(1)}`)
    console.log(`  nofilter (0 cm)    ${acc.nofilter.toFixed(1)}   loss ${(acc.region - acc.nofilter).toFixed(1)}   -> 2cm part filter costs ${(acc.nofilter - acc.base).toFixed(1)}`)
    console.log(`  noclamp            ${acc.noclamp.toFixed(1)}   loss ${(acc.region - acc.noclamp).toFixed(1)}   -> clampReach costs ${(acc.noclamp - acc.base).toFixed(1)}`)
    console.log(`  N=200              ${acc.n200.toFixed(1)}   loss ${(acc.region - acc.n200).toFixed(1)}   -> resolution costs ${(acc.n200 - acc.base).toFixed(1)}`)
    console.log(`  N=2000             ${acc.n2000.toFixed(1)}   loss ${(acc.region - acc.n2000).toFixed(1)}`)
    console.log(`  OWN-DOMAIN N=20    ${acc.own.toFixed(1)}   loss ${(acc.region - acc.own).toFixed(1)}   <- candidate fix (sample the region's own fraction extent)`)
    console.log(`  OWN-DOMAIN N=200   ${acc.own200.toFixed(1)}   loss ${(acc.region - acc.own200).toFixed(1)}`)
    console.log('')
    console.log('  loss by how many of the 21 sample columns land inside the region:')
    for (const [k, v] of [...byCols].sort((a, b) => b[1].loss - a[1].loss))
      console.log(`    ${k.padEnd(20)} n=${String(v.n).padStart(4)}  area ${v.area.toFixed(1).padStart(9)}  loss ${v.loss.toFixed(1).padStart(8)}  (${((v.loss / v.area) * 100).toFixed(1)} %)`)
    console.log('')
    console.log('  worst single regions (discretisation loss):')
    for (const w of worst.sort((a, b) => b.loss - a.loss).slice(0, 12))
      console.log(`    ${w.s.padEnd(18)} gap ${String(w.g).padStart(3)} ${w.litho.padEnd(16)} area ${w.area.toFixed(1).padStart(8)} loss ${w.loss.toFixed(1).padStart(7)} (${((w.loss / w.area) * 100).toFixed(0)} %) sampleCols=${w.cols} fracWidth=${w.fw.toFixed(3)}`)
    console.log('')
    console.log('  WORST INSTANCES — per-strip true-vs-reachable:')
    for (const w0 of worst.sort((a, b) => b.loss - a.loss).slice(0, 3)) {
      const W = w0.area / shoelace(w0.poly)
      console.log(`   == ${w0.s} gap ${w0.g} ${w0.litho}  gapWidth=${W.toFixed(2)} m  area=${w0.area.toFixed(1)} loss=${w0.loss.toFixed(1)}`)
      console.log(`      polygon(${w0.poly.length} pts) = ${JSON.stringify(w0.poly.map((p) => [p.fraction, p.elevation]))}`)
      const parts = []
      for (let k = 0; k <= 20; k++) parts.push((sliceAt(w0.poly, k / 20, 0.02) ?? []).length)
      console.log(`      parts per sample: ${parts.join(',')}`)
      for (let i = 0; i < 20; i++) {
        const sx = i / 20
        const ex = (i + 1) / 20
        let ta = 0
        const M = 400
        for (let k = 0; k < M; k++) {
          const s = sliceAt(w0.poly, sx + ((k + 0.5) * (ex - sx)) / M, 0)
          if (s) for (const p of s) ta += ((p[0] - p[1]) * (ex - sx)) / M
        }
        const sub = { ...w0 }
        void sub
        const em = reachStrip(w0.poly, i)
        if ((ta - em) * W > 0.5)
          console.log(`      strip ${String(i).padStart(2)} [${sx.toFixed(2)}-${ex.toFixed(2)}] true ${(ta * W).toFixed(2)} emit ${(em * W).toFixed(2)} LOSS ${((ta - em) * W).toFixed(2)} m2`)
      }
    }
    expect(acc.region).toBeGreaterThan(0)
  }, 900_000)
})

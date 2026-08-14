/** THROWAWAY — why does a gap-9 face straddle the litho SILT-wedge diagonal? */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { buildArrangement } from './partitionFillV2/arrangement'
import type { InputCurve, Point } from './partitionFillV2/types'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const DUMP = resolve(REPO_ROOT, 'scripts/throwaway_section_dump.json')

describe('gap9 clip diag', () => {
  if (process.env.GAP9_DIAG !== '1' || !existsSync(DUMP)) {
    it.skip('dormant', () => {})
    return
  }
  it('checks face cutting along the litho wedge diagonal', () => {
    const lines: string[] = []
    const d = JSON.parse(readFileSync(DUMP, 'utf8'))
    const GAP = Number(process.env.GAP9_GAP ?? 9)
    const SCALE = 100
    const rings: Point[][] = []
    for (const src of [d.litho, d.geo]) {
      for (const r of src) {
        if (r.gap !== GAP) continue
        rings.push(r.pts.map(([f, e]: [number, number]) => ({ x: f * SCALE, y: e })))
      }
    }
    const segKeys = new Set<string>()
    const curves: InputCurve[] = []
    let cid = 0
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]
        const b = ring[(i + 1) % ring.length]
        const ka = `${Math.round(a.x * 1000)},${Math.round(a.y * 1000)}`
        const kb = `${Math.round(b.x * 1000)},${Math.round(b.y * 1000)}`
        if (ka === kb) continue
        const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`
        if (segKeys.has(key)) continue
        segKeys.add(key)
        curves.push({ id: `c${cid++}`, kind: 'contact', points: [a, b] })
      }
    }
    lines.push(`curves: ${curves.length}`)
    const arr = buildArrangement(curves)
    lines.push(`faces: ${arr.faces.length}`)
    // The wedge diagonal in scaled coords:
    const A = { x: 0, y: 6.48 }
    const B = { x: 50, y: 3.93 }
    const crossesDiagonal = (p: Point, q: Point): boolean => {
      const d1 = (B.x - A.x) * (p.y - A.y) - (B.y - A.y) * (p.x - A.x)
      const d2 = (B.x - A.x) * (q.y - A.y) - (B.y - A.y) * (q.x - A.x)
      if (d1 * d2 >= -1e-9) return false
      const d3 = (q.x - p.x) * (A.y - p.y) - (q.y - p.y) * (A.x - p.x)
      const d4 = (q.x - p.x) * (B.y - p.y) - (q.y - p.y) * (B.x - p.x)
      return d3 * d4 < -1e-9
    }
    let bad = 0
    for (const f of arr.faces) {
      for (let i = 0; i < f.polygon.length; i++) {
        const p = f.polygon[i]
        const q = f.polygon[(i + 1) % f.polygon.length]
        if (crossesDiagonal(p, q)) {
          bad++
          lines.push(
            `face area=${f.area.toFixed(1)} edge (${(p.x / SCALE).toFixed(3)},${p.y.toFixed(2)})->` +
              `(${(q.x / SCALE).toFixed(3)},${q.y.toFixed(2)}) crosses the diagonal`,
          )
          break
        }
      }
    }
    lines.push(`faces with an edge crossing the diagonal: ${bad}`)
    // Is the diagonal itself among the curves?
    const hasDiag = curves.some(
      (c) =>
        c.points.some((p) => Math.abs(p.x - 0) < 1e-6 && Math.abs(p.y - 6.48) < 1e-3) &&
        c.points.some((p) => Math.abs(p.x - 50) < 1e-6 && Math.abs(p.y - 3.93) < 1e-3),
    )
    lines.push(`diagonal present as an input segment: ${hasDiag}`)
    // Input segments whose endpoints sit near the wedge diagonal's ends.
    for (const c of curves) {
      const nearA = c.points.some((p) => Math.hypot(p.x - 0, p.y - 6.48) < 0.05)
      const nearB = c.points.some((p) => Math.hypot(p.x - 50.0018, p.y - 3.93) < 0.05)
      if (nearA || nearB) {
        lines.push(
          `  input seg ${c.points.map((p) => `(${p.x.toFixed(4)},${p.y.toFixed(4)})`).join('->')}` +
            `${nearA ? ' [nearA]' : ''}${nearB ? ' [nearB]' : ''}`,
        )
      }
    }
    // Arrangement half-edges lying ON the diagonal (collinear within 5 mm).
    const onDiag = (p: Point): boolean => {
      const t = (p.x - A.x) / (B.x - A.x)
      if (t < -0.01 || t > 1.01) return false
      const ey = A.y + t * (B.y - A.y)
      return Math.abs(p.y - ey) < 0.005
    }
    let diagEdges = 0
    for (const he of arr.halfEdges) {
      const p = arr.vertices[he.origin]
      const q = arr.vertices[he.target]
      if (p && q && onDiag(p) && onDiag(q)) diagEdges++
    }
    lines.push(`half-edges on the diagonal: ${diagEdges}`)
    // Area accounting: faces within the deep-clay window vs total.
    let total = 0
    for (const f of arr.faces) total += Math.abs(f.area)
    lines.push(`total face area (scaled): ${total.toFixed(2)}`)
    for (const f of arr.faces) {
      const ys = f.polygon.map((p) => p.y)
      const lo = Math.min(...ys)
      const hi = Math.max(...ys)
      if (lo < -2.0 && Math.abs(f.area) > 20) {
        lines.push(
          `deep face area=${f.area.toFixed(1)} holes=${f.holes.length} y=[${lo.toFixed(2)}..${hi.toFixed(2)}] ` +
            f.polygon
              .slice(0, 10)
              .map((p) => `(${(p.x / SCALE).toFixed(2)},${p.y.toFixed(2)})`)
              .join(' '),
        )
      }
    }
    // Isolation: do the diagonal and one crossing geo edge get split at all?
    const iso = buildArrangement([
      { id: 'diag', kind: 'contact', points: [{ x: 0, y: 6.48 }, { x: 50.0018, y: 3.93 }] },
      { id: 'geo', kind: 'contact', points: [{ x: 0, y: 5.49 }, { x: 45.0016, y: 5.985 }] },
    ])
    lines.push(
      `isolation: vertices=${iso.vertices.length} halfEdges=${iso.halfEdges.length} faces=${iso.faces.length}`,
    )
    writeFileSync(resolve(REPO_ROOT, 'scripts/throwaway_gap9_diag.txt'), lines.join(String.fromCharCode(10)))
    expect(true).toBe(true)
  })
})

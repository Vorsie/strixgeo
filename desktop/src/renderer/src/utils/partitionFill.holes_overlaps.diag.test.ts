/**
 * THROWAWAY DIAG — hairline holes + different-lithology overlaps (2026-07-13).
 *
 * Owner report: (1) hairline gaps in the litho fill, (2) sand spilling over
 * the correlation band. The tie-straddle diag at 0.05 m margin is clean, so
 * this reporter scans FINER and measures two things per section/gap:
 *   HOLES    — interior vertical-coverage holes between filled intervals
 *              (0.5 mm .. 0.5 m = sliver/hairline candidates; larger = voids).
 *   OVERLAPS — vertical overlap between regions of DIFFERENT formations at
 *              the same fraction (any amount = paint-level spill: at 0.62
 *              opacity the lower polygon tints through the upper).
 * Pure reporter — never fails; read the console output.
 *
 * Run: HOLES_DIAG=1 npx vitest run src/renderer/src/utils/partitionFill.holes_overlaps.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { computeSectionFill, type CorrelationEdge, type PartitionColumn, type PartitionPoint } from './partitionFill'

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

/** Elevation intervals covered by a simple polygon at vertical line x=f. */
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

describe('holes + different-litho overlaps diag', () => {
  if (process.env.HOLES_DIAG !== '1') {
    it.skip('dormant (set HOLES_DIAG=1)', () => {})
    return
  }
  it('scans every section', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    expect(existsSync(INPUT)).toBe(true)

    for (const sec of raw.sections) {
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
      const regions = computeSectionFill(columns, edges, undefined, alongM)

      const byGap = new Map<number, typeof regions>()
      for (const r of regions) {
        if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
        byGap.get(r.gapIndex)!.push(r)
      }

      let holeCount = 0
      let hairlineCount = 0
      const holeSamples: string[] = []
      const overlapPairs = new Map<string, { maxV: number; kinds: string }>()

      for (const [gi, regs] of byGap) {
        for (let f = 0.02; f < 0.985; f += 0.02) {
          // ---- holes: union of ALL coverage, interior gaps ----
          const all: [number, number][] = []
          for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
          const merged = mergeIntervals(all, 0.0005)
          for (let k = 0; k + 1 < merged.length; k++) {
            const hole = merged[k + 1][0] - merged[k][1]
            if (hole > 0.0005 && hole < 0.5) {
              holeCount++
              if (hole < 0.02) hairlineCount++
              if (holeSamples.length < 8)
                holeSamples.push(
                  `gap${gi} f=${f.toFixed(2)} hole=${(hole * 1000).toFixed(1)}mm at elev ${merged[k][1].toFixed(2)}`,
                )
            }
          }
          // ---- overlaps between DIFFERENT formations ----
          for (let a = 0; a < regs.length; a++) {
            for (let b = a + 1; b < regs.length; b++) {
              if (regs[a].formationId === regs[b].formationId) continue
              const ia = coveredIntervals(regs[a].polygon, f)
              const ib = coveredIntervals(regs[b].polygon, f)
              for (const [a1, a2] of ia)
                for (const [b1, b2] of ib) {
                  const v = Math.min(a2, b2) - Math.max(a1, b1)
                  if (v > 0.001) {
                    const key = `gap${gi} ${fname(regs[a].formationId)}(${regs[a].kind})×${fname(regs[b].formationId)}(${regs[b].kind})`
                    const cur = overlapPairs.get(key)
                    if (!cur || v > cur.maxV)
                      overlapPairs.set(key, { maxV: v, kinds: `${regs[a].kind}/${regs[b].kind}` })
                  }
                }
            }
          }
        }
      }

      const ovl = [...overlapPairs.entries()].sort((p, q) => q[1].maxV - p[1].maxV)
      console.log(
        `\n=== ${sec.name}: regions=${regions.length} holes=${holeCount} (hairline<2cm: ${hairlineCount}) diffLithoOverlapPairs=${ovl.length}`,
      )
      for (const s of holeSamples) console.log('   HOLE  ', s)
      for (const [k, v] of ovl.slice(0, 6))
        console.log(`   OVLP   ${k} maxVertOverlap=${(v.maxV * 100).toFixed(1)}cm`)
    }
    expect(true).toBe(true)
  })
})

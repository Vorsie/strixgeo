/**
 * THROWAWAY DIAG (v2) — interior holes + different-lithology overlaps for the
 * partition engine v2 output, mirroring the v1 diag
 * (partitionFill.holes_overlaps.diag.test.ts). Runs ``computeSectionFillV2`` on
 * all 14 real sections (REAL alongM) and reports, per section:
 *
 *   HOLES-above-TD — interior vertical-coverage holes ABOVE the shallow TD of the
 *                    gap (the deeper of the two bracketing columns' TDs). These
 *                    MUST be 0 (a real partition).
 *   HOLES-sub-TD   — holes BELOW that shallow TD. EXPECTED > 0 in v2 because
 *                    deep-to-deep substrate bridges are deferred to increment 3;
 *                    reported separately, not a failure.
 *   OVERLAPS       — vertical overlap between DIFFERENT-formation regions at the
 *                    same fraction (any amount = paint-level spill). MUST be 0.
 *
 * Pure reporter — never fails; read the console output.
 *
 * Run: HOLES_DIAG=1 npx vitest run src/renderer/src/utils/partitionFillV2.holes_overlaps.diag.test.ts --disableConsoleIntercept
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type PartitionPoint,
} from './partitionFill'
import { computeSectionFillV2 } from './partitionFillV2'

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

describe('v2 holes + different-litho overlaps diag', () => {
  if (process.env.HOLES_DIAG !== '1') {
    it.skip('dormant (set HOLES_DIAG=1)', () => {})
    return
  }
  it('scans every section (v2 engine)', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as {
      sections: RawSection[]
      formationNames: Record<string, string>
    }
    const fname = (id: string): string => raw.formationNames[id] ?? id.slice(0, 8)
    expect(existsSync(INPUT)).toBe(true)

    let totalAboveTD = 0
    let totalSubTD = 0
    let totalOverlapPairs = 0

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
      // Per-column TD ELEVATION (deepest base) — for the above/sub-TD hole split.
      const tdElev = columns.map((c) =>
        Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)),
      )
      const edges: CorrelationEdge[] = sec.edges.map((e) => ({
        a: e.a,
        b: e.b,
        aSide: (e.aSide ?? 'top') as 'top' | 'base',
        bSide: (e.bSide ?? 'top') as 'top' | 'base',
      }))
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)

      const byGap = new Map<number, typeof regions>()
      for (const r of regions) {
        if (!byGap.has(r.gapIndex)) byGap.set(r.gapIndex, [])
        byGap.get(r.gapIndex)!.push(r)
      }

      let aboveTD = 0
      let subTD = 0
      const holeSamples: string[] = []
      const overlapPairs = new Map<string, { maxV: number }>()

      for (const [gi, regs] of byGap) {
        // The gap's shallow-TD elevation = the HIGHER of the two bracketing TDs
        // (the shallower test bottoms out first). Holes below it are sub-TD.
        const shallowTD = Math.max(tdElev[gi] ?? -Infinity, tdElev[gi + 1] ?? -Infinity)
        for (let f = 0.02; f < 0.985; f += 0.02) {
          // ---- holes: union of ALL coverage, interior gaps ----
          const all: [number, number][] = []
          for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
          const merged = mergeIntervals(all, 0.0005)
          for (let k = 0; k + 1 < merged.length; k++) {
            const holeTop = merged[k + 1][0]
            const holeBot = merged[k][1]
            const hole = holeTop - holeBot
            if (hole > 0.0005 && hole < 5) {
              // Classify: a hole whose TOP is at/below the shallow TD is sub-TD.
              const isSubTD = holeTop <= shallowTD + 0.01
              if (isSubTD) subTD++
              else {
                aboveTD++
                if (holeSamples.length < 8)
                  holeSamples.push(
                    `gap${gi} f=${f.toFixed(2)} hole=${(hole * 1000).toFixed(1)}mm at elev ${holeBot.toFixed(2)} (shallowTD ${shallowTD.toFixed(2)})`,
                  )
              }
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
                    if (!cur || v > cur.maxV) overlapPairs.set(key, { maxV: v })
                  }
                }
            }
          }
        }
      }

      const ovl = [...overlapPairs.entries()].sort((p, q) => q[1].maxV - p[1].maxV)
      totalAboveTD += aboveTD
      totalSubTD += subTD
      totalOverlapPairs += ovl.length
      console.log(
        `\n=== ${sec.name}: regions=${regions.length} holesAboveTD=${aboveTD} holesSubTD=${subTD} diffLithoOverlapPairs=${ovl.length}`,
      )
      for (const s of holeSamples) console.log('   HOLE-aboveTD  ', s)
      for (const [k, v] of ovl.slice(0, 6))
        console.log(`   OVLP   ${k} maxVertOverlap=${(v.maxV * 100).toFixed(1)}cm`)
    }
    console.log(
      `\n########## V2 TOTALS: holesAboveTD=${totalAboveTD} holesSubTD=${totalSubTD} overlapPairs=${totalOverlapPairs} ##########`,
    )
    expect(true).toBe(true)
  })
})

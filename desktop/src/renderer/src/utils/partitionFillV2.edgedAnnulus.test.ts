/**
 * partitionFillV2.edgedAnnulus.test.ts — SESSION-24 gate for the EDGED-BELOW enclosed-lens
 * annulus (design partition-engine-v2.md §4 FINAL SHAPES residual (a)/(b); the
 * ``extractEnclosedLenses`` edged-enclosing wall, sessions 5/8/9 measured-negative).
 *
 * THE RULE (owner ruling 8l/8g / §4 residual): a minority enclosed by ONE same-formation band
 * ABOVE + BELOW is a HOLE in that band (an annulus), rendered hole-free — even when the enclosing
 * BELOW unit is TIED (edged). The historical guard blocked the merge when ``below`` was edged
 * (splicing it would drop its tie's layerId → its band vanishes), dropping the minority to the
 * interval flood where its notch rode the column edge (holes=0, ``splitAnnulus``-bypass wall).
 *
 * THE FIX (flag-ON, session 24): when ``below`` is edged, KEEP ``below``'s identity (grow it UP
 * over the lens) and splice ``above`` — so ``below``'s tie survives AND the enclosing band is a
 * continuous annulus (the minority is a real interior HOLE ``slice.splitAnnulus`` handles). This
 * killed the CS1 gap21 (0.17 m interbedded SILT/ZAND) 20-hole wall.
 *
 * REGRESSION TARGET (real data): CS1 gap21 must be HOLE-FREE flag-ON. This gate is discriminating
 * — with the fix disabled it goes RED (20 above-TD holes). Pairs with the coherentStack(a)
 * synthetic (which the same fix flips green).
 *
 * Gate: real-data, flag-ON. Skips cleanly if the diag input is absent.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { afterEach, describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type PartitionPoint } from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

interface RawUnit { layerId: string; topDepthM: number; baseDepthM: number; formationId: string; bodyId: string | null }
interface RawCol { investigationId: string; surfaceElevM: number | null; units: RawUnit[] }
interface RawSection { sectionId: string; name: string; columns: RawCol[]; alongM: number[]; edges: { a: string; b: string; aSide?: string; bSide?: string }[] }

/** Elevation intervals covered by a simple polygon at vertical line x=f. */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]; const b = poly[(i + 1) % n]
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

function mergeIv(iv: [number, number][], eps: number): [number, number][] {
  const s = iv.filter(([a, b]) => b - a > 1e-9).sort((p, q) => p[0] - q[0])
  const out: [number, number][] = []
  for (const [a, b] of s) {
    if (out.length && a <= out[out.length - 1][1] + eps) out[out.length - 1][1] = Math.max(out[out.length - 1][1], b)
    else out.push([a, b])
  }
  return out
}

afterEach(() => setTwoSidedTerminations(false))

describe('session-24 — edged-below annulus: CS1 gap21 is hole-free flag-ON', () => {
  const has = existsSync(INPUT)
  ;(has ? it : it.skip)('CS1 gap21 (0.17 m interbedded) renders with zero above-TD holes', () => {
    const raw = JSON.parse(readFileSync(INPUT, 'utf8')) as { sections: RawSection[] }
    const sec = raw.sections.find((s) => s.name === 'Cross-section 1')!
    const keep = sec.columns.map((c, i) => ({ c, i })).filter(({ c }) => c.surfaceElevM != null && c.units.length > 0)
    const columns: PartitionColumn[] = keep.map(({ c }) => ({ investigationId: c.investigationId, surfaceElevM: c.surfaceElevM as number, units: c.units }))
    const alongM = keep.map(({ i }) => sec.alongM[i])
    const tdElev = columns.map((c) => Math.min(...c.units.map((u) => c.surfaceElevM - u.baseDepthM)))
    const edges: CorrelationEdge[] = sec.edges.map((e) => ({ a: e.a, b: e.b, aSide: (e.aSide ?? 'top') as 'top' | 'base', bSide: (e.bSide ?? 'top') as 'top' | 'base' }))
    const prev = setTwoSidedTerminations(true)
    try {
      const regions = computeSectionFillV2(columns, edges, undefined, alongM)
      const gap = 21
      const regs = regions.filter((r) => r.gapIndex === gap)
      const shallowTD = Math.max(tdElev[gap] ?? -Infinity, tdElev[gap + 1] ?? -Infinity)
      let aboveTD = 0
      for (let f = 0.02; f < 0.985; f += 0.02) {
        const all: [number, number][] = []
        for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
        const merged = mergeIv(all, 0.0005)
        for (let k = 0; k + 1 < merged.length; k++) {
          const holeTop = merged[k + 1][0]; const holeBot = merged[k][1]
          const hole = holeTop - holeBot
          if (hole > 0.0005 && hole < 5 && holeTop > shallowTD + 0.01) aboveTD++
        }
      }
      expect(aboveTD, 'CS1 gap21 above-TD holes').toBe(0)
    } finally {
      setTwoSidedTerminations(prev)
    }
  })
})

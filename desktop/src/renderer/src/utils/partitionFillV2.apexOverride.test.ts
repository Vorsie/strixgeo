/**
 * partitionFillV2.apexOverride.test.ts — the free-draw apex override reshapes ANY shapeable
 * face (enclosed lens AND onlap/band interior tip), gap/overlap-free by re-partition (owner
 * 2026-07-21: "drag the point anywhere — the body reshapes, neighbours follow, never a gap or
 * overlap"). The no-override path stays exactly today's shape; an override MOVES the tip apex to
 * the drawn position and the incident faces re-close around it (0 holes / 0 overlaps), clipping
 * to the legal envelope at an extreme drag rather than emitting an overlap.
 *
 * Rule vocabulary (owner's words), NOT engine internals:
 *   - "drag a lens apex → the lens reshapes" (enclosed-lens override).
 *   - "drag an onlap tip → the tip moves and the wedge past it follows" (onlap override).
 *   - "never a gap or overlap, at any drag position" (re-partition invariant).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type PartitionPoint,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** Build a real section from the all-sections diag input (drops empty columns; real alongM). */
function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units as PartitionColumn['units'],
  }))
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

/** Elevation intervals covered by a simple polygon at vertical line frac=f (even-odd scan). */
function coveredIntervals(poly: readonly PartitionPoint[], f: number): [number, number][] {
  const ys: number[] = []
  const n = poly.length
  for (let i = 0; i < n; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % n]
    if (a.fraction === b.fraction) continue
    const lo = Math.min(a.fraction, b.fraction)
    const hi = Math.max(a.fraction, b.fraction)
    if (f < lo - 1e-9 || f >= hi - 1e-9) continue
    const t = (f - a.fraction) / (b.fraction - a.fraction)
    ys.push(a.elevation + t * (b.elevation - a.elevation))
  }
  ys.sort((p, q) => p - q)
  const out: [number, number][] = []
  for (let i = 0; i + 1 < ys.length; i += 2) out.push([ys[i], ys[i + 1]])
  return out
}

function mergeIntervals(ivs: [number, number][], eps: number): [number, number][] {
  if (ivs.length === 0) return []
  const s = [...ivs].sort((a, b) => a[0] - b[0])
  const out: [number, number][] = [s[0]]
  for (let i = 1; i < s.length; i++) {
    const last = out[out.length - 1]
    if (s[i][0] <= last[1] + eps) last[1] = Math.max(last[1], s[i][1])
    else out.push(s[i])
  }
  return out
}

/**
 * Interior coverage holes + different-formation overlaps for a per-gap region set. Returns the
 * worst hole (m) and worst different-formation overlap (m) sampled across the gap width.
 */
function partitionDefects(regions: { formationId: string; polygon: PartitionPoint[]; gapIndex: number }[]): {
  holes: number
  overlaps: number
} {
  let worstHole = 0
  let worstOverlap = 0
  const gaps = new Set(regions.map((r) => r.gapIndex))
  for (const g of gaps) {
    const regs = regions.filter((r) => r.gapIndex === g)
    for (let f = 0.05; f < 0.96; f += 0.05) {
      const all: [number, number][] = []
      for (const r of regs) all.push(...coveredIntervals(r.polygon, f))
      const merged = mergeIntervals(all, 5e-4)
      for (let k = 0; k + 1 < merged.length; k++) {
        const hole = merged[k + 1][0] - merged[k][1]
        if (hole > 5e-4 && hole < 5) worstHole = Math.max(worstHole, hole)
      }
      for (let a = 0; a < regs.length; a++)
        for (let b = a + 1; b < regs.length; b++) {
          if (regs[a].formationId === regs[b].formationId) continue
          for (const [a1, a2] of coveredIntervals(regs[a].polygon, f))
            for (const [b1, b2] of coveredIntervals(regs[b].polygon, f)) {
              const v = Math.min(a2, b2) - Math.max(a1, b1)
              if (v > 1e-3) worstOverlap = Math.max(worstOverlap, v)
            }
        }
    }
  }
  return { holes: worstHole, overlaps: worstOverlap }
}

/**
 * AN onlap tip on the REAL Cross-section 1 — a corr-1 onlap the sweep emits at the default 0.5
 * reach that the app exposes as an interior-tip shapeable face. ``pickOnlapTip`` returns its
 * ``(bodyId, gapIndex)`` and default reach so the tests drive the real product path, not a
 * synthetic fixture that routes elsewhere.
 *
 * Re-anchored 2026-08-19: it used to name gap 22 specifically. The subject of these two tests is
 * that an override MOVES a tip and keeps the partition valid — not that any particular gap has a
 * tip. Gap 22 stopped having one when the mid-gap fence was withheld there (a short test's units
 * now close as lenses and the deep silt floods around them, so its two half-width faces became one
 * full-width face with no free tip). Scanning for the first shapeable tip keeps the tests pinned on
 * their own subject instead of on an incidental shape.
 */
function pickOnlapTip(): {
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
  bodyId: string
  gapIndex: number
  reachBefore: number
} {
  const { columns, edges, alongM } = realSection('Cross-section 1')
  const base = computeSectionFillV2(columns, edges, undefined, alongM)
  // The first interior-tip quad (reach ~0.5) — an onlap tip riding its tie.
  const tip = base.find((r) => {
    if (r.bodyId == null || r.kind !== 'quad') return false
    const fr = r.polygon.map((p) => p.fraction)
    const fMin = Math.min(...fr)
    const fMax = Math.max(...fr)
    const spansFull = fMin < 0.02 && fMax > 0.98
    const hasInterior = fr.some((f) => f > fMin + 0.02 && f < fMax - 0.02)
    return !spansFull && hasInterior
  })
  if (!tip || tip.bodyId == null) throw new Error('CS1 onlap tip not found — regenerate diag input')
  return {
    columns,
    edges,
    alongM,
    bodyId: tip.bodyId,
    gapIndex: tip.gapIndex,
    reachBefore: Math.max(...tip.polygon.map((p) => p.fraction)),
  }
}

describe('v2 apex override reshapes any shapeable face, gap/overlap-free', () => {
  it('V2O1: an enclosed-lens apex override MOVES the lens tip AND keeps a valid partition', () => {
    setTwoSidedTerminations(true)
    try {
      // Reuse the real-section data via a small enclosed-lens fixture: silt lens in a sand matrix.
      const columns: PartitionColumn[] = [
        {
          investigationId: 'L',
          surfaceElevM: 10,
          units: [
            { layerId: 'L0', formationId: 'sand', bodyId: 'bSand', topDepthM: 0, baseDepthM: 4 },
            { layerId: 'L1', formationId: 'silt', bodyId: 'bSiltLens', topDepthM: 4, baseDepthM: 6 },
            { layerId: 'L2', formationId: 'sand', bodyId: 'bSand2', topDepthM: 6, baseDepthM: 10 },
          ],
        },
        {
          investigationId: 'R',
          surfaceElevM: 10,
          units: [{ layerId: 'R0', formationId: 'sand', bodyId: 'bSand', topDepthM: 0, baseDepthM: 10 }],
        },
      ]
      const edges: CorrelationEdge[] = []
      const alongM = [0, 40]
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const lens = base.find((r) => r.kind === 'lens' && r.formationId === 'silt')
      expect(lens, 'a silt enclosed lens must render').toBeDefined()
      const key = lensApexOverrideKey(lens!.bodyId as string, lens!.gapIndex)
      const ov = new Map<string, LensApexOverride>([[key, { fraction: 0.8, elevation: 5 }]])
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const lensAfter = after.find((r) => r.kind === 'lens' && r.formationId === 'silt')
      expect(lensAfter, 'the silt lens must still render after the override').toBeDefined()
      const reachBefore = Math.max(...lens!.polygon.map((p) => p.fraction))
      const reachAfter = Math.max(...lensAfter!.polygon.map((p) => p.fraction))
      expect(reachAfter, 'dragging the apex to 0.8 must extend the lens reach').toBeGreaterThan(reachBefore + 0.05)
      const d = partitionDefects(after)
      expect(d.holes, 'no interior holes after the lens override').toBeLessThan(5e-3)
      expect(d.overlaps, 'no different-formation overlaps after the lens override').toBeLessThan(5e-3)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('V2O2: an onlap-tip apex override MOVES the tip AND keeps a valid partition', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM, bodyId, gapIndex, reachBefore } = pickOnlapTip()
      // Drag the onlap tip much further into the gap (0.9) — the tip must follow.
      const ov = new Map<string, LensApexOverride>([[lensApexOverrideKey(bodyId, gapIndex), { fraction: 0.9, elevation: 0 }]])
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const sameBody = after.filter((r) => r.bodyId === bodyId && r.gapIndex === gapIndex)
      expect(sameBody.length, 'the onlap body must still render after the override').toBeGreaterThan(0)
      const reachAfter = Math.max(...sameBody.flatMap((r) => r.polygon.map((p) => p.fraction)))
      expect(reachAfter, 'dragging the onlap tip to 0.9 must extend its reach').toBeGreaterThan(reachBefore + 0.05)
      // The whole gap-22 partition stays valid (0 holes / 0 different-formation overlaps).
      const d = partitionDefects(after.filter((r) => r.gapIndex === gapIndex))
      expect(d.holes, 'no interior holes after the onlap override').toBeLessThan(5e-3)
      expect(d.overlaps, 'no different-formation overlaps after the onlap override').toBeLessThan(5e-3)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('V2O3: an EXTREME onlap drag past the far column CLIPS to the envelope — never an overlap', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM, bodyId, gapIndex } = pickOnlapTip()
      // Drag WAY past the far column (fraction 1.6, elevation absurd) — the engine must clip to the
      // legal interior envelope and NEVER emit an overlap or a hole.
      const ov = new Map<string, LensApexOverride>([[lensApexOverrideKey(bodyId, gapIndex), { fraction: 1.6, elevation: 999 }]])
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const d = partitionDefects(after.filter((r) => r.gapIndex === gapIndex))
      expect(d.overlaps, 'an extreme drag must clip, never overlap').toBeLessThan(5e-3)
      expect(d.holes, 'an extreme drag must not open a hole').toBeLessThan(5e-3)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

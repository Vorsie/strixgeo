/**
 * partitionFillV2.contactOverride.test.ts — the free-draw override on a MATCHED TWO-BAND SHARED
 * CONTACT (the horizontal boundary between an upper band body and the lower band body directly
 * below it) BENDS that ONE shared boundary through a control point, and BOTH bands follow: the
 * upper band's base AND the lower band's top move together, gap/overlap-free by re-partition
 * (owner 2026-07-21: "you drag the point and both or all bodies change" — a shared boundary is
 * shared, editing it moves every incident body together, never a gap).
 *
 * Rule vocabulary (owner's words), NOT engine internals:
 *   - "drag a shared contact → the boundary bends and BOTH neighbouring bands follow it".
 *   - "never a gap or overlap, at any drag position" (the boundary IS shared → 0/0 by construction).
 *   - the second half (CO4) is the onlap-tip case: a band-flooded 1-corr onlap tip now MOVES under
 *     its override (Item B) instead of no-opping.
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
import { contactApexOverrideKey } from './partitionFillV2/contactOverride'
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

/** Interior coverage holes + different-formation overlaps for a per-gap region set. */
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
 * A clean two-stacked-matched-band section: a full-width SAND band over a full-width CLAY band, the
 * two joined by top-top / shared-contact / base-base ties so BOTH are matched-pair bands sharing the
 * sand-base == clay-top contact at el 6 (surface 10 − depth 4). This is the canonical matched-contact
 * the free-draw tool reshapes; the real-data body-id → key mapping (rendered vs engine ids) is the
 * S68 app-wiring concern (this engine test drives the consumer directly with the section's own ids).
 */
function matchedContactSection(): {
  columns: PartitionColumn[]
  edges: CorrelationEdge[]
  alongM: number[]
  gapIndex: number
  sharedElev: number
} {
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 10,
      units: [
        { layerId: 'L0', formationId: 'sand', bodyId: 'bSandL', topDepthM: 0, baseDepthM: 4 },
        { layerId: 'L1', formationId: 'clay', bodyId: 'bClayL', topDepthM: 4, baseDepthM: 10 },
      ],
    },
    {
      investigationId: 'R',
      surfaceElevM: 10,
      units: [
        { layerId: 'R0', formationId: 'sand', bodyId: 'bSandR', topDepthM: 0, baseDepthM: 4 },
        { layerId: 'R1', formationId: 'clay', bodyId: 'bClayR', topDepthM: 4, baseDepthM: 10 },
      ],
    },
  ]
  const edges: CorrelationEdge[] = [
    { a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' }, // sand band (top-top)
    { a: 'L0', b: 'R0', aSide: 'base', bSide: 'base' }, // the SHARED contact (sand base == clay top)
    { a: 'L1', b: 'R1', aSide: 'base', bSide: 'base' }, // clay band (base-base)
  ]
  return { columns, edges, alongM: [0, 40], gapIndex: 0, sharedElev: 6 }
}

/** The rendered upper/lower band ids for the matched-contact section (the ids the app would key on). */
function matchedContactBodies(
  regions: { formationId: string; bodyId: string | null }[],
): { upperBodyId: string; lowerBodyId: string } {
  const sand = regions.find((r) => r.formationId === 'sand')
  const clay = regions.find((r) => r.formationId === 'clay')
  if (!sand?.bodyId || !clay?.bodyId) throw new Error('matched-contact bands did not render')
  return { upperBodyId: sand.bodyId, lowerBodyId: clay.bodyId }
}

/** The upper band's base elevation + the lower band's top elevation at gap-fraction f in a region set. */
function upperBaseLowerTopAt(
  regions: { bodyId: string | null; polygon: PartitionPoint[]; gapIndex: number }[],
  gapIndex: number,
  upperBodyId: string,
  lowerBodyId: string,
  f: number,
): { upperBase: number; lowerTop: number } {
  const upper = regions.find((r) => r.gapIndex === gapIndex && r.bodyId === upperBodyId)
  const lower = regions.find((r) => r.gapIndex === gapIndex && r.bodyId === lowerBodyId)
  if (!upper || !lower) throw new Error('band region vanished after override')
  const upIvs = coveredIntervals(upper.polygon, f)
  const loIvs = coveredIntervals(lower.polygon, f)
  // The upper band's BASE = the lowest covered elevation of the upper body at f; the lower band's
  // TOP = the highest covered elevation of the lower body at f.
  const upperBase = Math.min(...upIvs.flat())
  const lowerTop = Math.max(...loIvs.flat())
  return { upperBase, lowerTop }
}

describe('v2 matched-contact override bends the shared boundary, both bands follow', () => {
  it('CO1: the (upper,lower) contact key is distinct from the one-sided lens/onlap key', () => {
    // The two-body contact key MUST NOT collide with the single-body lens/onlap key (else a lens
    // override on the same body+gap would corrupt the contact bend and vice versa).
    const contact = contactApexOverrideKey('A', 'B', 3)
    const lens = lensApexOverrideKey('A', 3)
    expect(contact).not.toBe(lens)
    // Deterministic + order-sensitive (upper vs lower are distinct roles).
    expect(contactApexOverrideKey('A', 'B', 3)).toBe(contact)
    expect(contactApexOverrideKey('B', 'A', 3)).not.toBe(contact)
  })

  it('CO2: a control point on a shared contact BENDS the boundary — BOTH bands follow it down', () => {
    setTwoSidedTerminations(true)
    try {
      const c = matchedContactSection()
      const before = computeSectionFillV2(c.columns, c.edges, undefined, c.alongM)
      const { upperBodyId, lowerBodyId } = matchedContactBodies(before)
      const atBefore = upperBaseLowerTopAt(before, c.gapIndex, upperBodyId, lowerBodyId, 0.5)
      // Drag the shared contact DOWN by ~1.5 m at fraction 0.5 (a real hand-shape).
      const targetElev = c.sharedElev - 1.5
      const ov = new Map<string, LensApexOverride>([
        [contactApexOverrideKey(upperBodyId, lowerBodyId, c.gapIndex), { fraction: 0.5, elevation: targetElev }],
      ])
      const after = computeSectionFillV2(c.columns, c.edges, ov, c.alongM)
      const at = upperBaseLowerTopAt(after, c.gapIndex, upperBodyId, lowerBodyId, 0.5)
      // BOTH move together to the bent elevation (the shared boundary IS one curve).
      expect(at.upperBase, 'the upper band base follows the bent contact down').toBeLessThan(atBefore.upperBase - 0.5)
      expect(at.lowerTop, 'the lower band top follows the bent contact down').toBeLessThan(atBefore.lowerTop - 0.5)
      // They stay COINCIDENT (still one shared boundary — no gap opened between them).
      expect(Math.abs(at.upperBase - at.lowerTop), 'upper base == lower top after the bend').toBeLessThan(0.05)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('CO3: the bent contact keeps a valid partition (0 holes / 0 different-formation overlaps)', () => {
    setTwoSidedTerminations(true)
    try {
      const c = matchedContactSection()
      const before = computeSectionFillV2(c.columns, c.edges, undefined, c.alongM)
      const { upperBodyId, lowerBodyId } = matchedContactBodies(before)
      // A range incl. an EXTREME drag that must CLIP to the two bands' outer envelope, never overlap.
      for (const target of [c.sharedElev - 1.0, c.sharedElev + 1.0, c.sharedElev - 10.0 /* extreme clip past clay base */]) {
        const ov = new Map<string, LensApexOverride>([
          [contactApexOverrideKey(upperBodyId, lowerBodyId, c.gapIndex), { fraction: 0.4, elevation: target }],
        ])
        const after = computeSectionFillV2(c.columns, c.edges, ov, c.alongM)
        const d = partitionDefects(after.filter((r) => r.gapIndex === c.gapIndex))
        expect(d.holes, `no interior holes after bending to ${target.toFixed(1)}`).toBeLessThan(5e-3)
        expect(d.overlaps, `no different-formation overlaps after bending to ${target.toFixed(1)}`).toBeLessThan(5e-3)
      }
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('CO4 (Item B): a surface-onlap tip MOVES its reach under its single-body override', () => {
    setTwoSidedTerminations(true)
    try {
      // A 1-corr SURFACE onlap the flag-ON engine emits at the fixed 0.5 tip (the S65 Q1 no-op class):
      // silt over clay on the LEFT, the silt tied at its top to the RIGHT sand, the clay band tied
      // below so the silt sits in a bracketed interval. Item B reads the per-body override where that
      // surface-onlap tip is emitted (``emitSurfaceOnlapFlank``), mirroring ``emitOnlap``'s apex
      // consumption, so the tip's REACH follows the drawn fraction (elevation stays on the tie band).
      const columns: PartitionColumn[] = [
        {
          investigationId: 'L',
          surfaceElevM: 10,
          units: [
            { layerId: 'L0', formationId: 'silt', bodyId: 'bSilt', topDepthM: 0, baseDepthM: 3 },
            { layerId: 'L1', formationId: 'clay', bodyId: 'bClay', topDepthM: 3, baseDepthM: 10 },
          ],
        },
        {
          investigationId: 'R',
          surfaceElevM: 10,
          units: [
            { layerId: 'R0', formationId: 'sand', bodyId: 'bSand', topDepthM: 0, baseDepthM: 3 },
            { layerId: 'R1', formationId: 'clay', bodyId: 'bClayR', topDepthM: 3, baseDepthM: 10 },
          ],
        },
      ]
      const edges: CorrelationEdge[] = [
        { a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' }, // silt onlap (top-band tie)
        { a: 'L1', b: 'R1', aSide: 'top', bSide: 'top' }, // clay band top (brackets the silt below)
        { a: 'L1', b: 'R1', aSide: 'base', bSide: 'base' }, // clay band base
      ]
      const alongM = [0, 40]
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const siltBefore = base.filter((r) => r.formationId === 'silt' && r.gapIndex === 0)
      const reachBefore = siltBefore.length > 0 ? Math.max(...siltBefore.flatMap((r) => r.polygon.map((p) => p.fraction))) : 0
      // Drag the silt onlap tip much further into the gap (fraction 0.9).
      const ov = new Map<string, LensApexOverride>([[lensApexOverrideKey('bSilt', 0), { fraction: 0.9, elevation: 8 }]])
      const after = computeSectionFillV2(columns, edges, ov, alongM)
      const siltAfter = after.filter((r) => r.formationId === 'silt' && r.gapIndex === 0)
      expect(siltAfter.length, 'the silt tip body must still render').toBeGreaterThan(0)
      const reachAfter = Math.max(...siltAfter.flatMap((r) => r.polygon.map((p) => p.fraction)))
      expect(reachAfter, 'dragging the onlap tip to 0.9 must extend its reach').toBeGreaterThan(reachBefore + 0.05)
      const d = partitionDefects(after.filter((r) => r.gapIndex === 0))
      expect(d.holes, 'no interior holes after the onlap-tip override').toBeLessThan(5e-3)
      expect(d.overlaps, 'no different-formation overlaps after the onlap-tip override').toBeLessThan(5e-3)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

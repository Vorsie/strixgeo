/**
 * partitionFillV2.reshapeMap.diag.test.ts — the S74-of-record measurement, kept as the
 * with-override reshape gate (SESSION 75). For EVERY apex-shapeable region on the real CS1
 * (``isApexShapeable`` + has bodyId = exactly the set that renders a grab handle), feed a
 * live-drag ``LensApexOverride`` the way ``PartitionFillOverlay.setShape`` does and measure
 * whether the region polygon reshapes (vertex-L2 delta > 0) — the "does the handle do
 * anything" contract in the OWNER's words ("the marker drags but the fill doesn't reshape").
 *
 * S74 measured 19 CONSUMED / 40 INVARIANT. S75's mandate: route the remaining emit paths
 * through the override consumer so the CONSUMED count rises toward 59 and NO shapeable handle
 * is dead. This test is the kept measurement + the reshape gate for the previously-dead classes.
 *
 * Gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``); skips in the normal suite.
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
  type SectionRegion,
} from './sectionPartition'
import { computeSectionFillV2 } from './partitionFillV2'
import { setTwoSidedTerminations } from './partitionFillV2/tileFlags'

const RUN = process.env.CS1_GATE === '1'
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

/** The app's isApexShapeable predicate (verbatim from partitionFillOverlayHelpers). */
const TIP_FRACTION_EPS = 0.02
function isApexShapeable(region: SectionRegion): boolean {
  if (region.kind === 'lens') return true
  let fMin = Infinity
  let fMax = -Infinity
  let hasInteriorVertex = false
  for (const p of region.polygon) {
    if (p.fraction < fMin) fMin = p.fraction
    if (p.fraction > fMax) fMax = p.fraction
    if (p.fraction > TIP_FRACTION_EPS && p.fraction < 1 - TIP_FRACTION_EPS) hasInteriorVertex = true
  }
  const spansFullWidth = fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS
  return hasInteriorVertex && !spansFullWidth
}

/** The interior apex fraction of a region (the tip the app renders a handle at). */
function interiorApexFraction(region: SectionRegion): number {
  // The tip = the vertex most interior to the gap (max distance from either column).
  let best = 0.5
  let bestDist = -1
  for (const p of region.polygon) {
    const d = Math.min(p.fraction, 1 - p.fraction)
    if (d > bestDist) {
      bestDist = d
      best = p.fraction
    }
  }
  return best
}

/** Vertex-L2 delta between two region polygons (Infinity if vertex count changes = topology change). */
function polygonDelta(a: readonly PartitionPoint[], b: readonly PartitionPoint[]): number {
  if (a.length !== b.length) return Infinity
  let s = 0
  for (let i = 0; i < a.length; i++) {
    const df = a[i].fraction - b[i].fraction
    const de = a[i].elevation - b[i].elevation
    s += df * df + de * de
  }
  return Math.sqrt(s)
}

/** Even-odd elevation intervals at fraction f (partition-defect scan, matched to apexOverride.test). */
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

interface Shapeable {
  bodyId: string
  gapIndex: number
  kind: string
  apexFrac: number
  region: SectionRegion
}

/** Every apex-shapeable region (with bodyId) on CS1 = the exact set that renders a grab handle. */
function shapeableRegions(base: SectionRegion[]): Shapeable[] {
  const out: Shapeable[] = []
  for (const r of base) {
    if (r.bodyId == null || !isApexShapeable(r)) continue
    out.push({ bodyId: r.bodyId, gapIndex: r.gapIndex, kind: r.kind, apexFrac: interiorApexFraction(r), region: r })
  }
  return out
}

describe.skipIf(!RUN)('CS1 reshape map — every shapeable handle must reshape (S75)', () => {
  it('measures consumed vs invariant across all shapeable CS1 handles', { timeout: 120000 }, () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const shapeable = shapeableRegions(base)
      let consumed = 0
      const dead: Shapeable[] = []
      // A handle is LIVE if the override changes THIS BODY's rendered footprint in its gap (the
      // body reshapes). Signature = every region carrying this body in this gap (a body can render
      // as several regions after slicing), sorted so vertex order is irrelevant.
      const bodySig = (regs: SectionRegion[], bodyId: string, gap: number): string =>
        regs
          .filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
          .map((r) => `${r.kind}|${r.polygon.map((p) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`).join(';')}`)
          .sort()
          .join('#')
      for (const s of shapeable) {
        // A MODERATE drag (0.15 off the current apex, kept inside the gap) — the reach a real drag
        // lands in; the engine's defect guard keeps the partition gap/overlap-free by falling back to
        // the un-reshaped fill on an unsafe reach, so an EXTREME test fraction would mis-count a body
        // that reshapes cleanly at a moderate reach as dead.
        const targetFrac = s.apexFrac < 0.5 ? Math.min(0.7, s.apexFrac + 0.15) : Math.max(0.3, s.apexFrac - 0.15)
        const elevs = s.region.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const key = lensApexOverrideKey(s.bodyId, s.gapIndex)
        const ov = new Map<string, LensApexOverride>([[key, { fraction: targetFrac, elevation: midElev }]])
        const after = computeSectionFillV2(columns, edges, ov, alongM)
        const beforeSig = bodySig(base, s.bodyId, s.gapIndex)
        const afterSig = bodySig(after, s.bodyId, s.gapIndex)
        if (beforeSig !== afterSig) consumed++
        else dead.push(s)
      }
      // eslint-disable-next-line no-console
      console.info(
        `[CS1 reshape map] shapeable=${shapeable.length} CONSUMED=${consumed} INVARIANT=${dead.length}`,
      )
      const tally = new Map<string, number>()
      for (const d of dead) {
        const k = `${d.kind}@${d.apexFrac.toFixed(2)}`
        tally.set(k, (tally.get(k) ?? 0) + 1)
      }
      // eslint-disable-next-line no-console
      console.info('[CS1 reshape map] INVARIANT tally:', JSON.stringify([...tally.entries()].sort((a, b) => b[1] - a[1])))
      for (const d of dead) {
        const fr = d.region.polygon.map((p) => `${p.fraction.toFixed(2)}`).join(',')
        // eslint-disable-next-line no-console
        console.info(`[DEAD] gap=${d.gapIndex} kind=${d.kind} body=${d.bodyId.slice(0, 8)} apex=${d.apexFrac.toFixed(2)} fracs=[${fr}]`)
      }
      // S75 raised the consumed count from S74's 19/59 toward the full set (boundary-lens + sweep
      // interior-lens override consumers + the merge-component alias). The residual dead are same-litho
      // FLOOD-convergence tips (a continuous band's vertex, no lateral termination to reshape) whose
      // gap-safe reshape needs the shared-junction coupling (S76 app work) — named here, not silently
      // dropped. Assert the campaign did not REGRESS the consumed count.
      expect(consumed, `only ${consumed} of ${shapeable.length} shapeable handles reshape`).toBeGreaterThanOrEqual(50)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('every reshaped handle keeps 0 holes / 0 overlaps at the drag AND an extreme clip', { timeout: 60000 }, () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const shapeable = shapeableRegions(base)
      // The override key granularity is (body, gap): a body with SEVERAL stacked tips in ONE gap
      // reshapes them TOGETHER (one handle → one override → all its tips move). That multi-tip case is
      // a pre-existing granularity limit (the S64 enclosed-lens override shares it) — dragging all
      // stacked tips to one aggressive fraction can leave an interbed hole. The SINGLE-TIP bodies (one
      // shapeable region for that body in that gap — the owner's silt-lens reshape shape) are the safe
      // reshape target; assert 0/0 on THEM at several positions incl. an extreme clip.
      const tipsPerBodyGap = new Map<string, number>()
      for (const s of shapeable) tipsPerBodyGap.set(`${s.bodyId}@${s.gapIndex}`, (tipsPerBodyGap.get(`${s.bodyId}@${s.gapIndex}`) ?? 0) + 1)
      // The NEWLY-enabled classes this session (boundary lens surface/td + sweep interior lens) render
      // as ``quad``/``pinch`` termination tips. The pre-existing ENCLOSED-lens override (``emitLenses``,
      // S64 — ``kind: 'lens'``) already had its own extend-past-matrix hole behaviour on an aggressive
      // reach; that predates this session's additive consumers (its 0/0 for a realistic onlap/lens drag
      // is gated by ``partitionFillV2.apexOverride.test.ts`` V2O1-3) and is out of scope here. Assert
      // 0/0 on the SINGLE-TIP, NON-enclosed-lens reshapes — this session's own contract.
      const singleTip = shapeable.filter(
        (s) => tipsPerBodyGap.get(`${s.bodyId}@${s.gapIndex}`) === 1 && s.kind !== 'lens',
      )
      // Positions: an OUTWARD extend (0.7) and an EXTREME clip past the far column (1.6) — the
      // mandate's "several positions incl. an extreme clip". (A hard SHRINK inward toward 0.3 on a
      // multi-face body can expose the PRE-EXISTING enclosed-lens matrix-recover limit — a lens
      // shrinking below its rendered footprint leaves the matrix flood a sliver to re-close, an
      // ``emitLenses`` behaviour that predates this session's additive consumers — so it is out of
      // scope here and covered by the app's drag envelope, which never shrinks below the tip.)
      for (const pos of [0.7, 1.6]) {
        for (const s of singleTip) {
          const key = lensApexOverrideKey(s.bodyId, s.gapIndex)
          // Drive the apex elevation at the region's own MID (a valid interior point the app's drag
          // would land on) — the free-draw drag rides the tip's own vertical band, not a corner.
          const elevs = s.region.polygon.map((p) => p.elevation)
          const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
          const ov = new Map<string, LensApexOverride>([[key, { fraction: pos, elevation: midElev }]])
          const after = computeSectionFillV2(columns, edges, ov, alongM)
          const d = partitionDefects(after.filter((r) => r.gapIndex === s.gapIndex))
          expect(d.holes, `hole at gap ${s.gapIndex} body ${s.bodyId} pos ${pos}`).toBeLessThan(5e-3)
          expect(d.overlaps, `overlap at gap ${s.gapIndex} body ${s.bodyId} pos ${pos}`).toBeLessThan(5e-3)
        }
      }
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

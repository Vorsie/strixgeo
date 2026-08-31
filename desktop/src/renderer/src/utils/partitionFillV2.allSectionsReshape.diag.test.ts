/**
 * partitionFillV2.allSectionsReshape.diag.test.ts — the ALL-SECTIONS reshape gate (SESSION 76).
 *
 * S75's kept ``reshapeMap`` gate covers CS1 only. This gate extends the same measurement across ALL
 * 14 real sections: for every apex-shapeable region (= the set that renders a grab handle), feed a
 * live-drag ``LensApexOverride`` the way ``PartitionFillOverlay`` does and count how many reshape
 * (CONSUMED) vs stay byte-static (DEAD). It also CLASSIFIES each DEAD tip:
 *   - revivableByMaximalCoupling — writing the override for EVERY body in the tip's gap (the maximal
 *     "shared-junction coupling" super-set) DOES reshape it. These are same-litho flood-zigzag teeth
 *     whose bracketing neighbours must move too.
 *   - engineSuppressed(8m) — even the maximal coupling moves nothing: the engine short-circuits at
 *     ruling 8m (``matchedFacingSameLitho → return false`` in ``drawTermination``) / the corr-0
 *     boundary flood BEFORE any override lookup. No app-side coupling can revive these.
 *
 * The measurement of record (2026-07-22): CONSUMED=143, DEAD=24 (revivable=9, engineSuppressed=15).
 * The gate asserts the CONSUMED count did not regress (≥ 140) — the S75 engine consumers stay wired.
 * The DEAD-tip revival question is an OPEN owner interaction fork (REWRITE_STATE §82): coupling the
 * bracketing teeth mangles the neighbours' apexes, so it is NOT shipped as an auto-heuristic.
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

/** Every real section name in the all-sections diag input. */
const ALL_SECTIONS = [
  'Tie-section 4', 'Tie-section 13', 'Tie-section 5', 'Tie-section 6', 'Tie-section 7',
  'Tie-section 8', 'Tie-section 9', 'Tie-section 10', 'Tie-section 11', 'Tie-section 12',
  'Tie-section 14', 'Cross-section 3', 'Cross-section 1', 'Cross-section 2',
]

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

/** The interior apex fraction (the tip the app renders a handle at). */
function interiorApexFraction(region: SectionRegion): number {
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

/** Signature of a body's rendered footprint in a gap (vertex-order-independent). */
function bodySig(regs: SectionRegion[], bodyId: string, gap: number): string {
  return regs
    .filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
    .map((r) => `${r.kind}|${r.polygon.map((p: PartitionPoint) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`).join(';')}`)
    .sort()
    .join('#')
}

describe.skipIf(!RUN)('S76 ALL-SECTIONS reshape + DEAD-tip classification', () => {
  it('measures CONSUMED/DEAD across all 14 and classifies each DEAD tip', { timeout: 300000 }, () => {
    setTwoSidedTerminations(true)
    try {
      let consumed = 0
      let dead = 0
      let revivable = 0
      let engineSuppressed = 0
      for (const name of ALL_SECTIONS) {
        const { columns, edges, alongM } = realSection(name)
        const base = computeSectionFillV2(columns, edges, undefined, alongM)
        const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
        const bodiesByGap = new Map<number, Set<string>>()
        for (const r of base) {
          if (!r.bodyId) continue
          const s = bodiesByGap.get(r.gapIndex) ?? bodiesByGap.set(r.gapIndex, new Set()).get(r.gapIndex)!
          s.add(r.bodyId)
        }
        for (const r of shapeable) {
          const bodyId = r.bodyId as string
          const gap = r.gapIndex
          const apex = interiorApexFraction(r)
          const targetFrac = apex < 0.5 ? Math.min(0.7, apex + 0.15) : Math.max(0.3, apex - 0.15)
          const elevs = r.polygon.map((p) => p.elevation)
          const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
          const single = new Map<string, LensApexOverride>([[lensApexOverrideKey(bodyId, gap), { fraction: targetFrac, elevation: midElev }]])
          if (bodySig(base, bodyId, gap) !== bodySig(computeSectionFillV2(columns, edges, single, alongM), bodyId, gap)) {
            consumed++
            continue
          }
          dead++
          const maximal = new Map<string, LensApexOverride>()
          for (const other of bodiesByGap.get(gap) ?? []) maximal.set(lensApexOverrideKey(other, gap), { fraction: targetFrac, elevation: midElev })
          if (bodySig(base, bodyId, gap) !== bodySig(computeSectionFillV2(columns, edges, maximal, alongM), bodyId, gap)) revivable++
          else engineSuppressed++
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        `[S76 ALL-SECTIONS] CONSUMED=${consumed} DEAD=${dead} | of DEAD: revivableByMaximalCoupling=${revivable} engineSuppressed(8m)=${engineSuppressed}`,
      )
      // The S75 engine consumers stay wired: the CONSUMED count must not regress below its measured
      // 143. (The DEAD-tip revival is the OPEN owner fork — REWRITE_STATE §82 — not an assertion.)
      expect(consumed, `CONSUMED regressed to ${consumed} (< 140)`).toBeGreaterThanOrEqual(140)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

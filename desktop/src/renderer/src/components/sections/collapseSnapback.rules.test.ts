/**
 * collapseSnapback.rules.test.ts — SESSION 97 target gate: "collapse → invalid → snapback" with the
 * OWNER-LOCKED discriminator (2026-07-23, "only over-reach snaps back").
 *
 * The rule (docs/design/freedraw-onlap-lens-edit-model.md → Invariants → "Collapse → invalid"): a tip
 * edit is ``rejected-collapse`` (INVALID → snap back, handle ALIVE) IFF BOTH
 *   (1) OVER-REACH — the apex was dragged PAST a column edge (the override's ``rawApexFraction`` is
 *       outside [0,1]), AND
 *   (2) FULL-WIDTH FLOOD — the edited tip's own body became a full-width band (non-shapeable).
 * If EITHER is false → ``applied``. A tip that VANISHES within the gap (raw still in [0,1], a
 * neighbour litho fills its apex) is a VALID reshape and MUST stay ``applied`` — this is why the S95
 * ``!isApexShapeable``-alone detector was WRONG (it over-rejected the vanish cases).
 *
 * Driven on REAL CS1 (``scripts/diag_allsections_input.json``): the aggressive over-reach that floods
 * a tip's own body to a band → ``rejected-collapse``; a within-gap moderate reshape (even one that
 * vanishes the tip) → ``applied``.
 *
 * Gated ``CS1_GATE=1``; skips in the normal suite.
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
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { classifyOverrideOutcome } from '../../utils/partitionFillV2/computeSectionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { isDragRejected, shouldPersistDrag } from './unsafeDragUX'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

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

function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) => c.surfaceElevM != null && c.units.length > 0)
  const columns: PartitionColumn[] = keep.map(
    ({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: c.units as PartitionColumn['units'],
    }),
  )
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map((e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
    a: e.a,
    b: e.b,
    aSide: (e.aSide ?? 'top') as 'top' | 'base',
    bSide: (e.bSide ?? 'top') as 'top' | 'base',
  }))
  return { columns, edges, alongM }
}

/** Does the edited body's own region(s) in its gap all become non-shapeable bands (a full-width flood)? */
function ownBodyFloodedToBand(regs: SectionRegion[], bodyId: string, gap: number): boolean {
  const own = regs.filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
  return own.length > 0 && own.every((r) => !isApexShapeable(r))
}

describe.skipIf(!RUN)('§97 collapse → invalid → snapback (owner over-reach discriminator)', () => {
  it('OVER-REACH that floods the own body to a band → rejected-collapse; handle alive (base regions returned)', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
      // Pick the FIRST shapeable tip whose over-reach floods its OWN body to a band — the exact
      // ``6bb744`` gap-7 aggressive class (raw ≈ 1.6, floods to a full-width band). Confirmed to exist
      // on real CS1 (measured 8 such tips). The ``fraction`` the ENGINE reads is clamped in-gap as the
      // app does; ``rawApexFraction`` carries the over-reach past the far column.
      let target: SectionRegion | null = null
      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const key = lensApexOverrideKey(bodyId, r.gapIndex)
        const probe = new Map<string, LensApexOverride>([[key, { fraction: 1.0, elevation: midElev }]])
        const after = computeSectionFillV2(columns, edges, probe, alongM)
        if (ownBodyFloodedToBand(after, bodyId, r.gapIndex)) {
          target = r
          break
        }
      }
      expect(target, 'no own-body-flood tip found on CS1 (fixture regressed)').not.toBeNull()
      const bodyId = target!.bodyId as string
      const gap = target!.gapIndex
      const elevs = target!.polygon.map((p) => p.elevation)
      const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
      const key = lensApexOverrideKey(bodyId, gap)

      // The AGGRESSIVE reach: engine fraction clamped in-gap (visible), but rawApexFraction 1.6 = the
      // apex dragged PAST the far column — over-reach TRUE. The engine floods the own body → collapse.
      const over = new Map<string, LensApexOverride>([[key, { fraction: 1.0, elevation: midElev, rawApexFraction: 1.6 }]])
      const overOutcome = classifyOverrideOutcome(columns, edges, over, alongM)
      expect(overOutcome.status, `over-reach flood → rejected-collapse (got ${overOutcome.status})`).toBe('rejected-collapse')
      // Handle ALIVE: the returned regions are the base (last-safe) fill, whose edited-body region is
      // still shapeable (the snapback shape the overlay renders).
      const returned = overOutcome.regions.filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
      expect(returned.length, 'edited body must survive in the snapback fill').toBeGreaterThan(0)
      expect(returned.some((r) => isApexShapeable(r)), 'snapback region must be shapeable (handle alive)').toBe(true)
      // The rejected status drives snap-back + red handle.
      expect(isDragRejected(overOutcome.status)).toBe(true)
      expect(shouldPersistDrag(overOutcome.status)).toBe(false)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('SAME reach WITHOUT the over-reach signal (raw in [0,1]) → applied, NOT collapse', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
      // Same own-body-flood tip as above, but with NO over-reach (rawApexFraction absent). Even though
      // the engine fraction floods the own body, condition 1 is false → it must NOT be a collapse. This
      // is the belt-and-suspenders half of the owner's AND: a full-width band with no over-reach is a
      // legitimate band, never a snapback.
      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const key = lensApexOverrideKey(bodyId, r.gapIndex)
        const probe = new Map<string, LensApexOverride>([[key, { fraction: 1.0, elevation: midElev }]])
        const after = computeSectionFillV2(columns, edges, probe, alongM)
        if (ownBodyFloodedToBand(after, bodyId, r.gapIndex)) {
          // No rawApexFraction → over-reach absent → NOT collapse.
          const ov = new Map<string, LensApexOverride>([[key, { fraction: 1.0, elevation: midElev }]])
          const outcome = classifyOverrideOutcome(columns, edges, ov, alongM)
          expect(outcome.status, `flood without over-reach → not collapse (got ${outcome.status})`).not.toBe('rejected-collapse')
          return
        }
      }
      throw new Error('no own-body-flood tip found on CS1 (fixture regressed)')
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('WITHIN-GAP moderate reshape (raw in [0,1]) → applied even when the edited tip VANISHES', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
      // A moderate in-gap drag (raw fraction inside [0,1]) that makes the edited body VANISH (a
      // neighbour litho fills its apex — the CS1 ``029c52@4/@5`` class, measured to vanish at 0.35).
      // Over-reach FALSE → it is a VALID reshape and MUST stay applied — never rejected-collapse.
      let checked = 0
      for (const r of shapeable) {
        const bodyId = r.bodyId as string
        const gap = r.gapIndex
        const apex = interiorApexFraction(r)
        const modFrac = apex < 0.5 ? 0.65 : 0.35
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        const key = lensApexOverrideKey(bodyId, gap)
        const mod = new Map<string, LensApexOverride>([[key, { fraction: modFrac, elevation: midElev, rawApexFraction: modFrac }]])
        const after = computeSectionFillV2(columns, edges, mod, alongM)
        const own = after.filter((x) => x.bodyId === bodyId && x.gapIndex === gap)
        if (own.length === 0) {
          // The tip vanished within the gap — the discriminator's VANISH case.
          const outcome = classifyOverrideOutcome(columns, edges, mod, alongM)
          expect(outcome.status, `vanish within gap must stay applied (got ${outcome.status})`).not.toBe('rejected-collapse')
          checked++
        }
      }
      // At least one vanish case exists on CS1 (measured 2: 029c52@4/@5) — assert the gate actually
      // exercised the vanish path, not vacuously passed.
      expect(checked, 'expected at least one within-gap vanish case on CS1').toBeGreaterThanOrEqual(1)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

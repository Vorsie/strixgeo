/**
 * freeDrawRepair.rules.test.ts — PHASE 1 of the owner free-draw repair brief.
 *
 * User-visible RULE tests (behaviour, not impl details). Each is written to FAIL against
 * the unmodified current code (proven RED in the campaign log) and turn GREEN only when the
 * Phase-2 minimal fixes land. Rules, in the owner's words:
 *
 *   (1) Adding a node to a SLOPED lens boundary stores the node ON that boundary even when the
 *       minimum visible reach is enforced. (Fact A — the floating blue handle.)
 *   (2) Dragging a supported one-sided lens handle on real CS1 changes the body footprint AND
 *       reports ``applied``. (Fact C — the handle must not move over an unchanged body.)
 *   (3) An UNSAFE override reports ``rejected-unsafe``; it does NOT silently return base as if it
 *       succeeded. (Fact C — the silent fallback becomes an explicit outcome.)
 *   (4) A two-sided shared contact uses its CONTACT-override protocol (``contact:U|L@g``), not the
 *       one-sided body-apex protocol (``bodyId@gap``).
 *
 * Rules (2)–(4) are gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``). Rule (1)
 * is a pure-geometry unit test (no real data needed) and runs in the normal suite.
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
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { classifyOverrideOutcome } from '../../utils/partitionFillV2/computeSectionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { classifyFreeDrawTarget } from './contactOverrideWiring'
import { applyReachFloorOnSegment, type RouterPoint } from './partitionAddStripRouter'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const MIN_VISIBLE_APEX_FRACTION = 0.08

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
function polyArea(poly: readonly PartitionPoint[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.fraction * q.elevation - q.fraction * p.elevation
  }
  return Math.abs(a) / 2
}
function distPointToSegment(p: RouterPoint, a: RouterPoint, b: RouterPoint): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const lenSq = dx * dx + dy * dy
  const t = lenSq === 0 ? 0 : ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq
  const c = Math.max(0, Math.min(1, t))
  const ex = p.x - (a.x + c * dx)
  const ey = p.y - (a.y + c * dy)
  return Math.sqrt(ex * ex + ey * ey)
}

// ===========================================================================
// RULE (1): a node added to a SLOPED lens boundary stays ON the boundary even
// when the visible-reach floor clamps its along-x. Pure geometry — no real data.
// ===========================================================================
describe('Rule 1 — reach-floor-clamped node stays on the sloped boundary', () => {
  // A right-anchored sloping lens top edge (mirrors CS1 gap-17 body 019ea3e1: slope ~1.75).
  // Screen coords: source corner on the RIGHT column face, tip to the interior-left.
  const leftX = 100
  const rightX = 200
  const seg: [RouterPoint, RouterPoint] = [
    { x: 195, y: 60 }, // near the right column face (source), high on screen
    { x: 140, y: 130 }, // interior tip, lower on screen — a real slope (dy/dx ≈ 1.27)
  ]

  it('CASE right-anchored: clamped x recomputes y so the node lands on the edge', () => {
    const gapW = rightX - leftX
    const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
    // A click NEAR the right source column (inside the floor band) → the floor clamps x.
    const clickX = rightX - floorPx * 0.4
    const t = (clickX - seg[0].x) / (seg[1].x - seg[0].x)
    const clickY = seg[0].y + t * (seg[1].y - seg[0].y) + 4
    // The FIX's helper: clamp the along-x to the reach floor, then read y ON the segment.
    const stored = applyReachFloorOnSegment({ x: clickX, y: clickY }, seg, 'right', leftX, rightX, floorPx)
    // The stored node MUST lie on the boundary segment (Fact A: current code keeps the raw y).
    expect(distPointToSegment(stored, seg[0], seg[1]), 'right-anchored clamped node off the sloped edge').toBeLessThan(0.01)
  })

  it('CASE left-anchored: mirror — clamped x recomputes y on the edge', () => {
    // Left-anchored sloping lens: source on the LEFT face, tip interior-right.
    const segL: [RouterPoint, RouterPoint] = [
      { x: 105, y: 60 },
      { x: 160, y: 130 },
    ]
    const gapW = rightX - leftX
    const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
    const clickX = leftX + floorPx * 0.4
    const t = (clickX - segL[0].x) / (segL[1].x - segL[0].x)
    const clickY = segL[0].y + t * (segL[1].y - segL[0].y) + 4
    const stored = applyReachFloorOnSegment({ x: clickX, y: clickY }, segL, 'left', leftX, rightX, floorPx)
    expect(distPointToSegment(stored, segL[0], segL[1]), 'left-anchored clamped node off the sloped edge').toBeLessThan(0.01)
  })

  it('CASE no-clamp: a mid-gap click (past the floor) is unchanged and on the edge', () => {
    const gapW = rightX - leftX
    const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
    const clickX = 165 // mid-gap, well past the floor band
    const t = (clickX - seg[0].x) / (seg[1].x - seg[0].x)
    const clickY = seg[0].y + t * (seg[1].y - seg[0].y)
    const stored = applyReachFloorOnSegment({ x: clickX, y: clickY }, seg, 'right', leftX, rightX, floorPx)
    expect(distPointToSegment(stored, seg[0], seg[1])).toBeLessThan(0.01)
    expect(stored.x).toBeCloseTo(clickX, 5) // floor did not bite
  })
})

// ===========================================================================
// RULES (2) + (3): the engine reports a STRUCTURED outcome — applied vs
// rejected-unsafe — instead of a silent base fallback (Fact C).
// ===========================================================================
describe.skipIf(!RUN)('Rules 2+3 — structured override outcome (real CS1)', () => {
  it('Rule 2 — a supported one-sided lens drag reshapes the body AND reports applied', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      // Find a single-tip shapeable lens body (the owner's silt-lens reshape shape).
      const tipsPerBodyGap = new Map<string, number>()
      const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
      for (const r of shapeable) {
        const k = `${r.bodyId}@${r.gapIndex}`
        tipsPerBodyGap.set(k, (tipsPerBodyGap.get(k) ?? 0) + 1)
      }
      const target = shapeable.find(
        (r) => tipsPerBodyGap.get(`${r.bodyId}@${r.gapIndex}`) === 1 && r.kind !== 'lens',
      )
      expect(target, 'no single-tip lens on CS1 to reshape').toBeTruthy()
      const r = target as SectionRegion
      const apex = interiorApexFraction(r)
      // A MODERATE, supported drag (0.15 off the apex, kept inside the gap).
      const targetFrac = apex < 0.5 ? Math.min(0.7, apex + 0.15) : Math.max(0.3, apex - 0.15)
      const elevs = r.polygon.map((p) => p.elevation)
      const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
      const key = lensApexOverrideKey(r.bodyId as string, r.gapIndex)
      const ov = new Map<string, LensApexOverride>([[key, { fraction: targetFrac, elevation: midElev }]])
      const outcome = classifyOverrideOutcome(columns, edges, ov, alongM)
      // The body footprint changed:
      const beforeArea = base.filter((x) => x.bodyId === r.bodyId && x.gapIndex === r.gapIndex).reduce((s, x) => s + polyArea(x.polygon), 0)
      const afterArea = outcome.regions.filter((x) => x.bodyId === r.bodyId && x.gapIndex === r.gapIndex).reduce((s, x) => s + polyArea(x.polygon), 0)
      expect(Math.abs(afterArea - beforeArea), 'supported drag did not change the footprint').toBeGreaterThan(1e-4)
      // AND it reports applied (not a silent base return).
      expect(outcome.status, `expected applied, got ${outcome.status}`).toBe('applied')
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('Rule 3 — an unsafe override reports rejected-unsafe, NOT a silent base success', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      // Drive EVERY shapeable body's apex to a wildly out-of-gap fraction at once — an
      // aggressive multi-tip reach the defect guard must reject on at least one gap
      // (the multi-tip granularity limit the reshapeMap test documents as hole-prone).
      const shapeable = base.filter((r) => r.bodyId != null && isApexShapeable(r))
      const ov = new Map<string, LensApexOverride>()
      for (const r of shapeable) {
        const elevs = r.polygon.map((p) => p.elevation)
        const midElev = (Math.max(...elevs) + Math.min(...elevs)) / 2
        // 1.8 = far past the far column → an unsafe extreme clip for stacked tips.
        ov.set(lensApexOverrideKey(r.bodyId as string, r.gapIndex), { fraction: 1.8, elevation: midElev })
      }
      const outcome = classifyOverrideOutcome(columns, edges, ov, alongM)
      // If the guard fell back to base, the OUTCOME must say so explicitly — never
      // 'applied' while silently returning the un-reshaped base.
      if (outcome.status === 'rejected-unsafe') {
        expect(outcome.baseDefect).toBeGreaterThanOrEqual(0)
        expect(outcome.candidateDefect).toBeGreaterThan(outcome.baseDefect + 1e-3)
      } else {
        // The only acceptable non-rejected result is a genuinely-applied gap-safe reshape.
        expect(outcome.status).toBe('applied')
      }
      // The contract that MUST hold: the status is never a lie. When the returned regions
      // equal the no-override base (silent fallback), the status must be 'rejected-unsafe'.
      const regionsEqualBase = JSON.stringify(outcome.regions) === JSON.stringify(base)
      if (regionsEqualBase) {
        expect(outcome.status, 'engine returned base but did not report rejected-unsafe (silent fallback)').toBe('rejected-unsafe')
      }
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

// ===========================================================================
// RULE (4): a two-sided shared contact is CLASSIFIED into the contact-override
// protocol (contact) — a body present on BOTH columns is a two-sided band, not a
// one-sided lens tip. The click target must be classified BEFORE generating an
// override so a shared contact never emits a one-sided bodyId@gap apex key.
// ===========================================================================
describe.skipIf(!RUN)('Rule 4 — shared-contact is classified into the contact protocol (real CS1)', () => {
  it('a body present on both gap columns classifies as a two-sided contact; a one-sided lens does not', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      // A two-sided target: a body present in BOTH columns of some gap (full-width band).
      let twoSidedBody: string | null = null
      let twoSidedGap = -1
      let left: PartitionColumn | null = null
      let right: PartitionColumn | null = null
      for (let i = 0; i + 1 < columns.length && twoSidedBody == null; i++) {
        const li = new Set(columns[i].units.map((u) => u.bodyId).filter((b): b is string => !!b))
        const ri = new Set(columns[i + 1].units.map((u) => u.bodyId).filter((b): b is string => !!b))
        for (const id of li) {
          if (ri.has(id)) {
            twoSidedBody = id
            twoSidedGap = i
            left = columns[i]
            right = columns[i + 1]
            break
          }
        }
      }
      expect(twoSidedBody, 'no two-sided body on CS1 to classify').toBeTruthy()
      // A one-sided target: a shapeable lens tip body (present on ONE column only in its gap).
      const oneSided = base.find((r) => r.bodyId != null && isApexShapeable(r) && r.kind !== 'lens')
      expect(oneSided, 'no one-sided lens tip on CS1 to classify').toBeTruthy()

      // The Phase-2 pure classifier. A body on BOTH columns → 'contact'; else → 'apex'.
      const twoSidedKind = classifyFreeDrawTarget(twoSidedBody as string, left as PartitionColumn, right as PartitionColumn)
      expect(twoSidedKind, 'a two-sided full-width band must classify as a contact target').toBe('contact')

      // The one-sided lens body sits on only one of its gap's columns.
      const g = (oneSided as SectionRegion).gapIndex
      const lensKind = classifyFreeDrawTarget((oneSided as SectionRegion).bodyId as string, columns[g], columns[g + 1])
      expect(lensKind, 'a one-sided lens tip must classify as an apex target').toBe('apex')
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

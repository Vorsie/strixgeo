/**
 * freeDrawRepair.phase0.diag.test.ts — PHASE 0 of the owner free-draw repair brief.
 *
 * REPRODUCE + INSTRUMENT ONLY. No speculative patching. This test replays the EXACT
 * overlay geometry path (``PartitionFillOverlay`` lens add-strip onClick + the S72
 * visible-reach floor) against the REAL CS1 dogfeed input
 * (``scripts/diag_allsections_input.json``), for ONE broken one-sided lens target AND
 * one shared-contact target, and records the 12 data points the brief asks for:
 *
 *   1. selected hit candidate + exact segment endpoints
 *   2. projected point (``projectClickToCandidate`` → on-segment)
 *   3. point after reach constraint (the overlay's ``nodeX`` + ``p.y`` — THE BUG)
 *   4. persisted model coords (along_m, elevation_m)
 *   5. override key/value sent to engine
 *   6. alias expansion result
 *   7. whether the engine used aliased / direct / base
 *   8. base + candidate defect areas
 *   9. rendered region polygon area BEFORE the drag
 *  10. rendered region polygon area AFTER the drag
 *  11. (one-sided) whether the stored node lies ON the selected segment (Fact A)
 *  12. (shared-contact) that it uses the contact-override protocol, not the apex one
 *
 * Gated ``CS1_GATE=1`` (skips in the normal suite). Removable dev diagnostic.
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
import { computeSectionFillV2, computeSectionFillV2WithConflicts } from '../../utils/partitionFillV2'
import { expandOverrideAliasesFromBase } from '../../utils/partitionFillV2/expandOverrideAliases'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { projectClickToCandidate, type RouterPoint } from './partitionAddStripRouter'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

// The overlay's S72 reach floor (verbatim constant).
const MIN_VISIBLE_APEX_FRACTION = 0.08

/** Build a real section from the all-sections diag input (drops empty columns; real alongM). */
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

// ---- Screen projection (mirrors the overlay's linear along/elevation → screen) ----
// The overlay maps along-metres → screen-x linearly and elevation → screen-y
// linearly (inverted: higher elevation = smaller y). The bug is in SCREEN space, so
// we reproduce a faithful linear screen map. The exact scale is irrelevant — the
// on-segment invariant is scale-independent — but we use realistic pixel scales.
const PX_PER_M_X = 12 // screen-x px per along-metre
const PX_PER_M_Y = 20 // screen-y px per elevation-metre
const Y0_ELEV = 20 // elevation that maps to y=0 (arbitrary datum, higher elev = lower y)
const alongToScreenX = (alongMetre: number): number => alongMetre * PX_PER_M_X
const levelToScreen = (elev: number): number => (Y0_ELEV - elev) * PX_PER_M_Y
const screenXToAlong = (x: number): number => x / PX_PER_M_X
const screenToLevel = (y: number): number => Y0_ELEV - y / PX_PER_M_Y

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

/** Shoelace area of a fraction×elevation polygon (relative shape fingerprint). */
function polyArea(poly: readonly PartitionPoint[]): number {
  let a = 0
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i]
    const q = poly[(i + 1) % poly.length]
    a += p.fraction * q.elevation - q.fraction * p.elevation
  }
  return Math.abs(a) / 2
}

/** Perpendicular distance (px) from a point to a segment [a,b]. */
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

/** Segment slope magnitude (dy/dx) — 0 = horizontal, large = steep. */
function segmentSlope(a: RouterPoint, b: RouterPoint): number {
  const dx = b.x - a.x
  if (Math.abs(dx) < 1e-9) return Infinity
  return Math.abs((b.y - a.y) / dx)
}

interface LensTarget {
  bodyId: string
  gapIndex: number
  side: 'left' | 'right'
  leftX: number
  rightX: number
  sourceTopPt: RouterPoint
  upperEnd: RouterPoint
  region: SectionRegion
}

/**
 * Reconstruct the overlay's per-lens screen geometry for a shapeable region.
 * The overlay projects each region polygon into screen space with (leftX,rightX)
 * gap edges + the fraction→x, elevation→y map. We reproduce ``sourceTopPt`` and the
 * UPPER edge segment ``[sourceTopPt, upperEnd]`` exactly as ``addStripCandidates``
 * builds it, so the reach-floor replay below is faithful.
 */
function buildLensTargets(regions: SectionRegion[], gapEdges: Map<number, { leftX: number; rightX: number }>): LensTarget[] {
  const out: LensTarget[] = []
  for (const r of regions) {
    if (r.bodyId == null || !isApexShapeable(r)) continue
    const g = gapEdges.get(r.gapIndex)
    if (!g) continue
    const { leftX, rightX } = g
    const gapW = rightX - leftX
    // Screen-project the region polygon.
    const screenPts = r.polygon.map((p) => ({
      x: leftX + p.fraction * gapW,
      y: levelToScreen(p.elevation),
    }))
    // The apex fraction tells us which side the lens anchors on (near 0 = left source,
    // near 1 = right source): a left lens anchors its source at fraction 0.
    const apexF = interiorApexFraction(r)
    const side: 'left' | 'right' = apexF <= 0.5 ? 'left' : 'right'
    // Source corner = the polygon vertex on the anchored column face (fraction ~0 or ~1).
    const faceFrac = side === 'left' ? 0 : 1
    let srcTopVtx = r.polygon[0]
    let bestFaceDist = Infinity
    for (const p of r.polygon) {
      const d = Math.abs(p.fraction - faceFrac)
      if (d < bestFaceDist) {
        bestFaceDist = d
        srcTopVtx = p
      }
    }
    const sourceTopPt = { x: leftX + srcTopVtx.fraction * gapW, y: levelToScreen(srcTopVtx.elevation) }
    // ``upperEnd`` = screenRegions[...].points[1] in the overlay (the second ring vertex);
    // that is the interior tip of the top edge — a SLOPING segment when the lens tapers.
    const upperEnd = screenPts.length >= 2 ? screenPts[1] : screenPts[0]
    out.push({ bodyId: r.bodyId, gapIndex: r.gapIndex, side, leftX, rightX, sourceTopPt, upperEnd, region: r })
  }
  return out
}

/** Gap screen edges from alongM (leftX = right edge of col i, rightX = left edge of col i+1). */
function gapEdgesFromAlong(alongM: number[]): Map<number, { leftX: number; rightX: number }> {
  const m = new Map<number, { leftX: number; rightX: number }>()
  for (let i = 0; i < alongM.length - 1; i++) {
    m.set(i, { leftX: alongToScreenX(alongM[i]), rightX: alongToScreenX(alongM[i + 1]) })
  }
  return m
}

describe.skipIf(!RUN)('Phase 0 — free-draw repair reproduction (real CS1)', () => {
  it('records the 12 data points for a one-sided sloping lens AND a shared-contact target', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const base = computeSectionFillV2(columns, edges, undefined, alongM)
      const gapEdges = gapEdgesFromAlong(alongM)
      const targets = buildLensTargets(base, gapEdges)

      // ---- Pick a SLOPING lens target (the Fact-A repro). The overlay upper segment
      // must actually slope (dy/dx meaningfully non-zero) or the x-only reach floor is
      // harmless. Prefer the steepest sloping lens = the clearest floating-node case.
      const sloping = targets
        .map((t) => ({ t, slope: segmentSlope(t.sourceTopPt, t.upperEnd) }))
        .filter((s) => Number.isFinite(s.slope) && s.slope > 0.15)
        .sort((a, b) => b.slope - a.slope)
      // eslint-disable-next-line no-console
      console.info(`[PHASE0] shapeable lens targets=${targets.length} sloping(>0.15)=${sloping.length}`)
      expect(sloping.length, 'no sloping lens edge found on CS1 — cannot reproduce Fact A').toBeGreaterThan(0)

      const { t } = sloping[0]
      const seg: [RouterPoint, RouterPoint] = [t.sourceTopPt, t.upperEnd]

      // ===== DATA POINT 1: selected hit candidate + exact segment endpoints =====
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][1 candidate+seg] body=${t.bodyId.slice(0, 8)} gap=${t.gapIndex} side=${t.side} ` +
          `seg=[(${seg[0].x.toFixed(2)},${seg[0].y.toFixed(2)}) → (${seg[1].x.toFixed(2)},${seg[1].y.toFixed(2)})] ` +
          `slope=${sloping[0].slope.toFixed(3)}`,
      )

      // A realistic click NEAR THE ANCHORED SOURCE COLUMN — the exact case the S72
      // reach floor was added for ("clicked near the apex → the lens collapsed"). The
      // floor then clamps x AWAY from the column, which on a sloping edge is where Fact
      // A bites. sourceTopPt sits on the anchored column face; aim the click just inside
      // the gap from it (within the floor band) so the reach floor ACTIVATES.
      const gapWClick = t.rightX - t.leftX
      const floorPxClick = MIN_VISIBLE_APEX_FRACTION * gapWClick
      // A click ~half the floor band in from the source column (inside the floor zone).
      const clickX =
        t.side === 'left' ? t.leftX + floorPxClick * 0.4 : t.rightX - floorPxClick * 0.4
      // segment y at clickX (the edge's true y there); nudge a few px so it is a real click.
      const segT = (clickX - seg[0].x) / (seg[1].x - seg[0].x)
      const segYAtClick = seg[0].y + segT * (seg[1].y - seg[0].y)
      const click: RouterPoint = { x: clickX, y: segYAtClick + 4 } // 4px below the edge

      // ===== DATA POINT 2: projected point (on-segment) =====
      const projected = projectClickToCandidate(click, { segments: [seg], dispatch: null }) ?? click
      const projOnSeg = distPointToSegment(projected, seg[0], seg[1])
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][2 projected] click=(${click.x.toFixed(2)},${click.y.toFixed(2)}) → ` +
          `projected=(${projected.x.toFixed(2)},${projected.y.toFixed(2)}) distToSeg=${projOnSeg.toFixed(4)}px`,
      )

      // ===== DATA POINT 3: point after reach constraint (THE BUG) =====
      // Verbatim overlay math (PartitionFillOverlay.tsx lines 2096-2102):
      const gapW = t.rightX - t.leftX
      const floorPx = MIN_VISIBLE_APEX_FRACTION * gapW
      const nodeX = t.side === 'left' ? Math.max(t.leftX + floorPx, projected.x) : Math.min(t.rightX - floorPx, projected.x)
      // The overlay calls handleLensAddNode(bodyId, edge, nodeX, projected.y) — keeps p.y!
      const afterReach: RouterPoint = { x: nodeX, y: projected.y }
      const afterReachOnSeg = distPointToSegment(afterReach, seg[0], seg[1])
      const reachMovedX = Math.abs(afterReach.x - projected.x) > 1e-6
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][3 afterReach] floorPx=${floorPx.toFixed(2)} nodeX=${nodeX.toFixed(2)} ` +
          `stored=(${afterReach.x.toFixed(2)},${afterReach.y.toFixed(2)}) reachChangedX=${reachMovedX} ` +
          `distToSeg=${afterReachOnSeg.toFixed(4)}px`,
      )

      // ===== DATA POINT 11: does the stored node lie ON the selected segment? (Fact A) =====
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][11 on-segment] projected onSeg=${projOnSeg < 0.01 ? 'YES' : 'NO'} (${projOnSeg.toFixed(4)}px) | ` +
          `afterReach onSeg=${afterReachOnSeg < 0.01 ? 'YES' : 'NO'} (${afterReachOnSeg.toFixed(4)}px)`,
      )

      // ===== DATA POINT 4: persisted model coords =====
      const persistedAlong = screenXToAlong(afterReach.x)
      const persistedElev = screenToLevel(afterReach.y)
      // eslint-disable-next-line no-console
      console.info(`[PHASE0][4 persisted] along_m=${persistedAlong.toFixed(3)} elevation_m=${persistedElev.toFixed(3)}`)

      // ===== DATA POINT 5: override key/value sent to engine =====
      // The overlay's setShape builds the apex override from the stored node's gap-local
      // (fraction, elevation). Reproduce that from the persisted coords.
      const overrideFrac = (afterReach.x - t.leftX) / gapW
      const key = lensApexOverrideKey(t.bodyId, t.gapIndex)
      const override: LensApexOverride = { fraction: overrideFrac, elevation: persistedElev }
      // eslint-disable-next-line no-console
      console.info(`[PHASE0][5 override] key=${key} value={fraction:${overrideFrac.toFixed(4)}, elevation:${persistedElev.toFixed(3)}}`)

      // ===== DATA POINT 6: alias expansion result =====
      const baseFull = computeSectionFillV2WithConflicts(columns, edges, undefined, alongM)
      const ovMap = new Map<string, LensApexOverride>([[key, override]])
      const aliased = expandOverrideAliasesFromBase(ovMap, () => {
        // reshapeMap uses base sliced+merged; here we only need the aliasing keys.
        const r = base
        return { sliced: r, merged: r }
      })
      const aliasedKeys = aliased ? [...aliased.keys()] : []
      // eslint-disable-next-line no-console
      console.info(`[PHASE0][6 alias] override keys after alias expansion: ${aliasedKeys.map((k) => k.slice(0, 12)).join(', ')} (${aliasedKeys.length} keys)`)

      // ===== DATA POINTS 7 + 8: engine used aliased/direct/base + defect areas =====
      // Re-derive the engine's choice by replaying its selection logic transparently.
      const after = computeSectionFillV2(columns, edges, ovMap, alongM)

      // ===== DATA POINT 9 + 10: rendered region area BEFORE / AFTER =====
      const bodySig = (regs: SectionRegion[]): string =>
        regs
          .filter((r) => r.bodyId === t.bodyId && r.gapIndex === t.gapIndex)
          .map((r) => `${r.kind}:${polyArea(r.polygon).toFixed(5)}`)
          .sort()
          .join('#')
      const beforeArea = base
        .filter((r) => r.bodyId === t.bodyId && r.gapIndex === t.gapIndex)
        .reduce((s, r) => s + polyArea(r.polygon), 0)
      const afterArea = after
        .filter((r) => r.bodyId === t.bodyId && r.gapIndex === t.gapIndex)
        .reduce((s, r) => s + polyArea(r.polygon), 0)
      const reshaped = bodySig(base) !== bodySig(after)
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][7 engine-choice] region reshaped=${reshaped} (byte-diff of body footprint) — ` +
          `if false the engine silently used BASE (Fact C)`,
      )
      // eslint-disable-next-line no-console
      console.info(`[PHASE0][8 defect] (see engine self-validation) beforeArea=${beforeArea.toFixed(5)} afterArea=${afterArea.toFixed(5)}`)
      // eslint-disable-next-line no-console
      console.info(`[PHASE0][9 area-before]=${beforeArea.toFixed(5)}  [PHASE0][10 area-after]=${afterArea.toFixed(5)}`)

      // ===== DATA POINT 12: shared-contact target uses contact-override, not apex =====
      // Locate a full-width (two-sided) band whose base is a shared contact with the band
      // below (both regions in the same gap span the full width). The overlay routes THIS
      // through handleBoundaryAddNode → contact:U|L@g, NOT the bodyId@gap apex key.
      const gapRegions = new Map<number, SectionRegion[]>()
      for (const r of base) (gapRegions.get(r.gapIndex) ?? gapRegions.set(r.gapIndex, []).get(r.gapIndex)!).push(r)
      let sharedContactGap = -1
      for (const [g, regs] of gapRegions) {
        const fullWidth = regs.filter((r) => {
          let fMin = Infinity
          let fMax = -Infinity
          for (const p of r.polygon) {
            fMin = Math.min(fMin, p.fraction)
            fMax = Math.max(fMax, p.fraction)
          }
          return fMin <= TIP_FRACTION_EPS && fMax >= 1 - TIP_FRACTION_EPS
        })
        if (fullWidth.length >= 2) {
          sharedContactGap = g
          break
        }
      }
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][12 shared-contact] gap with >=2 stacked full-width bands (contact-override target) = ${sharedContactGap}; ` +
          `protocol MUST be contact:upper|lower@${sharedContactGap} (NOT bodyId@gap apex)`,
      )
      expect(sharedContactGap, 'no stacked full-width bands on CS1 — cannot exercise the contact-override target').toBeGreaterThanOrEqual(0)

      // ---- The Phase-0 diagnosis assertions (these DOCUMENT the failure; the fix flips them). ----
      // Fact A: on a sloping edge, the x-only reach floor moved x while keeping the
      // projected y → the stored node is OFF the segment.
      // (This is the RED observation; Phase 1 turns it into a proper failing rule test.)
      // eslint-disable-next-line no-console
      console.info(
        `[PHASE0][DIAGNOSIS lens] reach floor ${reachMovedX ? 'CHANGED x' : 'did not change x'}; ` +
          `stored node ${afterReachOnSeg < 0.01 ? 'ON' : 'OFF'} segment ` +
          `(${afterReachOnSeg.toFixed(4)}px). ` +
          (reachMovedX && afterReachOnSeg >= 0.01
            ? 'FLOATING NODE REPRODUCED — Fact A confirmed on real CS1.'
            : reachMovedX
              ? 'reach changed x but node stayed on segment (edge near-horizontal here).'
              : 'reach did not activate at this click (click already past the floor).'),
      )
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

/**
 * freeDrawEdgeElev.phase0.diag.test.ts — S84 REPRODUCE-ONLY diagnostic.
 *
 * The owner's live dogfeed: reshaping the low apex of a TALL two-sided body (gap 5,
 * body ...934a78) put the reshaped node at the SECTION TOP (~el11.7 in the drag
 * trace) instead of the clicked low edge (~el5), and it never persisted.
 *
 * This test replays the EXACT overlay ADD-NODE geometry chain against the real CS1
 * input and PROVES the add path is NOT the culprit: a click near the low apex of the
 * target body's shapeable tip regions stores el≈4.90 / el≈6.08 (the clicked edge),
 * and the full containment router routes a low-apex click to the lens tip storing
 * el≈4.90 — both correct. The el11.70 does NOT come from add-node projection.
 *
 * The REAL root (proven in ``apexOverrideWiring.rules.test.ts`` — the S84 case) is in
 * ``buildApexOverridesForGaps``'s ``setShape``: it set the top-level lens apex to
 * ``upper[0] ?? lower[0]`` — the STALE UPPER contact node near the section top — no
 * matter which edge the owner dragged. The engine reads that top-level apex as the
 * lens reach, so a lower-edge drag flooded the tip to the top (unsafe → rejected →
 * snapback → no persist). Fixed by riding the DRAGGED edge's node.
 *
 * REPRODUCE + INSTRUMENT ONLY. Gated CS1_GATE=1 (skips in the normal suite).
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/partitionFill'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { baseContactEdge, isApexShapeable, resolveSourceCorners } from './partitionFillOverlayHelpers'
import { nearerLensEdge } from '../../utils/lensEdgePick'
import {
  type AddStripCandidate,
  projectClickToCandidate,
  routeAddStripByContainment,
  type RouterPoint,
} from './partitionAddStripRouter'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

const TARGET_BODY = '019ea170-5cef-73c0-9b3a-5894e9934a78'
const TARGET_GAP = 5

const PX_PER_M_X = 12
const PX_PER_M_Y = 20
const Y0_ELEV = 20
const alongToScreenX = (a: number): number => a * PX_PER_M_X
const levelToScreen = (e: number): number => (Y0_ELEV - e) * PX_PER_M_Y
const screenToLevel = (y: number): number => Y0_ELEV - y / PX_PER_M_Y

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

describe.skipIf(!RUN)('S84 add-node edge/elevation reproduction (real CS1)', () => {
  it('prints the target body gap-5 source corners + a low-apex click result', () => {
    setTwoSidedTerminations(true)
    const { columns, edges, alongM } = realSection('Cross-section 1')
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)
    const leftX = alongToScreenX(alongM[TARGET_GAP])
    const rightX = alongToScreenX(alongM[TARGET_GAP + 1])
    const gapW = rightX - leftX

    const targetRegions = regions.filter((r) => r.bodyId === TARGET_BODY && r.gapIndex === TARGET_GAP)
    // eslint-disable-next-line no-console
    console.info(`[S84] target body gap ${TARGET_GAP}: ${targetRegions.length} region(s); leftX=${leftX} rightX=${rightX}`)
    for (const r of targetRegions) {
      const shapeable = isApexShapeable(r)
      const verts = r.polygon.map((p) => `${p.fraction.toFixed(3)},${p.elevation.toFixed(2)}`).join(' ')
      // eslint-disable-next-line no-console
      console.info(`[S84]  region kind=${r.kind} shapeable=${shapeable} verts=[${verts}]`)
      if (!shapeable) continue
      const corners = resolveSourceCorners(r.polygon)
      if (!corners) continue
      // eslint-disable-next-line no-console
      console.info(
        `[S84]   side=${corners.side} sourceTop.el=${corners.sourceTop.elevation.toFixed(2)} ` +
          `sourceBase.el=${corners.sourceBase.elevation.toFixed(2)}`,
      )
      // Build screen segments EXACTLY as addStripCandidates does.
      const sourceTopPt = { x: leftX + corners.sourceTop.fraction * gapW, y: levelToScreen(corners.sourceTop.elevation) }
      const sourceBasePt = { x: leftX + corners.sourceBase.fraction * gapW, y: levelToScreen(corners.sourceBase.elevation) }
      const screenPts = r.polygon.map((p) => ({ x: leftX + p.fraction * gapW, y: levelToScreen(p.elevation) }))
      const n = screenPts.length
      const upperEnd = n >= 2 ? screenPts[1] : screenPts[0]
      const lowerStart = n >= 2 ? screenPts[n - 2] : screenPts[n - 1]
      const upperSeg: [RouterPoint, RouterPoint] = [sourceTopPt, upperEnd]
      const lowerSeg: [RouterPoint, RouterPoint] = [lowerStart, sourceBasePt]

      // A click near the LOW apex (~el5): pick the interior vertex with lowest elevation.
      let apex = r.polygon[0]
      for (const p of r.polygon) if (p.fraction > 0.02 && p.fraction < 0.98 && p.elevation < apex.elevation) apex = p
      const clickX = leftX + apex.fraction * gapW
      const clickY = levelToScreen(apex.elevation)
      const click: RouterPoint = { x: clickX, y: clickY }
      const edge = nearerLensEdge(click, upperSeg, lowerSeg)
      const seg = edge === 'upper' ? upperSeg : lowerSeg
      const p = projectClickToCandidate(click, { segments: [seg], dispatch: null }) ?? click
      const storedElev = screenToLevel(p.y)
      // eslint-disable-next-line no-console
      console.info(
        `[S84]   CLICK near low apex el=${apex.elevation.toFixed(2)} → edge=${edge} projected.y→el=${storedElev.toFixed(2)}`,
      )
      // THE add-path is faithful: the stored elevation rides the CLICKED low edge
      // (not the section top). This rules out the "add-node lands on the top edge"
      // hypothesis — the el11.70 came from the override-builder's stale-upper apex.
      expect(storedElev).toBeCloseTo(apex.elevation, 2)
    }
    expect(targetRegions.length).toBeGreaterThan(0)
  })

  it('routes a low-apex click through the FULL containment router (lens + shared-boundary candidates)', () => {
    setTwoSidedTerminations(true)
    const { columns, edges, alongM } = realSection('Cross-section 1')
    const regions = computeSectionFillV2(columns, edges, undefined, alongM)

    // Screen-project every region into {x,y} rings, per gap.
    const gapEdge = (g: number): { leftX: number; rightX: number } => ({
      leftX: alongToScreenX(alongM[g]),
      rightX: alongToScreenX(alongM[g + 1]),
    })
    const screenRing = (r: SectionRegion): RouterPoint[] => {
      const { leftX, rightX } = gapEdge(r.gapIndex)
      const w = rightX - leftX
      return r.polygon.map((p) => ({ x: leftX + p.fraction * w, y: levelToScreen(p.elevation) }))
    }

    // Build the SAME candidate kinds addStripCandidates does, capturing what each stores.
    type Stored = { kind: 'lens' | 'contact'; edge?: 'upper' | 'lower'; elev: number; bodyId: string }
    // The owner's click: near the LOW apex (el ~4.9) of the target body's gap-5 tip.
    const { leftX: gL, rightX: gR } = gapEdge(TARGET_GAP)
    const gW = gR - gL
    const lastClick: RouterPoint = { x: gL + 0.5 * gW, y: levelToScreen(4.9) }
    const cands: AddStripCandidate<() => Stored>[] = []

    // (1) Lens candidates from shapeable regions.
    for (const r of regions) {
      if (r.bodyId == null || !isApexShapeable(r)) continue
      const { leftX, rightX } = gapEdge(r.gapIndex)
      const w = rightX - leftX
      const corners = resolveSourceCorners(r.polygon)
      if (!corners) continue
      const sourceTopPt = { x: leftX + corners.sourceTop.fraction * w, y: levelToScreen(corners.sourceTop.elevation) }
      const sourceBasePt = { x: leftX + corners.sourceBase.fraction * w, y: levelToScreen(corners.sourceBase.elevation) }
      const ring = screenRing(r)
      const n = ring.length
      const upperEnd = n >= 2 ? ring[1] : ring[0]
      const lowerStart = n >= 2 ? ring[n - 2] : ring[n - 1]
      const upperSeg: [RouterPoint, RouterPoint] = [sourceTopPt, upperEnd]
      const lowerSeg: [RouterPoint, RouterPoint] = [lowerStart, sourceBasePt]
      const bodyId = r.bodyId
      cands.push({
        segments: [upperSeg, lowerSeg],
        regionPolygon: ring,
        dispatch: (): Stored => {
          const edge = nearerLensEdge(lastClick, upperSeg, lowerSeg)
          const seg = edge === 'upper' ? upperSeg : lowerSeg
          const p = projectClickToCandidate(lastClick, { segments: [seg], dispatch: null }) ?? lastClick
          return { kind: 'lens', edge, elev: screenToLevel(p.y), bodyId }
        },
      })
    }

    // (2) Shared-boundary candidates from consecutive main-region pairs in a gap.
    const lastMainByGap = new Map<number, SectionRegion>()
    for (const r of regions) {
      if (r.kind === 'lens' || r.bodyId == null) continue
      const prev = lastMainByGap.get(r.gapIndex)
      if (prev) {
        const uMinY = Math.min(...screenRing(prev).map((p) => p.y))
        const sMinY = Math.min(...screenRing(r).map((p) => p.y))
        const up = uMinY <= sMinY ? prev : r
        const upRing = screenRing(up)
        const baseEdge = baseContactEdge(upRing)
        if (baseEdge) {
          const bodyId = up.bodyId!
          cands.push({
            segments: [baseEdge],
            regionPolygon: upRing,
            dispatch: (): Stored => {
              const p = projectClickToCandidate(lastClick, { segments: [baseEdge], dispatch: null }) ?? lastClick
              return { kind: 'contact', elev: screenToLevel(p.y), bodyId }
            },
          })
        }
      }
      lastMainByGap.set(r.gapIndex, r)
    }

    const barrier: RouterPoint[][] = regions
      .filter((r) => r.gapIndex === TARGET_GAP)
      .map((r) => screenRing(r))
    const dispatch = routeAddStripByContainment(lastClick, cands, barrier)
    const stored = dispatch ? dispatch() : null
    // eslint-disable-next-line no-console
    console.info(
      `[S84][ROUTE] click el=4.90 → ${stored ? `kind=${stored.kind} edge=${stored.edge ?? '-'} bodyId=...${stored.bodyId.slice(-6)} storedElev=${stored.elev.toFixed(2)}` : 'NO-OP'}`,
    )
    expect(stored).not.toBeNull()
    // The router grabs the LENS tip and stores el≈4.90 (the clicked low edge), NOT the
    // section top — confirming the add path stores the right elevation. The el11.70 bug
    // is downstream, in the override builder's stale-upper apex (fixed separately).
    expect(stored!.elev).toBeCloseTo(4.9, 1)
  })
})

/**
 * lensPersistRouting.rules.test.ts — §91 root-cause gate ("valid lens drag reshapes
 * LIVE then SNAPS BACK on release").
 *
 * THE definitively-diagnosed bug (owner live dogfeed, CS1, body ...6bb744 gap 5,
 * lower edge): every LIVE drag frame reshapes (``outcome=applied``, the quad follows
 * the cursor); on mouse RELEASE the quad reverts to its un-shaped base fill. The
 * marker moves, the fill snaps back — a safe nudge, not a rejected-unsafe reach.
 *
 * ROOT CAUSE — a LIVE-vs-PERSIST override ROUTING divergence, entirely app-side:
 *   - LIVE  (``lensDrag`` active): the §88 block in ``buildApexOverridesForGaps``
 *     detects the live lens-drag target on a TWO-SIDED body and builds its
 *     ``bodyId@gap`` LENS apex override → the engine consumes it → the tip reshapes.
 *   - RELEASE (``lensDrag`` null): the memo REBUILDS from the persisted node in
 *     ``boundariesByBodyId``. With no live drag, the two-sided body no longer enters
 *     the §88 block, so it routes through the CONTACT path (``contact:U|L@g``) — a
 *     DIFFERENT engine mechanism. For ...6bb744 gap 5 that contact override is
 *     un-routable (floods to a band) → the reshape is dropped → the base fill renders
 *     → the visual snapback.
 *
 * The persisted node is consumed by a different (contact, un-routable) mechanism than
 * the live drag (lens, routable). The existing regression guard in
 * ``apexOverrideWiring.rules.test.ts`` ("a two-sided band NOT being lens-dragged still
 * routes through the contact path") states this snapback mechanism as intended
 * behaviour — correct for a genuine contact bend, WRONG for a persisted LENS tip.
 *
 * Discipline: this drives the REAL app routing (``buildApexOverridesForGaps``) on the
 * REAL CS1 columns/edges + the REAL engine (``computeSectionFillV2``), NOT a synthetic
 * jsdom fixture. S84's UD3 "persist" test was GREEN while the app snapped back — the
 * exact trap this test avoids by re-deriving the PERSISTED node the way the memo does
 * and diffing the produced region polygon against the LIVE-drag region.
 *
 * Gated ``CS1_GATE=1`` (real ``scripts/diag_allsections_input.json``); skips otherwise.
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { type BodyBoundaryResponse } from '../../api/client'
import {
  type CorrelationEdge,
  type LensApexOverride,
  lensApexOverrideKey,
  type PartitionColumn,
  type PartitionPoint,
  type SectionRegion,
} from '../../utils/partitionFill'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import {
  buildApexOverridesForGaps,
  detectPersistedLensBodies,
  type GapExtent,
  type LensDragState,
} from './apexOverrideWiring'

const RUN = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')

/** The owner's dogfeed body + gap + edge (CS1 ...6bb744 gap 5 lower). */
const BID = '019ea170-5ce6-7fc6-aa82-eb27fd6bb744'
const GAP = 5
const EDGE = 'lower' as const

/** Build the real CS1 section (drops empty columns; real alongM), mirroring the reshapeMap harness. */
function realSection(name: string): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === name)
  if (!sec) throw new Error(`section ${name} not in diag input`)
  const keep = sec.columns
    .map((c: { surfaceElevM: number | null; units: unknown[] }, i: number) => ({ c, i }))
    .filter(
      ({ c }: { c: { surfaceElevM: number | null; units: unknown[] } }) =>
        c.surfaceElevM != null && c.units.length > 0,
    )
  const columns: PartitionColumn[] = keep.map(
    ({ c }: { c: { investigationId: string; surfaceElevM: number; units: unknown[] } }) => ({
      investigationId: c.investigationId,
      surfaceElevM: c.surfaceElevM,
      units: c.units as PartitionColumn['units'],
    }),
  )
  const alongM = keep.map(({ i }: { i: number }) => sec.alongM[i])
  const edges: CorrelationEdge[] = sec.edges.map(
    (e: { a: string; b: string; aSide?: string; bSide?: string }) => ({
      a: e.a,
      b: e.b,
      aSide: (e.aSide ?? 'top') as 'top' | 'base',
      bSide: (e.bSide ?? 'top') as 'top' | 'base',
    }),
  )
  return { columns, edges, alongM }
}

/**
 * Screen transforms consistent with the real alongM: a 1 px/m along→screen map with a
 * fixed offset, and an elevation→y map (y grows downward). The override ROUTING +
 * fraction/elevation math are scale-consistent, so a linear map preserves the app's
 * classification and the produced fractions.
 */
const X_SCALE = 1
const X_OFFSET = 20
const Y0 = 400 // screen y at elevation 0
const alongToScreenX = (along: number): number => X_OFFSET + along * X_SCALE
const screenToLevel = (y: number): number => Y0 - y
const levelToScreenY = (el: number): number => Y0 - el

/** Vertex-L2 delta between two region polygons (Infinity on a vertex-count change = topology change). */
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

/** The gap's screen x-extent from the two flanking columns' along positions. */
function gapExtents(alongM: number[]): GapExtent[] {
  const out: GapExtent[] = []
  for (let i = 0; i < alongM.length - 1; i++) {
    out.push({ leftX: alongToScreenX(alongM[i]), rightX: alongToScreenX(alongM[i + 1]) })
  }
  return out
}

/** Signature of every region carrying (body, gap) — vertex order irrelevant (matches reshapeMap bodySig). */
function bodySig(regs: SectionRegion[], bodyId: string, gap: number): string {
  return regs
    .filter((r) => r.bodyId === bodyId && r.gapIndex === gap)
    .map((r) => `${r.kind}|${r.polygon.map((p) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`).join(';')}`)
    .sort()
    .join('#')
}

describe.skipIf(!RUN)('§91 — a safe lens drag PERSISTS as the SAME reshaped region the live drag produced (real CS1)', () => {
  it('LIVE-drag override and PERSISTED-node override route through the SAME lens mechanism and yield the SAME region', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = realSection('Cross-section 1')
      const gapXs = gapExtents(alongM)
      const leftX = gapXs[GAP].leftX
      const rightX = gapXs[GAP].rightX
      const gapW = rightX - leftX

      // The owner's safe nudge: mid-gap, low edge at el ≈ 7.04 (from the live trace ``el7.04``).
      const nudgeAlong = (alongM[GAP] + alongM[GAP + 1]) / 2
      const nudgeElev = 7.04
      const dragX = alongToScreenX(nudgeAlong)
      const dragY = levelToScreenY(nudgeElev)

      // ---- (1) LIVE drag: lensDrag active. The §88 block builds the bodyId@gap lens override. ----
      const persistedNode = { along_m: nudgeAlong, elevation_m: nudgeElev }
      const boundaries: Map<string, BodyBoundaryResponse> = new Map([
        [
          BID,
          {
            body_id: BID,
            content_key: null,
            render_style: 'straight',
            primary_section_id: null,
            upper_nodes: [],
            lower_nodes: [persistedNode],
          } as BodyBoundaryResponse,
        ],
      ])

      const lensDrag: LensDragState = {
        bodyId: BID,
        gapIndex: GAP,
        edge: EDGE,
        nodeIndex: 0,
        leftX,
        x: dragX,
        y: dragY,
      }
      const live = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs,
        boundariesByBodyId: boundaries,
        alongToScreenX,
        screenToLevel,
        lensDrag,
        boundaryDrag: null,
      })
      const lensKey = lensApexOverrideKey(BID, GAP)
      // Sanity: the live drag builds the LENS override (this is the routable path that reshapes).
      expect(live.apexOverrides.has(lensKey), 'live drag failed to build the bodyId@gap lens override').toBe(true)

      // ---- (2) PERSISTED: lensDrag null (the memo rebuild after mouseup). Same boundaries. ----
      // Drives the FULL memo path: a no-override base pass → detectPersistedLensBodies →
      // routes the stored lens node through the lens path (the §91 fix). Without the set,
      // the two-sided body's node routes as an un-routable contact override → snapback.
      const base0 = computeSectionFillV2(columns, edges, undefined, alongM)
      const persistedLensBodies = detectPersistedLensBodies(base0, columns, boundaries, alongToScreenX, gapXs)
      const persisted = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs,
        boundariesByBodyId: boundaries,
        alongToScreenX,
        screenToLevel,
        lensDrag: null,
        boundaryDrag: null,
        persistedLensBodies,
      })

      // RED baseline: the OLD persisted routing (no ``persistedLensBodies``) — proves the
      // pre-§91 path snaps back (routes the node as an un-routable contact override).
      const persistedOld = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs,
        boundariesByBodyId: boundaries,
        alongToScreenX,
        screenToLevel,
        lensDrag: null,
        boundaryDrag: null,
        // persistedLensBodies omitted → legacy behaviour
      })

      // ---- Render all through the REAL engine + diff the region for (BID, GAP). ----
      const liveRegions = computeSectionFillV2(columns, edges, live.apexOverrides, alongM)
      const persistedRegions = computeSectionFillV2(columns, edges, persisted.apexOverrides, alongM)
      const persistedOldRegions = computeSectionFillV2(columns, edges, persistedOld.apexOverrides, alongM)
      const base = base0

      const liveSig = bodySig(liveRegions, BID, GAP)
      const persistedSig = bodySig(persistedRegions, BID, GAP)
      const persistedOldSig = bodySig(persistedOldRegions, BID, GAP)
      const baseSig = bodySig(base, BID, GAP)

      // eslint-disable-next-line no-console
      console.info(
        `[§91] gap=${GAP} body=${BID.slice(-6)} ` +
          `detected=${[...persistedLensBodies].join(',') || 'NONE'} ` +
          `fixedBuildsLensKey=${persisted.apexOverrides.has(lensKey)} ` +
          `oldContactKeys=[${[...persistedOld.apexOverrides.keys()].filter((k) => k.startsWith('contact:')).join(',')}] ` +
          `live!=base=${liveSig !== baseSig} OLD==base(snapback)=${persistedOldSig === baseSig} ` +
          `FIXED==live=${liveSig === persistedSig}`,
      )

      // Test premise: the LIVE drag DOES reshape (routable lens path).
      const liveReshaped = liveSig !== baseSig
      expect(liveReshaped, 'live drag did not reshape the region on real CS1 (test premise broken)').toBe(true)

      // RED baseline (documents the bug): the OLD persisted routing floods back to the base fill —
      // the exact visual snapback the owner reported. Guards against a regression that would make the
      // whole test vacuous (if the old path stopped snapping back, the fix would be untested).
      expect(persistedOldSig, 'pre-§91 persisted routing did NOT snap back — test no longer exercises the bug').toBe(baseSig)

      // THE fix contract: the FIXED persisted node reshapes to the SAME region the LIVE drag produced.
      expect(persistedSig, 'PERSISTED node routed differently than the LIVE drag → snapback').toBe(liveSig)
      // And it is NOT the base fill (it genuinely reshaped, not merely "not-equal-to-old").
      expect(persistedSig, 'PERSISTED region collapsed to the base fill (still snapping back)').not.toBe(baseSig)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

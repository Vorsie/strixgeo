/**
 * pressToGrabAddNode.rules.test.ts — S86 gate: press on an add-strip creates AND
 * grabs the new control node in the SAME mousedown, so a new node reshapes LIVE.
 *
 * THE bug the owner reported (S86 dogfeed): the add gesture was two-step — a click
 * on a body boundary dropped a node (persist), and only a SEPARATE press-drag on that
 * node's handle reshaped it. The owner wants ONE continuous gesture: "click down and
 * drag". Approach B (single-save): the mousedown does NOT persist — it starts a lens
 * (or contact) drag flagged ``isNew: true`` whose ``nodeIndex`` is the WOULD-BE new
 * index (``existing edge array length``). The live override machinery
 * (``buildApexOverridesForGaps``) must render that new node from the live cursor even
 * though it is NOT yet in ``boundariesByBodyId``; the mouseup APPENDS it and persists.
 *
 * This gate drives the REAL override builder, NOT a jsdom fixture, so it cannot pass on
 * the two-step code (which requires the node to already exist in the stored arrays):
 *   - Test 1 (RED on old code): an ``isNew`` lens drag on a body with NO stored lens
 *     node still builds the ``bodyId@gap`` apex override reflecting the dragged cursor.
 *     Old ``chain`` iterates only stored nodes → no node at ``nodeIndex = 0`` on an
 *     empty array → NO override → the new node does not render live.
 *   - Test 2: a NEW node appended to an EXISTING edge (``nodeIndex = length``) also
 *     renders live (injection is index-correct, not just "empty array").
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
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { buildApexOverridesForGaps, type GapExtent, type LensDragState } from './apexOverrideWiring'
import { collectContactOverridesForGap, type ContactDragState } from './contactOverrideWiring'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'

// A single-sided lens body: present on the LEFT column only, so it pinches to a tip
// inside the gap (the ordinary shapeable lens the add-strip targets). No stored node.
const LENS = 'lens-left-only'
const MATRIX = 'matrix-both' // full-width band beneath so the gap has a partition

const GAP: GapExtent = { leftX: 100, rightX: 200 }
const alongToScreenX = (along: number): number => along // 1:1 (along == screen x)
const screenToLevel = (y: number): number => 100 - y

function oneSidedLensColumns(): PartitionColumn[] {
  // LEFT carries LENS (top) over MATRIX; RIGHT carries only MATRIX → LENS pinches out.
  const left = [
    { topDepthM: 0, baseDepthM: 4, formationId: 'zand', bodyId: LENS, layerId: 'L-lens' },
    { topDepthM: 4, baseDepthM: 12, formationId: 'klei', bodyId: MATRIX, layerId: 'L-matrix' },
  ]
  const right = [{ topDepthM: 0, baseDepthM: 12, formationId: 'klei', bodyId: MATRIX, layerId: 'R-matrix' }]
  return [
    { investigationId: 'A', surfaceElevM: 10, units: left },
    { investigationId: 'B', surfaceElevM: 10, units: right },
  ]
}

/** No stored freedraw shape at all (the empty-edge new-node case). */
function emptyBoundary(): Map<string, BodyBoundaryResponse> {
  const m = new Map<string, BodyBoundaryResponse>()
  m.set(LENS, {
    body_id: LENS,
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    upper_nodes: [],
    lower_nodes: [],
  })
  return m
}

/** One stored lower node already present (the append-to-existing new-node case). */
function boundaryWithOneLowerNode(): Map<string, BodyBoundaryResponse> {
  const m = new Map<string, BodyBoundaryResponse>()
  m.set(LENS, {
    body_id: LENS,
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    upper_nodes: [],
    lower_nodes: [{ along_m: 130, elevation_m: 6 }],
  })
  return m
}

describe('S86 — press-to-grab: an isNew lens drag renders the new node LIVE (real setShape path)', () => {
  it('RED on old code: an isNew drag on an EMPTY edge builds the bodyId@gap override from the live cursor', () => {
    // The mousedown started a NEW lens node: node index 0 on a body whose lower_nodes is
    // empty. Old ``chain`` finds no stored node at index 0 → builds NO override → the new
    // node never renders live (the owner's "press does nothing" step).
    const lensDrag: LensDragState = {
      bodyId: LENS,
      gapIndex: 0,
      edge: 'lower',
      nodeIndex: 0, // would-be new index on an empty lower_nodes array
      leftX: GAP.leftX,
      x: 170,
      y: 34,
      isNew: true,
    }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: oneSidedLensColumns(),
      gapXs: [GAP],
      boundariesByBodyId: emptyBoundary(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const key = lensApexOverrideKey(LENS, 0)
    expect(
      apexOverrides.has(key),
      'isNew lens drag produced no live override → the new node does not reshape on press-drag',
    ).toBe(true)
    const ov = apexOverrides.get(key)!
    // The live cursor drives the apex: x=170 in [100,200] → fraction 0.70.
    expect(ov.fraction).toBeCloseTo(0.7, 5)
    expect(ov.elevation).toBeCloseTo(screenToLevel(34), 5)
    // The injected new node is present on the dragged (lower) edge.
    expect(ov.lower?.length).toBe(1)
  })

  it('an isNew node APPENDED to an existing edge (nodeIndex = length) also renders live', () => {
    // One node already stored (index 0); the new node is index 1 (the array length).
    const lensDrag: LensDragState = {
      bodyId: LENS,
      gapIndex: 0,
      edge: 'lower',
      nodeIndex: 1, // append after the single stored node
      leftX: GAP.leftX,
      x: 160,
      y: 40,
      isNew: true,
    }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: oneSidedLensColumns(),
      gapXs: [GAP],
      boundariesByBodyId: boundaryWithOneLowerNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const ov = apexOverrides.get(lensApexOverrideKey(LENS, 0))!
    expect(ov, 'isNew append produced no override').toBeTruthy()
    // BOTH the stored node (index 0) AND the injected new node (index 1) ride the lower edge.
    expect(ov.lower?.length).toBe(2)
    // The injected node reflects the live cursor: x=160 → fraction 0.60.
    const injected = ov.lower!.find((p) => Math.abs(p.fraction - 0.6) < 1e-6)
    expect(injected, 'the appended new node did not take the live cursor fraction').toBeTruthy()
    expect(injected!.elevation).toBeCloseTo(screenToLevel(40), 5)
  })
})

// A two-sided band (present on BOTH columns) over a band below → its base is a shared
// CONTACT. The contact add-strip press must create AND grab a new contact node.
const UBAND = 'contact-upper' // full-width band whose base is the shared contact
const LBAND = 'contact-lower' // the band directly beneath

function contactColumns(): PartitionColumn[] {
  const units = [
    { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: UBAND, layerId: 'L-u' },
    { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: LBAND, layerId: 'L-l' },
  ]
  return [
    { investigationId: 'A', surfaceElevM: 10, units },
    { investigationId: 'B', surfaceElevM: 10, units },
  ]
}

function emptyContactBoundary(): Map<string, BodyBoundaryResponse> {
  const m = new Map<string, BodyBoundaryResponse>()
  m.set(UBAND, {
    body_id: UBAND,
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    upper_nodes: [],
    lower_nodes: [],
  })
  return m
}

describe('S86 — press-to-grab: an isNew CONTACT drag renders the new contact node LIVE', () => {
  it('RED on old code: an isNew contact drag on an empty boundary builds the contact:U|L@g override from the cursor', () => {
    const drag: ContactDragState = {
      upperBodyId: UBAND,
      lowerBodyId: LBAND,
      nodeIndex: 0, // would-be new index on an empty lower_nodes array
      x: 170,
      y: 45,
      leftX: GAP.leftX,
      rightX: GAP.rightX,
      isNew: true,
    }
    const out = new Map<string, LensApexOverride>()
    collectContactOverridesForGap(
      0,
      contactColumns()[0],
      contactColumns()[1],
      GAP.leftX,
      GAP.rightX,
      emptyContactBoundary(),
      alongToScreenX,
      screenToLevel,
      drag,
      out,
    )
    const key = contactApexOverrideKey(UBAND, LBAND, 0)
    expect(
      out.has(key),
      'isNew contact drag produced no live override → the new contact node does not reshape on press-drag',
    ).toBe(true)
    const ov = out.get(key)!
    // x=170 in [100,200] → fraction 0.70; elevation from the live cursor.
    expect(ov.fraction).toBeCloseTo(0.7, 5)
    expect(ov.elevation).toBeCloseTo(screenToLevel(45), 5)
  })
})

// ---------------------------------------------------------------------------
// CS1 REAL-DATA gate: a NEW lens-tip node created by press-to-grab (isNew, no stored
// node) on the real ...6bb744 gap-5 lens reshapes on press-drag AND persists routed as a
// LENS — the same region the equivalent stored-node drag produces, never the base fill
// (no snapback one gesture earlier than §85). Reuses the §85 lensPersistRouting harness.
// ---------------------------------------------------------------------------
const RUN_CS1 = process.env.CS1_GATE === '1'
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '../../../../../..')
const CS1_INPUT = resolve(REPO_ROOT, 'scripts/diag_allsections_input.json')
const CS1_BID = '019ea170-5ce6-7fc6-aa82-eb27fd6bb744'
const CS1_GAP = 5
const CS1_EDGE = 'lower' as const
const CS1_X_OFFSET = 20
const CS1_Y0 = 400
const cs1AlongToScreenX = (along: number): number => CS1_X_OFFSET + along
const cs1ScreenToLevel = (y: number): number => CS1_Y0 - y
const cs1LevelToScreenY = (el: number): number => CS1_Y0 - el

function cs1RealSection(): { columns: PartitionColumn[]; edges: CorrelationEdge[]; alongM: number[] } {
  const raw = JSON.parse(readFileSync(CS1_INPUT, 'utf8'))
  const sec = raw.sections.find((s: { name: string }) => s.name === 'Cross-section 1')
  if (!sec) throw new Error('Cross-section 1 not in diag input')
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

/** Signature of the (body, gap) region(s) — vertex order irrelevant (matches the §85 harness). */
function cs1BodySig(regs: SectionRegion[]): string {
  return regs
    .filter((r) => r.bodyId === CS1_BID && r.gapIndex === CS1_GAP)
    .map((r) => `${r.kind}|${r.polygon.map((p) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`).join(';')}`)
    .sort()
    .join('#')
}

describe.skipIf(!RUN_CS1)('S86 — a press-to-grab NEW lens-tip node reshapes + persists routed as a lens (real CS1)', () => {
  it('the isNew live drag AND the appended-then-persisted node yield the SAME reshaped region, never the base fill', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges, alongM } = cs1RealSection()
      const gapXs: GapExtent[] = []
      for (let i = 0; i < alongM.length - 1; i++) {
        gapXs.push({ leftX: cs1AlongToScreenX(alongM[i]), rightX: cs1AlongToScreenX(alongM[i + 1]) })
      }
      const leftX = gapXs[CS1_GAP].leftX
      const rightX = gapXs[CS1_GAP].rightX

      // The owner's safe mid-gap nudge (from the §85 live trace el≈7.04).
      const nudgeAlong = (alongM[CS1_GAP] + alongM[CS1_GAP + 1]) / 2
      const nudgeElev = 7.04
      const dragX = cs1AlongToScreenX(nudgeAlong)
      const dragY = cs1LevelToScreenY(nudgeElev)

      // (1) PRESS-TO-GRAB live: the body has NO stored node yet (empty boundary) — the
      // add-strip press CREATED the node. ``isNew`` + nodeIndex 0 on an empty lower edge.
      const emptyBoundaries: Map<string, BodyBoundaryResponse> = new Map([
        [
          CS1_BID,
          {
            body_id: CS1_BID,
            content_key: null,
            render_style: 'straight',
            primary_section_id: null,
            upper_nodes: [],
            lower_nodes: [],
          } as BodyBoundaryResponse,
        ],
      ])
      const liveDrag: LensDragState = {
        bodyId: CS1_BID,
        gapIndex: CS1_GAP,
        edge: CS1_EDGE,
        nodeIndex: 0,
        leftX,
        x: dragX,
        y: dragY,
        isNew: true,
      }
      const live = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs,
        boundariesByBodyId: emptyBoundaries,
        alongToScreenX: cs1AlongToScreenX,
        screenToLevel: cs1ScreenToLevel,
        lensDrag: liveDrag,
        boundaryDrag: null,
      })
      const lensKey = lensApexOverrideKey(CS1_BID, CS1_GAP)
      expect(live.apexOverrides.has(lensKey), 'isNew press-to-grab drag built no live lens override on real CS1').toBe(true)

      // (2) PERSISTED: the mouseup APPENDED the node to lower_nodes → an ordinary stored
      // node. The §91 persisted-lens routing (via the overlay memo's detectPersistedLensBodies)
      // makes it route as a lens; here we assert the STORED node builds the same lens override
      // directly (the overlay's persisted-lens set is exercised by lensPersistRouting.rules).
      const persistedNode = { along_m: nudgeAlong, elevation_m: nudgeElev }
      const persistedBoundaries: Map<string, BodyBoundaryResponse> = new Map([
        [
          CS1_BID,
          {
            body_id: CS1_BID,
            content_key: null,
            render_style: 'straight',
            primary_section_id: null,
            upper_nodes: [],
            lower_nodes: [persistedNode],
          } as BodyBoundaryResponse,
        ],
      ])
      const persisted = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs,
        boundariesByBodyId: persistedBoundaries,
        alongToScreenX: cs1AlongToScreenX,
        screenToLevel: cs1ScreenToLevel,
        lensDrag: null,
        boundaryDrag: null,
        // The stored node is a genuine lens tip → route as a lens (the §91 discriminator).
        persistedLensBodies: new Set([`${CS1_GAP}:${CS1_BID}`]),
      })

      const liveRegions = computeSectionFillV2(columns, edges, live.apexOverrides, alongM)
      const persistedRegions = computeSectionFillV2(columns, edges, persisted.apexOverrides, alongM)
      const baseRegions = computeSectionFillV2(columns, edges, undefined, alongM)

      const liveSig = cs1BodySig(liveRegions)
      const persistedSig = cs1BodySig(persistedRegions)
      const baseSig = cs1BodySig(baseRegions)

      // The press-to-grab live reshape is NOT the base fill (the new node genuinely reshaped).
      expect(liveSig, 'press-to-grab live drag did not reshape (== base fill)').not.toBe(baseSig)
      // The persisted (appended) node reshapes to the SAME region — no snapback one gesture earlier.
      expect(persistedSig, 'the appended new node persisted differently than the live drag → snapback').toBe(liveSig)
      expect(persistedSig, 'the persisted new node collapsed to the base fill (snapback)').not.toBe(baseSig)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

/**
 * apexOverrideWiring.rules.test.ts — §88 root-cause gate.
 *
 * THE definitively-diagnosed bug (live dev-trace of the owner's real drag): dragging
 * a lens handle on a TWO-SIDED band produced ``override=NONE`` every frame → nothing
 * reshaped. Root cause: the app builds the ``bodyId@gap`` lens apex override through
 * ``setShape`` gated by the two XOR loops:
 *
 *     for (const id of leftIds) if (!rightIds.has(id)) setShape(id)
 *     for (const id of rightIds) if (!leftIds.has(id)) setShape(id)
 *
 * A body present on BOTH columns of the gap (a full-width band) is skipped by the
 * XOR — even when it owns a genuine LENS tip inside the gap. So its lens override is
 * never built and the drag is a silent no-op. Every ``reshapeMap`` / ``allSectionsReshape``
 * test passed because they feed the override DIRECTLY to the engine, bypassing this gate.
 *
 * Discipline: these drive the REAL ``setShape`` + XOR path via ``buildApexOverridesForGaps``.
 * Test 1 first REPRODUCES the bug with an XOR-only reference (proves the override is
 * absent under the old gate), THEN asserts the fixed builder DOES produce it — and that
 * the produced apex reflects the dragged cursor position (the body reshapes). Test 2 is
 * the disentangle: a two-sided lens-tip drag must NOT also emit a spurious ``contact:``
 * override for the same node.
 */
import { describe, expect, it } from 'vitest'

import { type BodyBoundaryResponse } from '../../api/client'
import { lensApexOverrideKey, type PartitionColumn } from '../../utils/sectionPartition'
import { buildApexOverridesForGaps, type GapExtent, type LensDragState } from './apexOverrideWiring'

// --------------------------------------------------------------------------
// A minimal two-column section where the SAME body is a full-width band (present
// on both columns) yet ALSO owns a lens tip inside the gap. This is the owner's
// ``019ea170`` gap-5 shape: a matrix band that pinches a lens the XOR gate skips.
// --------------------------------------------------------------------------
const BAND = 'band-two-sided' // present on BOTH columns → skipped by the XOR gate
const LOWER = 'band-below' // the band directly beneath (gives the contact a lower body)

// Gap screen extent: left face at x=100, right face at x=200 (gapW=100).
const GAP: GapExtent = { leftX: 100, rightX: 200 }

/** along-metres → screen x. The lens node sits mid-gap (x=150) so it is owned here. */
const alongToScreenX = (along: number): number => along // 1:1: use along = screen x directly
/** screen y → elevation (mTAW). Simple linear inverse for the drag preview. */
const screenToLevel = (y: number): number => 100 - y

function twoSidedColumns(): PartitionColumn[] {
  // Both columns carry BAND (full-width) over LOWER (the band below) → BAND is two-sided.
  const units = [
    { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: BAND, layerId: 'L-band' },
    { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: LOWER, layerId: 'L-below' },
  ]
  return [
    { investigationId: 'A', surfaceElevM: 10, units },
    { investigationId: 'B', surfaceElevM: 10, units },
  ]
}

/** Stored freedraw shape: BAND owns ONE lens node mid-gap on its lower edge. */
function boundariesWithLensNode(): Map<string, BodyBoundaryResponse> {
  const m = new Map<string, BodyBoundaryResponse>()
  m.set(BAND, {
    body_id: BAND,
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    upper_nodes: [],
    lower_nodes: [{ along_m: 150, elevation_m: 6 }], // mid-gap (x=150 ∈ [100,200]) → owned
  })
  return m
}

/**
 * Stored freedraw shape mirroring the owner's real ...934a78 gap-5 body: a tall
 * two-sided band carrying BOTH a stale UPPER contact node near the section top AND
 * the LOWER lens node the owner is dragging. This is the S84 el11.70 bug fixture —
 * the top-level apex must ride the DRAGGED edge, not the unconditional ``upper[0]``.
 */
function boundariesWithUpperAndLowerNodes(): Map<string, BodyBoundaryResponse> {
  const m = new Map<string, BodyBoundaryResponse>()
  m.set(BAND, {
    body_id: BAND,
    content_key: null,
    render_style: 'straight',
    primary_section_id: null,
    // A top contact bend high up the tall band (screen y=88 → el=12 under screenToLevel).
    upper_nodes: [{ along_m: 150, elevation_m: 12 }],
    // The LOW lens tip the owner grabs (screen y=95 → el=5).
    lower_nodes: [{ along_m: 150, elevation_m: 5 }],
  })
  return m
}

/** The old XOR-only gate, reproduced verbatim, as the RED reference. */
function xorOnlyOverrideKeys(columns: PartitionColumn[]): Set<string> {
  const keys = new Set<string>()
  const left = columns[0]
  const right = columns[1]
  const leftIds = new Set(left.units.map((u) => u.bodyId).filter((id): id is string => !!id))
  const rightIds = new Set(right.units.map((u) => u.bodyId).filter((id): id is string => !!id))
  for (const id of leftIds) if (!rightIds.has(id)) keys.add(lensApexOverrideKey(id, 0))
  for (const id of rightIds) if (!leftIds.has(id)) keys.add(lensApexOverrideKey(id, 0))
  return keys
}

describe('§88 — two-sided band lens-tip drag builds an apex override (real setShape path)', () => {
  it('RED reference: the old XOR-only gate produces NO override for the two-sided band', () => {
    const columns = twoSidedColumns()
    // The bug, made concrete: BAND is on both columns, so the XOR gate skips it.
    expect(xorOnlyOverrideKeys(columns).has(lensApexOverrideKey(BAND, 0))).toBe(false)
  })

  it('the fixed builder DOES build the bodyId@gap override when the lens handle is dragged', () => {
    const columns = twoSidedColumns()
    // Owner drags BAND's lens handle (lower edge, node 0) toward x=170 in gap 0.
    const lensDrag: LensDragState = {
      bodyId: BAND,
      gapIndex: 0,
      edge: 'lower',
      nodeIndex: 0,
      leftX: GAP.leftX,
      x: 170,
      y: 34,
    }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithLensNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const key = lensApexOverrideKey(BAND, 0)
    // THE fix: the override is now BUILT (not NONE) for the two-sided lens tip.
    expect(apexOverrides.has(key), 'two-sided band lens-tip drag produced no override (XOR gate skipped it)').toBe(true)
    // AND it reflects the dragged cursor: x=170 in [100,200] → fraction 0.70.
    const ov = apexOverrides.get(key)!
    expect(ov.fraction).toBeCloseTo(0.7, 5)
    expect(ov.elevation).toBeCloseTo(screenToLevel(34), 5)
  })

  it('disentangle: the two-sided lens-tip drag does NOT also emit a contact:U|L override for the same body', () => {
    const columns = twoSidedColumns()
    const lensDrag: LensDragState = {
      bodyId: BAND,
      gapIndex: 0,
      edge: 'lower',
      nodeIndex: 0,
      leftX: GAP.leftX,
      x: 170,
      y: 34,
    }
    const { apexOverrides, contactOverriddenBodies } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithLensNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    // Exactly ONE override key, and it is the lens apex — no ``contact:`` twin.
    expect([...apexOverrides.keys()]).toEqual([lensApexOverrideKey(BAND, 0)])
    for (const k of apexOverrides.keys()) expect(k.startsWith('contact:')).toBe(false)
    // The contact path did not claim this body for the gap either.
    expect(contactOverriddenBodies.has(`0:${BAND}`)).toBe(false)
  })

  it('S84: dragging the LOWER lens node of a band that also owns an UPPER node rides the DRAGGED edge, not the stale upper node', () => {
    // The owner's live dogfeed (body ...934a78 gap 5): grabbing the LOW lens tip put the
    // reshaped node at the SECTION TOP (~el11.70) instead of the clicked low edge (~el5),
    // and the node never persisted (an unsafe top reach → rejected → snapback). Root cause:
    // ``setShape`` set the top-level apex to ``upper[0] ?? lower[0]`` — the stale UPPER node —
    // regardless of which edge the owner dragged. The engine reads that top-level apex as the
    // lens reach, so the tip flooded to the top.
    const columns = twoSidedColumns()
    // Owner drags BAND's LOWER lens handle (node 0) down to screen y=95 (→ el=5).
    const lensDrag: LensDragState = {
      bodyId: BAND,
      gapIndex: 0,
      edge: 'lower',
      nodeIndex: 0,
      leftX: GAP.leftX,
      x: 150,
      y: 95,
    }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithUpperAndLowerNodes(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const ov = apexOverrides.get(lensApexOverrideKey(BAND, 0))!
    expect(ov, 'two-sided band lens-tip drag produced no override').toBeTruthy()
    // THE fix: the top-level apex ELEVATION reflects the DRAGGED LOWER node (screenToLevel(95)=5),
    // NOT the stale UPPER node (el=12). RED on the old code (apex0 = upper[0] → el=12).
    expect(ov.elevation, 'apex rode the stale upper node instead of the dragged lower edge').toBeCloseTo(
      screenToLevel(95),
      5,
    )
    // The full per-edge arrays are still both carried so the engine rebuilds both flanks.
    expect(ov.upper?.length).toBe(1)
    expect(ov.lower?.length).toBe(1)
  })

  it('a two-sided band NOT being lens-dragged still routes through the contact path (regression guard)', () => {
    const columns = twoSidedColumns()
    // No lens drag → BAND's lower node is a shared CONTACT bend (contact:U|L@0), not a lens apex.
    const { apexOverrides, contactOverriddenBodies } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithLensNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag: null,
      boundaryDrag: null,
    })
    // The contact path claims BAND for gap 0 (its lower_nodes shape the shared contact).
    expect(contactOverriddenBodies.has(`0:${BAND}`)).toBe(true)
    // And there is NO one-sided lens apex for the two-sided band.
    expect(apexOverrides.has(lensApexOverrideKey(BAND, 0))).toBe(false)
    // The only override written is a contact key.
    expect([...apexOverrides.keys()].every((k) => k.startsWith('contact:'))).toBe(true)
  })

  // -------------------------------------------------------------------------
  // S97 OVER-REACH signal (collapse discriminator, owner-locked 2026-07-23).
  // The dragged tip's override must carry ``rawApexFraction`` = the RAW (pre-clamp)
  // cursor reach, so the classifier can test "dragged PAST a column edge". The
  // visible ``fraction`` stays clamped; only ``rawApexFraction`` preserves the
  // over-reach. Absent on the non-drag / persisted-render path.
  // -------------------------------------------------------------------------
  it('S97: an IN-GAP lens drag carries rawApexFraction inside [0,1] (no over-reach)', () => {
    const columns = twoSidedColumns()
    // x=170 in [100,200] → raw fraction 0.70, in-gap.
    const lensDrag: LensDragState = { bodyId: BAND, gapIndex: 0, edge: 'lower', nodeIndex: 0, leftX: GAP.leftX, x: 170, y: 34 }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithLensNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const ov = apexOverrides.get(lensApexOverrideKey(BAND, 0))!
    expect(ov.rawApexFraction, 'in-gap drag must carry a raw reach').toBeCloseTo(0.7, 5)
    // Not over-reach → within [0,1].
    expect(ov.rawApexFraction! >= 0 && ov.rawApexFraction! <= 1).toBe(true)
  })

  it('S97: an OVER-REACH lens drag (cursor past the far column) carries rawApexFraction > 1 while fraction stays clamped', () => {
    const columns = twoSidedColumns()
    // x=260, past the right face at x=200 (gapW=100) → raw fraction 1.60 = over-reach.
    const lensDrag: LensDragState = { bodyId: BAND, gapIndex: 0, edge: 'lower', nodeIndex: 0, leftX: GAP.leftX, x: 260, y: 34 }
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: columns,
      gapXs: [GAP],
      boundariesByBodyId: boundariesWithLensNode(),
      alongToScreenX,
      screenToLevel,
      lensDrag,
      boundaryDrag: null,
    })
    const ov = apexOverrides.get(lensApexOverrideKey(BAND, 0))!
    // THE over-reach signal: raw reach past the far column (1.60), OUTSIDE [0,1].
    expect(ov.rawApexFraction, 'over-reach drag must preserve the raw past-column reach').toBeCloseTo(1.6, 5)
    expect(ov.rawApexFraction! > 1).toBe(true)
    // The VISIBLE fraction the engine reads stays clamped in-gap (clampVisibleApex → ≤ 0.92) — the raw
    // reach is the ONLY carrier of over-reach; the clamp would otherwise discard it.
    expect(ov.fraction).toBeLessThanOrEqual(0.92)
  })

  it('S97: the non-drag / persisted-render path leaves rawApexFraction ABSENT (no over-reach to test)', () => {
    const columns = twoSidedColumns()
    // A one-sided lens body (present on ONE column) with a stored node but NO live drag → the render
    // path builds the override from storage; no cursor → no raw reach.
    const oneSided: PartitionColumn[] = [
      { investigationId: 'A', surfaceElevM: 10, units: [{ topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: 'lens-1', layerId: 'L1' }] },
      { investigationId: 'B', surfaceElevM: 10, units: [{ topDepthM: 0, baseDepthM: 5, formationId: 'klei', bodyId: 'other', layerId: 'L2' }] },
    ]
    const stored = new Map<string, BodyBoundaryResponse>([
      ['lens-1', { body_id: 'lens-1', content_key: null, render_style: 'straight', primary_section_id: null, upper_nodes: [], lower_nodes: [{ along_m: 150, elevation_m: 6 }] }],
    ])
    const { apexOverrides } = buildApexOverridesForGaps({
      orderedColumns: oneSided,
      gapXs: [GAP],
      boundariesByBodyId: stored,
      alongToScreenX,
      screenToLevel,
      lensDrag: null,
      boundaryDrag: null,
    })
    const ov = apexOverrides.get(lensApexOverrideKey('lens-1', 0))
    expect(ov, 'one-sided stored lens builds an override').toBeTruthy()
    expect(ov!.rawApexFraction, 'non-drag render must NOT carry a raw reach').toBeUndefined()
  })
})

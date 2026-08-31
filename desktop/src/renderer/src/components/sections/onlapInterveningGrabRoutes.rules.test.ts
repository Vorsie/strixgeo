/**
 * onlapInterveningGrabRoutes.rules.test.ts — SESSION 110 gate: WIRE the gesture so grabbing the
 * clay boundary with an intervening sand onlap dispatches a ``contact:A|C`` bend the onlap RIDES —
 * WITHOUT a banding tie (no §106 re-absorb). Owner 2026-07-24: "i'm grabbing the boundary of the
 * clay and the sand is disappearing. It needs to reshape together with the dragged boundary."
 *
 * §109 PROVED the ENGINE half (blockers 1+2): a ``contact:A|C`` bend makes the onlap ride the bent
 * clay-base contact (the sand's top contact IS the clay's base — the SAME line), and a bend WITHOUT
 * the A/C banding tie does NOT re-absorb the onlap. What was missing (blocker 3): the app-layer grab
 * routing. §107 made ``reclassifyStackedBandGrab`` return null when an onlap intervenes (to STOP the
 * destructive absorb), so the grab fell through to a LENS drag on the sand → NO ``contact:A|C`` bend
 * ever emitted → the onlap could not ride.
 *
 * THIS SESSION's fix: a new resolver ``resolveOnlapInterveningGrab`` returns the (upper=A, lower=C,
 * ridingOnlaps=[B]) triple for the onlap-intervening grab of the clay/lower boundary — instead of
 * null — so the overlay can start a CONTACT bend on the shared A-base contact WITHOUT synthesizing
 * the A/C banding tie. ``reclassifyStackedBandGrab`` STAYS null for this case (its both-column guard
 * is unchanged — the §106 absorb never re-opens through the tie path); the NEW resolver is a sibling
 * that carries the intervening onlap so the overlay knows to emit the bend-without-tie.
 *
 * TOPOLOGY (a faithful synthetic of CS1 gap-4):
 *   LEFT  : A (clay) 0..5,          C (matrix) 5..12   → A/C contact at el 5
 *   RIGHT : A (clay) 0..5, B (sand onlap) 5..7, C 7..12 → A base el 5, C top el 3 (B intervenes)
 *   The onlap tie: B's top (right, el 5) laps A's base (left, el 5) — the SAME line as A's base.
 */
import { describe, expect, it } from 'vitest'

import {
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type SectionRegion,
} from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { contactApexOverrideKey } from '../../utils/partitionFillV2/contactOverride'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { buildApexOverridesForGaps } from './apexOverrideWiring'
import {
  boundaryDragIsConsumable,
  pendingContactTieForDrag,
  reclassifyStackedBandGrab,
  resolveOnlapInterveningGrab,
  routeGrabbedBoundary,
} from './correlateOnDrag'

const A = 'body-a-clay' // full-width upper (the clay whose base is dragged)
const B = 'body-b-sand-onlap' // the sand onlap — pinches in on the RIGHT column between A and C
const C = 'body-c-matrix' // full-width lower

// ---- REAL CS1 gap-4 topology (S111) --------------------------------------
// Extracted verbatim from ``scripts/diag_allsections_input.json`` → "Cross-section 1",
// columns 4 & 5 — the owner's live grab (2026-07-25, "dragged the sand onlap and the clay band
// disappeared"). The clay ``934a78`` full-width; the matrix ``6bb744`` full-width; the sand onlap
// ``029c52`` intervenes on the RIGHT column (col5) between them. UNLIKE the synthetic above, the
// clay's base is NOT flush across the gap (col4 base el 5.21 vs col5 base el 6.44) and the onlap
// laps the DEEPER clay base — the exact shape the S110 synthetic missed. This locks the resolver +
// the shared-boundary dispatch routing against regression on the real model.
const RA = '019eb0b8-934a78' // clay 934a78 (full-width upper)
const RC = '019eb0b8-6bb744' // matrix 6bb744 (full-width lower)
const RB = '019eb0b8-029c52' // sand onlap 029c52 (intervenes on col5)

function realCs1Gap4(): PartitionColumn[] {
  return [
    {
      investigationId: 'cs1-col4',
      surfaceElevM: 13.37,
      units: [
        { topDepthM: 0.81, baseDepthM: 1.42, formationId: 'f-38d1bc', bodyId: 'cs1-218d5e', layerId: 'c4-0' },
        { topDepthM: 1.42, baseDepthM: 8.16, formationId: 'f-0f2e06', bodyId: RA, layerId: 'c4-a' },
        { topDepthM: 8.16, baseDepthM: 9.69, formationId: 'f-19bb43', bodyId: RC, layerId: 'c4-c' },
        { topDepthM: 9.69, baseDepthM: 15.16, formationId: 'f-38d1bc', bodyId: 'cs1-417604', layerId: 'c4-d' },
        { topDepthM: 15.16, baseDepthM: 23.06, formationId: 'f-19bb43', bodyId: 'cs1-1e8069', layerId: 'c4-e' },
      ],
    },
    {
      investigationId: 'cs1-col5',
      surfaceElevM: 13.35,
      units: [
        { topDepthM: 1.51, baseDepthM: 6.91, formationId: 'f-0f2e06', bodyId: RA, layerId: 'c5-a' }, // A base el 6.44
        { topDepthM: 6.91, baseDepthM: 7.62, formationId: 'f-38d1bc', bodyId: RB, layerId: 'c5-b' }, // B el 6.44..5.73
        { topDepthM: 7.62, baseDepthM: 9.8, formationId: 'f-19bb43', bodyId: RC, layerId: 'c5-c' }, // C top el 5.73
        { topDepthM: 9.8, baseDepthM: 15.64, formationId: 'f-38d1bc', bodyId: 'cs1-417604', layerId: 'c5-d' },
        { topDepthM: 15.64, baseDepthM: 23.06, formationId: 'f-19bb43', bodyId: 'cs1-1e8069', layerId: 'c5-e' },
      ],
    },
  ]
}

function section(): { columns: PartitionColumn[]; edges: CorrelationEdge[] } {
  const columns: PartitionColumn[] = [
    {
      investigationId: 'L',
      surfaceElevM: 10,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'L-a' },
        { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'L-c' },
      ],
    },
    {
      investigationId: 'R',
      surfaceElevM: 10,
      units: [
        { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'R-a' }, // A base el 5
        { topDepthM: 5, baseDepthM: 7, formationId: 'sand', bodyId: B, layerId: 'R-b' }, // B el 5..3
        { topDepthM: 7, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'R-c' }, // C top el 3
      ],
    },
  ]
  // The onlap tie: B's top (right, el 5) laps onto A's base (left, el 5) — the SAME line as A's base.
  const edges: CorrelationEdge[] = [{ a: 'L-a', b: 'R-b', aSide: 'base', bSide: 'top' }]
  return { columns, edges }
}

/** True when B renders as at least one region in gap 0 (it SURVIVES — never absorbed). */
function onlapSurvives(regions: SectionRegion[]): boolean {
  return regions.some((r) => r.bodyId === B && r.gapIndex === 0)
}

/** The onlap B's interior (mid-gap) APEX elevation in gap 0 — the tip that rides the tie. */
function onlapApexElev(regions: SectionRegion[]): number | null {
  const rs = regions.filter((r) => r.bodyId === B && r.gapIndex === 0)
  let best: number | null = null
  for (const r of rs)
    for (const p of r.polygon)
      if (p.fraction > 0.02 && p.fraction < 0.98) {
        if (best === null || p.elevation > best) best = p.elevation
      }
  return best
}

describe('S110 — the onlap-intervening grab ROUTES to a contact bend (not a lens drag, not a no-op)', () => {
  it('resolveOnlapInterveningGrab returns {upper:A, lower:C, ridingOnlaps:[B]} for a grab of the clay base', () => {
    const { columns } = section()
    // The owner grabs the CLAY (A) boundary near its BASE (el 5 = the shared A/C contact). On the
    // LEFT column A sits directly above C; on the RIGHT column the sand onlap B intervenes. The
    // resolver must recognise this as a contact-bend target carrying the intervening onlap.
    const resolved = resolveOnlapInterveningGrab(columns[0], columns[1], A, 5)
    expect(resolved, 'the onlap-intervening grab of the clay base must resolve (not null)').not.toBeNull()
    expect(resolved!.upperBodyId, 'A (clay) is the upper band').toBe(A)
    expect(resolved!.lowerBodyId, 'C (matrix) is the lower band').toBe(C)
    expect(resolved!.ridingOnlaps, 'the intervening sand onlap B is carried as a riding onlap').toContain(B)
  })

  it('reclassifyStackedBandGrab STAYS null for the onlap-intervening grab (the §107 guard unchanged)', () => {
    const { columns } = section()
    // §106 absorb hazard: the both-column adjacency guard in reclassifyStackedBandGrab must remain,
    // so the destructive banding-tie path never re-opens. The NEW resolver is a SIBLING, not a
    // replacement — reclassifyStackedBandGrab still returns null here.
    expect(reclassifyStackedBandGrab(columns[0], columns[1], A, 5)).toBeNull()
    expect(reclassifyStackedBandGrab(columns[0], columns[1], C, 5)).toBeNull()
  })

  it('a genuine two-full-band boundary (no intervening onlap) does NOT resolve as onlap-intervening', () => {
    // Two identical columns A over C, no onlap. This is the plain two-band case — it must route
    // through the EXISTING reclassifyStackedBandGrab + banding-tie path, NOT the onlap resolver.
    const plain: PartitionColumn[] = [
      {
        investigationId: 'L',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'L-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'L-c' },
        ],
      },
      {
        investigationId: 'R',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'R-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'R-c' },
        ],
      },
    ]
    // No onlap intervenes → the onlap resolver bails (this is the plain-band job, handled elsewhere).
    expect(resolveOnlapInterveningGrab(plain[0], plain[1], A, 5)).toBeNull()
    // The plain path DOES reclassify (unchanged behaviour).
    expect(reclassifyStackedBandGrab(plain[0], plain[1], A, 5)).not.toBeNull()
  })

  it('NO banding A/C tie is synthesized for the onlap-intervening grab (no re-absorb)', () => {
    const { columns } = section()
    // pendingContactTieForDrag({A, C}) resolves through resolveTwoBandBoundary, whose both-column
    // adjacency check catches the intervening B → null. So even if the overlay called it, no A/C
    // banding tie is created. The onlap-intervening dispatch must NOT call synthesizeContactTie:
    // the §106 absorb stays impossible because no A/C banding tie ever exists.
    expect(
      pendingContactTieForDrag(columns, 0, A, C, []),
      'no A/C banding tie is created for the onlap-intervening grab (the §106 absorb never re-opens)',
    ).toBeNull()
  })

  it('the onlapIntervening boundaryDrag WIRES a contact:A|C override (not contact:A|B), which the engine rides', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges } = section()
      // The overlay starts a boundaryDrag flagged onlapIntervening from resolveOnlapInterveningGrab
      // (upper=A, lower=C). buildApexOverridesForGaps → collectContactOverridesForGap must key the
      // contact override on the DRAGGED lower body C (the matrix), NOT the intervening onlap B whose
      // top ALSO sits at A's base contact. If it keyed contact:A|B, the engine bend would target the
      // wrong contact and the ride would fail. Drive the wiring with a live cursor at el 2, mid-gap.
      const CURSOR_EL = 2.0
      const leftX = 0
      const rightX = 100
      const alongToScreenX = (along: number): number => leftX + (rightX - leftX) * (along / 1) // single gap
      // levelToScreen / screenToLevel: identity-flip (higher el → smaller y). Use y = -el.
      const screenToLevel = (y: number): number => -y
      const { apexOverrides } = buildApexOverridesForGaps({
        orderedColumns: columns,
        gapXs: [{ leftX, rightX }],
        // Real usage always passes a Map (possibly empty). The isNew press-to-grab synthesizes the
        // control point from the cursor even with no stored boundary for A.
        boundariesByBodyId: new Map(),
        alongToScreenX,
        screenToLevel,
        lensDrag: null,
        // The contact-override wiring reads only the (upper, lower) pair + cursor from the drag; the
        // ``onlapIntervening`` flag lives on ``BoundaryDrag`` (the overlay state) and gates the TIE
        // path in the overlay, NOT the override build here — so it is not part of ``ContactDragState``.
        boundaryDrag: {
          upperBodyId: A,
          lowerBodyId: C,
          nodeIndex: 0,
          x: (leftX + rightX) / 2,
          y: -CURSOR_EL,
          leftX,
          rightX,
          isNew: true,
        },
      })
      // The wiring must produce the contact:A|C override (keyed on the dragged matrix, not the onlap).
      expect(apexOverrides.has(contactApexOverrideKey(A, C, 0)), 'contact:A|C override is wired').toBe(true)
      expect(apexOverrides.has(contactApexOverrideKey(A, B, 0)), 'no stray contact:A|B override').toBe(false)

      // Feed that wired override to the engine (edges = B's own onlap tie only, NO A/C banding tie).
      const after = computeSectionFillV2(columns, edges, apexOverrides)
      expect(onlapSurvives(after), 'the onlap B survives the wired bend').toBe(true)
      const afterApex = onlapApexElev(after)
      expect(afterApex, 'the onlap keeps an interior tip').not.toBeNull()
      expect(afterApex! < 4, `the onlap rides the wired bend DOWN (now ${afterApex})`).toBe(true)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('REAL CS1 gap-4: the resolver HITS on the owner-live topology (clay base not flush, onlap laps the deeper base)', () => {
    // Owner dogfeed 2026-07-25: "dragged the sand onlap and the clay band disappeared." The live
    // ``[freedraw]`` trace showed ``onlapIntervening=false`` — the S110 synthetic PASSED but the real
    // grab fell through to a plain un-tied boundaryDrag that ate the clay. The real topology differs
    // from the synthetic: the clay ``934a78`` base is NOT flush across the gap (col4 el 5.21 vs col5
    // el 6.44) and the onlap ``029c52`` laps the DEEPER clay base. The resolver must still HIT — the
    // grab column (col4, where clay & matrix ARE adjacent) is the LEFT column, the far column (col5)
    // carries the intervening onlap.
    const [col4, col5] = realCs1Gap4()
    // Grab near the clay base on the GRAB column (col4 base el 5.21).
    const resolved = resolveOnlapInterveningGrab(col4, col5, RA, 5.21)
    expect(resolved, 'the REAL CS1 gap-4 clay-base grab must resolve (not null)').not.toBeNull()
    expect(resolved!.upperBodyId, 'clay 934a78 is the upper band').toBe(RA)
    expect(resolved!.lowerBodyId, 'matrix 6bb744 is the lower band').toBe(RC)
    expect(resolved!.ridingOnlaps, 'the intervening sand onlap 029c52 rides').toContain(RB)
  })

  it('REAL CS1 gap-4: the onlap-intervening dispatch is chosen (routeGrabbedBoundary) — NOT a plain destructive grab', () => {
    // The SHARED-BOUNDARY dispatch (``sharedBoundaries``) — where the owner's clay-base grab actually
    // lands, because clay & matrix ARE adjacent on col4 so the A/C contact renders as a shared
    // boundary handle — must route THROUGH ``routeGrabbedBoundary`` to the onlap-intervening branch.
    // Before S111 that dispatch created a PLAIN un-tied ``isNew`` boundaryDrag (onlapIntervening=false)
    // that persisted an engine-inert node → the clay flooded away. ``routeGrabbedBoundary`` is the
    // shared decision both dispatch sites call; it must return the onlap-intervening route here.
    const [col4, col5] = realCs1Gap4()
    const route = routeGrabbedBoundary(col4, col5, RA, RC, 5.21)
    expect(route.kind, 'the clay-base grab with an intervening onlap routes onlap-intervening').toBe(
      'onlap-intervening',
    )
    if (route.kind === 'onlap-intervening') {
      expect(route.grab.upperBodyId).toBe(RA)
      expect(route.grab.lowerBodyId).toBe(RC)
      expect(route.grab.ridingOnlaps).toContain(RB)
    }
  })

  it('REAL CS1 gap-4: NO A/C banding tie is synthesized (the §106 absorb stays impossible)', () => {
    const [col4, col5] = realCs1Gap4()
    // The both-column adjacency check in resolveTwoBandBoundary catches the intervening onlap on
    // col5 → null → no banding tie ever created for the real grab either.
    expect(pendingContactTieForDrag([col4, col5], 0, RA, RC, [])).toBeNull()
  })

  it('a plain (adjacent-both-columns) boundary routes NOT onlap-intervening but a real two-band grab', () => {
    // The safety net must not mis-route a genuine two-band boundary. A plain A-over-C boundary
    // adjacent on BOTH columns routes to ``plain-boundary`` (the existing correlate-then-bend path),
    // never onlap-intervening and never the un-consumable no-op.
    const plain: PartitionColumn[] = [
      {
        investigationId: 'L',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'L-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'L-c' },
        ],
      },
      {
        investigationId: 'R',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'R-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'R-c' },
        ],
      },
    ]
    const route = routeGrabbedBoundary(plain[0], plain[1], A, C, 5)
    expect(route.kind, 'a plain two-band boundary is a plain grab (correlate-then-bend)').toBe('plain-boundary')
  })

  it('S111 SAFETY NET: an un-tied onlap-straddling boundary is NOT consumable (release must NO-OP, no band eaten)', () => {
    // The un-consumable-fallback safety net (owner standing rule: a build must never eat a band). If a
    // future resolver miss let the REAL CS1 gap-4 (A/C with the onlap intervening) reach the release as
    // a PLAIN drag, ``boundaryDragIsConsumable`` returns false → the persist NO-OPs → no engine-inert
    // node is written → the clay cannot flood away.
    const [col4, col5] = realCs1Gap4()
    expect(
      boundaryDragIsConsumable([col4, col5], 0, RA, RC),
      'the A/C boundary with an intervening onlap is NOT engine-consumable as a plain contact',
    ).toBe(false)
  })

  it('S111 SAFETY NET: a genuine two-full-band boundary IS consumable (normal correlate-then-bend persists)', () => {
    // The safety net must not suppress a real two-band grab. A plain A-over-C boundary adjacent on both
    // columns is consumable → the persist proceeds → the correlate-then-bend node is written normally.
    const plain: PartitionColumn[] = [
      {
        investigationId: 'L',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'L-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'L-c' },
        ],
      },
      {
        investigationId: 'R',
        surfaceElevM: 10,
        units: [
          { topDepthM: 0, baseDepthM: 5, formationId: 'clay', bodyId: A, layerId: 'R-a' },
          { topDepthM: 5, baseDepthM: 12, formationId: 'matrix', bodyId: C, layerId: 'R-c' },
        ],
      },
    ]
    expect(boundaryDragIsConsumable(plain, 0, A, C), 'a plain two-band boundary IS consumable').toBe(true)
  })

  it('with the contact:A|C bend (B keeps only its OWN onlap tie), B SURVIVES and RIDES the bend', () => {
    setTwoSidedTerminations(true)
    try {
      const { columns, edges } = section()
      // The edges carry ONLY B's own onlap tie (A-base ↔ B-top) — NO A/C banding tie. This is the
      // exact edge set the onlap-intervening dispatch feeds the engine.
      const base = computeSectionFillV2(columns, edges)
      expect(onlapSurvives(base), 'the sand onlap B renders in the base fill').toBe(true)
      const baseApex = onlapApexElev(base)
      expect(baseApex, 'the base onlap must have an interior tip').not.toBeNull()

      // The contact:A|C bend (built from the boundaryDrag by the overlay) drags the clay base DOWN
      // to el 2. B's top contact IS that line, so B rides it — no banding tie needed (B's own onlap
      // tie already sits on the A-base contact, so collectContactBends bends it).
      const CURSOR_EL = 2.0
      const ov = new Map<string, LensApexOverride>([
        [contactApexOverrideKey(A, C, 0), { fraction: 0.5, elevation: CURSOR_EL } as LensApexOverride],
      ])
      const after = computeSectionFillV2(columns, edges, ov)

      expect(onlapSurvives(after), 'the onlap B must SURVIVE the drag (never absorbed)').toBe(true)
      const afterApex = onlapApexElev(after)
      expect(afterApex, 'the dragged onlap must still have an interior tip').not.toBeNull()
      expect(
        afterApex! < baseApex! - 1.5,
        `the onlap tip must ride the bent contact DOWN (was ${baseApex}, now ${afterApex})`,
      ).toBe(true)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

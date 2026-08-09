// Why the geotech axis withholds ContactsLayer's min-thickness drag clamp.
//
// GS4/GS5 in SectionPanel.geotechSnap.test.tsx pin that the prop is not passed there.
// That is the decision, not its consequence — SectionPanel mocks ContactsLayer, so
// nothing in that file shows what leaving the clamp active would DO. These cases show it,
// by driving the real drag and feeding the depth it commits into the real planner. If the
// two ever disagree about what a landing is, one of these goes red.
//
// The mechanism, stated once: `handleMove` clamps the drag to 10 cm clear of the
// neighbouring contacts, and on the geotech axis those neighbours ARE the packing
// boundaries — the only depths the drag may land on. `clampToNextBoundary` then asks
// whether the drag reached one, and a drag stopped 10 cm short of every boundary reached
// none.
//
// It does not bite at every zoom, and the cases say where the edge is. The clamp runs
// BEFORE `snapDepth`, whose window is SNAP_TOLERANCE_PX = 8, so a 10 cm shortfall is
// pulled back onto the boundary whenever 0.1 m is under 8 px — i.e. below ~80 px/m. Above
// that, and at ANY zoom when the snap toggle is off and there are no candidates to snap
// to, the shortfall survives and the landing is lost.
//
// Pinned claims:
//   DC1  Zoomed in, with the clamp active, the drag commits short and lands nothing.
//   DC2  Withheld — what the geotech axis does — the same drag lands on the boundary.
//   DC3  Zoomed out the snap window rescues the shortfall, so the clamp is harmless there.
//        (The bound on DC1: this is why the fix is about interbed work, not everything.)
//   DC4  With snap off there is nothing to rescue it, and the landing is lost at any zoom.

import { act, fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type {
  CptListItem,
  FormationContactResponse,
  GeologicalFormationResponse,
  LithoLayerResponse,
} from '../../api/client'
import type { ProjectedInvestigation } from '../../utils/sectionProjection'
import ContactsLayer from './ContactsLayer'
import type { SnapCandidate } from './ContactsLayer'
import { planGeotechContactDrag } from './geotechContactDrag'
import { packingSnapCandidates } from './geotechSnapTargets'
import type { PlacedColumn } from './utils'

// ---------------------------------------------------------------------------
// One CPT column, the shape the drag actually meets on the geotech axis:
//
//   litho:    KLEI 0 ... 3          ZAND 3 ................ 9
//   packing:  g1 0-3           | g2 3-5 | g3 5-9
//   boundary:                  ^3 CONTACT  ^5 packing
//
// The drag grabs the contact at 3 m and aims past the packing boundary at 5 m.
// ---------------------------------------------------------------------------

const COLUMN_ELEVATION_M = 10

/**
 * One layer row on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the top, in metres below the collar.
 * @param base Depth of the base, in metres below the collar.
 */
function layer(id: string, top: number, base: number): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: `body-${id}`,
    notes: null,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  } as LithoLayerResponse
}

const GEOTECH_LAYERS = [layer('g1', 0, 3), layer('g2', 3, 5), layer('g3', 5, 9)]
const LITHO_LAYERS = [layer('L-klei', 0, 3), layer('L-zand', 3, 9)]
const LITHO_CONTACTS = [contactAt('L-zand', 3)]

/** The candidate set SectionPanel builds for this column on the geotech axis. */
const SNAP_SET: ReadonlyMap<string, readonly SnapCandidate[]> =
  packingSnapCandidates(GEOTECH_LAYERS)

/**
 * A contact on the CPT column.
 *
 * @param id Contact id — on this axis, the geotech layer whose top it is.
 * @param depthM Depth below the collar, in metres.
 */
function contactAt(id: string, depthM: number): FormationContactResponse {
  return {
    id,
    model_id: 'm-1',
    formation_id: 'f-1',
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: depthM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-08-09T00:00:00Z',
    updated_at: '2026-08-09T00:00:00Z',
  } as FormationContactResponse
}

/** The two contacts ContactsLayer draws: the boundary at 3 m and the one at 5 m. */
const CONTACTS = [contactAt('g2', 3), contactAt('g3', 5)]

const FORMATION = {
  id: 'f-1',
  app_project_id: 'P',
  name: 'Unit',
  color: '#ff8800',
  code: null,
  display_order: 0,
  pinned_order: false,
  regional_ref: null,
  description: null,
  lithology: null,
  nad_class: null,
  parent_formation_id: null,
  litho_main_soil_code: null,
  litho_admixtures: null,
  instance_ordinal: null,
  instance_ordinal_locked: false,
  parent_formation_name: null,
  parent_extrapolated: false,
  source_litho_formation_id: null,
  source_geo_formation_id: null,
  created_at: '2026-08-09T00:00:00Z',
  updated_at: '2026-08-09T00:00:00Z',
} as GeologicalFormationResponse

/** The placed CPT column the contacts hang off. */
function placedColumn(): PlacedColumn {
  const item = {
    id: 'cpt-1',
    name: 'CPT-1',
    elevation_m: COLUMN_ELEVATION_M,
    epsg: 31370,
    z_epsg: 5710,
  } as unknown as CptListItem
  const proj = { item, along: 0, offset: 0, side: 'on' as const } as unknown as ProjectedInvestigation<CptListItem>
  return { kind: 'cpt', proj, trueX: 100, nudgedX: 100, width: 14, displaced: false }
}

/**
 * Drag the contact at 3 m down past the packing boundary at 5 m, and report where it
 * committed and what the planner then makes of that depth.
 *
 * @param pxPerMetre Vertical scale — the whole point of DC1 vs DC3.
 * @param clampMinThicknessM The prop under test; `undefined` is what the geotech axis passes.
 * @param snapSet The snap candidates, or `null` for "the snap toggle is off". NULL and not
 *   `undefined`: an explicit `undefined` argument takes the default, so a caller asking
 *   for no snap set would silently get one and the case would pin the opposite of what it
 *   says (DC4 did exactly that until it failed).
 * @returns The committed depth and the plan built from it.
 */
function dragPastTheBoundary(
  pxPerMetre: number,
  clampMinThicknessM: number | undefined,
  snapSet: ReadonlyMap<string, readonly SnapCandidate[]> | null = SNAP_SET,
) {
  const onUpdateContactDepth = vi.fn().mockResolvedValue(undefined)
  const levelToScreen = (level: number): number => (20 - level) * pxPerMetre
  const { container } = render(
    <svg>
      <ContactsLayer
        contacts={CONTACTS}
        formations={[FORMATION]}
        placedColumns={[placedColumn()]}
        levelToScreen={levelToScreen}
        plotTop={0}
        plotBottom={20 * pxPerMetre + 1000}
        perColumnBandsFromContacts
        contactDragClampMinThicknessM={clampMinThicknessM}
        snapDepthsByAnchorId={snapSet ?? undefined}
        onUpdateContactDepth={onUpdateContactDepth}
        axisMode="geotechnical"
      />
    </svg>,
  )

  const strip = container.querySelector(
    '[data-testid="contact-drag-strip"][data-contact-id="g2"]',
  )
  // Precondition, not a claim: without the strip the drag never happens and every
  // assertion below would pass vacuously.
  expect(strip).not.toBeNull()

  // 2 m of travel past the contact at 3 m, i.e. released at 5.5 m — half a metre past
  // the packing boundary the drag is aiming for.
  fireEvent.mouseDown(strip!, { clientY: 0, button: 0 })
  act(() => {
    document.dispatchEvent(
      new MouseEvent('mousemove', { clientY: 2.5 * pxPerMetre, buttons: 1, bubbles: true }),
    )
  })
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
  })

  expect(onUpdateContactDepth).toHaveBeenCalledTimes(1)
  const committedDepthM = onUpdateContactDepth.mock.calls[0][1] as number
  return {
    committedDepthM,
    plan: planGeotechContactDrag({
      geotechContactId: 'g2',
      toDepthM: committedDepthM,
      geotechLayers: GEOTECH_LAYERS,
      lithoLayers: LITHO_LAYERS,
      lithoContacts: LITHO_CONTACTS,
    }),
  }
}

describe('the min-thickness clamp against the geotech landing rule', () => {
  it('DC1 — zoomed in with the clamp active, the drag stops short and lands nothing', () => {
    // 100 px/m: the 10 cm the clamp holds back is 10 px, outside the 8 px snap window,
    // so the shortfall survives to the commit.
    const { committedDepthM, plan } = dragPastTheBoundary(100, 0.1)

    expect(committedDepthM).toBeCloseTo(4.9, 5)
    expect(plan).toEqual({ kind: 'no-boundary-crossed' })
  })

  it('DC2 — withheld, the same drag lands on the boundary', () => {
    // What the geotech axis actually passes. The drag is free to cross, and the landing
    // rule — not the clamp — is what decides where it stops: the FIRST boundary crossed.
    const { committedDepthM, plan } = dragPastTheBoundary(100, undefined)

    expect(committedDepthM).toBeCloseTo(5.5, 5)
    expect(plan).toEqual({ kind: 'move', lithoContactId: 'L-zand', depthM: 5 })
  })

  it('DC3 — zoomed out the snap window rescues the shortfall, so the clamp is harmless', () => {
    // 1 px/m: 10 cm is 0.1 px, well inside the 8 px snap window, so `snapDepth` pulls the
    // clamped depth back onto the boundary and the landing survives. The bound on DC1 —
    // the clamp broke zoomed-in interbed work, not every drag everywhere.
    const { committedDepthM, plan } = dragPastTheBoundary(1, 0.1)

    expect(committedDepthM).toBeCloseTo(5, 5)
    expect(plan).toEqual({ kind: 'move', lithoContactId: 'L-zand', depthM: 5 })
  })

  it('DC4 — with the snap toggle off there is nothing to rescue it, at any zoom', () => {
    // The other half of DC3, and the DEFAULT: `snap_to_stratigraphy` is off unless the
    // engineer turns it on, and with no candidate set there is no snap to pull the
    // clamped depth anywhere. Zoomed out, where DC3 was safe, the landing is lost.
    const { committedDepthM, plan } = dragPastTheBoundary(1, 0.1, null)

    expect(committedDepthM).toBeCloseTo(4.9, 5)
    expect(plan).toEqual({ kind: 'no-boundary-crossed' })
  })
})

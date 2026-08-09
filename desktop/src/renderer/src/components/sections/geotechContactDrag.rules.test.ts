// Dragging a lithostratigraphic contact from the geotech axis.
//
// The engineer is looking at the axis that shows the cone resistance's own reading of
// the ground. On finely interbedded ground the boundary he wants to move IS a litho
// contact, and the CPT resolved it better than the driller's 0.5 m log grid did — so the
// contact is draggable HERE, onto the packing boundaries, and the edit lands on the LITHO
// row it restates.
//
// Two rules decide whether a boundary can be dragged at all, and they are different
// questions:
//   * PARENTAGE decides IF: a boundary between two bands in different litho bodies IS a
//     restated litho contact. A boundary inside one body is an internal packing boundary
//     and keeps refusing — that is the hierarchy rule (a packing boundary never crosses a
//     litho contact) and it is why the packing drag exists separately.
//   * DEPTH decides only WHICH litho row is being restated, within a millimetre. The
//     geotech materialiser rounds depths to 3 decimals while litho contacts keep full
//     float precision, so a fifth of the coincident boundaries on the owner's real model
//     are NOT bit-identical to their contact (255 exact, 67 within a millimetre).
//
// Pinned claims:
//   GC1  Dragging a restated contact down past several boundaries lands on the FIRST one.
//   GC2  Same upward.
//   GC3  A drag that crosses no boundary does not move the contact at all.
//   GC4  An internal packing boundary is not a contact drag — parentage refuses it.
//   GC5  A litho row further than a millimetre away is NOT the restated row: refuse
//        rather than guess.
//   GC6  The top of the column is not an internal boundary and owns no drag.
//   GC7  A borehole column offers nothing to land on, so the drag does not move it.
//   GC8  The plan targets the LITHO contact id, never the geotech row that was grabbed.

import { describe, expect, it } from 'vitest'

import type { FormationContactResponse, LithoLayerResponse } from '../../api/client'
import { planGeotechContactDrag } from './geotechContactDrag'

// ---------------------------------------------------------------------------
// Fixtures — one CPT column, two litho bodies, four packing bands.
//
//   litho:    KLEI  0 ....... 4        ZAND  4 ............. 10
//   packing:  g1 0-2 | g2 2-4        | g3 4-7 | g4 7-10
//   boundary:        ^2 packing        ^4 CONTACT   ^7 packing
// ---------------------------------------------------------------------------

/**
 * One layer row on the CPT column.
 *
 * @param id Layer id.
 * @param top Depth of the top, in metres below the collar.
 * @param base Depth of the base, in metres below the collar.
 * @param anchor Which investigation the row hangs off (defaults to the CPT).
 */
function layer(
  id: string,
  top: number,
  base: number,
  anchor: { cpt_id: string | null; borehole_id: string | null } = {
    cpt_id: 'cpt-1',
    borehole_id: null,
  },
): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: `f-${id}`,
    cpt_id: anchor.cpt_id,
    borehole_id: anchor.borehole_id,
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
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  } as LithoLayerResponse
}

/**
 * A litho contact on the CPT column.
 *
 * @param id Contact id — the litho layer id whose top it is.
 * @param depthM Depth below the collar, in metres.
 */
function contact(id: string, depthM: number): FormationContactResponse {
  return {
    id,
    model_id: 'litho-model',
    formation_id: `f-${id}`,
    cpt_id: 'cpt-1',
    borehole_id: null,
    depth_top_m: depthM,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-08-08T00:00:00Z',
    updated_at: '2026-08-08T00:00:00Z',
  } as FormationContactResponse
}

const LITHO_LAYERS = [layer('L-klei', 0, 4), layer('L-zand', 4, 10)]

const GEOTECH_LAYERS = [
  layer('g1', 0, 2),
  layer('g2', 2, 4),
  layer('g3', 4, 7),
  layer('g4', 7, 10),
]

// The materialiser rounded the band top to 4.000; the litho contact it restates keeps its
// full float depth. Under a millimetre apart — the everyday case on the real model.
const LITHO_CONTACTS = [contact('L-zand', 4.0000123)]

/**
 * Plan one drag on the standard fixture.
 *
 * @param geotechContactId The grabbed geotech row (the boundary is its top).
 * @param toDepthM Where the cursor released, in metres below the collar.
 * @param overrides Fixture overrides for the borehole / unmatched cases.
 */
function plan(
  geotechContactId: string,
  toDepthM: number,
  overrides: {
    geotechLayers?: readonly LithoLayerResponse[]
    lithoLayers?: readonly LithoLayerResponse[]
    lithoContacts?: readonly FormationContactResponse[]
  } = {},
) {
  return planGeotechContactDrag({
    geotechContactId,
    toDepthM,
    geotechLayers: overrides.geotechLayers ?? GEOTECH_LAYERS,
    lithoLayers: overrides.lithoLayers ?? LITHO_LAYERS,
    lithoContacts: overrides.lithoContacts ?? LITHO_CONTACTS,
  })
}

describe('planGeotechContactDrag — a contact drag on the geotech axis', () => {
  it('GC1 — dragging down past two boundaries lands on the first one crossed', () => {
    // Released at 8.5 m, past the packing boundary at 7 AND the column base at 10.
    // One drag consumes one boundary: moving it further takes another drag, and each
    // step is its own decision and its own undo entry.
    expect(plan('g3', 8.5)).toEqual({ kind: 'move', lithoContactId: 'L-zand', depthM: 7 })
  })

  it('GC2 — dragging up past two boundaries lands on the first one crossed', () => {
    expect(plan('g3', 1)).toEqual({ kind: 'move', lithoContactId: 'L-zand', depthM: 2 })
  })

  it('GC3 — a drag that reaches no boundary leaves the contact where it was', () => {
    // Nothing between 4 and 4.4 to land on. The honest answer is to leave the
    // interpretation where the engineer last put it deliberately, not to slide it to
    // whatever depth the cursor happened to stop at.
    expect(plan('g3', 4.4)).toEqual({ kind: 'no-boundary-crossed' })
  })

  it('GC4 — an internal packing boundary is not a contact drag', () => {
    // g1 and g2 both sit inside the KLEI body, so the boundary at 2 m is the owner's own
    // subdivision — the packing drag owns it and the hierarchy rule stands.
    expect(plan('g2', 3.5)).toEqual({ kind: 'packing-boundary' })
  })

  it('GC5 — a litho row further than a millimetre away is not the restated row', () => {
    // 5 mm off: parentage says this boundary restates a contact, but nothing here is
    // that contact. Refuse and say so — guessing would move a row the engineer never
    // pointed at, and a silent no-op is the bug being removed.
    const far = [contact('L-zand', 4.005)]
    expect(plan('g3', 8.5, { lithoContacts: far })).toEqual({
      kind: 'unmatched',
      anchorId: 'cpt-1',
      boundaryDepthM: 4,
    })
  })

  it('GC6 — the top of the column owns no drag', () => {
    // g1's top is where the cone started, not a boundary between two bands.
    expect(plan('g1', 3)).toEqual({ kind: 'not-a-boundary' })
  })

  it('GC7 — a borehole column offers nothing to land on', () => {
    // A borehole records no cone resistance: its packing bands were extrapolated from
    // the neighbouring CPTs, so there is no reading HERE for the contact to land on.
    const onBorehole = { cpt_id: null, borehole_id: 'bh-1' }
    const bhGeotech = [
      layer('b1', 0, 2, onBorehole),
      layer('b2', 2, 4, onBorehole),
      layer('b3', 4, 7, onBorehole),
    ]
    const bhLitho = [layer('BL-klei', 0, 4, onBorehole), layer('BL-zand', 4, 7, onBorehole)]
    const bhContacts = [{ ...contact('BL-zand', 4), cpt_id: null, borehole_id: 'bh-1' }]
    expect(
      plan('b3', 6.5, {
        geotechLayers: bhGeotech,
        lithoLayers: bhLitho,
        lithoContacts: bhContacts,
      }),
    ).toEqual({ kind: 'no-boundary-crossed' })
  })

  it('GC8 — the move targets the litho row, never the geotech row that was grabbed', () => {
    const result = plan('g3', 8.5)

    // The grabbed row is a geotech band; moving IT is what the next Subdivide discards.
    // The edit belongs to the litho model, which is why the plan names a litho id.
    expect(result).toMatchObject({ kind: 'move' })
    if (result.kind === 'move') expect(result.lithoContactId).not.toBe('g3')
  })
})

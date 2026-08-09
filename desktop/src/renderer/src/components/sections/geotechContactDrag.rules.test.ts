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

// The same column shape on a borehole: bands that "Divide boreholes" extrapolated from the
// CPTs around it, with no cone resistance of their own behind them.
const ON_BOREHOLE = { cpt_id: null, borehole_id: 'bh-1' }
const BOREHOLE_GEOTECH = [
  layer('b1', 0, 2, ON_BOREHOLE),
  layer('b2', 2, 4, ON_BOREHOLE),
  layer('b3', 4, 7, ON_BOREHOLE),
]
const BOREHOLE_LITHO = [
  layer('BL-klei', 0, 4, ON_BOREHOLE),
  layer('BL-zand', 4, 7, ON_BOREHOLE),
]
const BOREHOLE_CONTACTS = [{ ...contact('BL-zand', 4), cpt_id: null, borehole_id: 'bh-1' }]

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

  it('GC3 — a drag that reaches no boundary NUDGES the contact to where it was released', () => {
    // Reversed on owner dogfeed, 2026-08-09: "i want to be able to nudge those solids ...
    // we're refining from geo-litho-geotech, so if we want to refine in the geotech then
    // the rest should move too".
    //
    // Refusing a sub-boundary drag made a small correction impossible: the gesture either
    // jumped a whole boundary or reported "The contact did not move", which is what he
    // hit. The packing boundary is a WALL (GC1/GC2 still clamp at it), not a magnet — so
    // anywhere short of it is the engineer's to choose.
    expect(plan('g3', 4.4)).toEqual({ kind: 'move', lithoContactId: 'L-zand', depthM: 4.4 })
  })

  it('GC3b — and a release exactly where it started still moves nothing', () => {
    // No travel is not a nudge. Without this the press-and-release that opens a menu or
    // just picks the contact would write a PATCH for the depth it already has.
    expect(plan('g3', 4)).toEqual({ kind: 'no-boundary-crossed' })
  })

  it('GC4 — an internal packing boundary is not a contact drag', () => {
    // g1 and g2 both sit inside the KLEI body, so the boundary at 2 m is the owner's own
    // subdivision — the packing drag owns it and the hierarchy rule stands.
    //
    // The anchor rides along because the caller has to SAY so, and what to say differs:
    // on a CPT the boundary has a handle of its own beside the column, on a borehole
    // nothing here can move it at all.
    expect(plan('g2', 3.5)).toEqual({ kind: 'packing-boundary', anchorIsCpt: true })
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

  // GC10/GC11 straddle RESTATED_CONTACT_TOLERANCE_M itself, one on each side of it.
  //
  // Without them the constant is undefended: GC1's row is 12 µm away and GC5's is 5 mm,
  // so ANY threshold between those two keeps this suite green. Tighten it to 1e-4 in a
  // later tidy-up and the 67 boundaries on the owner's real database that coincide only
  // within a millimetre would start refusing — silently, on his data, with the suite
  // still passing. The number came from measuring that database (255 bit-identical, 67
  // within a millimetre), so it is a finding, and a finding needs a test.
  it('GC10 — a row 1.0 mm away still is the restated row', () => {
    const justInside = [contact('L-zand', 4.001)]
    expect(plan('g3', 8.5, { lithoContacts: justInside })).toEqual({
      kind: 'move',
      lithoContactId: 'L-zand',
      depthM: 7,
    })
  })

  it('GC11 — and a row 1.2 mm away is not', () => {
    // Nothing physical happens between 1.0 mm and 1.2 mm: the tolerance is the width of
    // the materialiser's mm rounding, so a row further out than that rounding could
    // explain is a DIFFERENT boundary, not this one seen imprecisely.
    const justOutside = [contact('L-zand', 4.0012)]
    expect(plan('g3', 8.5, { lithoContacts: justOutside })).toEqual({
      kind: 'unmatched',
      anchorId: 'cpt-1',
      boundaryDepthM: 4,
    })
  })

  it('GC6 — the top of the column owns no drag', () => {
    // g1's top is where the cone started, not a boundary between two bands.
    expect(plan('g1', 3)).toEqual({ kind: 'not-a-boundary' })
  })

  it('GC7 — a borehole column offers nothing to land on, and says which nothing that is', () => {
    // A borehole records no cone resistance: its packing bands were extrapolated from
    // the neighbouring CPTs, so there is no reading HERE for the contact to land on.
    //
    // Told apart from GC3 on purpose. "You did not drag far enough" and "there is
    // nothing on this column to drag to, ever" look identical from the outside — the
    // handle moves and nothing happens — and only one of them is worth trying again.
    expect(
      plan('b3', 6.5, {
        geotechLayers: BOREHOLE_GEOTECH,
        lithoLayers: BOREHOLE_LITHO,
        lithoContacts: BOREHOLE_CONTACTS,
      }),
    ).toEqual({ kind: 'no-packing-boundaries', anchorId: 'bh-1' })
  })

  it('GC9 — and a borehole packing boundary reports the borehole, not a CPT', () => {
    // b1 and b2 both sit in the borehole's KLEI body. Same refusal as GC4, different
    // remedy: a CPT column carries a band handle for this boundary and a borehole
    // carries none, so the caller must be able to tell the two apart.
    expect(
      plan('b2', 3.5, {
        geotechLayers: BOREHOLE_GEOTECH,
        lithoLayers: BOREHOLE_LITHO,
        lithoContacts: BOREHOLE_CONTACTS,
      }),
    ).toEqual({ kind: 'packing-boundary', anchorIsCpt: false })
  })

  it('GC8 — the nearest row ON THIS COLUMN is the restated one, not the first found', () => {
    // GC1 already fixes the id exactly, so it covers "the plan names a litho row". What
    // it cannot cover is CHOOSING between rows, because it offers only one. A real
    // column has several, and two mistakes are easy to make and invisible with one:
    //
    //   * dropping the column filter — the decoy below sits at exactly 4 m on ANOTHER
    //     CPT, so it is nearer than the true row and would win outright;
    //   * taking the first row inside the tolerance instead of the nearest — the second
    //     decoy is on this column, inside the millimetre, and listed first.
    //
    // Both would move a boundary the engineer never pointed at, on a different column or
    // at a different depth, and neither would fail any other case in this file.
    const withDecoys = [
      { ...contact('L-other-column', 4), cpt_id: 'cpt-2' },
      contact('L-zand-further', 4.0009),
      contact('L-zand', 4.0000123),
    ]
    expect(plan('g3', 8.5, { lithoContacts: withDecoys })).toEqual({
      kind: 'move',
      lithoContactId: 'L-zand',
      depthM: 7,
    })
  })
})

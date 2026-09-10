// What each packing band gets paired with before the fit rule judges it.
//
// Claims pinned here:
//   BP1  A band is paired with the litho unit on ITS OWN column.
//   BP2  A litho row for the same formation on a different column is not a parent.
//   BP3  Where the formation recurs on the column, the band is paired with the
//        occurrence it overlaps — either one, in either row order.
//   BP4  A band that overlaps NO occurrence is still paired (with the first),
//        because "the contact was dragged clean past it" is the worst kind of
//        staleness, not an unresolvable parent.
//   BP5  Borehole-anchored bands are paired like a CPT's (owner 2026-09-10 —
//        a re-composed piece under a borehole's band read as up to date).
//   BP6  A band whose geotech unit is missing from the roster, or whose unit
//        names no litho parent, is paired with null.
//   BP7  A litho row hung off a BOREHOLE is never a CPT band's parent.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../api/client'
import { pairBandsWithLithoParents } from './geotechBandParents'

const LITHO_FORMATION_ID = 'litho-form-1'
const GEOTECH_FORMATION_ID = 'geotech-form-1'

/** A layer row; the caller decides whether it stands for a litho unit or a band. */
function layer(
  overrides: Partial<LithoLayerResponse> & {
    formation_id: string
    depth_top_m: number
    depth_base_m: number
  },
): LithoLayerResponse {
  return {
    id: 'row-1',
    model_id: 'model-1',
    borehole_id: null,
    cpt_id: 'cpt-A',
    status: 'accepted',
    source: 'segmenter',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

/** A litho unit occupying `top`→`base` on `columnId`. */
function unit(columnId: string, top: number, base: number, formationId = LITHO_FORMATION_ID) {
  return layer({ cpt_id: columnId, formation_id: formationId, depth_top_m: top, depth_base_m: base })
}

/** A packing band on `columnId`. */
function band(columnId: string, top: number, base: number, formationId = GEOTECH_FORMATION_ID) {
  return layer({ cpt_id: columnId, formation_id: formationId, depth_top_m: top, depth_base_m: base })
}

/** The geotech unit roster: one NAD unit pointing at its litho parent. */
const ROSTER: GeologicalFormationResponse[] = [
  {
    id: GEOTECH_FORMATION_ID,
    app_project_id: 'proj-1',
    name: 'NAD class 15',
    color: '#4a90d9',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: 15,
    parent_formation_id: null,
    source_litho_formation_id: LITHO_FORMATION_ID,
    source_geo_formation_id: 'geo-form-1',
    litho_main_soil_code: 'ZAND',
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  },
]

describe('pairBandsWithLithoParents', () => {
  it('BP1 — pairs a band with the litho unit on its own column', () => {
    const paired = pairBandsWithLithoParents([band('cpt-A', 2, 5)], [unit('cpt-A', 2, 8)], ROSTER)
    expect(paired).toEqual([
      {
        columnId: 'cpt-A',
        topDepthM: 2,
        baseDepthM: 5,
        parent: { formationId: LITHO_FORMATION_ID, topDepthM: 2, baseDepthM: 8 },
        parentMissingOnColumn: false,
      },
    ])
  })

  it('BP2 — the same formation on another column is not a parent', () => {
    // cpt-B's copy of the unit sits 18 m deeper; using it would report cpt-A as
    // stale on the strength of a different hole in the ground.
    const paired = pairBandsWithLithoParents([band('cpt-A', 2, 5)], [unit('cpt-B', 20, 28)], ROSTER)
    expect(paired[0].parent).toBeNull()
  })

  it('BP3 — a recurring formation pairs each band with the occurrence it overlaps', () => {
    // Two ZAND bodies on the column. Whichever order the rows arrive in, the
    // shallow band must get the shallow body and the deep band the deep one.
    const bands = [band('cpt-A', 0.5, 1.5), band('cpt-A', 5.5, 7.5)]
    for (const rows of [
      [unit('cpt-A', 0, 2), unit('cpt-A', 5, 8)],
      [unit('cpt-A', 5, 8), unit('cpt-A', 0, 2)],
    ]) {
      const paired = pairBandsWithLithoParents(bands, rows, ROSTER)
      expect(paired[0].parent).toEqual({
        formationId: LITHO_FORMATION_ID,
        topDepthM: 0,
        baseDepthM: 2,
      })
      expect(paired[1].parent).toEqual({
        formationId: LITHO_FORMATION_ID,
        topDepthM: 5,
        baseDepthM: 8,
      })
    }
  })

  it('BP4 — a band overlapping no occurrence is still paired, not orphaned', () => {
    // The contact was dragged clean past the band: it now overlaps neither body.
    // Pairing it with null would call the worst case "not staleness".
    const paired = pairBandsWithLithoParents(
      [band('cpt-A', 3, 4)],
      [unit('cpt-A', 0, 2), unit('cpt-A', 5, 8)],
      ROSTER,
    )
    expect(paired[0].parent).not.toBeNull()
  })

  it("BP5 — a borehole-anchored band is paired like a CPT's (owner 2026-09-10)", () => {
    // Boreholes were skipped until the owner re-composed a piece under a
    // borehole's band and nothing said the column was out of date.
    const boreholeBand = layer({
      cpt_id: null,
      borehole_id: 'bh-1',
      formation_id: GEOTECH_FORMATION_ID,
      depth_top_m: 2,
      depth_base_m: 10,
    })
    const boreholeUnit = layer({
      cpt_id: null,
      borehole_id: 'bh-1',
      formation_id: LITHO_FORMATION_ID,
      depth_top_m: 2,
      depth_base_m: 8,
    })
    const paired = pairBandsWithLithoParents([boreholeBand], [boreholeUnit], ROSTER)
    expect(paired).toHaveLength(1)
    expect(paired[0].columnId).toBe('bh-1')
    expect(paired[0].parent).toEqual({ formationId: LITHO_FORMATION_ID, topDepthM: 2, baseDepthM: 8 })
  })

  it('BP6 — an unresolvable geotech unit pairs with null', () => {
    // Missing from the roster entirely...
    expect(
      pairBandsWithLithoParents(
        [band('cpt-A', 2, 5, 'geotech-form-unknown')],
        [unit('cpt-A', 2, 8)],
        ROSTER,
      )[0].parent,
    ).toBeNull()
    // ...and present but naming no litho parent.
    const parentless = [{ ...ROSTER[0], source_litho_formation_id: null }]
    expect(
      pairBandsWithLithoParents([band('cpt-A', 2, 5)], [unit('cpt-A', 2, 8)], parentless)[0]
        .parent,
    ).toBeNull()
  })

  it('BP8 — equal overlap is broken by depth, so row order cannot decide the pair', () => {
    // A band straddling the contact between two bodies overlaps each by 1 m. It
    // overhangs whichever it is paired with, so the staleness answer is the same
    // either way — but the pair itself must not flip when the server returns the
    // same two rows in the other order.
    const straddling = [band('cpt-A', 1, 3)]
    const shallow = { formationId: LITHO_FORMATION_ID, topDepthM: 0, baseDepthM: 2 }
    for (const rows of [
      [unit('cpt-A', 0, 2), unit('cpt-A', 2, 4)],
      [unit('cpt-A', 2, 4), unit('cpt-A', 0, 2)],
    ]) {
      expect(pairBandsWithLithoParents(straddling, rows, ROSTER)[0].parent).toEqual(shallow)
    }
  })

  it('BP7 — a litho row hung off a borehole is never the parent of a CPT band', () => {
    const boreholeUnit = layer({
      cpt_id: null,
      borehole_id: 'bh-1',
      formation_id: LITHO_FORMATION_ID,
      depth_top_m: 2,
      depth_base_m: 8,
    })
    expect(pairBandsWithLithoParents([band('cpt-A', 2, 5)], [boreholeUnit], ROSTER)[0].parent)
      .toBeNull()
  })
})

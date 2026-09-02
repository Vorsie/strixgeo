// A GROUPED body's Parameters header (debt #278 D2, owner ruling 2026-09-02).
//
// Owner, verbatim: "Header becomes head of 3 litho bodies and then a summation
// in bullet points which litho bodies — that way we have provenance." So a
// grouped scope REPLACES the confusing deep breadcrumb ("SILT › SILT · #10 › …")
// with a group title ("Group N — M bodies · <class>") plus a provenance list of
// the source LITHO bodies each member sits under.
//
// HG1 — the group title names the group, the member count and the packing class,
//        NOT a deep breadcrumb.
// HG2 — the provenance list is each member's source litho body, in order.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import type { BodyRosterEntry } from './parameterUnitBodies'
import type { ParameterTreeInput } from './parameterBodyTree'
import { groupProvenanceLithoBodies, scopeHeaderLabel } from './parameterScopeHeader'

function formation(id: string, over: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'p',
    name: id,
    color: '#888',
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
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    parent_extrapolated: false,
    created_at: '',
    updated_at: '',
    ...over,
  }
}

function layer(id: string, over: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id,
    model_id: 'm',
    formation_id: 'f',
    borehole_id: null,
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'high',
    parent_litho_layer_id: null,
    body_id: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as LithoLayerResponse
}

function roster(rows: Array<[string, BodyRosterEntry]>): ReadonlyMap<string, BodyRosterEntry> {
  return new Map(rows)
}

/** Two disjoint SF (NAD 13) geotech bodies in two different litho bodies. */
function makeScene(): ParameterTreeInput {
  return {
    lithoFormations: [formation('silt-unit', { name: 'SILT', display_order: 0 })],
    geotechFormations: [formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt-unit' })],
    lithoLayers: [
      layer('L1', { formation_id: 'silt-unit', body_id: 'lb0', cpt_id: 'c1' }),
      layer('L2', { formation_id: 'silt-unit', body_id: 'lb1', cpt_id: 'c2' }),
    ],
    geotechLayers: [
      layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gA', cpt_id: 'c1' }),
      layer('g2', { formation_id: 'silt-sf', parent_litho_layer_id: 'L2', body_id: 'gB', cpt_id: 'c2' }),
      // gC shares litho body lb0 with gA — the dedup-with-count case.
      layer('g3', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gC', cpt_id: 'c1' }),
    ],
    lithoBodies: roster([
      ['lb0', { name: null, body_ordinal: 0, formation_id: 'silt-unit' }],
      ['lb1', { name: null, body_ordinal: 1, formation_id: 'silt-unit' }],
    ]),
    geotechBodies: roster([
      ['gA', { name: null, body_ordinal: 0, formation_id: 'silt-sf' }],
      ['gB', { name: null, body_ordinal: 1, formation_id: 'silt-sf' }],
      ['gC', { name: null, body_ordinal: 2, formation_id: 'silt-sf' }],
    ]),
  }
}

describe('the Parameters header of a grouped body (D2)', () => {
  it('HG1 — the group title names the group + member count + class, not a deep breadcrumb', () => {
    const title = scopeHeaderLabel(
      { kind: 'geotech-group', unitId: 'silt-sf', groupNumber: 1, memberBodyIds: ['gA', 'gB'] },
      makeScene(),
    )
    expect(title).toContain('Group 1')
    expect(title).toContain('2 bodies')
    expect(title).toContain('SILT, slightly firm') // nadClassName(13)
    // The whole point is to REPLACE the deep breadcrumb.
    expect(title).not.toContain('›')
  })

  it('HG2 — the provenance list is each member’s source litho body, in order', () => {
    const prov = groupProvenanceLithoBodies(['gA', 'gB'], makeScene())
    expect(prov).toEqual(['SILT · #0', 'SILT · #1'])
  })

  it('HG3 — members sharing a litho parent collapse to ONE bullet with a ×count', () => {
    // gA and gC both sit under litho body lb0 (#0); gB under lb1 (#1). The
    // provenance lists the litho bodies, not the members — #0 once, with ×2, so
    // a shared parent never reads as a duplicate render (ux-reviewer 2026-09-02).
    const prov = groupProvenanceLithoBodies(['gA', 'gB', 'gC'], makeScene())
    expect(prov).toEqual(['SILT · #0 ×2', 'SILT · #1'])
  })
})

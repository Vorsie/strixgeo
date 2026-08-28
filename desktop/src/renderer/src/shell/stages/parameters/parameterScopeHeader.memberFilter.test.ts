// The header must not claim to pool ground that contributed NOTHING.
//
// The F7 honesty rule: "pooled across N bodies" states how many resolver
// bodies the numbers on screen actually came from. A body whose only cone is
// hidden in the project view, removed, or off every section contributes no
// samples to the pool — counting it makes the header overstate the evidence
// (the live case that produced the rule read "16 bodies" where 9 contributed).
//
// This is the behaviour the retired ``pooledBodyCount`` protected with pins
// PB11/PB12. Those pins died with the helper in the body-tree rework, and the
// replacement count was never given the membership filter — so the header
// silently went back to over-counting. These pins put the rule back under
// test at the surface that now owns it.
//
// MF1 — a body whose only cone is off the member set is not counted.
// MF2 — a borehole-only body is not counted (it has no cone to summarise).
// MF3 — with no member set supplied the count is unfiltered (the pooling
//       population is "everything", e.g. before any section exists).
// MF4 — an EMPTY member set pools nothing, so the header claims no pooling.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import type { BodyRosterEntry } from './parameterUnitBodies'
import type { ParameterTreeInput } from './parameterBodyTree'
import { scopeHeaderLabel } from './parameterScopeHeader'

function formation(
  id: string,
  over: Partial<GeologicalFormationResponse>,
): GeologicalFormationResponse {
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
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    parent_litho_layer_id: null,
    notes: null,
    created_at: '',
    updated_at: '',
    ...over,
  } as LithoLayerResponse
}

function roster(
  entries: ReadonlyArray<[string, BodyRosterEntry]>,
): ReadonlyMap<string, BodyRosterEntry> {
  return new Map(entries)
}

/**
 * SILT with two litho bodies: lb1 on cone c1, lb2 on cone c2. The scene is
 * built so a member set of {c1} leaves exactly one contributing body.
 */
function makeScene(): ParameterTreeInput {
  return {
    lithoFormations: [formation('silt-unit', { name: 'SILT', display_order: 0 })],
    geotechFormations: [],
    lithoLayers: [
      layer('L1', { formation_id: 'silt-unit', body_id: 'lb1', cpt_id: 'c1' }),
      layer('L2', { formation_id: 'silt-unit', body_id: 'lb2', cpt_id: 'c2' }),
    ],
    geotechLayers: [],
    lithoBodies: roster([
      ['lb1', { name: null, body_ordinal: 0, formation_id: 'silt-unit' }],
      ['lb2', { name: null, body_ordinal: 1, formation_id: 'silt-unit' }],
    ]),
    geotechBodies: roster([]),
  }
}

const SCOPE = { kind: 'litho-unit', unitId: 'silt-unit' } as const

describe('the pooled header counts only bodies that CONTRIBUTED (F7)', () => {
  it('MF1 — a body whose only cone is off the member set is not counted', () => {
    const label = scopeHeaderLabel(SCOPE, makeScene(), new Set(['c1']))
    // One body contributed; a one-body pool is not "pooled across" anything.
    expect(label).not.toContain('pooled across')
  })

  it('MF2 — a borehole-only body has no cone to summarise and is not counted', () => {
    const scene = makeScene()
    const boreholeOnly = {
      ...scene,
      lithoLayers: [
        scene.lithoLayers[0],
        layer('L2', {
          formation_id: 'silt-unit',
          body_id: 'lb2',
          cpt_id: null,
          borehole_id: 'bh1',
        }),
      ],
    }
    expect(scopeHeaderLabel(SCOPE, boreholeOnly, new Set(['c1', 'bh1']))).not.toContain(
      'pooled across',
    )
  })

  it('MF3 — with no member set the count is unfiltered', () => {
    expect(scopeHeaderLabel(SCOPE, makeScene(), null)).toContain('pooled across 2 bodies')
    expect(scopeHeaderLabel(SCOPE, makeScene())).toContain('pooled across 2 bodies')
  })

  it('MF4 — an empty member set pools nothing, so the header claims no pooling', () => {
    expect(scopeHeaderLabel(SCOPE, makeScene(), new Set())).not.toContain('pooled across')
  })
})

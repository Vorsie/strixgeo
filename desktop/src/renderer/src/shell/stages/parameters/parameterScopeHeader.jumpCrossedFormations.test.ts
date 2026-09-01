// The scope header must show a body's crossed geological formations on the
// RIGHT-CLICK JUMP path, the same list it shows when the unit is picked from the
// right-hand pane (owner dogfeed 2026-09-01, verbatim: "Quartair + Pleistoceen
// is not visible on the first right click - unit statistics (it is however
// visible when i select a unit from the right hand pane)").
//
// Root cause: the geotech BODY's own ``geo_formations`` list is empty (the
// backend derives the crossed-formation list against the model's parent, which
// for a geotech model is the LITHO model, not the geological model — so a
// geotech body gets no list). The header therefore fell back to nothing on the
// geotech axis, while the litho unit/body — picked from the pane — carries the
// list correctly. The fix: a geotech body (and its class row) inherit their
// LITHO PARENT body's crossed formations when they carry none, so the SAME
// body's context reads identically on both arrival paths.
//
//   JCF1 — a geotech-BODY header with an empty own-list inherits the litho parent's
//   JCF2 — a geotech-CLASS header (the fallback rung of the jump ladder) shows it too
//   JCF3 — a geotech body that DOES carry its own list keeps it (no regression)

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import type { BodyRosterEntry } from './parameterUnitBodies'
import type { ParameterTreeInput } from './parameterBodyTree'
import { scopeHeaderLabel } from './parameterScopeHeader'

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

function roster(entries: ReadonlyArray<[string, BodyRosterEntry]>): ReadonlyMap<string, BodyRosterEntry> {
  return new Map(entries)
}

/**
 * A SILT litho unit with one litho body lb1 that crosses two geological
 * formations (Quartair + Pleistoceen). Its NAD-13 geotech body gbA carries NO
 * crossed-formation list of its own (the backend gap), unless ``over.gbAGeo``
 * supplies one. The geotech layer g1 links gbA up to lb1 through
 * ``parent_litho_layer_id``, which is how the header resolves the litho parent.
 */
function makeScene(over: { gbAGeo?: Partial<BodyRosterEntry> } = {}): ParameterTreeInput {
  return {
    lithoFormations: [formation('silt-unit', { name: 'SILT', display_order: 0 })],
    geotechFormations: [formation('silt-sf', { nad_class: 13, source_litho_formation_id: 'silt-unit' })],
    lithoLayers: [layer('L1', { formation_id: 'silt-unit', body_id: 'lb1' })],
    geotechLayers: [
      layer('g1', { formation_id: 'silt-sf', parent_litho_layer_id: 'L1', body_id: 'gbA' }),
    ],
    lithoBodies: roster([
      [
        'lb1',
        {
          name: null,
          body_ordinal: 0,
          formation_id: 'silt-unit',
          geo_formations: [
            { id: 'q', name: 'Quartair' },
            { id: 'pl', name: 'Pleistoceen' },
          ],
        },
      ],
    ]),
    geotechBodies: roster([['gbA', { name: null, body_ordinal: 0, ...over.gbAGeo }]]),
  }
}

describe('the scope header shows crossed formations on the right-click jump (dogfeed 2026-09-01)', () => {
  it('JCF1 — a geotech-body header with no own list inherits its litho parent’s', () => {
    // The jump-shaped scope: a resolved geotech body, unitId from the arbitrary
    // reporting band (immaterial here — the header resolves by bodyId).
    const label = scopeHeaderLabel({ kind: 'geotech-body', unitId: 'silt-sf', bodyId: 'gbA' }, makeScene())
    expect(label).toContain('Quartair + Pleistoceen')
  })

  it('JCF2 — a geotech-class header (jump-ladder fallback) shows the litho parent’s list', () => {
    const label = scopeHeaderLabel(
      { kind: 'geotech-class', lithoUnitId: 'silt-unit', lithoBodyId: 'lb1', nadClass: 13 },
      makeScene(),
    )
    expect(label).toContain('Quartair + Pleistoceen')
  })

  it('JCF3 — a geotech body carrying its OWN list keeps it (no inherit override)', () => {
    const scene = makeScene({ gbAGeo: { geo_formations: [{ id: 'ho', name: 'Holoceen' }] } })
    const label = scopeHeaderLabel({ kind: 'geotech-body', unitId: 'silt-sf', bodyId: 'gbA' }, scene)
    expect(label).toContain('Holoceen')
    expect(label).not.toContain('Quartair')
  })
})

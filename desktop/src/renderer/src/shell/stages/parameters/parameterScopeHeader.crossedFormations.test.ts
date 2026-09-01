// The Parameters scope header shows a body's crossed geological formations,
// the same way the BodyContextMenu header does (owner ruling 2026-08-31, piece
// C: "i would like to see it there too").
//
// A body may cross more than one geological formation (R2, debt #278), so its
// geological context is the full LIST — every formation it falls in, joined
// "A + B" — appended to the litho path. Falls back to the singular
// ``geo_formation_name`` for an older cached response, and appends NOTHING when
// the body carries neither.
//
// CF1 — a litho-body header appends the crossed-formation LIST.
// CF2 — a geotech-body header appends the crossed-formation LIST.
// CF3 — a body with only the singular field falls back to it.
// CF4 — a body carrying neither appends nothing.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../../../api/client'
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

function roster(entries: ReadonlyArray<[string, BodyRosterEntry]>): ReadonlyMap<string, BodyRosterEntry> {
  return new Map(entries)
}

/** SILT unit with one litho body (lb1) and one geotech body (gbA), each of
 *  which carries a crossed-formation list. Geotech layers are omitted on
 *  purpose — the geotech body's path resolves to its bare label, and the
 *  crossed-formation suffix appends regardless. */
function makeScene(over: {
  lithoBody?: Partial<BodyRosterEntry>
  geotechBody?: Partial<BodyRosterEntry>
}): ParameterTreeInput {
  return {
    lithoFormations: [formation('silt-unit', { name: 'SILT', display_order: 0 })],
    geotechFormations: [],
    lithoLayers: [],
    geotechLayers: [],
    lithoBodies: roster([['lb1', { name: null, body_ordinal: 0, formation_id: 'silt-unit', ...over.lithoBody }]]),
    geotechBodies: roster([['gbA', { name: null, body_ordinal: 0, ...over.geotechBody }]]),
  }
}

describe('the scope header shows a body’s crossed geological formations (piece C)', () => {
  it('CF1 — a litho-body header appends the crossed-formation LIST', () => {
    const scene = makeScene({
      lithoBody: {
        geo_formations: [
          { id: 'ho', name: 'Holoceen' },
          { id: 'pl', name: 'Pleistoceen' },
        ],
      },
    })
    const label = scopeHeaderLabel({ kind: 'litho-body', unitId: 'silt-unit', bodyId: 'lb1' }, scene)
    expect(label).toContain('Holoceen + Pleistoceen')
  })

  it('CF2 — a geotech-body header appends the crossed-formation LIST', () => {
    const scene = makeScene({
      geotechBody: {
        geo_formations: [
          { id: 'ho', name: 'Holoceen' },
          { id: 'pl', name: 'Pleistoceen' },
        ],
      },
    })
    const label = scopeHeaderLabel({ kind: 'geotech-body', unitId: 'x', bodyId: 'gbA' }, scene)
    expect(label).toContain('Holoceen + Pleistoceen')
  })

  it('CF3 — a body with only the singular field falls back to it', () => {
    const scene = makeScene({ lithoBody: { geo_formation_name: 'Pleistoceen' } })
    const label = scopeHeaderLabel({ kind: 'litho-body', unitId: 'silt-unit', bodyId: 'lb1' }, scene)
    expect(label).toContain('Pleistoceen')
  })

  it('CF4 — a body carrying neither appends nothing', () => {
    const scope = { kind: 'litho-body', unitId: 'silt-unit', bodyId: 'lb1' } as const
    const bare = scopeHeaderLabel(scope, makeScene({}))
    const withList = scopeHeaderLabel(
      scope,
      makeScene({ lithoBody: { geo_formations: [{ id: 'ho', name: 'Holoceen' }] } }),
    )
    // The no-geo body appends nothing — its header IS the bare path; the list
    // body's header is exactly that path plus the " · <formations>" context,
    // the same middot BodyContextMenu uses.
    expect(withList).toBe(`${bare} · Holoceen`)
  })
})

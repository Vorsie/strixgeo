import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../api/client'
import { formationsYoungestFirst } from './formationOrder'

function f(overrides: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id: 'f',
    app_project_id: 'P',
    name: 'X',
    color: '#000000',
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
    created_at: '2026-06-04T00:00:00Z',
    updated_at: '2026-06-04T00:00:00Z',
    ...overrides,
  }
}

describe('formationsYoungestFirst', () => {
  it('orders descending by display_order (youngest first)', () => {
    const rows = [
      f({ id: 'old', name: 'Kortrijk', display_order: 0 }),
      f({ id: 'mid', name: 'Pleistoceen', display_order: 1 }),
      f({ id: 'young', name: 'Antropogeen', display_order: 2 }),
    ]
    expect(formationsYoungestFirst(rows).map(r => r.id)).toEqual(['young', 'mid', 'old'])
  })

  it('accepts any input order, not just pre-sorted', () => {
    const rows = [
      f({ id: 'mid', display_order: 1 }),
      f({ id: 'young', display_order: 2 }),
      f({ id: 'old', display_order: 0 }),
    ]
    expect(formationsYoungestFirst(rows).map(r => r.id)).toEqual(['young', 'mid', 'old'])
  })

  it('does not mutate the input array', () => {
    const rows = [f({ id: 'a', display_order: 0 }), f({ id: 'b', display_order: 1 })]
    formationsYoungestFirst(rows)
    expect(rows.map(r => r.id)).toEqual(['a', 'b'])
  })

  it('breaks display_order ties by name (stable with the inspector)', () => {
    const rows = [
      f({ id: 'b', name: 'Bravo', display_order: 5 }),
      f({ id: 'a', name: 'Alpha', display_order: 5 }),
    ]
    // Ascending (Alpha, Bravo) then reversed → Bravo, Alpha.
    expect(formationsYoungestFirst(rows).map(r => r.id)).toEqual(['b', 'a'])
  })
})

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../api/client'
import { isGeologicalFormation, isLithoUnit } from './formationKind'

function makeFormation(
  overrides: Partial<GeologicalFormationResponse> = {},
): GeologicalFormationResponse {
  return {
    id: 'f1',
    app_project_id: 'p1',
    name: 'Test',
    code: null,
    color: '#aaaaaa',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('formationKind', () => {
  // F1: a pure geological formation — no litho_main_soil_code, no
  // nad_class. Both parent_formation_id paths (null on geological;
  // would also be null here) match the legacy filter's expectation.
  it('F1 — pure geological formation is geological, not litho', () => {
    const geo = makeFormation({ name: 'Quartair Holoceen' })
    expect(isGeologicalFormation(geo)).toBe(true)
    expect(isLithoUnit(geo)).toBe(false)
  })

  // F2: a litho-builder unit with a parent_formation_id set — the
  // happy path. Excluded from the geology vocabulary.
  it('F2 — litho unit with a parent is excluded from geology', () => {
    const litho = makeFormation({
      name: 'ZAND',
      litho_main_soil_code: 'ZAND',
      parent_formation_id: 'geo-parent',
    })
    expect(isGeologicalFormation(litho)).toBe(false)
    expect(isLithoUnit(litho)).toBe(true)
  })

  // F3: regression for the dogfeed bug (2026-05-21) — orphan litho
  // unit (parent_formation_id=null, litho_main_soil_code set). The
  // legacy `parent_formation_id === null` filter mis-classified
  // these as geological; the new discriminator catches them.
  it('F3 — orphan litho unit (no parent) is still excluded from geology', () => {
    const orphan = makeFormation({
      name: 'SILT',
      litho_main_soil_code: 'SILT',
      parent_formation_id: null,
    })
    expect(isGeologicalFormation(orphan)).toBe(false)
    expect(isLithoUnit(orphan)).toBe(true)
  })

  // F4: a geotech NAD-class unit — excluded from the geology
  // vocabulary on a separate signal (nad_class set). Not strictly
  // the leak that triggered the helper, but the boundary applies
  // symmetrically.
  it('F4 — geotech NAD-class unit is excluded from geology', () => {
    const geotech = makeFormation({
      name: 'Zand-NAD-21',
      nad_class: 21,
      parent_formation_id: 'litho-parent',
    })
    expect(isGeologicalFormation(geotech)).toBe(false)
    // Not a litho unit either (no main soil code) — isLithoUnit is
    // litho-specific.
    expect(isLithoUnit(geotech)).toBe(false)
  })
})

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../api/client'
import { isGeologicalFormation, isGeotechUnit, isLithoUnit } from './formationKind'

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
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  }
}

describe('formationKind', () => {
  // F1: a pure geological formation — no litho_main_soil_code, no
  // nad_class, no source_litho_formation_id.
  it('F1 — pure geological formation is geological, not litho, not geotech', () => {
    const geo = makeFormation({ name: 'Quartair Holoceen' })
    expect(isGeologicalFormation(geo)).toBe(true)
    expect(isLithoUnit(geo)).toBe(false)
    expect(isGeotechUnit(geo)).toBe(false)
  })

  // F2: a litho-builder unit with a parent_formation_id set — the
  // happy path. Excluded from the geology + geotech vocabulary.
  it('F2 — litho unit with a parent is excluded from geology and geotech', () => {
    const litho = makeFormation({
      name: 'ZAND',
      litho_main_soil_code: 'ZAND',
      parent_formation_id: 'geo-parent',
      source_litho_formation_id: null,
    })
    expect(isGeologicalFormation(litho)).toBe(false)
    expect(isLithoUnit(litho)).toBe(true)
    expect(isGeotechUnit(litho)).toBe(false)
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
      source_litho_formation_id: null,
    })
    expect(isGeologicalFormation(orphan)).toBe(false)
    expect(isLithoUnit(orphan)).toBe(true)
    expect(isGeotechUnit(orphan)).toBe(false)
  })

  // F4: a geotech classified unit (nad_class set, soil-code inherited from
  // source litho, source_litho_formation_id set). With the old proxy
  // discriminators it leaked into the litho roster because
  // litho_main_soil_code !== null. The correct discriminator is
  // source_litho_formation_id.
  it('F4 — geotech classified unit (nad_class set) is geotech only, not litho', () => {
    const classified = makeFormation({
      name: 'ZAND-NAD-21',
      // inherited from the source litho formation — the old isLithoUnit bug
      litho_main_soil_code: 'ZAND',
      nad_class: 21,
      source_litho_formation_id: 'litho-form-uuid',
      source_geo_formation_id: 'geo-form-uuid',
    })
    expect(isGeologicalFormation(classified)).toBe(false)
    // Must NOT appear in the litho roster despite carrying litho_main_soil_code.
    expect(isLithoUnit(classified)).toBe(false)
    expect(isGeotechUnit(classified)).toBe(true)
  })

  // F5 (new): a geotech skeleton / borehole-only unit — nad_class is null
  // (no CPT qc available) but source_litho_formation_id is set.  With the
  // old isGeotechUnit (nad_class !== null) this was silently omitted from
  // the geotech inspector roster.
  it('F5 — geotech skeleton unit (nad_class null, source_litho set) is geotech only, not litho', () => {
    const skeleton = makeFormation({
      name: 'KLEI (geotech)',
      // inherited from the source litho formation
      litho_main_soil_code: 'KLEI',
      nad_class: null,
      source_litho_formation_id: 'litho-form-uuid',
      source_geo_formation_id: null,
    })
    expect(isGeologicalFormation(skeleton)).toBe(false)
    // Must NOT appear in the litho roster.
    expect(isLithoUnit(skeleton)).toBe(false)
    // Must appear in the geotech roster even without a NAD class.
    expect(isGeotechUnit(skeleton)).toBe(true)
  })

  // F-MIX: the geology badge uses isGeologicalFormation to filter
  // visibleFormations — a project-scoped list that contains geological,
  // litho, and geotech rows.  The filter must return only the geological
  // formations so the badge shows 2, not 4.
  it('F-MIX — mixed formation list filtered to geological only counts 2', () => {
    const geo1 = makeFormation({ name: 'Quartair' })
    const geo2 = makeFormation({ name: 'Tertiair' })
    const litho = makeFormation({ name: 'ZAND', litho_main_soil_code: 'ZAND', source_litho_formation_id: null })
    const geotech = makeFormation({
      name: 'ZAND-NAD-21',
      litho_main_soil_code: 'ZAND',
      nad_class: 21,
      source_litho_formation_id: 'litho-form-uuid',
    })
    const allFormations = [geo1, geo2, litho, geotech]
    const geologicalCount = allFormations.filter(isGeologicalFormation).length
    expect(geologicalCount).toBe(2)
  })
})

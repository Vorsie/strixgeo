/**
 * Tests for the section-band display-label rule (contactsLayerGeometry.ts).
 *
 * Regression anchor: a GEOTECH formation inherits ``litho_main_soil_code`` from
 * the litho unit it subdivides, so the lithology branch used to win and the band
 * read litho-only ("SAND") — the packing class only showed on the connecting
 * fill, never on the per-test column (dogfeed 2026-06-30). The NAD branch must
 * win for any NAD-classed formation.
 */

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../../api/clients/geology'
import { nadClassName } from '../../utils/nadClasses'
import { formationDisplayLabel } from './contactsLayerGeometry'

/** Build a GeologicalFormationResponse with all required fields, override per case. */
function makeFormation(over: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id: 'f-1',
    app_project_id: 'p-1',
    name: 'Formation',
    color: '#cccccc',
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...over,
  }
}

describe('formationDisplayLabel', () => {
  it('GEOTECH formation labels by NAD name even though it inherited a litho soil code', () => {
    // The exact dogfeed shape: a subdivided sand body — nad_class set AND
    // litho_main_soil_code inherited from the source litho unit.
    const geotech = makeFormation({
      nad_class: 6,
      litho_main_soil_code: 'ZAND',
      name: 'ZAND (NAD 6)',
    })
    expect(formationDisplayLabel(geotech)).toBe(nadClassName(6)) // "SAND, medium dense"
    // NOT the lithology — the bug was it read "Sand"/"SAND" (litho only).
    expect(formationDisplayLabel(geotech)).not.toMatch(/^Sand$/i)
  })

  it('LITHO unit (no nad_class) still labels by translated lithology — debt #96 unchanged', () => {
    const litho = makeFormation({
      nad_class: null,
      litho_main_soil_code: 'KLEI',
      name: 'KLEI (KL:Z)',
    })
    // formatLithoDisplayName output, not the raw "KLEI (KL:Z)" token.
    const label = formationDisplayLabel(litho)
    expect(label).not.toBe('KLEI (KL:Z)')
    expect(label.length).toBeGreaterThan(0)
  })

  it('GEOLOGICAL / curated formation (no nad_class, no soil code) labels by name', () => {
    const geo = makeFormation({ name: 'Diest Zand', regional_ref: 'DZ' })
    expect(formationDisplayLabel(geo)).toBe('Diest Zand')
  })

  it('a non-NAD, non-litho formation prefers name over regional_ref', () => {
    const geo = makeFormation({ name: 'Boom Klei', regional_ref: 'BK' })
    expect(formationDisplayLabel(geo)).toBe('Boom Klei')
  })
})

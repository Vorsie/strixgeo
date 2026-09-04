/**
 * Tests for the geotech admixture-choice detection (admixtureNadChoice.ts).
 *
 * Owner ruling 2026-09-04: prompt the engineer, at subdivide, for a litho unit
 * whose admixture the NAD table can express as pure OR with-admixture. These
 * pins mirror the backend detection (``test_nad_admixture_choice.py``): the same
 * pairs must be ambiguous, and VEEN / cross-admixtures must NOT be.
 */

import { describe, expect, it } from 'vitest'

import type { AdmixtureItem, GeologicalFormationResponse } from '../api/clients/geology.types'
import {
  ambiguousAdmixtureUnits,
  hasUnansweredAdmixtureUnits,
  unitAdmixtureIsAmbiguous,
} from './admixtureNadChoice'

const SILTY: AdmixtureItem[] = [{ soil_code: 'KL', amount: 'M', locally: false }]
const SANDY: AdmixtureItem[] = [{ soil_code: 'XZ', amount: 'M', locally: false }]

describe('unitAdmixtureIsAmbiguous', () => {
  it('a silty sand is ambiguous — pure sand (5-8) or silty sand (9-12)', () => {
    expect(unitAdmixtureIsAmbiguous('ZAND', SILTY)).toBe(true)
  })

  it('a silty gravel is ambiguous', () => {
    expect(unitAdmixtureIsAmbiguous('GRIND', SILTY)).toBe(true)
  })

  it('a sandy silt is ambiguous', () => {
    expect(unitAdmixtureIsAmbiguous('SILT', SANDY)).toBe(true)
  })

  it('a sandy clay is ambiguous', () => {
    expect(unitAdmixtureIsAmbiguous('KLEI', SANDY)).toBe(true)
  })

  it('a clean sand is not ambiguous — nothing to ask', () => {
    expect(unitAdmixtureIsAmbiguous('ZAND', [])).toBe(false)
    expect(unitAdmixtureIsAmbiguous('ZAND', null)).toBe(false)
  })

  it('a sandy SAND is not ambiguous — the table has no "sandy sand" column', () => {
    expect(unitAdmixtureIsAmbiguous('ZAND', SANDY)).toBe(false)
  })

  it('a silty SILT is not ambiguous — the table has no "silty silt" column', () => {
    expect(unitAdmixtureIsAmbiguous('SILT', SILTY)).toBe(false)
  })

  it('peat is never ambiguous — secondary mirrors clean', () => {
    expect(unitAdmixtureIsAmbiguous('VEEN', SANDY)).toBe(false)
  })

  it('an unknown / null soil is not ambiguous', () => {
    expect(unitAdmixtureIsAmbiguous('ROCK', SANDY)).toBe(false)
    expect(unitAdmixtureIsAmbiguous(null, SANDY)).toBe(false)
  })
})

/** Minimal formation stub — only the fields the detection reads. */
function formation(over: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id: 'f',
    app_project_id: 'p',
    name: 'F',
    color: '#000',
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
    nad_admixture_choice: null,
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

describe('ambiguousAdmixtureUnits', () => {
  it('lists only in-scope ambiguous units, carrying their stored choice', () => {
    const forms = [
      formation({ id: 'silty-sand', name: 'B', litho_main_soil_code: 'ZAND', litho_admixtures: SILTY }),
      formation({
        id: 'answered',
        name: 'A',
        litho_main_soil_code: 'ZAND',
        litho_admixtures: SILTY,
        nad_admixture_choice: 'pure',
      }),
      // Ambiguous but OUT of scope → excluded.
      formation({ id: 'out', name: 'C', litho_main_soil_code: 'ZAND', litho_admixtures: SILTY }),
      // In scope but clean → excluded.
      formation({ id: 'clean', name: 'D', litho_main_soil_code: 'ZAND', litho_admixtures: [] }),
    ]
    const scope = new Set(['silty-sand', 'answered', 'clean'])
    const units = ambiguousAdmixtureUnits(forms, scope)
    // Sorted by name: 'answered' (A) then 'silty-sand' (B).
    expect(units.map(u => u.formationId)).toEqual(['answered', 'silty-sand'])
    expect(units[0].choice).toBe('pure')
    expect(units[1].choice).toBeNull()
  })
})

describe('hasUnansweredAdmixtureUnits', () => {
  it('true when any listed unit has no stored answer', () => {
    expect(
      hasUnansweredAdmixtureUnits([
        { formationId: 'a', name: 'A', soilCode: 'ZAND', choice: 'pure' },
        { formationId: 'b', name: 'B', soilCode: 'ZAND', choice: null },
      ]),
    ).toBe(true)
  })

  it('false when every listed unit is answered', () => {
    expect(
      hasUnansweredAdmixtureUnits([
        { formationId: 'a', name: 'A', soilCode: 'ZAND', choice: 'pure' },
        { formationId: 'b', name: 'B', soilCode: 'KLEI', choice: 'with_admixture' },
      ]),
    ).toBe(false)
  })
})

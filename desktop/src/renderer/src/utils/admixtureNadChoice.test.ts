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
  defaultAdmixtureChoice,
  forkingAdmixtures,
  hasUnansweredAdmixtureUnits,
  unitAdmixtureIsAmbiguous,
} from './admixtureNadChoice'

const SILTY: AdmixtureItem[] = [{ soil_code: 'KL', amount: 'M', locally: false }]
const SANDY: AdmixtureItem[] = [{ soil_code: 'XZ', amount: 'M', locally: false }]
// A gravel admixture (owner ruling 2026-09-05: "if it is gravel it does not
// count and it should default to normal sand"). NB the DOV code for gravel is
// XG, not GL — GL is glauconiet. The earlier test used GL here by mistake,
// conflating the mislabelled front-end label with the gravel ruling.
const GRAVELLY: AdmixtureItem[] = [{ soil_code: 'XG', amount: 'M', locally: false }]
// A glauconite admixture (owner ruling walk22b: glauconite in a sand triggers
// the geotech admixture question, exactly like a silt/clay admixture).
const GLAUCONITIC: AdmixtureItem[] = [{ soil_code: 'GL', amount: 'M', locally: false }]

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

  it('a GRAVELLY sand does not count — gravel is not the coarse-soil fork', () => {
    // Owner ruling 2026-09-05: "you can also have gravel as admixture, but that
    // is not what we mean … if it is gravel it does not count and it should
    // default to normal sand." Only silt/clay (and glauconite) forks a sand;
    // gravel never does.
    expect(unitAdmixtureIsAmbiguous('ZAND', GRAVELLY)).toBe(false)
  })

  it('a sand with a glauconite admixture asks the admixture question in the geotech stage', () => {
    // Owner ruling walk22b: "I want to be able to add glauconiet as bijmenging;
    // it should also trigger admixture in sand in geotech." A glauconitic sand
    // is ambiguous — pure sand (5-8) or with-admixture (9-12) — just like a
    // silty/clayey sand, so the prompt must ask about it.
    expect(unitAdmixtureIsAmbiguous('ZAND', GLAUCONITIC)).toBe(true)
  })
})

describe('forkingAdmixtures', () => {
  it('returns the silt/clay admixture that forks a sand', () => {
    expect(forkingAdmixtures('ZAND', SILTY)).toEqual(SILTY)
  })

  it('returns the sand admixture that forks a fine soil', () => {
    expect(forkingAdmixtures('SILT', SANDY)).toEqual(SANDY)
  })

  it('drops a gravel admixture on sand — it is not a fork', () => {
    expect(forkingAdmixtures('ZAND', GRAVELLY)).toEqual([])
  })

  it('returns the glauconite admixture that forks a sand', () => {
    expect(forkingAdmixtures('ZAND', GLAUCONITIC)).toEqual(GLAUCONITIC)
  })

  it('keeps only the forking codes when several admixtures are present', () => {
    const mixed: AdmixtureItem[] = [...GRAVELLY, ...SILTY]
    expect(forkingAdmixtures('ZAND', mixed)).toEqual(SILTY)
  })

  it('empty for a soil with no fork column (VEEN) and for null soil', () => {
    expect(forkingAdmixtures('VEEN', SANDY)).toEqual([])
    expect(forkingAdmixtures(null, SANDY)).toEqual([])
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
    // Each unit carries the admixtures that forked it, so the prompt can name
    // them (owner ruling 2026-09-05).
    expect(units[1].matchedAdmixtures).toEqual(SILTY)
  })

  it('carries only the FORKING admixtures, dropping a gravel one on sand', () => {
    const forms = [
      formation({
        id: 'silty-gravelly-sand',
        name: 'A',
        litho_main_soil_code: 'ZAND',
        litho_admixtures: [...GRAVELLY, ...SILTY],
      }),
    ]
    const units = ambiguousAdmixtureUnits(forms, new Set(['silty-gravelly-sand']))
    expect(units[0].matchedAdmixtures).toEqual(SILTY)
  })
})

describe('hasUnansweredAdmixtureUnits', () => {
  it('true when any listed unit has no stored answer', () => {
    expect(
      hasUnansweredAdmixtureUnits([
        { formationId: 'a', name: 'A', soilCode: 'ZAND', matchedAdmixtures: SILTY, choice: 'pure' },
        { formationId: 'b', name: 'B', soilCode: 'ZAND', matchedAdmixtures: SILTY, choice: null },
      ]),
    ).toBe(true)
  })

  it('false when every listed unit is answered', () => {
    expect(
      hasUnansweredAdmixtureUnits([
        { formationId: 'a', name: 'A', soilCode: 'ZAND', matchedAdmixtures: SILTY, choice: 'pure' },
        {
          formationId: 'b',
          name: 'B',
          soilCode: 'KLEI',
          matchedAdmixtures: SANDY,
          choice: 'with_admixture',
        },
      ]),
    ).toBe(false)
  })
})

describe('defaultAdmixtureChoice', () => {
  // Owner ruling 2026-09-07: "glauconitic sand can default to clay sand, but we
  // need to prompt the user on subdivide". The prompt still opens; the
  // with-admixture (clayey / silty sand) radio is the pre-checked answer.
  const unit = (soilCode: string, matched: AdmixtureItem[], choice: 'pure' | 'with_admixture' | null) => ({
    formationId: 'f1',
    name: 'Zand',
    soilCode,
    matchedAdmixtures: matched,
    choice,
  })

  it('a glauconitic sand defaults to the clayey sand column, the engineer can still switch', () => {
    expect(defaultAdmixtureChoice(unit('ZAND', GLAUCONITIC, null))).toBe('with_admixture')
  })

  it('a silty sand has no default: the engineer decides (owner ruling 2026-09-04)', () => {
    expect(defaultAdmixtureChoice(unit('ZAND', SILTY, null))).toBeNull()
  })

  it('a sand that is both glauconitic and silty has no default: the silt rule is stricter', () => {
    expect(defaultAdmixtureChoice(unit('ZAND', [...GLAUCONITIC, ...SILTY], null))).toBeNull()
  })

  it('a stored answer always wins over the default', () => {
    expect(defaultAdmixtureChoice(unit('ZAND', GLAUCONITIC, 'pure'))).toBe('pure')
  })
})

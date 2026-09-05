/**
 * Tests for the scoped-unit NAD-parameter helpers (scopeNadParameters.ts).
 *
 * Owner ruling 2026-09-05: the Parameters pane shows, per geotech body (and per
 * group), the NAD table's characteristic values for the body's packing class —
 * *"one general value per body"*. These pins derive (a) the single NAD class a
 * set of geotech bands shares and (b) the parameters for that class read off the
 * geotech formations. No table is duplicated here — the values come from the
 * backend ``nad_parameters`` field.
 */

import { describe, expect, it } from 'vitest'

import type {
  GeologicalFormationResponse,
  LithoLayerResponse,
  NadCharacteristicValues,
} from '../../../api/clients/geology.types'
import { nadParametersForClass, scopeNadClass } from './scopeNadParameters'

/** A geotech band pointing at a formation id (only the read fields matter). */
function band(formationId: string): LithoLayerResponse {
  return { formation_id: formationId } as LithoLayerResponse
}

const CLASS6_PARAMS: NadCharacteristicValues = {
  gamma_unsat_kn_m3: 17,
  gamma_sat_kn_m3: 19,
  phi_deg: 30,
  c_kpa: 0,
  cu_kpa: null,
}

/** A geotech formation carrying a class + its backend-computed parameters. */
function geotechFormation(
  id: string,
  nadClass: number | null,
  params: NadCharacteristicValues | null,
): GeologicalFormationResponse {
  return {
    id,
    nad_class: nadClass,
    nad_parameters: params,
  } as unknown as GeologicalFormationResponse
}

describe('scopeNadClass', () => {
  const classByFormation = new Map<string, number | null>([
    ['f6a', 6],
    ['f6b', 6],
    ['f10', 10],
    ['fnull', null],
  ])

  it('a body whose bands all share one class → that class', () => {
    expect(scopeNadClass([band('f6a'), band('f6b')], classByFormation)).toBe(6)
  })

  it('a group pooling two formations of the SAME class → that class', () => {
    // Two formation rows, one class (Join = group maps to one export class).
    expect(scopeNadClass([band('f6a'), band('f6b'), band('f6a')], classByFormation)).toBe(6)
  })

  it('bands spanning two classes → null (no single value to show)', () => {
    expect(scopeNadClass([band('f6a'), band('f10')], classByFormation)).toBeNull()
  })

  it('bands with no class (a litho scope) → null', () => {
    expect(scopeNadClass([band('fnull')], classByFormation)).toBeNull()
  })

  it('no bands → null', () => {
    expect(scopeNadClass([], classByFormation)).toBeNull()
  })
})

describe('nadParametersForClass', () => {
  const forms = [
    geotechFormation('f6a', 6, CLASS6_PARAMS),
    geotechFormation('f10', 10, null), // classified but no params carried
  ]

  it('reads the parameters off a formation carrying the class', () => {
    expect(nadParametersForClass(6, forms)).toEqual(CLASS6_PARAMS)
  })

  it('null class → null (unclassified unit shows no block)', () => {
    expect(nadParametersForClass(null, forms)).toBeNull()
  })

  it('a class with no parameters on any formation → null', () => {
    expect(nadParametersForClass(10, forms)).toBeNull()
  })

  it('a class no formation carries → null', () => {
    expect(nadParametersForClass(24, forms)).toBeNull()
  })
})

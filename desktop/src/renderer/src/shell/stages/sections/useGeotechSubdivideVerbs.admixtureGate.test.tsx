/**
 * The Sections-stage Subdivide asks the admixture question too (owner walk22b).
 *
 * The known gap (CLAUDE.local.md): the Geotech-stage Build prompts for a sand
 * unit with a qualifying admixture, but the Sections-axis Subdivide silently
 * reused the last choice. These pins put the SAME gate in front of the sections
 * toolbar's Subdivide press.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { GeologicalFormationResponse, LithoLayerResponse } from '../../../api/client'
import { useGeotechSubdivideVerbs } from './useGeotechSubdivideVerbs'

/** A litho unit carrying only the fields the admixture detection reads. */
function lithoUnit(over: Partial<GeologicalFormationResponse>): GeologicalFormationResponse {
  return {
    id: 'f-silty-sand',
    app_project_id: 'p',
    name: 'Silty Zand',
    color: '#000',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: 'ZAND',
    litho_admixtures: [{ soil_code: 'KL', amount: 'M', locally: false }],
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

/** One accepted litho layer whose formation is in scope for the classifier. */
const ACCEPTED_LAYER = {
  id: 'l1',
  formation_id: 'f-silty-sand',
  status: 'accepted',
} as unknown as LithoLayerResponse

function makeDeps(over: Record<string, unknown> = {}) {
  return {
    activeLithoModel: { id: 'm-litho' } as never,
    geotechBandsStale: false,
    pendingStatistic: null,
    columnsNeedingRederive: [] as never,
    handleSubdivideAllBodies: vi.fn().mockResolvedValue(undefined),
    refreshTieStatus: vi.fn(),
    subdivideScope: { bandCount: 0, handEditCount: 0, modelBandCount: 0, modelHandEditCount: 0 },
    // New deps for the admixture gate (walk22b):
    formations: [lithoUnit({})],
    lithoLayers: [ACCEPTED_LAYER],
    handleSetNadAdmixtureChoices: vi.fn().mockResolvedValue(undefined),
    ...over,
  }
}

afterEach(() => vi.clearAllMocks())

describe('useGeotechSubdivideVerbs — admixture gate', () => {
  it('subdividing from the sections toolbar asks the admixture question the first time', () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useGeotechSubdivideVerbs(deps))

    act(() => result.current.pressSubdivide('cs1'))

    // The prompt is open on the unanswered silty sand, and nothing subdivided.
    expect(result.current.askingAdmixtures?.map(u => u.formationId)).toEqual(['f-silty-sand'])
    expect(deps.handleSubdivideAllBodies).not.toHaveBeenCalled()
  })

  it('after answering, the subdivide proceeds and the answer is persisted', async () => {
    const deps = makeDeps()
    const { result } = renderHook(() => useGeotechSubdivideVerbs(deps))

    act(() => result.current.pressSubdivide('cs1'))
    act(() => result.current.selectAdmixture('f-silty-sand', 'with_admixture'))
    await act(async () => {
      await result.current.confirmAdmixtures()
    })

    expect(deps.handleSetNadAdmixtureChoices).toHaveBeenCalledWith([
      { formationId: 'f-silty-sand', choice: 'with_admixture' },
    ])
    expect(result.current.askingAdmixtures).toBeNull()
    expect(deps.handleSubdivideAllBodies).toHaveBeenCalledTimes(1)
  })

  it('an already-answered model subdivides straight through (no prompt)', () => {
    const deps = makeDeps({
      formations: [lithoUnit({ nad_admixture_choice: 'pure' })],
    })
    const { result } = renderHook(() => useGeotechSubdivideVerbs(deps))

    act(() => result.current.pressSubdivide('cs1'))

    expect(result.current.askingAdmixtures).toBeNull()
    expect(deps.handleSubdivideAllBodies).toHaveBeenCalledTimes(1)
  })
})

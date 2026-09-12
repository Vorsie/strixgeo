// Decision net for the shared borehole-exclusion toggle (debt #65 + the
// existing geological toggle both run through it).
//
// The rule, in the debt entry's words: the exclusion toggle "PATCHes the
// model's excluded_borehole_ids". Its two decisions:
//   * "Include again" (included = true)  → the borehole is REMOVED from the
//     model's excluded list, and the model is PATCHed with the reduced set.
//   * Exclude          (included = false) → the borehole is ADDED.
// It fires immediately (optimistic local update), registers an undo command,
// and — for callers that ask — a confirmation toast AFTER the PATCH lands. A
// failed PATCH rolls the optimistic update back and stays silent.

import type { SetStateAction } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { toggleBoreholeExclusion } from './boreholeExclusionToggle'
import type { GeologicalModelResponse } from '../api/client'

vi.mock('../api/client', () => ({
  api: { geology: { updateModel: vi.fn() } },
}))

vi.mock('../utils/log', () => ({
  log: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), success: vi.fn() },
}))

function makeModel(excluded: string[]): GeologicalModelResponse {
  // The helper only reads ``id`` + ``excluded_borehole_ids``; the rest is
  // shape padding so the cast stays honest.
  return {
    id: 'model-1',
    app_project_id: 'proj-1',
    name: 'Litho',
    description: null,
    kind: 'lithostratigraphic',
    is_active: true,
    excluded_borehole_ids: excluded,
    parent_model_id: 'geo-1',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

const asMock = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>

describe('toggleBoreholeExclusion — the include / exclude decision', () => {
  beforeEach(async () => {
    const { api } = await import('../api/client')
    asMock(api.geology.updateModel).mockReset()
  })

  it('Include again removes the borehole from the model and PATCHes the reduced list', async () => {
    const { api } = await import('../api/client')
    let model = makeModel(['bh-1', 'bh-2'])
    const setModel = vi.fn((value: SetStateAction<GeologicalModelResponse | null>) => {
      model = (typeof value === 'function'
        ? (value as (prev: GeologicalModelResponse | null) => GeologicalModelResponse | null)(model)
        : value) as GeologicalModelResponse
    })
    const pushUndo = vi.fn()
    const markMutated = vi.fn()
    const onSuccessToast = vi.fn()
    asMock(api.geology.updateModel).mockResolvedValue(makeModel(['bh-2']))

    await toggleBoreholeExclusion({
      projectId: 'proj-1',
      model,
      setModel,
      boreholeId: 'bh-1',
      included: true,
      pushUndo,
      markMutated,
      includeDescriptionKey: 'undo.includeBoreholeLitho',
      excludeDescriptionKey: 'undo.excludeBoreholeLitho',
      logLabel: 'litho',
      onSuccessToast,
    })

    expect(api.geology.updateModel).toHaveBeenCalledWith('proj-1', 'model-1', {
      excluded_borehole_ids: ['bh-2'],
    })
    // Optimistic local state reflects the include immediately.
    expect(model.excluded_borehole_ids).toEqual(['bh-2'])
    expect(pushUndo).toHaveBeenCalledTimes(1)
    expect(markMutated).toHaveBeenCalledTimes(1)
    // The confirmation toast fires only after the PATCH resolves.
    expect(onSuccessToast).toHaveBeenCalledTimes(1)
  })

  it('Exclude adds the borehole to the model', async () => {
    const { api } = await import('../api/client')
    let model = makeModel(['bh-2'])
    const setModel = vi.fn((value: SetStateAction<GeologicalModelResponse | null>) => {
      model = (typeof value === 'function'
        ? (value as (prev: GeologicalModelResponse | null) => GeologicalModelResponse | null)(model)
        : value) as GeologicalModelResponse
    })
    asMock(api.geology.updateModel).mockResolvedValue(makeModel(['bh-2', 'bh-1']))

    await toggleBoreholeExclusion({
      projectId: 'proj-1',
      model,
      setModel,
      boreholeId: 'bh-1',
      included: false,
      pushUndo: vi.fn(),
      markMutated: vi.fn(),
      includeDescriptionKey: 'undo.includeBoreholeGeo',
      excludeDescriptionKey: 'undo.excludeBoreholeGeo',
      logLabel: 'litho',
    })

    expect(api.geology.updateModel).toHaveBeenCalledWith('proj-1', 'model-1', {
      excluded_borehole_ids: ['bh-2', 'bh-1'],
    })
    expect(model.excluded_borehole_ids).toEqual(['bh-2', 'bh-1'])
  })

  it('rolls back the optimistic update and does not toast when the PATCH fails', async () => {
    const { api } = await import('../api/client')
    let model = makeModel(['bh-1'])
    const setModel = vi.fn((value: SetStateAction<GeologicalModelResponse | null>) => {
      model = (typeof value === 'function'
        ? (value as (prev: GeologicalModelResponse | null) => GeologicalModelResponse | null)(model)
        : value) as GeologicalModelResponse
    })
    const pushUndo = vi.fn()
    const onSuccessToast = vi.fn()
    asMock(api.geology.updateModel).mockRejectedValue(new Error('backend blip'))

    await toggleBoreholeExclusion({
      projectId: 'proj-1',
      model,
      setModel,
      boreholeId: 'bh-1',
      included: true,
      pushUndo,
      markMutated: vi.fn(),
      includeDescriptionKey: 'undo.includeBoreholeGeo',
      excludeDescriptionKey: 'undo.excludeBoreholeGeo',
      logLabel: 'litho',
      onSuccessToast,
    })

    // Server truth wins: the optimistic include is undone.
    expect(model.excluded_borehole_ids).toEqual(['bh-1'])
    expect(pushUndo).not.toHaveBeenCalled()
    expect(onSuccessToast).not.toHaveBeenCalled()
  })
})

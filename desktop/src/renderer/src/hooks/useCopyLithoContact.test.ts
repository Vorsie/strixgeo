/**
 * Hook-level pins for the litho-contact copy gesture (installer #35 owner ask,
 * verbatim: *"can't i drag and drop an accepted litho contact onto a new cptm
 * for example. just like the litho boundaries?"* / *"b, both units."*).
 *
 * The hook orchestrates one drop: it plans (planLithoContactCopy), fires the
 * right existing endpoint (bulk-create both units on an empty target, or split
 * the spanning layer on a target that already has layers), toasts, and pushes a
 * single undo step. These tests drive it through a REAL useUndoStack so
 * *"ctrl+z takes the copy back"* is exercised end to end, with the API mocked.
 */

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCopyLithoContact } from './useCopyLithoContact'
import { useUndoStack } from './useUndoStack'
import type { UseUndoStackResult } from './useUndoStack'
import type { LithoLayerResponse } from '../api/client'

const PROJECT_ID = 'proj-1'
const MODEL_ID = 'model-1'

/** Minimal accepted litho layer for the source/target column state. */
function makeLayer(over: Partial<LithoLayerResponse>): LithoLayerResponse {
  return {
    id: 'l-x',
    model_id: MODEL_ID,
    formation_id: 'f-x',
    borehole_id: null,
    cpt_id: null,
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source: 'manual',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-09-13T00:00:00Z',
    updated_at: '2026-09-13T00:00:00Z',
    ...over,
  }
}

// Source CPT-A: clay 1..3 (f-clay) above sand 3..7 (f-sand). The contact is 3 m.
const SOURCE_LAYERS: LithoLayerResponse[] = [
  makeLayer({ id: 'a1', cpt_id: 'cpt-a', formation_id: 'f-clay', depth_top_m: 1, depth_base_m: 3 }),
  makeLayer({ id: 'a2', cpt_id: 'cpt-a', formation_id: 'f-sand', depth_top_m: 3, depth_base_m: 7 }),
]

function makeApi() {
  return {
    bulkCreateLayers: vi.fn(async (_p: string, _m: string, items: readonly { depth_top_m: number }[]) =>
      items.map((it, i) =>
        makeLayer({ id: `created-${i}`, cpt_id: 'cpt-b', depth_top_m: it.depth_top_m }),
      ),
    ),
    splitLayer: vi.fn(async () => ({
      top: makeLayer({ id: 'split-top', cpt_id: 'cpt-b' }),
      bottom: makeLayer({ id: 'split-bottom', cpt_id: 'cpt-b' }),
    })),
    deleteLayer: vi.fn(async (_p: string, _m: string, _layerId: string) => undefined),
  }
}

function renderHost(
  over: {
    lithoLayers?: LithoLayerResponse[]
    terminalDepthM?: (investigationId: string, kind: 'cpt' | 'borehole') => number | null
  } = {},
) {
  const api = makeApi()
  const toast = vi.fn()
  const settle = vi.fn(async () => undefined)
  const { result } = renderHook(() => {
    const undo: UseUndoStackResult = useUndoStack()
    const hook = useCopyLithoContact({
      projectId: PROJECT_ID,
      modelId: MODEL_ID,
      lithoLayers: over.lithoLayers ?? SOURCE_LAYERS,
      terminalDepthM: over.terminalDepthM ?? (() => 10),
      api,
      pushUndo: undo.push,
      toast,
      settle,
    })
    return { hook, undo, api, toast, settle }
  })
  return result
}

describe('useCopyLithoContact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('drag an accepted litho contact onto a new CPT: both units land there', async () => {
    const result = renderHost()
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(result.current.api.bulkCreateLayers).toHaveBeenCalledTimes(1)
    const items = result.current.api.bulkCreateLayers.mock.calls[0][2]
    expect(items).toEqual([
      expect.objectContaining({
        formation_id: 'f-clay',
        depth_top_m: 0,
        depth_base_m: 3,
        status: 'accepted',
        cpt_id: 'cpt-b',
        borehole_id: null,
      }),
      expect.objectContaining({
        formation_id: 'f-sand',
        depth_top_m: 3,
        depth_base_m: 10,
        status: 'accepted',
        cpt_id: 'cpt-b',
        borehole_id: null,
      }),
    ])
    expect(result.current.api.splitLayer).not.toHaveBeenCalled()
    expect(result.current.toast).toHaveBeenCalledWith('success', expect.any(String), expect.any(String))
  })

  it('onto a CPT that already has layers: the layer splits, compositions kept', async () => {
    const targetLayers = [
      makeLayer({ id: 'b-top', cpt_id: 'cpt-b', depth_top_m: 0, depth_base_m: 5 }),
      makeLayer({ id: 'b-bottom', cpt_id: 'cpt-b', depth_top_m: 5, depth_base_m: 12 }),
    ]
    const result = renderHost({ lithoLayers: [...SOURCE_LAYERS, ...targetLayers] })
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(result.current.api.splitLayer).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, 'b-top', 3)
    expect(result.current.api.bulkCreateLayers).not.toHaveBeenCalled()
    expect(result.current.toast).toHaveBeenCalledWith('success', expect.any(String), expect.any(String))
  })

  it('dropped below the terminal depth: refused', async () => {
    const result = renderHost({ terminalDepthM: () => 2 })
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(result.current.api.bulkCreateLayers).not.toHaveBeenCalled()
    expect(result.current.api.splitLayer).not.toHaveBeenCalled()
    expect(result.current.toast).toHaveBeenCalledWith('warning', expect.any(String), expect.any(String))
  })

  it('ctrl+z takes the copy back (empty target: the created units are deleted)', async () => {
    const result = renderHost()
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    expect(result.current.undo.canUndo).toBe(true)
    await act(async () => {
      await result.current.undo.undo()
    })
    // Both created layers were deleted to take the copy back.
    expect(result.current.api.deleteLayer).toHaveBeenCalledTimes(2)
    const deleted = result.current.api.deleteLayer.mock.calls.map(c => c[2])
    expect(deleted).toContain('created-0')
    expect(deleted).toContain('created-1')
  })

  it('ctrl+z takes the copy back (split target: the new bottom half is deleted)', async () => {
    const targetLayers = [
      makeLayer({ id: 'b-top', cpt_id: 'cpt-b', depth_top_m: 0, depth_base_m: 5 }),
      makeLayer({ id: 'b-bottom', cpt_id: 'cpt-b', depth_top_m: 5, depth_base_m: 12 }),
    ]
    const result = renderHost({ lithoLayers: [...SOURCE_LAYERS, ...targetLayers] })
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-b',
        targetKind: 'cpt',
      })
    })
    await act(async () => {
      await result.current.undo.undo()
    })
    // The split's undo deletes the new bottom half; the FC->LL mirror re-merges.
    expect(result.current.api.deleteLayer).toHaveBeenCalledWith(PROJECT_ID, MODEL_ID, 'split-bottom')
  })

  it('a drop on the source column is a silent no-op (no API call, no toast)', async () => {
    const result = renderHost()
    await act(async () => {
      await result.current.hook.copyLithoContact({
        sourceInvestigationId: 'cpt-a',
        contactDepthM: 3,
        targetInvestigationId: 'cpt-a',
        targetKind: 'cpt',
      })
    })
    expect(result.current.api.bulkCreateLayers).not.toHaveBeenCalled()
    expect(result.current.api.splitLayer).not.toHaveBeenCalled()
    expect(result.current.toast).not.toHaveBeenCalled()
  })
})

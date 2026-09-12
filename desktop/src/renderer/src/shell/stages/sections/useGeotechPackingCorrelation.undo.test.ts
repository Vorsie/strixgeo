// Disconnecting a packing correlation must be undoable, like uncorrelating on litho.
//
// The litho path pushes an undo entry whose revert recreates the edge and whose reapply
// deletes it again (`SectionsCanvas.tsx:810`, "Uncorrelate contacts"). The geotech path
// pushed nothing, with a comment reasoning that "the subdivide verb re-generates all
// packing correlations anyway".
//
// That reasoning does not survive contact with the workflow it describes. Re-subdividing
// is model-wide and destructive — it deletes every geotech row and every MANUAL
// correlation with it — so it is the one thing an owner correlating by hand must avoid.
// Leaving disconnect un-undoable meant a mis-click could only be repaired by hand, or by
// the very verb that would throw away the rest of the session's work.
//
// Phrased as the owner would: taking a connection away by accident should cost one
// Ctrl-Z, not the afternoon.

import { renderHook, act } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeotechPackingCorrelation } from './useGeotechPackingCorrelation'
import type { GeologicalModelResponse } from '../../../api/client'

const mockDeleteContactCorrelation = vi.fn().mockResolvedValue(undefined)
const mockCreateContactCorrelation = vi.fn().mockResolvedValue(undefined)

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    api: {
      geology: {
        deleteContactCorrelation: (...a: unknown[]) => mockDeleteContactCorrelation(...a),
        createContactCorrelation: (...a: unknown[]) => mockCreateContactCorrelation(...a),
      },
    },
  }
})

const GEOTECH_MODEL: GeologicalModelResponse = {
  id: 'geotech-model-1',
  app_project_id: 'proj-1',
  name: 'Geotechnical Model',
  description: null,
  is_active: true,
  excluded_borehole_ids: [],
  kind: 'geotechnical',
  parent_model_id: 'litho-model-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

/** The undo entries the hook pushes during a test. */
type Entry = { descriptionKey: string; revert: () => Promise<void>; reapply: () => Promise<void> }

function makeDeps(pushed: Entry[]) {
  return {
    activeGeotechModel: GEOTECH_MODEL,
    projectId: 'proj-1',
    selectedSectionId: 'sec-1',
    refetchContactEdges: () => Promise.resolve(),
    refetchGeotechPackingEdges: () => Promise.resolve(),
    requestGeotechLayersRefetch: vi.fn(),
    markMutated: vi.fn(),
    markBoreholesStale: vi.fn(),
    toast: vi.fn(),
    setArmedContactId: vi.fn(),
    setArmedContactSide: vi.fn(),
    setLastTargetTestId: vi.fn(),
    setContactCorrelationEdges: vi.fn(),
    setGeotechPackingEdges: vi.fn(),
    undoStack: { push: (e: Entry) => pushed.push(e) },
  }
}

describe('handleDeleteGeotechPackingCorrelation — undo', () => {
  beforeEach(() => {
    mockDeleteContactCorrelation.mockClear()
    mockCreateContactCorrelation.mockClear()
  })

  it('GU1 — disconnecting pushes an undo entry', async () => {
    const pushed: Entry[] = []
    const { result } = renderHook(() =>
      useGeotechPackingCorrelation(makeDeps(pushed) as never),
    )

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('a', 'b', 'top', 'base')
    })

    expect(pushed).toHaveLength(1)
    expect(pushed[0].descriptionKey).toBe('undo.disconnectPackingBands')
  })

  it('GU2 — undo recreates the same edge, sides and all', async () => {
    const pushed: Entry[] = []
    const { result } = renderHook(() =>
      useGeotechPackingCorrelation(makeDeps(pushed) as never),
    )

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('a', 'b', 'top', 'base')
    })
    await act(async () => {
      await pushed[0].revert()
    })

    // Sides are load-bearing: a top-to-base tie is not the same connection as
    // top-to-top, so a revert that dropped them would restore a different edge.
    expect(mockCreateContactCorrelation).toHaveBeenCalledWith(
      'proj-1',
      'geotech-model-1',
      'a',
      'b',
      'sec-1',
      'top',
      'base',
    )
  })

  it('GU3 — redo removes it again, so a round-trip leaves no drift', async () => {
    const pushed: Entry[] = []
    const { result } = renderHook(() =>
      useGeotechPackingCorrelation(makeDeps(pushed) as never),
    )

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('a', 'b', 'top', 'base')
    })
    mockDeleteContactCorrelation.mockClear()
    await act(async () => {
      await pushed[0].reapply()
    })

    expect(mockDeleteContactCorrelation).toHaveBeenCalledWith(
      'proj-1',
      'geotech-model-1',
      'a',
      'b',
      'sec-1',
      'top',
      'base',
    )
  })

  it('GU4 — a failed DELETE pushes nothing, so undo cannot restore what still exists', async () => {
    mockDeleteContactCorrelation.mockRejectedValueOnce(new Error('boom'))
    const pushed: Entry[] = []
    const { result } = renderHook(() =>
      useGeotechPackingCorrelation(makeDeps(pushed) as never),
    )

    await act(async () => {
      await result.current.handleDeleteGeotechPackingCorrelation('a', 'b', 'top', 'base')
    })

    expect(pushed).toHaveLength(0)
  })
})

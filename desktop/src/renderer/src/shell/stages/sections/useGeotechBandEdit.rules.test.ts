// What happens between the gesture and the database, in the owner's terms.
//
// Ruling 5 (docs/debt.md #227, 2026-08-01): "the user needs to be able to manually overrule
// everything". The case that proves it is not that a warning appears — it is that the commit
// still goes out AFTER one appeared. Ruling 4: "only the edited column re-derives", which on
// this side of the wire means one call, on one band, and no sweep of the model.
//
// Ruling 2 is the one refusal that is correct rather than a defect, so the 422 the server
// answers for an out-of-body depth must reach the owner in the server's own words — the
// message names which wall it hit and which axis to fix it on, and paraphrasing it here
// would lose that.

import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeotechBandEdit } from './useGeotechBandEdit'

const previewSplitGeotechBand = vi.fn()
const previewMergeGeotechBands = vi.fn()
const previewMergeGeotechRun = vi.fn()
const previewMoveGeotechBoundary = vi.fn()
const splitGeotechBand = vi.fn()
const mergeGeotechBands = vi.fn()
const mergeGeotechRun = vi.fn()
const moveGeotechBoundary = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      previewSplitGeotechBand: (...a: unknown[]) => previewSplitGeotechBand(...a),
      previewMergeGeotechBands: (...a: unknown[]) => previewMergeGeotechBands(...a),
      previewMergeGeotechRun: (...a: unknown[]) => previewMergeGeotechRun(...a),
      previewMoveGeotechBoundary: (...a: unknown[]) => previewMoveGeotechBoundary(...a),
      splitGeotechBand: (...a: unknown[]) => splitGeotechBand(...a),
      mergeGeotechBands: (...a: unknown[]) => mergeGeotechBands(...a),
      mergeGeotechRun: (...a: unknown[]) => mergeGeotechRun(...a),
      moveGeotechBoundary: (...a: unknown[]) => moveGeotechBoundary(...a),
    },
  },
}))

/** A plan whose merge moves the class — i.e. one that carries a warning. */
const PLAN_WITH_WARNING = {
  kind: 'merge',
  parent_top_m: 2,
  parent_base_m: 8,
  intervals: [
    {
      depth_top_m: 3,
      depth_base_m: 6,
      median_qc_mpa: 7.5,
      nad_class: 6,
      previous_nad_class: 7,
      class_changed: true,
      unclassifiable_reason: null,
    },
  ],
  warnings: [
    {
      code: 'qc_pull_down',
      message:
        'Pulls the representative qc of this layer DOWN from 12.0 to 7.5 MPa, class 7 becomes 6.',
      depth_top_m: 3,
      depth_base_m: 4.5,
      band_id: 'band-upper',
    },
  ],
}

const toast = vi.fn()

function deps() {
  return {
    activeGeotechModel: { id: 'geo-model-1' } as never,
    projectId: 'proj-1',
    requestGeotechLayersRefetch: vi.fn(),
    refetchGeotechPackingEdges: vi.fn().mockResolvedValue(undefined),
    markMutated: vi.fn(),
    toast,
    undoStack: { push: vi.fn() },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  previewSplitGeotechBand.mockResolvedValue(PLAN_WITH_WARNING)
  previewMergeGeotechBands.mockResolvedValue(PLAN_WITH_WARNING)
  previewMoveGeotechBoundary.mockResolvedValue(PLAN_WITH_WARNING)
  splitGeotechBand.mockResolvedValue({
    deleted_edge_ids: [],
    flagged_edge_ids: [],
    investigation_id: 'cpt-1',
    layer_ids: ['band-1', 'new-lower'],
    created_layer_ids: ['new-lower'],
    deleted_layer_ids: [],
  })
  mergeGeotechBands.mockResolvedValue({
    deleted_edge_ids: [],
    flagged_edge_ids: [],
    investigation_id: 'cpt-1',
    layer_ids: ['band-upper'],
    created_layer_ids: [],
    deleted_layer_ids: ['band-lower'],
  })
  moveGeotechBoundary.mockResolvedValue({
    deleted_edge_ids: [],
    flagged_edge_ids: [],
    investigation_id: 'cpt-1',
    layer_ids: ['band-u', 'band-l'],
    created_layer_ids: [],
    deleted_layer_ids: [],
  })
})

describe('the consequence is shown before anything is written', () => {
  it('HK1 — asking to split previews first and writes nothing yet', async () => {
    const { result } = renderHook(() => useGeotechBandEdit(deps()))

    act(() => result.current.onRequestSplitBand?.('band-2', 4.75))

    await waitFor(() => expect(result.current.plan).not.toBeNull())
    expect(previewSplitGeotechBand).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-2', 4.75)
    expect(splitGeotechBand).not.toHaveBeenCalled()
  })
})

describe('and then the owner may proceed against it — the override is the feature', () => {
  it('HK2 — confirming after a warning commits the split', async () => {
    const { result } = renderHook(() => useGeotechBandEdit(deps()))

    act(() => result.current.onRequestSplitBand?.('band-2', 4.75))
    await waitFor(() => expect(result.current.plan?.warnings).toHaveLength(1))
    await act(async () => {
      await result.current.confirm()
    })

    expect(splitGeotechBand).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-2', 4.75)
  })

  it('HK3 — confirming after a warning commits the merge', async () => {
    const { result } = renderHook(() => useGeotechBandEdit(deps()))

    act(() => result.current.onRequestMergeBands?.('band-2', 'band-3', 6))
    await waitFor(() => expect(result.current.plan?.warnings).toHaveLength(1))
    await act(async () => {
      await result.current.confirm()
    })

    expect(mergeGeotechBands).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-2', 'band-3')
  })

  it('HK4 — cancelling writes nothing and closes the sheet', async () => {
    const { result } = renderHook(() => useGeotechBandEdit(deps()))

    act(() => result.current.onRequestSplitBand?.('band-2', 4.75))
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    act(() => result.current.cancel())

    expect(result.current.plan).toBeNull()
    expect(splitGeotechBand).not.toHaveBeenCalled()
  })
})

describe('a refusal on hierarchy grounds reaches the owner in the server’s own words', () => {
  it('HK5 — an out-of-body split depth surfaces the 422 verbatim, and opens no sheet', async () => {
    const message =
      'The depth falls outside the band’s own litho body (2.00–8.00 m). A packing boundary ' +
      'moves freely inside its litho body and clamps at the edge.'
    previewSplitGeotechBand.mockRejectedValue(new Error(message))
    const { result } = renderHook(() => useGeotechBandEdit(deps()))

    act(() => result.current.onRequestSplitBand?.('band-2', 99))

    await waitFor(() => expect(toast).toHaveBeenCalledWith('error', message))
    expect(result.current.plan).toBeNull()
  })
})

describe('without a geotech model there is nothing to edit', () => {
  it('HK6 — the verbs are not offered at all', () => {
    const { result } = renderHook(() =>
      useGeotechBandEdit({ ...deps(), activeGeotechModel: null }),
    )

    expect(result.current.onRequestSplitBand).toBeUndefined()
    expect(result.current.onRequestMergeBands).toBeUndefined()
  })
})


// ---------------------------------------------------------------------------
// HK7+ — the drag verb (owner 2026-08-07) and undo for every band edit
// ---------------------------------------------------------------------------

describe('the drag verb previews and commits like its siblings', () => {
  it('HK7 — asking to move a boundary previews first and writes nothing yet', async () => {
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    expect(previewMoveGeotechBoundary).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      'band-u',
      'band-l',
      4.6,
    )
    expect(moveGeotechBoundary).not.toHaveBeenCalled()
  })

  it('HK8 — confirming the move commits it', async () => {
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(moveGeotechBoundary).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      'band-u',
      'band-l',
      4.6,
    )
  })
})

describe('every committed band edit is undoable (app-wide owner rule)', () => {
  it('HK9 — undoing a move drags the boundary back where it was', async () => {
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(d.undoStack.push).toHaveBeenCalledTimes(1)
    const command = d.undoStack.push.mock.calls[0][0]
    moveGeotechBoundary.mockClear()
    await command.revert()
    expect(moveGeotechBoundary).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      'band-u',
      'band-l',
      4.0,
    )
  })

  it('HK10 — undoing a split merges the two halves back together', async () => {
    splitGeotechBand.mockResolvedValue({
      deleted_edge_ids: [],
      flagged_edge_ids: [],
      investigation_id: 'cpt-1',
      layer_ids: ['band-1', 'new-lower'],
      created_layer_ids: ['new-lower'],
      deleted_layer_ids: [],
    })
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestSplitBand?.('band-1', 4.5)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const command = d.undoStack.push.mock.calls[0][0]
    await command.revert()
    expect(mergeGeotechBands).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-1', 'new-lower')
  })

  it('HK11 — undoing a merge re-splits at the old shared boundary', async () => {
    mergeGeotechBands.mockResolvedValue({
      deleted_edge_ids: [],
      flagged_edge_ids: [],
      investigation_id: 'cpt-1',
      layer_ids: ['band-upper'],
      created_layer_ids: [],
      deleted_layer_ids: ['band-lower'],
    })
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      // The overlay carries the shared boundary's depth so the undo can restore it.
      result.current.onRequestMergeBands?.('band-upper', 'band-lower', 4.5)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const command = d.undoStack.push.mock.calls[0][0]
    await command.revert()
    expect(splitGeotechBand).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-upper', 4.5)
  })

  it('HK12 — the toast names the flagged ties, not a deletion', async () => {
    mergeGeotechBands.mockResolvedValue({
      deleted_edge_ids: [],
      flagged_edge_ids: ['edge-1', 'edge-2'],
      investigation_id: 'cpt-1',
      layer_ids: ['band-upper'],
      created_layer_ids: [],
      deleted_layer_ids: ['band-lower'],
    })
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMergeBands?.('band-upper', 'band-lower', 4.5)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const message = toast.mock.calls.at(-1)?.[1] as string
    expect(message).toMatch(/2.*flagged for review/)
  })

  it('HK14 — revert refreshes the render exactly as the commit did', async () => {
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const command = d.undoStack.push.mock.calls[0][0]
    d.requestGeotechLayersRefetch.mockClear()
    await command.revert()
    expect(d.requestGeotechLayersRefetch).toHaveBeenCalled()
  })
})

describe('absorbing a small enclosed lens is ONE merge over the whole run', () => {
  // Owner idea (#227 tail): host + lens + host collapse in a single verb — one
  // consequence sheet over the union, one undo step. The run form of the merge
  // endpoint exists exactly for this; the hook never chains pair merges.
  const ABSORB_RESULT = {
    deleted_edge_ids: [],
    flagged_edge_ids: [],
    investigation_id: 'cpt-1',
    layer_ids: ['host-up'],
    created_layer_ids: [],
    deleted_layer_ids: ['lens', 'host-down'],
  }

  it('HK15 — asking to absorb previews the three-band union and writes nothing yet', async () => {
    previewMergeGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    const { result } = renderHook(() => useGeotechBandEdit(deps()))
    act(() => {
      result.current.onRequestAbsorbLens?.('host-up', 'lens', 'host-down', 4.0, 4.3)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    expect(previewMergeGeotechRun).toHaveBeenCalledWith('proj-1', 'geo-model-1', [
      'host-up',
      'lens',
      'host-down',
    ])
    expect(mergeGeotechRun).not.toHaveBeenCalled()
  })

  it('HK16 — undoing an absorb re-splits at BOTH carried boundaries, top down', async () => {
    previewMergeGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    mergeGeotechRun.mockResolvedValue(ABSORB_RESULT)
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestAbsorbLens?.('host-up', 'lens', 'host-down', 4.0, 4.3)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(mergeGeotechRun).toHaveBeenCalledWith('proj-1', 'geo-model-1', [
      'host-up',
      'lens',
      'host-down',
    ])
    expect(d.undoStack.push).toHaveBeenCalledTimes(1)
    const command = d.undoStack.push.mock.calls[0][0]
    // First split peels the lens+lower composite off the survivor at the upper
    // boundary; the second splits that fresh row at the lower boundary.
    splitGeotechBand
      .mockResolvedValueOnce({
        ...ABSORB_RESULT,
        layer_ids: ['host-up', 'new-lens'],
        created_layer_ids: ['new-lens'],
        deleted_layer_ids: [],
      })
      .mockResolvedValueOnce({
        ...ABSORB_RESULT,
        layer_ids: ['new-lens', 'new-down'],
        created_layer_ids: ['new-down'],
        deleted_layer_ids: [],
      })
    await command.revert()
    expect(splitGeotechBand).toHaveBeenNthCalledWith(1, 'proj-1', 'geo-model-1', 'host-up', 4.0)
    expect(splitGeotechBand).toHaveBeenNthCalledWith(2, 'proj-1', 'geo-model-1', 'new-lens', 4.3)
  })

  it('HK17 — redo after the undo merges the FRESH rows, not the dead ids', async () => {
    previewMergeGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    mergeGeotechRun.mockResolvedValue(ABSORB_RESULT)
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestAbsorbLens?.('host-up', 'lens', 'host-down', 4.0, 4.3)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const command = d.undoStack.push.mock.calls[0][0]
    splitGeotechBand
      .mockResolvedValueOnce({
        ...ABSORB_RESULT,
        layer_ids: ['host-up', 'new-lens'],
        created_layer_ids: ['new-lens'],
        deleted_layer_ids: [],
      })
      .mockResolvedValueOnce({
        ...ABSORB_RESULT,
        layer_ids: ['new-lens', 'new-down'],
        created_layer_ids: ['new-down'],
        deleted_layer_ids: [],
      })
    await command.revert()
    mergeGeotechRun.mockClear()
    await command.reapply()
    expect(mergeGeotechRun).toHaveBeenCalledWith('proj-1', 'geo-model-1', [
      'host-up',
      'new-lens',
      'new-down',
    ])
  })
})

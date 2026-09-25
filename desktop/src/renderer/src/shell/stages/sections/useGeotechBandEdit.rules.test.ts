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
const previewAbsorbGeotechRun = vi.fn()
const absorbGeotechRun = vi.fn()

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
      previewAbsorbGeotechRun: (...a: unknown[]) => previewAbsorbGeotechRun(...a),
      absorbGeotechRun: (...a: unknown[]) => absorbGeotechRun(...a),
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
const onAcceptedTiesFlagged = vi.fn()

function deps() {
  return {
    activeGeotechModel: { id: 'geo-model-1' } as never,
    projectId: 'proj-1',
    requestGeotechLayersRefetch: vi.fn(),
    refetchGeotechPackingEdges: vi.fn().mockResolvedValue(true),
    markMutated: vi.fn(),
    toast,
    undoStack: { push: vi.fn() },
    onAcceptedTiesFlagged,
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

describe('a committed band edit schedules the geotech body-identity recompute (slice 5)', () => {
  it('HK7 — one verb success is one geotech bump; the preview alone bumps nothing', async () => {
    const requestBodyRecompute = vi.fn()
    const { result } = renderHook(() => useGeotechBandEdit({ ...deps(), requestBodyRecompute }))

    act(() => result.current.onRequestSplitBand?.('band-2', 4.75))
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    // A preview writes nothing, so it must not reschedule identity either.
    expect(requestBodyRecompute).not.toHaveBeenCalled()

    await act(async () => {
      await result.current.confirm()
    })
    expect(requestBodyRecompute).toHaveBeenCalledTimes(1)
    expect(requestBodyRecompute).toHaveBeenCalledWith('geotech')
  })

  it('HK8 — the pushed undo command reschedules on revert too', async () => {
    const requestBodyRecompute = vi.fn()
    const push = vi.fn()
    const { result } = renderHook(() =>
      useGeotechBandEdit({ ...deps(), undoStack: { push }, requestBodyRecompute }),
    )

    act(() => result.current.onRequestSplitBand?.('band-2', 4.75))
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(push).toHaveBeenCalledTimes(1)

    // Ctrl+Z moves the geometry back — the identity must follow it back too.
    requestBodyRecompute.mockClear()
    await push.mock.calls[0][0].revert()
    expect(requestBodyRecompute).toHaveBeenCalledTimes(1)
    expect(requestBodyRecompute).toHaveBeenCalledWith('geotech')
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

  it('HK11 — ctrl+z after a merge brings back both bands as they were', async () => {
    // Owner (#35 dogfeed): "ctrl+z on geotech axis, after merges, deletes the
    // merge but doesn't restore the earlier packing suggestion". Re-splitting and
    // re-deriving lost a class the merge had changed or a hand class it never
    // measured. The undo now RESTORES each half from the pre-merge state the
    // merge captured — split + set class (and source) on each half.
    mergeGeotechBands.mockResolvedValue({
      deleted_edge_ids: [],
      flagged_edge_ids: [],
      investigation_id: 'cpt-1',
      layer_ids: ['band-upper'],
      created_layer_ids: [],
      deleted_layer_ids: ['band-lower'],
      pre_merge_upper_nad_class: 6,
      pre_merge_lower_nad_class: 7,
      pre_merge_upper_source: 'segmenter',
      pre_merge_lower_source: 'manual',
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
    // Split at the carried boundary, restoring each half's pre-merge class + source —
    // NOT a bare re-split that re-derives (which lost the lower piece's class).
    expect(splitGeotechBand).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-upper', 4.5, {
      upperNadClass: 6,
      lowerNadClass: 7,
      upperSource: 'segmenter',
      lowerSource: 'manual',
    })
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

  it('HK15 — a flagged tie is reported so the engineer can be asked about it', async () => {
    // Owner, after hunting a violet badge down by hand: "check the correlations
    // after merge ... then prompt user, do you want to delete correlation band
    // because packing densities mismatch?". The toast alone does not ask anything,
    // so the ids go out to whoever owns the prompt. Reported AFTER the refetch, so
    // the ids can be looked up in a list that matches the server.
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
    expect(onAcceptedTiesFlagged).toHaveBeenCalledWith(['edge-1', 'edge-2'])
  })

  it('HK16 — an edit that flagged nothing asks nothing', async () => {
    // Every split, merge and move would otherwise open a dialog over a list of none.
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(onAcceptedTiesFlagged).not.toHaveBeenCalled()
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

describe('a write that reached the server is never reported as a failure', () => {
  // The refresh that follows a commit is a VIEW concern. If it fails, the edit
  // has still happened: telling the engineer "could not apply the edit" invites
  // them to do it a second time, and skipping the undo push leaves the edit
  // they were told never happened permanently unundoable.
  it('HK18 — a failed refresh still pushes the undo command for the committed edit', async () => {
    const d = deps()
    d.refetchGeotechPackingEdges = vi.fn().mockRejectedValue(new Error('network blip'))
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(moveGeotechBoundary).toHaveBeenCalledTimes(1)
    expect(d.undoStack.push).toHaveBeenCalledTimes(1)
  })

  it('HK19 — a failed refresh never toasts the commit as an error', async () => {
    const d = deps()
    d.refetchGeotechPackingEdges = vi.fn().mockRejectedValue(new Error('network blip'))
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const severities = toast.mock.calls.map(c => c[0])
    expect(severities).toContain('success')
    expect(severities).not.toContain('error')
  })
})

describe('the toast names what actually happened to each tie', () => {
  // The owner's binding rule is that accepted work is never quietly destroyed.
  // A merge CAN legitimately delete an accepted tie — a self-loop, or a true
  // duplicate of one the survivor already carries — but calling that "a pending
  // tie removed" tells him the machine withdrew its own proposal when in fact
  // a correlation HE drew is gone. The counts must be separated at the wire.
  it('HK20 — a deleted accepted tie is reported as accepted, never as pending', async () => {
    mergeGeotechBands.mockResolvedValue({
      deleted_edge_ids: ['edge-acc'],
      deleted_accepted_edge_ids: ['edge-acc'],
      flagged_edge_ids: [],
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
    expect(message).toMatch(/1 accepted tie/)
    expect(message).not.toMatch(/1 pending tie/)
  })

  it('HK21 — withdrawn machine proposals are still called pending', async () => {
    mergeGeotechBands.mockResolvedValue({
      deleted_edge_ids: ['edge-pending'],
      deleted_accepted_edge_ids: [],
      flagged_edge_ids: [],
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
    expect(message).toMatch(/1 pending tie/)
  })
})

describe('a stale view after a committed edit is said out loud', () => {
  // HK18/HK19 pin the throwing case. Production does not throw: the packing-edge
  // refetch catches its own failure and logs, so the hook sees a RESOLVED
  // promise and — before this test existed — showed a plain success toast over
  // a section still drawing ties the server had just deleted. The engineer then
  // judges his model against a correlation picture that no longer exists, and
  // the violet review badges flag-not-drop exists to raise never appear.
  it('HK22 — a refetch that reports failure warns that the view is behind', async () => {
    const d = deps()
    d.refetchGeotechPackingEdges = vi.fn().mockResolvedValue(false)
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    const severities = toast.mock.calls.map(c => c[0])
    expect(severities).toContain('warning')
    expect(severities).not.toContain('error')
    expect(d.undoStack.push).toHaveBeenCalledTimes(1)
  })

  it('HK23 — a refetch that succeeds says nothing extra', async () => {
    const d = deps()
    d.refetchGeotechPackingEdges = vi.fn().mockResolvedValue(true)
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestMoveBoundary?.('band-u', 'band-l', 4.6, 4.0)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(toast.mock.calls.map(c => c[0])).not.toContain('warning')
  })
})


describe('Ctrl+drag absorb-all is ONE previewed edit and ONE undo step', () => {
  // Owner 2026-09-25. The run unions and the far boundary moves in one server
  // transaction; the sheet shows the final two intervals; ctrl+z moves the
  // boundary back and re-splits the survivor at every carried boundary.
  const REQUEST = {
    runBandIds: ['band-1', 'band-2', 'band-3'],
    carriedBoundariesM: [4, 6],
    enteredBandId: 'band-4',
    enteredOriginalBoundaryM: 8,
    newDepthM: 9,
    direction: 'down' as const,
  }
  const ABSORB_RUN_RESULT = {
    deleted_edge_ids: [],
    flagged_edge_ids: [],
    investigation_id: 'cpt-1',
    layer_ids: ['band-1', 'band-4'],
    created_layer_ids: [],
    deleted_layer_ids: ['band-2', 'band-3'],
  }

  it('HK24 — asking previews the final two intervals and writes nothing yet', async () => {
    previewAbsorbGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    const { result } = renderHook(() => useGeotechBandEdit(deps()))
    act(() => {
      result.current.onRequestAbsorbRun?.(REQUEST)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    expect(previewAbsorbGeotechRun).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      ['band-1', 'band-2', 'band-3'],
      'band-4',
      9,
    )
    expect(absorbGeotechRun).not.toHaveBeenCalled()
  })

  it('HK25 — confirming commits it once; undo moves the boundary back, then re-splits top down', async () => {
    previewAbsorbGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    absorbGeotechRun.mockResolvedValue(ABSORB_RUN_RESULT)
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestAbsorbRun?.(REQUEST)
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(absorbGeotechRun).toHaveBeenCalledTimes(1)
    expect(absorbGeotechRun).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      ['band-1', 'band-2', 'band-3'],
      'band-4',
      9,
    )
    expect(d.undoStack.push).toHaveBeenCalledTimes(1)
    const command = d.undoStack.push.mock.calls[0][0]
    expect(command.descriptionKey).toBe('undo.absorbPackingRun')

    splitGeotechBand
      .mockResolvedValueOnce({ ...ABSORB_RUN_RESULT, created_layer_ids: ['new-2'], deleted_layer_ids: [] })
      .mockResolvedValueOnce({ ...ABSORB_RUN_RESULT, created_layer_ids: ['new-3'], deleted_layer_ids: [] })
    await command.revert()
    // 1. the boundary with the entered band goes back where it was …
    expect(moveGeotechBoundary).toHaveBeenCalledWith('proj-1', 'geo-model-1', 'band-1', 'band-4', 8)
    // 2. … then the survivor is re-split at each carried boundary, top down.
    expect(splitGeotechBand).toHaveBeenNthCalledWith(1, 'proj-1', 'geo-model-1', 'band-1', 4)
    expect(splitGeotechBand).toHaveBeenNthCalledWith(2, 'proj-1', 'geo-model-1', 'new-2', 6)

    absorbGeotechRun.mockClear()
    await command.reapply()
    // Redo absorbs the FRESH rows, never the dead ids.
    expect(absorbGeotechRun).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      ['band-1', 'new-2', 'new-3'],
      'band-4',
      9,
    )
  })

  it('HK26 — a release on the litho wall has no entered band: undo only re-splits', async () => {
    previewAbsorbGeotechRun.mockResolvedValue(PLAN_WITH_WARNING)
    absorbGeotechRun.mockResolvedValue({ ...ABSORB_RUN_RESULT, layer_ids: ['band-1'] })
    const d = deps()
    const { result } = renderHook(() => useGeotechBandEdit(d))
    act(() => {
      result.current.onRequestAbsorbRun?.({
        ...REQUEST,
        enteredBandId: null,
        enteredOriginalBoundaryM: null,
        newDepthM: 14,
      })
    })
    await waitFor(() => expect(result.current.plan).not.toBeNull())
    await act(async () => {
      await result.current.confirm()
    })
    expect(absorbGeotechRun).toHaveBeenCalledWith(
      'proj-1',
      'geo-model-1',
      ['band-1', 'band-2', 'band-3'],
      null,
      null,
    )
    const command = d.undoStack.push.mock.calls[0][0]
    splitGeotechBand
      .mockResolvedValueOnce({ ...ABSORB_RUN_RESULT, created_layer_ids: ['new-2'], deleted_layer_ids: [] })
      .mockResolvedValueOnce({ ...ABSORB_RUN_RESULT, created_layer_ids: ['new-3'], deleted_layer_ids: [] })
    await command.revert()
    expect(moveGeotechBoundary).not.toHaveBeenCalled()
    expect(splitGeotechBand).toHaveBeenCalledTimes(2)
  })
})

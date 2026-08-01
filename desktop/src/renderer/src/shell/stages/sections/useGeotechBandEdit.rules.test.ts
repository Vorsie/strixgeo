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
const splitGeotechBand = vi.fn()
const mergeGeotechBands = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      previewSplitGeotechBand: (...a: unknown[]) => previewSplitGeotechBand(...a),
      previewMergeGeotechBands: (...a: unknown[]) => previewMergeGeotechBands(...a),
      splitGeotechBand: (...a: unknown[]) => splitGeotechBand(...a),
      mergeGeotechBands: (...a: unknown[]) => mergeGeotechBands(...a),
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
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  previewSplitGeotechBand.mockResolvedValue(PLAN_WITH_WARNING)
  previewMergeGeotechBands.mockResolvedValue(PLAN_WITH_WARNING)
  splitGeotechBand.mockResolvedValue({ deleted_edge_ids: [], investigation_id: 'cpt-1' })
  mergeGeotechBands.mockResolvedValue({ deleted_edge_ids: [], investigation_id: 'cpt-1' })
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

    act(() => result.current.onRequestMergeBands?.('band-2', 'band-3'))
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

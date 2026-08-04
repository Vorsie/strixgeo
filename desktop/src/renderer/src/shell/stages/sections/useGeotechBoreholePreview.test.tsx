// Tests for useGeotechBoreholePreview — the fetch behind the geotech ghosts.
//
// PH1 — fetches and exposes the planned columns on the geotech axis
// PH2 — does not fetch at all when the axis is not geotech
// PH3 — does not fetch before "Subdivide all bodies" has created a geotech model
// PH4 — a failure surfaces an error string, never a silently-empty column
// PH5 — the "no geotech model yet" 404 is not an error
// PH6 — a new refresh key refetches (the Subdivide / Divide invalidation)
// PH7 — the SAME refresh key does not refetch (one plan() per mutation)
// PH8 — a 404 that is NOT "no geotech model" is reported, not silenced
// PH9 — changing the planner's snap tolerance refetches

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeotechBoreholePreview } from './useGeotechBoreholePreview'
import { ApiError } from '../../../api/clients/shared'

const previewDivideBoreholes = vi.fn()

vi.mock('../../../api/client', () => ({
  api: {
    geology: {
      previewDivideBoreholes: (...args: unknown[]) => previewDivideBoreholes(...args),
    },
  },
}))

const PAYLOAD = {
  geotech_model_id: 'geo-1',
  columns: [
    {
      borehole_id: 'bh-1',
      name: 'BH-1',
      bands: [
        {
          depth_top_m: 0,
          depth_base_m: 4,
          nad_class: 6,
          source: 'cpt_interpolated',
          confidence: 'high',
        },
      ],
    },
  ],
  borehole_count: 1,
  divided_borehole_count: 1,
  single_band_borehole_count: 0,
  layer_count: 1,
  carried_tie_count: 3,
  review_tie_reasons: {},
  lost_tie_count: 1,
  lost_tie_reasons: { band_absent: 1 },
}

/** The everything-is-ready argument set; individual cases override one field. */
const READY = {
  projectId: 'proj-1',
  lithoModelId: 'litho-1',
  hasGeotechModel: true,
  enabled: true,
  refreshKey: 0,
  snapToleranceM: 0.3,
}

beforeEach(() => {
  previewDivideBoreholes.mockReset()
  previewDivideBoreholes.mockResolvedValue(PAYLOAD)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useGeotechBoreholePreview', () => {
  it('PH1 — loads the planned columns and the tie-carry counts', async () => {
    const { result } = renderHook(() => useGeotechBoreholePreview(READY))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(previewDivideBoreholes).toHaveBeenCalledWith('proj-1', 'litho-1')
    expect(result.current.columns).toHaveLength(1)
    expect(result.current.carriedTieCount).toBe(3)
    expect(result.current.lostTieCount).toBe(1)
    expect(result.current.error).toBeNull()
  })

  it('PH2 — asks for nothing off the geotech axis', () => {
    renderHook(() => useGeotechBoreholePreview({ ...READY, enabled: false }))
    expect(previewDivideBoreholes).not.toHaveBeenCalled()
  })

  it('PH3 — asks for nothing before a geotech model exists', () => {
    renderHook(() => useGeotechBoreholePreview({ ...READY, hasGeotechModel: false }))
    expect(previewDivideBoreholes).not.toHaveBeenCalled()
  })

  it('PH4 — a failure is reported, not swallowed into an empty column', async () => {
    previewDivideBoreholes.mockRejectedValue(new ApiError('boom', 500))
    const { result } = renderHook(() => useGeotechBoreholePreview(READY))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.columns).toHaveLength(0)
    expect(result.current.loading).toBe(false)
  })

  it('PH5 — "Subdivide has not run" is a state, not an error', async () => {
    previewDivideBoreholes.mockRejectedValue(
      new ApiError('missing', 404, {
        detail: { code: 'geotech_model_not_found', message: "Run 'Subdivide all bodies' first." },
      }),
    )
    const { result } = renderHook(() => useGeotechBoreholePreview(READY))
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.error).toBeNull()
    expect(result.current.columns).toHaveLength(0)
  })

  it('PH6 — a fresh refresh key refetches', async () => {
    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) =>
        useGeotechBoreholePreview({ ...READY, refreshKey }),
      { initialProps: { refreshKey: 1 } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(previewDivideBoreholes).toHaveBeenCalledTimes(1)
    rerender({ refreshKey: 2 })
    await waitFor(() => expect(previewDivideBoreholes).toHaveBeenCalledTimes(2))
  })

  it('PH7 — an unchanged refresh key costs nothing, however often it re-renders', async () => {
    // The key used to be the committed geotechLayers ARRAY, and
    // useGeologicalModel replaces that twice per mutation (it clears to [] before
    // refetching). Every Divide therefore ran the whole planner — TIN
    // interpolation included — twice. A value-typed key cannot do that.
    const { result, rerender } = renderHook(
      ({ refreshKey }: { refreshKey: number }) =>
        useGeotechBoreholePreview({ ...READY, refreshKey }),
      { initialProps: { refreshKey: 7 } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    rerender({ refreshKey: 7 })
    rerender({ refreshKey: 7 })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(previewDivideBoreholes).toHaveBeenCalledTimes(1)
  })

  it('PH8 — a 404 about anything else is still an error the engineer is told about', async () => {
    // load_scoped_or_raise 404s with a plain "Litho model not found" when the
    // model reference is broken. Silencing that renders an empty geotech axis
    // that looks exactly like "these boreholes get no packing".
    previewDivideBoreholes.mockRejectedValue(
      new ApiError('Litho model not found', 404, { detail: 'Litho model not found' }),
    )
    const { result } = renderHook(() => useGeotechBoreholePreview(READY))
    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.columns).toHaveLength(0)
  })

  it('PH9 — retuning the planner refetches, because the plan changes with it', async () => {
    // plan() reads the geotech geo↔litho snap tolerance from project settings,
    // so a ghost drawn before the setting changed is stale.
    const { result, rerender } = renderHook(
      ({ snapToleranceM }: { snapToleranceM: number }) =>
        useGeotechBoreholePreview({ ...READY, snapToleranceM }),
      { initialProps: { snapToleranceM: 0.3 } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(previewDivideBoreholes).toHaveBeenCalledTimes(1)
    rerender({ snapToleranceM: 0.6 })
    await waitFor(() => expect(previewDivideBoreholes).toHaveBeenCalledTimes(2))
  })
})

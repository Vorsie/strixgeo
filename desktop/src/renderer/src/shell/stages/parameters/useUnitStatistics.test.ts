// Pins for the fetch half of the per-unit statistics (owner ballot 2026-08-26).
//
// The arithmetic is pinned in ``unitStatistics.test.ts``; what these cases
// protect is everything the hook decides ABOUT fetching — which is where the
// cost and the races live.
//
// UH1 — a hole already in the shared cache is never re-fetched.
// UH2 — only the MISSING holes are asked for, in ONE batch.
// UH3 — the request does not re-fire when the band list is reshuffled but
//       still names the same holes.
// UH4 — a failed fetch surfaces a message and can be retried.
// UH5 — holes the batch had no series for are reported, not silently dropped.
// UH6 — no unit scoped means no request at all.

import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const plotBatch = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { cpt: { plotBatch: (...args: unknown[]) => plotBatch(...args) } },
}))

import { useUnitStatistics } from './useUnitStatistics'
import type { CptPlotResponse, LithoLayerResponse } from '../../../api/client'

afterEach(() => {
  vi.clearAllMocks()
})

/** An accepted, CPT-anchored geotech band of ``unit-1``. */
function band(cptId: string, id: string): LithoLayerResponse {
  return {
    id,
    formation_id: 'unit-1',
    cpt_id: cptId,
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 5,
    status: 'accepted',
  } as unknown as LithoLayerResponse
}

function plot(cptId: string, qc: number[]): CptPlotResponse {
  return {
    cpt_id: cptId,
    depths_m: qc.map((_, i) => i + 1),
    qc_mpa: qc,
    fs_mpa: null,
    rf_pct: null,
  } as unknown as CptPlotResponse
}

describe('useUnitStatistics — what it fetches', () => {
  it('UH1 — a hole already in the shared cache is never re-fetched', async () => {
    const cache = new Map([['cpt-a', plot('cpt-a', [1, 2, 3])]])
    const { result } = renderHook(() =>
      useUnitStatistics('unit-1', [band('cpt-a', 'l1')], cache, 'proj-1'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).not.toHaveBeenCalled()
    // ...and the cached series still feeds the statistics.
    const qc = result.current.statistics.channels.find(c => c.channel === 'qc')
    expect(qc?.summary.n).toBe(3)
  })

  it('UH2 — only the missing holes are asked for, in one batch', async () => {
    const cache = new Map([['cpt-a', plot('cpt-a', [1, 2])]])
    plotBatch.mockResolvedValue([plot('cpt-b', [10, 20])])

    const { result } = renderHook(() =>
      useUnitStatistics(
        'unit-1',
        [band('cpt-a', 'l1'), band('cpt-b', 'l2')],
        cache,
        'proj-1',
      ),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).toHaveBeenCalledTimes(1)
    expect(plotBatch).toHaveBeenCalledWith(['cpt-b'], 'proj-1')
    // Cached + fetched are pooled together.
    const qc = result.current.statistics.channels.find(c => c.channel === 'qc')
    expect(qc?.samples).toEqual([1, 2, 10, 20])
  })

  it('UH3 — reshuffling the bands does not re-fire the request', async () => {
    plotBatch.mockResolvedValue([plot('cpt-a', [1]), plot('cpt-b', [2])])
    const cache = new Map<string, CptPlotResponse>()

    const { result, rerender } = renderHook(
      ({ bands }) => useUnitStatistics('unit-1', bands, cache, 'proj-1'),
      { initialProps: { bands: [band('cpt-a', 'l1'), band('cpt-b', 'l2')] } },
    )
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).toHaveBeenCalledTimes(1)

    // Same holes, different order and different band rows — a band edit does
    // this constantly, and re-requesting every series each time is the cost
    // the sorted+deduped key exists to avoid.
    rerender({ bands: [band('cpt-b', 'l9'), band('cpt-a', 'l8')] })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).toHaveBeenCalledTimes(1)
  })

  it('UH6 — no unit scoped means no request', async () => {
    const { result } = renderHook(() =>
      useUnitStatistics(null, [band('cpt-a', 'l1')], new Map(), 'proj-1'),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).not.toHaveBeenCalled()
    expect(result.current.statistics.bandCount).toBe(0)
  })

  it('UH7 — only CPTs on the sections are pooled; hidden and removed are excluded', async () => {
    // The owner's rule, verbatim: "Only cpt's on the sections should be in
    // the pooling so all hidden and removed should be excluded." cpt-b is not
    // in the member set — off every section, project-removed, or manifest-
    // gated all arrive here the same way — so its bands contribute NOTHING:
    // no fetch, no samples, no band count.
    const cache = new Map([['cpt-a', plot('cpt-a', [1, 2])]])
    const { result } = renderHook(() =>
      useUnitStatistics(
        'unit-1',
        [band('cpt-a', 'l1'), band('cpt-b', 'l2')],
        cache,
        'proj-1',
        new Set(['cpt-a']),
      ),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(plotBatch).not.toHaveBeenCalled()
    expect(result.current.statistics.bandCount).toBe(1)
    expect(result.current.statistics.cptCount).toBe(1)
    const qc = result.current.statistics.channels.find(c => c.channel === 'qc')
    expect(qc?.summary.n).toBe(2)
  })
})

describe('useUnitStatistics — when the answer is partial or absent', () => {
  it('UH4 — a failed fetch surfaces a message and can be retried', async () => {
    plotBatch.mockRejectedValueOnce(new Error('network down'))
    const { result } = renderHook(() =>
      useUnitStatistics('unit-1', [band('cpt-a', 'l1')], new Map(), 'proj-1'),
    )

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(result.current.error).toContain('network down')
    expect(result.current.loading).toBe(false)

    // Retry re-runs the same request — a dead end is not an error state.
    plotBatch.mockResolvedValueOnce([plot('cpt-a', [7, 8])])
    result.current.retry()
    await waitFor(() => expect(result.current.error).toBeNull())
    const qc = result.current.statistics.channels.find(c => c.channel === 'qc')
    expect(qc?.samples).toEqual([7, 8])
  })

  it('UH5 — holes the batch had no series for are reported, not hidden', async () => {
    // ``plot-batch`` drops unknown / series-less ids rather than failing, so a
    // partial answer is normal. The panel must be able to say the picture is
    // incomplete instead of presenting one hole as the whole unit.
    plotBatch.mockResolvedValue([plot('cpt-a', [1, 2])])

    const { result } = renderHook(() =>
      useUnitStatistics(
        'unit-1',
        [band('cpt-a', 'l1'), band('cpt-b', 'l2')],
        new Map(),
        'proj-1',
      ),
    )

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.pendingCptCount).toBe(1)
    expect(result.current.statistics.cptCount).toBe(2)
  })
})

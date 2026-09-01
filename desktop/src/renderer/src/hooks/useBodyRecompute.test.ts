/**
 * useBodyRecompute.test.ts — the debounced body-identity recompute scheduler
 * (slice 5). Behavior-shaped cases in the rule's vocabulary:
 *
 *   * a burst of mutations fires ONE recompute after the quiet period;
 *   * a user who never pauses still gets one within the max-latency cap;
 *   * a response overtaken by a newer schedule is DISCARDED, toast included;
 *   * a null assembly (nothing to send) never POSTs;
 *   * not-yet-loaded inputs never schedule;
 *   * background failures are console-only; the manual verb toasts them;
 *   * a 422 ``empty_recompute_payload`` is a bug signal — never a toast.
 */

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ApiError } from '../api/clients/shared'
import {
  BODY_RECOMPUTE_DEBOUNCE_MS,
  BODY_RECOMPUTE_MAX_LATENCY_MS,
  useBodyRecompute,
  type UseBodyRecomputeOptions,
} from './useBodyRecompute'
import type { RecomputeBodiesRequest } from '../utils/buildBodyRecomputePayload'
import { api } from '../api/client'

vi.mock('../api/client', () => ({
  api: { geology: { recomputeBodies: vi.fn() } },
}))

const recomputeBodies = vi.mocked(api.geology.recomputeBodies)

/** A minimal non-empty payload (content is irrelevant to the scheduler). */
const PAYLOAD: RecomputeBodiesRequest = {
  sections: [
    { start_x: 0, start_y: 0, end_x: 1, end_y: 0, columns: [], regions: [] },
  ],
  section_ids: ['s-1'],
  layer_groups: [[]],
}

const OK_RESULT = {
  facts_written: 1,
  facts_dropped_stale: 0,
  bodies_merged: 0,
  bodies_split: 0,
  renamed: [],
}

function makeOpts(over: Partial<UseBodyRecomputeOptions> = {}): UseBodyRecomputeOptions {
  return {
    projectId: 'p1',
    buildPayload: vi.fn().mockResolvedValue(PAYLOAD),
    dataLoaded: true,
    toast: vi.fn(),
    ...over,
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  recomputeBodies.mockReset()
  recomputeBodies.mockResolvedValue({ ...OK_RESULT })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useBodyRecompute — debounce + cap + single-flight', () => {
  it('a burst of schedules fires ONE recompute after the quiet period', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useBodyRecompute(opts))
    act(() => {
      result.current.scheduleRecompute('m1')
      result.current.scheduleRecompute('m1')
      result.current.scheduleRecompute('m1')
    })
    // Just short of the quiet period: nothing has fired.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS - 1)
    })
    expect(opts.buildPayload).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(opts.buildPayload).toHaveBeenCalledTimes(1)
    expect(recomputeBodies).toHaveBeenCalledTimes(1)
    expect(recomputeBodies).toHaveBeenCalledWith('p1', 'm1', PAYLOAD)
  })

  it('a user who never pauses still gets a recompute at the max-latency cap', async () => {
    const opts = makeOpts()
    const { result } = renderHook(() => useBodyRecompute(opts))
    // Schedule at t=0 and keep mutating every 2 s — the debounce is never quiet.
    act(() => result.current.scheduleRecompute('m1'))
    for (let t = 2_000; t < BODY_RECOMPUTE_MAX_LATENCY_MS; t += 2_000) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2_000)
      })
      act(() => result.current.scheduleRecompute('m1'))
    }
    // At the cap the recompute fires anyway (bounded staleness).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(1)
    // The fire also cleared the outstanding debounce — no second, immediate POST.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(1)
  })

  it('a response overtaken by a newer schedule is discarded, TOAST INCLUDED', async () => {
    const opts = makeOpts()
    // First POST hangs until we resolve it by hand.
    let resolveFirst: (v: typeof OK_RESULT) => void = () => {}
    recomputeBodies.mockImplementationOnce(
      () => new Promise(res => { resolveFirst = res }),
    )
    const { result } = renderHook(() => useBodyRecompute(opts))
    act(() => result.current.scheduleRecompute('m1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(1)
    // A newer schedule lands while the POST is in flight...
    act(() => result.current.scheduleRecompute('m1'))
    // ...then the stale response arrives, claiming visible changes.
    await act(async () => {
      resolveFirst({ ...OK_RESULT, bodies_merged: 2, bodies_split: 1 })
      await Promise.resolve()
    })
    expect(opts.toast).not.toHaveBeenCalled()
    // The newer schedule's own fire reports normally.
    recomputeBodies.mockResolvedValueOnce({ ...OK_RESULT, bodies_merged: 1, bodies_split: 0 })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(opts.toast).toHaveBeenCalledTimes(1)
    expect(opts.toast).toHaveBeenCalledWith('success', 'Bodies recomputed: 1 merged, 0 split')
  })

  it('names displaced bodies in the success toast', async () => {
    const opts = makeOpts()
    recomputeBodies.mockResolvedValueOnce({
      ...OK_RESULT,
      bodies_merged: 3,
      bodies_split: 0,
      renamed: ['a', 'b'],
    })
    const { result } = renderHook(() => useBodyRecompute(opts))
    await act(async () => {
      await result.current.recomputeNow('m1')
    })
    expect(opts.toast).toHaveBeenCalledWith(
      'success',
      'Bodies recomputed: 3 merged, 0 split, names displaced: 2',
    )
  })

  it('a manual press with zero changes still toasts "no changes"', async () => {
    // Owner ruling 2026-08-31: "yes always toast, when i click something, this
    // is annoying." A manual toolbar press is a click and must confirm it ran,
    // even when nothing moved — the click had no visible effect otherwise.
    const opts = makeOpts()
    // OK_RESULT carries zero merged / split / renamed — a genuine no-op recompute.
    const { result } = renderHook(() => useBodyRecompute(opts))
    await act(async () => {
      await result.current.recomputeNow('m1')
    })
    expect(opts.toast).toHaveBeenCalledTimes(1)
    expect(opts.toast).toHaveBeenCalledWith('success', 'Bodies recomputed: no changes')
  })

  it('a background recompute with zero changes stays silent', async () => {
    // The debounced background path keeps the alarm-fatigue rule: a recompute
    // that changed nothing raises no toast (only a click deserves confirmation).
    const opts = makeOpts()
    const { result } = renderHook(() => useBodyRecompute(opts))
    act(() => result.current.scheduleRecompute('m1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(recomputeBodies).toHaveBeenCalledTimes(1)
    expect(opts.toast).not.toHaveBeenCalled()
  })

  it('a null assembly never POSTs', async () => {
    const opts = makeOpts({ buildPayload: vi.fn().mockResolvedValue(null) })
    const { result } = renderHook(() => useBodyRecompute(opts))
    act(() => result.current.scheduleRecompute('m1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_MAX_LATENCY_MS)
    })
    expect(opts.buildPayload).toHaveBeenCalledTimes(1)
    expect(recomputeBodies).not.toHaveBeenCalled()
  })

  it('does nothing while the model inputs are not loaded yet', async () => {
    const opts = makeOpts({ dataLoaded: false })
    const { result } = renderHook(() => useBodyRecompute(opts))
    act(() => result.current.scheduleRecompute('m1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_MAX_LATENCY_MS * 2)
    })
    expect(opts.buildPayload).not.toHaveBeenCalled()
    expect(recomputeBodies).not.toHaveBeenCalled()
  })

  it('a background failure is console-only; the manual verb toasts it', async () => {
    const opts = makeOpts()
    recomputeBodies.mockRejectedValueOnce(new Error('boom'))
    const { result } = renderHook(() => useBodyRecompute(opts))
    // Background fire: no toast.
    act(() => result.current.scheduleRecompute('m1'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(BODY_RECOMPUTE_DEBOUNCE_MS)
    })
    expect(opts.toast).not.toHaveBeenCalled()
    // Manual fire: error toast.
    recomputeBodies.mockRejectedValueOnce(new Error('boom'))
    await act(async () => {
      await result.current.recomputeNow('m1')
    })
    expect(opts.toast).toHaveBeenCalledTimes(1)
    expect(opts.toast).toHaveBeenCalledWith('error', 'Recompute bodies failed — see console.')
  })

  it('a 422 empty_recompute_payload is a bug signal — never a toast, even manually', async () => {
    const opts = makeOpts()
    recomputeBodies.mockRejectedValueOnce(
      new ApiError('empty', 422, { detail: { code: 'empty_recompute_payload' } }),
    )
    const { result } = renderHook(() => useBodyRecompute(opts))
    await act(async () => {
      await result.current.recomputeNow('m1')
    })
    expect(opts.toast).not.toHaveBeenCalled()
  })
})

// Always on, in the background (owner 2026-10-19): fetch when the model opens,
// wait 2 s after a pick edit, poll while the engine computes, never block.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { PICK_CHECK_DEBOUNCE_MS, PICK_CHECK_POLL_MS, useContactConsistency } from './useContactConsistency'
import { api } from '../api/client'

vi.mock('../api/client', () => ({ api: { geology: { getContactConsistency: vi.fn() } } }))
vi.mock('../utils/log', () => ({ log: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() } }))

const mockGet = vi.mocked(api.geology.getContactConsistency)
const ready = { model_id: 'm1', status: 'ready' as const, formations: [] }
const computing = { model_id: 'm1', status: 'computing' as const, formations: [] }

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  mockGet.mockReset()
})

describe('useContactConsistency', () => {
  it('opening a model fetches at once', async () => {
    mockGet.mockResolvedValue(ready)
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(mockGet).toHaveBeenCalledTimes(1)
    expect(result.current.status).toBe('ready')
  })

  it('a pick edit waits 2 s before asking again', async () => {
    mockGet.mockResolvedValue(ready)
    const { rerender } = renderHook(({ s }) => useContactConsistency('p1', 'm1', s), { initialProps: { s: 0 } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ s: 1 })
    await act(async () => { await vi.advanceTimersByTimeAsync(PICK_CHECK_DEBOUNCE_MS - 1) })
    expect(mockGet).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(1) })
    expect(mockGet).toHaveBeenCalledTimes(2)
  })

  it('polls while the engine computes, then reports ready', async () => {
    mockGet.mockResolvedValueOnce(computing).mockResolvedValueOnce(ready)
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('computing')
    await act(async () => { await vi.advanceTimersByTimeAsync(PICK_CHECK_POLL_MS) })
    expect(mockGet).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ready')
  })

  it('a failed request is not a clean model', async () => {
    mockGet.mockRejectedValue(new Error('boom'))
    const { result } = renderHook(() => useContactConsistency('p1', 'm1', 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('failed')
  })

  it('no model, no request', async () => {
    const { result } = renderHook(() => useContactConsistency('p1', null, 0))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(mockGet).not.toHaveBeenCalled()
    expect(result.current.status).toBe('idle')
  })
})

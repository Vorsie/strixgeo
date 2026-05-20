// Tests for useClickDebounce — the single-vs-double-click gate.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useClickDebounce } from './useClickDebounce'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useClickDebounce', () => {
  it('fires the scheduled action after delayMs when nothing cancels it', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useClickDebounce(250))
    act(() => result.current.schedule(fn))
    expect(fn).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(fn).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('cancels the scheduled action when cancel() arrives before the window', () => {
    const fn = vi.fn()
    const { result } = renderHook(() => useClickDebounce(250))
    act(() => result.current.schedule(fn))
    act(() => result.current.cancel())
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('a second schedule() before the window resets the timer (only one fires)', () => {
    const first = vi.fn()
    const second = vi.fn()
    const { result } = renderHook(() => useClickDebounce(250))
    act(() => result.current.schedule(first))
    act(() => {
      vi.advanceTimersByTime(100)
    })
    act(() => result.current.schedule(second))
    act(() => {
      vi.advanceTimersByTime(249)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()
    act(() => {
      vi.advanceTimersByTime(1)
    })
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('cancel() is a no-op when nothing is queued', () => {
    const { result } = renderHook(() => useClickDebounce(250))
    expect(() => act(() => result.current.cancel())).not.toThrow()
  })

  it('clears the in-flight timer on unmount', () => {
    const fn = vi.fn()
    const { result, unmount } = renderHook(() => useClickDebounce(250))
    act(() => result.current.schedule(fn))
    unmount()
    act(() => {
      vi.advanceTimersByTime(500)
    })
    expect(fn).not.toHaveBeenCalled()
  })

  it('schedule and cancel are stable across renders (referential identity)', () => {
    const { result, rerender } = renderHook(() => useClickDebounce(250))
    const firstSchedule = result.current.schedule
    const firstCancel = result.current.cancel
    rerender()
    expect(result.current.schedule).toBe(firstSchedule)
    expect(result.current.cancel).toBe(firstCancel)
  })
})

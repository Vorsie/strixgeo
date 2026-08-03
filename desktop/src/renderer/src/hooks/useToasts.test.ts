// An error toast waits to be read; a success toast does not.
//
// Audit 2026-08-02: every toast auto-dismissed after 4 s regardless of
// severity, so an action-required message — "3 accepted packing ties could not
// be kept and have to be redrawn" — was off screen before an engineer looking
// at the section noticed it, with no in-app history to recover it from.
//
// The rule, in the rule's own words: a message that tells the engineer
// something has to be done stays on screen until they dismiss it. A message
// that only reports what happened goes away on its own.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { TOAST_TIMEOUT_MS, useToasts } from './useToasts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useToasts — errors do not scroll past unnoticed', () => {
  it('keeps an error on screen well past the auto-dismiss window', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('error', '3 accepted packing ties could not be kept')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 10)
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].sticky).toBe(true)
  })

  it('still expires a success', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Boreholes divided')
    })
    expect(result.current.toasts).toHaveLength(1)
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('still expires a warning', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('warning', '4 ties need checking')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('dismisses a sticky error on request, leaving the others alone', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('error', 'first')
      result.current.toast('error', 'second')
    })
    const firstId = result.current.toasts[0].id
    act(() => {
      result.current.dismissToast(firstId)
    })

    expect(result.current.toasts.map(t => t.message)).toEqual(['second'])
  })
})

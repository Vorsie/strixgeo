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

import { TOAST_LONG_TIMEOUT_MS, TOAST_TIMEOUT_MS, useToasts } from './useToasts'

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

// ---------------------------------------------------------------------------
// A recurring toast replaces itself instead of stacking
//
// Owner (dogfeed 2026-08-15):
//
//   > "when i repeatedly press l the toast just kind of stack on the right, if
//   > it is a recurring toast for example by pressing same hotkey multiple
//   > times, you can just immediately replace it and don't need to flood the
//   > screen"
//
//   TR1  the same recurring toast replaces the one already on screen
//   TR2  the replacement keeps the slot it had — it does not jump to the bottom
//   TR3  the replacement gets the full window again, not the leftovers
//   TR4  a recurring message that turns into an error waits to be read
//   TR5  ...and an error replaced by a report goes back to expiring
//   TR6  two different recurring messages never replace each other
//   TR7  a message with nothing recurring about it still stacks as before
// ---------------------------------------------------------------------------

describe('useToasts — a recurring toast replaces itself', () => {
  it('TR1: pressing the same key again replaces the toast instead of flooding', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
      result.current.toast('success', 'Litho fill off', 'litho-fill')
      result.current.toast('success', 'Litho fill on', 'litho-fill')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Litho fill on')
  })

  it('TR2: the replacement stays where it was — it does not jump to the bottom', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
      result.current.toast('error', 'Subdivide failed')
    })
    act(() => {
      result.current.toast('success', 'Litho fill off', 'litho-fill')
    })

    expect(result.current.toasts.map(t => t.message)).toEqual([
      'Litho fill off',
      'Subdivide failed',
    ])
  })

  it('TR3: the replacement gets the whole window again', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
    })
    // Almost expired, then replaced: the new message must not inherit the
    // remaining sliver of the old one's window.
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 100)
      result.current.toast('success', 'Litho fill off', 'litho-fill')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS - 100)
    })

    expect(result.current.toasts.map(t => t.message)).toEqual(['Litho fill off'])

    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('TR4: a recurring report that turns into an error waits to be read', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
      result.current.toast('error', 'Litho fill could not be read', 'litho-fill')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS * 10)
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Litho fill could not be read')
    expect(result.current.toasts[0].sticky).toBe(true)
  })

  it('TR5: an error replaced by a plain report goes back to expiring', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('error', 'Litho fill could not be read', 'litho-fill')
    })
    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS)
    })

    expect(result.current.toasts).toHaveLength(0)
  })

  it('TR6: two different recurring messages never replace each other', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Litho fill on', 'litho-fill')
      result.current.toast('success', 'Sample markers on', 'sample-markers')
      result.current.toast('success', 'Litho fill off', 'litho-fill')
    })

    expect(result.current.toasts.map(t => t.message)).toEqual([
      'Litho fill off',
      'Sample markers on',
    ])
  })

  it('TR7: a message with nothing recurring about it still stacks', () => {
    const { result } = renderHook(() => useToasts())

    act(() => {
      result.current.toast('success', 'Accepted 3 correlations')
      result.current.toast('success', 'Accepted 3 correlations')
    })

    expect(result.current.toasts).toHaveLength(2)
  })
})

// Owner finding 2026-10-04 ("import report disappears automatically, a bit
// too fast"): a summary of several outcomes takes longer to read than a
// one-fact toast, so its caller may ask for the long window. It still goes
// away on its own: it reports, it does not ask.
describe('useToasts: a long summary stays long enough to read', () => {
  it('a toast asked to stay longer is still on screen after the ordinary window', () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      result.current.toast('success', '2 imported', undefined, { durationMs: TOAST_LONG_TIMEOUT_MS })
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_TIMEOUT_MS + 100)
    })
    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].sticky).toBe(false)
  })

  it('and it still goes away on its own once its own window has passed', () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      result.current.toast('success', '2 imported', undefined, { durationMs: TOAST_LONG_TIMEOUT_MS })
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_LONG_TIMEOUT_MS)
    })
    expect(result.current.toasts).toHaveLength(0)
  })

  it('a longer window never makes an error expire', () => {
    const { result } = renderHook(() => useToasts())
    act(() => {
      result.current.toast('error', 'nothing imported', undefined, { durationMs: TOAST_LONG_TIMEOUT_MS })
    })
    act(() => {
      vi.advanceTimersByTime(TOAST_LONG_TIMEOUT_MS * 10)
    })
    expect(result.current.toasts).toHaveLength(1)
  })
})

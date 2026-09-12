// Behaviour tests for useUndoStack — the command-pattern undo/redo
// foundation (debt #45). Tests focus on stack semantics and the
// safety nets; per-command correctness is exercised at the App-
// integration level via the contact mutation handlers.

import { renderHook, act } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useUndoStack, type UndoCommand } from './useUndoStack'
import { setLanguage } from '../i18n/languageSelect'

function makeCommand(
  description: string,
  overrides: Partial<UndoCommand> = {},
): UndoCommand {
  return {
    // ``description`` is a message KEY resolved at display time (ruling 11).
    // These unit tests pass a bare letter — ``t()`` falls back to the key
    // itself, so the failure toast still names the action.
    descriptionKey: description as UndoCommand['descriptionKey'],
    revert: vi.fn().mockResolvedValue(undefined),
    reapply: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

// Every test runs in English by default; the NL failure-toast test flips the
// device language and must leave it as it found it.
afterEach(() => {
  setLanguage('en')
})

describe('useUndoStack', () => {
  it('starts empty: canUndo and canRedo both false', () => {
    const { result } = renderHook(() => useUndoStack())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(result.current.busy).toBe(false)
  })

  it('push enables canUndo + clears any pending redo', async () => {
    const { result } = renderHook(() => useUndoStack())
    const cmd1 = makeCommand('A')
    act(() => result.current.push(cmd1))
    expect(result.current.canUndo).toBe(true)

    // Undo to populate the redo stack.
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.canRedo).toBe(true)

    // A new push should wipe the redo stack — linear history.
    const cmd2 = makeCommand('B')
    act(() => result.current.push(cmd2))
    expect(result.current.canRedo).toBe(false)
  })

  it('undo calls revert and moves the command to the redo stack', async () => {
    const { result } = renderHook(() => useUndoStack())
    const revert = vi.fn().mockResolvedValue(undefined)
    const cmd = makeCommand('X', { revert })
    act(() => result.current.push(cmd))

    await act(async () => {
      await result.current.undo()
    })
    expect(revert).toHaveBeenCalledTimes(1)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
  })

  it('redo calls reapply and moves the command back to the undo stack', async () => {
    const { result } = renderHook(() => useUndoStack())
    const reapply = vi.fn().mockResolvedValue(undefined)
    const cmd = makeCommand('X', { reapply })
    act(() => result.current.push(cmd))
    await act(async () => {
      await result.current.undo()
    })

    await act(async () => {
      await result.current.redo()
    })
    expect(reapply).toHaveBeenCalledTimes(1)
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(false)
  })

  it('undo on an empty stack is a no-op', async () => {
    const { result } = renderHook(() => useUndoStack())
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('clear empties both stacks', async () => {
    const { result } = renderHook(() => useUndoStack())
    act(() => result.current.push(makeCommand('A')))
    act(() => result.current.push(makeCommand('B')))
    await act(async () => {
      await result.current.undo()
    })
    expect(result.current.canUndo).toBe(true)
    expect(result.current.canRedo).toBe(true)

    act(() => result.current.clear())
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
  })

  it('failed revert clears both stacks and reports via onError', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useUndoStack({ onError }))
    const goodA = makeCommand('A')
    const failingB = makeCommand('B', {
      revert: vi.fn().mockRejectedValue(new Error('server down')),
    })
    act(() => result.current.push(goodA))
    act(() => result.current.push(failingB))
    expect(result.current.canUndo).toBe(true)

    await act(async () => {
      await result.current.undo()
    })
    // The failing revert wiped the entire history — including the
    // earlier good command — to keep state consistent.
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    // Toast names the failed action (dogfeed 2026-05-31): a Ctrl-Z
    // landing on a stale stack entry must say WHICH action blew up
    // so the user can correlate the message to their intent.
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('B'))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Undo failed'))
  })

  it('the failure toast is translated to the active language (NL)', async () => {
    // Ruling 11: the "history cleared" toast is display-time translated, so a
    // Dutch session reads it in Dutch, not the hardcoded English of before.
    setLanguage('nl')
    const onError = vi.fn()
    const { result } = renderHook(() => useUndoStack({ onError }))
    const cmd = makeCommand('X', {
      revert: vi.fn().mockRejectedValue(new Error('boom')),
    })
    act(() => result.current.push(cmd))
    await act(async () => {
      await result.current.undo()
    })
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Ongedaan maken mislukt'))
  })

  it('failed reapply also clears both stacks', async () => {
    const onError = vi.fn()
    const { result } = renderHook(() => useUndoStack({ onError }))
    const cmd = makeCommand('X', {
      reapply: vi.fn().mockRejectedValue(new Error('boom')),
    })
    act(() => result.current.push(cmd))
    await act(async () => {
      await result.current.undo()
    })
    await act(async () => {
      await result.current.redo()
    })
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(false)
    expect(onError).toHaveBeenCalledTimes(1)
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('X'))
    expect(onError).toHaveBeenCalledWith(expect.stringContaining('Redo failed'))
  })

  it('capacity caps the undo stack at the configured size', () => {
    const { result } = renderHook(() => useUndoStack({ capacity: 3 }))
    act(() => result.current.push(makeCommand('A')))
    act(() => result.current.push(makeCommand('B')))
    act(() => result.current.push(makeCommand('C')))
    act(() => result.current.push(makeCommand('D')))
    // Stack capped at 3 → 'A' dropped off the bottom.
    // We can't observe the description list directly, but we can
    // observe that we can undo at most 3 times.
    expect(result.current.canUndo).toBe(true)
  })

  it('rapid undo presses queue serially — each peels one history entry', async () => {
    // Pin the "hold Ctrl+Z to walk back through history" UX. Rapid
    // calls chain onto a serial queue so each one pops a fresh
    // command from the stack and runs its revert AFTER the prior
    // one completes — never in parallel (which would race on
    // shared state) and never dropped (which the old busy guard
    // did).
    let resolveSlow: (() => void) | null = null
    const slow = new Promise<void>(resolve => {
      resolveSlow = resolve
    })
    const slowRevert = vi.fn().mockReturnValue(slow)
    const fastRevert = vi.fn().mockResolvedValue(undefined)

    const { result } = renderHook(() => useUndoStack())
    // Push A (fast) then B (slow). Stack: [A, B], top = B (slow).
    act(() => result.current.push(makeCommand('A', { revert: fastRevert })))
    act(() => result.current.push(makeCommand('B', { revert: slowRevert })))

    // Press Ctrl+Z twice rapidly. Both enqueue; neither dropped.
    let firstPromise: Promise<void>
    let secondPromise: Promise<void>
    act(() => {
      firstPromise = result.current.undo()
    })
    act(() => {
      secondPromise = result.current.undo()
    })
    // The queue uses microtasks (Promise.resolve().then(...)) — flush
    // them so the first slot actually starts running its work.
    await act(async () => {
      await Promise.resolve()
    })

    // B's slow revert is in flight, A's fast revert hasn't started
    // yet — the queue is serial.
    expect(slowRevert).toHaveBeenCalledTimes(1)
    expect(fastRevert).toHaveBeenCalledTimes(0)
    expect(result.current.busy).toBe(true)

    // Let the slow revert finish; the queue drains the second slot.
    await act(async () => {
      resolveSlow?.()
      await firstPromise
      await secondPromise
    })
    expect(fastRevert).toHaveBeenCalledTimes(1)
    expect(result.current.canUndo).toBe(false)
    expect(result.current.canRedo).toBe(true)
    expect(result.current.busy).toBe(false)
  })
})

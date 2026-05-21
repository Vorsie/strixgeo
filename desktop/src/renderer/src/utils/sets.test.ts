import { describe, expect, it, vi } from 'vitest'
import type { Dispatch, SetStateAction } from 'react'

import { addAllToSet } from './sets'

// Captures the React-style ``setter(prev => next)`` contract: the
// returned next-state is what React renders. We mock the setter as a
// vi.fn that runs the updater synchronously to inspect what it would
// commit. Returns the same Dispatch<SetStateAction<Set<T>>> shape
// React's useState exposes so addAllToSet's typed parameter accepts
// the mock at the call boundary.
function runSetter<T>(): {
  setter: Dispatch<SetStateAction<Set<T>>>
  result: () => Set<T>
} {
  let state = new Set<T>()
  const fn: Dispatch<SetStateAction<Set<T>>> = vi.fn(
    (action: SetStateAction<Set<T>>) => {
      state = typeof action === 'function' ? action(state) : action
    },
  )
  return {
    setter: fn,
    result: () => state,
  }
}

describe('addAllToSet', () => {
  it('adds new ids to a fresh set', () => {
    const harness = runSetter<string>()
    addAllToSet(harness.setter, ['a', 'b', 'c'])
    expect([...harness.result()].sort()).toEqual(['a', 'b', 'c'])
  })

  it('returns the previous set unchanged when every id is already present', () => {
    let snapshot = new Set(['x', 'y'])
    const setter: Dispatch<SetStateAction<Set<string>>> = vi.fn(
      (action: SetStateAction<Set<string>>) => {
        snapshot = typeof action === 'function' ? action(snapshot) : action
      },
    )
    const before = snapshot
    addAllToSet(setter, ['x', 'y'])
    // Same reference — React skips the re-render in this case.
    expect(snapshot).toBe(before)
  })

  it('only allocates a new set when something is genuinely added', () => {
    let snapshot = new Set(['x'])
    const before = snapshot
    const setter: Dispatch<SetStateAction<Set<string>>> = (action) => {
      snapshot = typeof action === 'function' ? action(snapshot) : action
    }
    addAllToSet(setter, ['x', 'y'])
    expect(snapshot).not.toBe(before)
    expect([...snapshot].sort()).toEqual(['x', 'y'])
  })

  it('handles an empty input iterable as a no-op', () => {
    let snapshot = new Set(['a'])
    const before = snapshot
    const setter: Dispatch<SetStateAction<Set<string>>> = (action) => {
      snapshot = typeof action === 'function' ? action(snapshot) : action
    }
    addAllToSet(setter, [])
    expect(snapshot).toBe(before)
  })
})

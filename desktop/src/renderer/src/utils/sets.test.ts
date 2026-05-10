import { describe, expect, it, vi } from 'vitest'

import { addAllToSet } from './sets'

// Captures the React-style ``setter(prev => next)`` contract: the
// returned next-state is what React renders. We mock the setter as a
// vi.fn that runs the updater synchronously to inspect what it would
// commit.
function runSetter<T>(setter: (updater: (prev: Set<T>) => Set<T>) => void): {
  setter: typeof setter
  result: () => Set<T>
  state: Set<T>
} {
  let state = new Set<T>()
  const fn = vi.fn((updater: (prev: Set<T>) => Set<T>) => {
    state = updater(state)
  }) as typeof setter
  return {
    setter: fn,
    state,
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
    const setter = vi.fn((updater: (prev: Set<string>) => Set<string>) => {
      snapshot = updater(snapshot)
    })
    const before = snapshot
    addAllToSet(setter, ['x', 'y'])
    // Same reference — React skips the re-render in this case.
    expect(snapshot).toBe(before)
  })

  it('only allocates a new set when something is genuinely added', () => {
    let snapshot = new Set(['x'])
    const before = snapshot
    const setter = (updater: (prev: Set<string>) => Set<string>) => {
      snapshot = updater(snapshot)
    }
    addAllToSet(setter, ['x', 'y'])
    expect(snapshot).not.toBe(before)
    expect([...snapshot].sort()).toEqual(['x', 'y'])
  })

  it('handles an empty input iterable as a no-op', () => {
    let snapshot = new Set(['a'])
    const before = snapshot
    const setter = (updater: (prev: Set<string>) => Set<string>) => {
      snapshot = updater(snapshot)
    }
    addAllToSet(setter, [])
    expect(snapshot).toBe(before)
  })
})

// The #279 body-menu arming gate (owner ruling 2026-08-31 "fix it now").
//
// The body menu must arm ONLY once the body roster is current for the active
// model. A recompute rewrites body_id stamps, so the roster in hand goes stale
// the instant the recompute nonce bumps — and stays stale (bodiesLoaded false,
// stats menu the deliberate answer) until the fresh roster is marked loaded.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { useRosterLoadedGate } from './useRosterLoadedGate'

describe('useRosterLoadedGate', () => {
  it('RG1 — starts NOT loaded', () => {
    const { result } = renderHook(() => useRosterLoadedGate('m1', 0))
    expect(result.current.bodiesLoaded).toBe(false)
  })

  it('RG2 — markLoaded(active model) → loaded', () => {
    const { result } = renderHook(() => useRosterLoadedGate('m1', 0))
    act(() => result.current.markLoaded('m1'))
    expect(result.current.bodiesLoaded).toBe(true)
  })

  it('RG3 — a recompute nonce bump resets to NOT loaded (the #279 window)', () => {
    let nonce = 0
    const { result, rerender } = renderHook(() => useRosterLoadedGate('m1', nonce))
    act(() => result.current.markLoaded('m1'))
    expect(result.current.bodiesLoaded).toBe(true)
    // The recompute fires: the nonce bumps, the roster is now stale.
    nonce = 1
    rerender()
    expect(result.current.bodiesLoaded).toBe(false)
    // …and only marking the fresh roster loaded re-arms the menu.
    act(() => result.current.markLoaded('m1'))
    expect(result.current.bodiesLoaded).toBe(true)
  })

  it('RG4 — a null active model is never loaded (non-litho axis)', () => {
    const { result } = renderHook(() => useRosterLoadedGate(null, 0))
    act(() => result.current.markLoaded('m1'))
    expect(result.current.bodiesLoaded).toBe(false)
  })

  it('RG5 — a roster loaded for a DIFFERENT model is stale', () => {
    let modelId: string | null = 'm1'
    const { result, rerender } = renderHook(() => useRosterLoadedGate(modelId, 0))
    act(() => result.current.markLoaded('m1'))
    expect(result.current.bodiesLoaded).toBe(true)
    // The active model switches before the new roster lands.
    modelId = 'm2'
    rerender()
    expect(result.current.bodiesLoaded).toBe(false)
  })
})

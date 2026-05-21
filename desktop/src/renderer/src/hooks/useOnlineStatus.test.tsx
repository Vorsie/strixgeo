// Unit tests for useOnlineStatus (debt #26).
//
// Pins three contracts the Geology3DViewer offline banner relies on:
//
//   T1 — initial value reads navigator.onLine
//   T2 — flips to false on the browser 'offline' event
//   T3 — flips back to true on the browser 'online' event

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { useOnlineStatus } from './useOnlineStatus'

describe('useOnlineStatus (debt #26)', () => {
  // navigator.onLine is read-only via Object.defineProperty trick; the
  // tests directly mutate it and fire the corresponding browser event.
  let originalOnLine: boolean

  beforeEach(() => {
    originalOnLine = navigator.onLine
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => originalOnLine,
    })
  })

  it('T1 — initial value reads navigator.onLine', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
  })

  it('T2 — flips to false when an offline event fires', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => true,
    })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(true)
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => false,
      })
      window.dispatchEvent(new Event('offline'))
    })
    expect(result.current).toBe(false)
  })

  it('T3 — flips back to true when an online event fires', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      get: () => false,
    })
    const { result } = renderHook(() => useOnlineStatus())
    expect(result.current).toBe(false)
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        get: () => true,
      })
      window.dispatchEvent(new Event('online'))
    })
    expect(result.current).toBe(true)
  })
})

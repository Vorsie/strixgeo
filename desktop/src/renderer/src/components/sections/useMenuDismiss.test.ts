// Unit tests for useMenuDismissOnZoomOrEsc (debt #151 / #275).
//
// The shared fixed-menu auto-dismiss: a position:fixed context menu detaches
// from the section content the moment the user zooms, so it must close on any
// wheel event or Escape while open. ContactsLayer's litho band menu, the
// unit-statistics portal menu and (from debt #275) GeotechBandEditOverlay's
// band menu all rely on this one hook — previously only e2e exercised the
// behaviour, so a regression in the shared mechanism had no unit guard.
//
// Pins the four contracts every consumer depends on:
//   T1 — a wheel event while open dismisses
//   T2 — Escape while open dismisses
//   T3 — a non-Escape key while open does NOT dismiss
//   T4 — inert while closed (no dismiss on wheel or Escape)
//   T5 — listeners are removed on unmount (no dismiss afterwards)

import { renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useMenuDismissOnZoomOrEsc } from './useMenuDismiss'

describe('useMenuDismissOnZoomOrEsc (debt #151 / #275)', () => {
  it('T1 — a wheel event while open dismisses', () => {
    const dismiss = vi.fn()
    renderHook(() => useMenuDismissOnZoomOrEsc(true, dismiss))
    document.dispatchEvent(new WheelEvent('wheel'))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('T2 — Escape while open dismisses', () => {
    const dismiss = vi.fn()
    renderHook(() => useMenuDismissOnZoomOrEsc(true, dismiss))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dismiss).toHaveBeenCalledTimes(1)
  })

  it('T3 — a non-Escape key while open does not dismiss', () => {
    const dismiss = vi.fn()
    renderHook(() => useMenuDismissOnZoomOrEsc(true, dismiss))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }))
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('T4 — inert while closed', () => {
    const dismiss = vi.fn()
    renderHook(() => useMenuDismissOnZoomOrEsc(false, dismiss))
    document.dispatchEvent(new WheelEvent('wheel'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dismiss).not.toHaveBeenCalled()
  })

  it('T5 — listeners are removed on unmount', () => {
    const dismiss = vi.fn()
    const { unmount } = renderHook(() => useMenuDismissOnZoomOrEsc(true, dismiss))
    unmount()
    document.dispatchEvent(new WheelEvent('wheel'))
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(dismiss).not.toHaveBeenCalled()
  })
})

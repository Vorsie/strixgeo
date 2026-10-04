// Owner 2026-10-04 (Data-stage dogfeed): "on the data stage make it so that
// i can turn off lithological boundaries and stratigraphic boundaries, now
// it is a mess". Two independent per-user switches, both ON by default,
// remembered across sessions (per-user UI chrome = localStorage, never the
// project bundle), and a broken storage must never break the chart.

import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CONTACT_OVERLAY_VISIBILITY_KEY,
  parseContactOverlayVisibility,
  useContactOverlayVisibility,
} from './useContactOverlayVisibility'

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useContactOverlayVisibility', () => {
  it('shows both stratigraphic and lithological boundaries by default', () => {
    const { result } = renderHook(() => useContactOverlayVisibility())
    expect(result.current.visibility).toEqual({ geology: true, litho: true })
  })

  it('turning lithological boundaries off leaves stratigraphic boundaries on', () => {
    const { result } = renderHook(() => useContactOverlayVisibility())
    act(() => result.current.toggle('litho'))
    expect(result.current.visibility).toEqual({ geology: true, litho: false })
  })

  it('the two switches are independent', () => {
    const { result } = renderHook(() => useContactOverlayVisibility())
    act(() => result.current.toggle('geology'))
    expect(result.current.visibility).toEqual({ geology: false, litho: true })
    act(() => result.current.toggle('litho'))
    expect(result.current.visibility).toEqual({ geology: false, litho: false })
    act(() => result.current.toggle('geology'))
    expect(result.current.visibility).toEqual({ geology: true, litho: false })
  })

  it('remembers the choice for the next session', () => {
    const first = renderHook(() => useContactOverlayVisibility())
    act(() => first.result.current.toggle('litho'))
    first.unmount()
    const second = renderHook(() => useContactOverlayVisibility())
    expect(second.result.current.visibility).toEqual({ geology: true, litho: false })
  })

  it('stores under a stable global key (not project-scoped)', () => {
    const { result } = renderHook(() => useContactOverlayVisibility())
    act(() => result.current.toggle('geology'))
    expect(CONTACT_OVERLAY_VISIBILITY_KEY).toBe('groundmodel.detail.contact_overlays')
    expect(JSON.parse(localStorage.getItem(CONTACT_OVERLAY_VISIBILITY_KEY)!)).toEqual({
      geology: false,
      litho: true,
    })
  })

  it('a storage that throws does not break the switches', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    const { result } = renderHook(() => useContactOverlayVisibility())
    expect(result.current.visibility).toEqual({ geology: true, litho: true })
    act(() => result.current.toggle('litho'))
    expect(result.current.visibility).toEqual({ geology: true, litho: false })
  })
})

describe('parseContactOverlayVisibility', () => {
  it('falls back to both on for corrupt storage', () => {
    for (const raw of [null, 42, 'litho', [], { geology: 'no' }]) {
      expect(parseContactOverlayVisibility(raw)).toEqual({ geology: true, litho: true })
    }
  })

  it('keeps a valid half and defaults the missing half to on', () => {
    expect(parseContactOverlayVisibility({ litho: false })).toEqual({
      geology: true,
      litho: false,
    })
  })
})

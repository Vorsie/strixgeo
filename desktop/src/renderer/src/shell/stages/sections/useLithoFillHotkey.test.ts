// Behaviour tests for the bare-L accelerator on the litho fill.
//
// Owner's words (dogfeed 2026-08-15): "a hide litho fill hotkey would be nice
// too, toggling quite often when doing step 1" — one key, on whichever axis the
// engineer is reading, flips the LITHO fill.
//
//   LK1  on the geotech axis L flips "Show litho fill", and says which way
//   LK2  on the litho axis L flips the fill that gates the litho fill there
//   LK3  on the geology axis L does nothing — there is no litho fill to hide
//   LK4  typing an l into a text field is text, not a shortcut
//   LK5  Ctrl / Cmd / Alt + L belong to the browser, not to us
//   LK6  leaving the section view takes the shortcut with it
//   LK8  hammering L leaves ONE toast that updates, not a column of them
//        (owner 2026-08-15: "when i repeatedly press l the toast just kind of
//        stack on the right ... you can just immediately replace it and don't
//        need to flood the screen")

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useLithoFillHotkey } from './useLithoFillHotkey'
import type { SectionModelAxis } from '../../../hooks/useSections'
import { getBandFillVisible, setBandFill } from '../../../utils/bandFillStore'
import { getLithoFillOnGeotech, toggleLithoFillOnGeotech } from '../../../utils/lithoFillOnGeotechStore'
import { useToasts } from '../../../hooks/useToasts'
import { LITHO_FILL_TOAST_KEY, lithoFillToastMessage } from './displayToggleToast'

afterEach(() => {
  // Both stores are module-global; leave them at their shipped defaults.
  setBandFill(false)
  if (getLithoFillOnGeotech()) toggleLithoFillOnGeotech()
  vi.restoreAllMocks()
})

/** Fire a keydown on document, optionally from inside a typing target. */
function pressKey(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
}

describe('useLithoFillHotkey', () => {
  it('LK1: on the geotech axis L flips the litho fill and says which way it went', () => {
    const onFlip = vi.fn()
    renderHook(() => useLithoFillHotkey('geotechnical', onFlip))

    expect(getLithoFillOnGeotech()).toBe(false)
    pressKey('l')
    expect(getLithoFillOnGeotech()).toBe(true)
    expect(onFlip).toHaveBeenCalledWith(true)

    // Shift-L is the same key to a user with caps on.
    pressKey('L')
    expect(getLithoFillOnGeotech()).toBe(false)
    expect(onFlip).toHaveBeenLastCalledWith(false)
  })

  it('LK2: on the litho axis L flips the band fill that gates the litho fill there', () => {
    const onFlip = vi.fn()
    renderHook(() => useLithoFillHotkey('lithostratigraphic', onFlip))

    expect(getBandFillVisible()).toBe(false)
    pressKey('l')
    expect(getBandFillVisible()).toBe(true)
    expect(onFlip).toHaveBeenCalledWith(true)
    // The geotech toggle is a different fill and must not have moved with it.
    expect(getLithoFillOnGeotech()).toBe(false)

    pressKey('l')
    expect(getBandFillVisible()).toBe(false)
    expect(onFlip).toHaveBeenLastCalledWith(false)
  })

  it('LK3: on the geology axis L does nothing — there is no litho fill there', () => {
    const onFlip = vi.fn()
    renderHook(() => useLithoFillHotkey('geological', onFlip))

    pressKey('l')

    expect(getBandFillVisible()).toBe(false)
    expect(getLithoFillOnGeotech()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('LK4: typing an l into a text field is text, not a shortcut', () => {
    const onFlip = vi.fn()
    renderHook(() => useLithoFillHotkey('geotechnical', onFlip))

    const input = document.createElement('input')
    document.body.appendChild(input)
    pressKey('l', {}, input)

    expect(getLithoFillOnGeotech()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
    input.remove()
  })

  it('LK5: Ctrl / Cmd / Alt + L are left alone', () => {
    const onFlip = vi.fn()
    renderHook(() => useLithoFillHotkey('geotechnical', onFlip))

    pressKey('l', { ctrlKey: true })
    pressKey('l', { metaKey: true })
    pressKey('l', { altKey: true })

    expect(getLithoFillOnGeotech()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('LK6: leaving the section view takes the shortcut with it', () => {
    const onFlip = vi.fn()
    const { unmount } = renderHook(() => useLithoFillHotkey('geotechnical', onFlip))
    unmount()

    pressKey('l')
    expect(getLithoFillOnGeotech()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('LK7: switching axis without remounting re-targets the same key', () => {
    // The listener binds once; the axis is read at press time. A caller that
    // re-renders on an axis change (the toolbar does) must not need a remount
    // for L to follow it.
    const onFlip = vi.fn()
    const { rerender } = renderHook<void, { axis: SectionModelAxis }>(
      ({ axis }) => useLithoFillHotkey(axis, onFlip),
      { initialProps: { axis: 'geotechnical' } },
    )

    pressKey('l')
    expect(getLithoFillOnGeotech()).toBe(true)

    rerender({ axis: 'lithostratigraphic' })
    pressKey('l')
    expect(getBandFillVisible()).toBe(true)
    // The geotech toggle stayed where the first press left it.
    expect(getLithoFillOnGeotech()).toBe(true)
  })

  it('LK8: hammering L leaves one toast that updates, not a screen of them', () => {
    // Announced the way the toolbar announces it, through the real toast
    // stack: five presses must leave one line saying where the fill ended.
    const { result } = renderHook(() => {
      const toasts = useToasts()
      useLithoFillHotkey('geotechnical', nowOn =>
        toasts.toast('success', lithoFillToastMessage('geotechnical', nowOn), LITHO_FILL_TOAST_KEY),
      )
      return toasts
    })

    act(() => {
      pressKey('l')
      pressKey('l')
      pressKey('l')
      pressKey('l')
      pressKey('l')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Litho fill on')
  })
})

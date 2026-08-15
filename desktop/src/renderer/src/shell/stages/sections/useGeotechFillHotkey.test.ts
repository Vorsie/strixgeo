// Behaviour tests for the bare-F accelerator on the packing (NAD) fill.
//
// Owner's words (dogfeed 2026-08-15), reading his own section: *"Turn the fill
// on (l this is for litho fill so this wouldn't work)"* — L flips the LITHO
// fill, and there was no key at all for the geotech axis's own NAD packing
// fill, which he flips just as often through Display → Show / Hide fill.
//
//   GK1  on the geotech axis F flips the packing fill, and says which way
//   GK2  on the litho axis F does nothing — the litho fill already has L
//   GK3  on the geology axis F does nothing either
//   GK4  typing an f into a text field is text, not a shortcut
//   GK5  Ctrl / Cmd / Alt + F belong to the browser (find), not to us
//   GK6  leaving the section view takes the shortcut with it
//   GK7  switching axis without remounting re-targets the same key
//   GK8  hammering F leaves ONE toast that updates, not a column of them
//   GK9  F never moves the litho fill and L never moves the packing fill —
//        two keys, two toggles, their own toast lines

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useGeotechFillHotkey } from './useGeotechFillHotkey'
import { useLithoFillHotkey } from './useLithoFillHotkey'
import type { SectionModelAxis } from '../../../hooks/useSections'
import { getBandFillVisible, setBandFill } from '../../../utils/bandFillStore'
import { getGeotechFillVisible, toggleGeotechFill } from '../../../utils/geotechFillStore'
import { getLithoFillOnGeotech, toggleLithoFillOnGeotech } from '../../../utils/lithoFillOnGeotechStore'
import { useToasts } from '../../../hooks/useToasts'
import {
  GEOTECH_FILL_TOAST_KEY,
  LITHO_FILL_TOAST_KEY,
  geotechFillToastMessage,
  lithoFillToastMessage,
} from './displayToggleToast'

afterEach(() => {
  // Every store here is module-global; leave them at their shipped defaults.
  setBandFill(false)
  if (getGeotechFillVisible()) toggleGeotechFill()
  if (getLithoFillOnGeotech()) toggleLithoFillOnGeotech()
  vi.restoreAllMocks()
})

/** Fire a keydown on document, optionally from inside a typing target. */
function pressKey(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
}

describe('useGeotechFillHotkey', () => {
  it('GK1: on the geotech axis F flips the packing fill and says which way it went', () => {
    const onFlip = vi.fn()
    renderHook(() => useGeotechFillHotkey('geotechnical', onFlip))

    expect(getGeotechFillVisible()).toBe(false)
    pressKey('f')
    expect(getGeotechFillVisible()).toBe(true)
    expect(onFlip).toHaveBeenCalledWith(true)

    // Shift-F is the same key to a user with caps on.
    pressKey('F')
    expect(getGeotechFillVisible()).toBe(false)
    expect(onFlip).toHaveBeenLastCalledWith(false)
  })

  it('GK2: on the litho axis F does nothing — that axis has L for its fill', () => {
    const onFlip = vi.fn()
    renderHook(() => useGeotechFillHotkey('lithostratigraphic', onFlip))

    pressKey('f')

    expect(getGeotechFillVisible()).toBe(false)
    expect(getBandFillVisible()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('GK3: on the geology axis F does nothing — there is no packing fill there', () => {
    const onFlip = vi.fn()
    renderHook(() => useGeotechFillHotkey('geological', onFlip))

    pressKey('f')

    expect(getGeotechFillVisible()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('GK4: typing an f into a text field is text, not a shortcut', () => {
    const onFlip = vi.fn()
    renderHook(() => useGeotechFillHotkey('geotechnical', onFlip))

    const input = document.createElement('input')
    document.body.appendChild(input)
    pressKey('f', {}, input)

    expect(getGeotechFillVisible()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
    input.remove()
  })

  it('GK5: Ctrl / Cmd / Alt + F are left alone', () => {
    const onFlip = vi.fn()
    renderHook(() => useGeotechFillHotkey('geotechnical', onFlip))

    pressKey('f', { ctrlKey: true })
    pressKey('f', { metaKey: true })
    pressKey('f', { altKey: true })

    expect(getGeotechFillVisible()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('GK6: leaving the section view takes the shortcut with it', () => {
    const onFlip = vi.fn()
    const { unmount } = renderHook(() => useGeotechFillHotkey('geotechnical', onFlip))
    unmount()

    pressKey('f')
    expect(getGeotechFillVisible()).toBe(false)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('GK7: switching axis without remounting re-targets the same key', () => {
    const onFlip = vi.fn()
    const { rerender } = renderHook<void, { axis: SectionModelAxis }>(
      ({ axis }) => useGeotechFillHotkey(axis, onFlip),
      { initialProps: { axis: 'geotechnical' } },
    )

    pressKey('f')
    expect(getGeotechFillVisible()).toBe(true)

    rerender({ axis: 'lithostratigraphic' })
    pressKey('f')
    // The press on the litho axis is a no-op: the toggle stayed where the
    // geotech press left it.
    expect(getGeotechFillVisible()).toBe(true)
  })

  it('GK8: hammering F leaves one toast that updates, not a screen of them', () => {
    const { result } = renderHook(() => {
      const toasts = useToasts()
      useGeotechFillHotkey('geotechnical', nowOn =>
        toasts.toast('success', geotechFillToastMessage(nowOn), GEOTECH_FILL_TOAST_KEY),
      )
      return toasts
    })

    act(() => {
      pressKey('f')
      pressKey('f')
      pressKey('f')
      pressKey('f')
      pressKey('f')
    })

    expect(result.current.toasts).toHaveLength(1)
    expect(result.current.toasts[0].message).toBe('Packing fill on')
  })

  it('GK9: F and L are two toggles with two toast lines, never one', () => {
    // Both bound at once, exactly as the toolbar binds them: each press writes
    // its OWN toast line under its own replace key, never folding into one.
    //
    // The two fills themselves are now exclusive — owner, dogfeed 2026-08-15:
    // "packing and litho fill can't be on at the same time, we should put a
    // safeguard when one is true the other turns false" — so the second press
    // below takes the first fill down. The toast lines still stand apart; that
    // is what this case is about.
    const { result } = renderHook(() => {
      const toasts = useToasts()
      useGeotechFillHotkey('geotechnical', nowOn =>
        toasts.toast('success', geotechFillToastMessage(nowOn), GEOTECH_FILL_TOAST_KEY),
      )
      useLithoFillHotkey('geotechnical', nowOn =>
        toasts.toast(
          'success',
          lithoFillToastMessage('geotechnical', nowOn),
          LITHO_FILL_TOAST_KEY,
        ),
      )
      return toasts
    })

    act(() => {
      pressKey('f')
    })
    expect(getGeotechFillVisible()).toBe(true)
    expect(getLithoFillOnGeotech()).toBe(false)

    act(() => {
      pressKey('l')
    })
    expect(getLithoFillOnGeotech()).toBe(true)
    expect(getGeotechFillVisible()).toBe(false)

    // Two announcements standing side by side, not one replacing the other.
    expect(result.current.toasts.map(t => t.message).sort()).toEqual([
      'Litho fill on',
      'Packing fill on',
    ])
  })
})

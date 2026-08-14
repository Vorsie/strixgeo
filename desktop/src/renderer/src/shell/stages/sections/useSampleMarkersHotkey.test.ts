// Behaviour tests for the bare-P accelerator on the sample markers.
//
// Owner's words (dogfeed 2026-08-14): "i asked for a hotkey to turn the
// markers of[f]" — bare P toggles the sample MARKERS; the grain-size preview
// keeps its menu toggle only.
//
//   PK1  pressing P flips the markers, and says which way it went
//   PK2  typing a p into a text field is text, not a shortcut
//   PK3  Ctrl+P still belongs to the browser's print, not to us
//   PK4  leaving the section view takes the shortcut with it

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useSampleMarkersHotkey } from './useSampleMarkersHotkey'
import { getSampleMarkersOn, setSampleMarkersOn } from '../../../utils/sampleMarkersOnStore'

afterEach(() => {
  // The store is module-global; leave it at its shipped default.
  setSampleMarkersOn(true)
  vi.restoreAllMocks()
})

/** Fire a keydown on document, optionally from inside a typing target. */
function pressKey(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
}

describe('useSampleMarkersHotkey', () => {
  it('PK1: pressing P flips the markers and says which way it went', () => {
    const onFlip = vi.fn()
    renderHook(() => useSampleMarkersHotkey(onFlip))

    expect(getSampleMarkersOn()).toBe(true)
    pressKey('p')
    expect(getSampleMarkersOn()).toBe(false)
    expect(onFlip).toHaveBeenCalledWith(false)

    // Shift-P is the same key to a user with caps on.
    pressKey('P')
    expect(getSampleMarkersOn()).toBe(true)
    expect(onFlip).toHaveBeenLastCalledWith(true)
  })

  it('PK2: typing a p into a text field is text, not a shortcut', () => {
    const onFlip = vi.fn()
    renderHook(() => useSampleMarkersHotkey(onFlip))

    const input = document.createElement('input')
    document.body.appendChild(input)
    pressKey('p', {}, input)

    expect(getSampleMarkersOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
    input.remove()
  })

  it('PK3: Ctrl+P is left alone', () => {
    const onFlip = vi.fn()
    renderHook(() => useSampleMarkersHotkey(onFlip))

    pressKey('p', { ctrlKey: true })
    pressKey('p', { metaKey: true })
    pressKey('p', { altKey: true })

    expect(getSampleMarkersOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('PK4: leaving the section view takes the shortcut with it', () => {
    const onFlip = vi.fn()
    const { unmount } = renderHook(() => useSampleMarkersHotkey(onFlip))
    unmount()

    pressKey('p')
    expect(getSampleMarkersOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
  })
})

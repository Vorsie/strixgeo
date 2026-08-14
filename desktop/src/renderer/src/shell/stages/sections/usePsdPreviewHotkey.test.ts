// Behaviour tests for the bare-P accelerator on the grain-size hover preview.
//
// Owner's words: 'Toggle "PSD preview on hover" (default ON) in the Display
// dropdown AND on the bare P key ... guard with the repo's isTypingTarget
// helper pattern; the hotkey shows a brief toast ... so the flip is visible.'
//
//   PK1  pressing P flips the preview, and says which way it went
//   PK2  typing a p into a text field is text, not a shortcut
//   PK3  Ctrl+P still belongs to the browser's print, not to us
//   PK4  leaving the section view takes the shortcut with it

import { renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { usePsdPreviewHotkey } from './usePsdPreviewHotkey'
import { getPsdPreviewOn, setPsdPreviewOn } from '../../../utils/psdPreviewOnStore'

afterEach(() => {
  // The store is module-global; leave it at its shipped default.
  setPsdPreviewOn(true)
  vi.restoreAllMocks()
})

/** Fire a keydown on document, optionally from inside a typing target. */
function pressKey(key: string, init: KeyboardEventInit = {}, target?: HTMLElement): void {
  const event = new KeyboardEvent('keydown', { key, bubbles: true, ...init })
  ;(target ?? document.body).dispatchEvent(event)
}

describe('usePsdPreviewHotkey', () => {
  it('PK1: pressing P flips the preview and says which way it went', () => {
    const onFlip = vi.fn()
    renderHook(() => usePsdPreviewHotkey(onFlip))

    expect(getPsdPreviewOn()).toBe(true)
    pressKey('p')
    expect(getPsdPreviewOn()).toBe(false)
    expect(onFlip).toHaveBeenCalledWith(false)

    // Shift-P is the same key to a user with caps on.
    pressKey('P')
    expect(getPsdPreviewOn()).toBe(true)
    expect(onFlip).toHaveBeenLastCalledWith(true)
  })

  it('PK2: typing a p into a text field is text, not a shortcut', () => {
    const onFlip = vi.fn()
    renderHook(() => usePsdPreviewHotkey(onFlip))

    const input = document.createElement('input')
    document.body.appendChild(input)
    pressKey('p', {}, input)

    expect(getPsdPreviewOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
    input.remove()
  })

  it('PK3: Ctrl+P is left alone', () => {
    const onFlip = vi.fn()
    renderHook(() => usePsdPreviewHotkey(onFlip))

    pressKey('p', { ctrlKey: true })
    pressKey('p', { metaKey: true })
    pressKey('p', { altKey: true })

    expect(getPsdPreviewOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
  })

  it('PK4: leaving the section view takes the shortcut with it', () => {
    const onFlip = vi.fn()
    const { unmount } = renderHook(() => usePsdPreviewHotkey(onFlip))
    unmount()

    pressKey('p')
    expect(getPsdPreviewOn()).toBe(true)
    expect(onFlip).not.toHaveBeenCalled()
  })
})

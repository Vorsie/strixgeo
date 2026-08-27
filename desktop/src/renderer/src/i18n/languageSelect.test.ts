// Tests for the device-local language store.
//
// LS1 — with nothing stored, the language is the default (EN), so a fresh
//        install never shows an unreviewed translation.
// LS2 — setLanguage persists, and getLanguage reads it back.
// LS3 — a stored value the app does not ship (hand-edited storage, a removed
//        locale) falls back to the default instead of rendering keys.
// LS4 — setLanguage refuses an unsupported value rather than storing it.
// LS5 — useLanguage re-renders its component when the language flips; this is
//        the property that makes the toggle apply "immediately, everywhere".
// LS6 — an unavailable localStorage degrades to the default, never throws.

import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LANGUAGE, LANGUAGE_STORAGE_KEY, type Language } from './i18n_constants'
import { getLanguage, setLanguage, useLanguage } from './languageSelect'

afterEach(() => {
  localStorage.clear()
  setLanguage(DEFAULT_LANGUAGE)
  vi.restoreAllMocks()
})

describe('languageSelect', () => {
  it('LS1 — defaults to English when nothing is stored', () => {
    localStorage.clear()
    expect(getLanguage()).toBe('en')
    expect(DEFAULT_LANGUAGE).toBe('en')
  })

  it('LS2 — setLanguage persists and getLanguage reads it back', () => {
    setLanguage('nl')
    expect(localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('nl')
    expect(getLanguage()).toBe('nl')
  })

  it('LS3 — an unknown stored value falls back to the default', () => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, 'fr')
    expect(getLanguage()).toBe(DEFAULT_LANGUAGE)
  })

  it('LS4 — setLanguage ignores an unsupported value and keeps the current one', () => {
    setLanguage('nl')
    // Past the type system on purpose: this is what a bad call site does.
    setLanguage('de' as Language)
    expect(getLanguage()).toBe('nl')
  })

  it('LS5 — useLanguage re-renders when the language flips', () => {
    const { result } = renderHook(() => useLanguage())
    expect(result.current).toBe('en')

    act(() => setLanguage('nl'))
    expect(result.current).toBe('nl')

    act(() => setLanguage('en'))
    expect(result.current).toBe('en')
  })

  it('LS6 — a throwing localStorage degrades to the default instead of crashing', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('privacy mode')
    })
    expect(getLanguage()).toBe(DEFAULT_LANGUAGE)
  })
})

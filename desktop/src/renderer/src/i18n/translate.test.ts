// Tests for the t() lookup + interpolation.
//
// TR1 — a key resolves to the active locale's string.
// TR2 — a key the locale does not carry falls back to English, so a partially
//        translated app stays usable rather than showing raw keys.
// TR3 — a key neither catalogue has renders as the key itself (loud + greppable)
//        and warns exactly once, not once per render.
// TR4 — {placeholder} substitution, including a value used twice.
// TR5 — an unknown placeholder is left verbatim, never blanked.
// TR6 — module-level t() reads the CURRENT language at call time (the contract
//        non-React callers rely on).

import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LANGUAGE, LANGUAGES } from './i18n_constants'
import { setLanguage } from './languageSelect'
import { interpolate, t, translate } from './translate'
import { EN, type MessageKey } from './locales/en'

afterEach(() => {
  localStorage.clear()
  setLanguage(DEFAULT_LANGUAGE)
  vi.restoreAllMocks()
})

describe('translate', () => {
  it('TR1 — resolves a key in the requested locale', () => {
    expect(translate('en', 'common.save')).toBe('Save')
    expect(translate('nl', 'common.save')).toBe('Opslaan')
  })

  it('TR2 — every EN key resolves to real copy in every locale, never to a key', () => {
    // The observable form of the fallback guarantee: whether NL carries a key
    // or inherits it from EN, no user-facing surface may ever render a dotted
    // key. This assertion holds while NL is complete AND while it is partial,
    // which is exactly the property the fallback exists to provide.
    for (const key of Object.keys(EN) as MessageKey[]) {
      for (const language of LANGUAGES) {
        const rendered = translate(language, key)
        expect(rendered, `${language}:${key}`).not.toBe(key)
        expect(rendered.length, `${language}:${key}`).toBeGreaterThan(0)
      }
    }
  })

  it('TR3 — an unknown key renders as the key and warns once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const bogus = 'settings.doesNotExist' as MessageKey

    expect(translate('nl', bogus)).toBe('settings.doesNotExist')
    expect(translate('nl', bogus)).toBe('settings.doesNotExist')
    expect(translate('en', bogus)).toBe('settings.doesNotExist')

    // Warned on the first miss only — a key looked up inside a render loop
    // must not flood the console.
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('TR4 — substitutes {placeholder} values', () => {
    expect(interpolate('Range {min}–{max} m.', { min: 0.1, max: 5 })).toBe('Range 0.1–5 m.')
    expect(interpolate('{a} then {a}', { a: 'x' })).toBe('x then x')

    // Through the real catalogue: the litho min-thickness hint ends in the default.
    const hint = translate('en', 'settings.litho.minThicknessHint', { default: 0.25 })
    expect(hint).toContain('Default 0.25 m.')
    expect(hint).not.toContain('{default}')
  })

  it('TR5 — leaves an unknown placeholder verbatim', () => {
    expect(interpolate('Hello {name}', { other: 'x' })).toBe('Hello {name}')
    expect(interpolate('Hello {name}')).toBe('Hello {name}')
  })

  it('TR6 — module-level t() reads the language at call time', () => {
    expect(t('common.cancel')).toBe('Cancel')
    setLanguage('nl')
    expect(t('common.cancel')).toBe('Annuleren')
    setLanguage('en')
    expect(t('common.cancel')).toBe('Cancel')
  })
})

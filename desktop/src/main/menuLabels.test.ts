// Pure — no Electron. The menu label table is data; these pins guard its
// completeness and the OS-locale narrowing that seeds the first paint.

import { describe, expect, it } from 'vitest'

import {
  MENU_LABELS,
  MENU_LANGUAGES,
  menuLabel,
  narrowMenuLanguage,
  type MenuLabelId,
} from './menuLabels'

describe('native menu labels', () => {
  it('every menu id has both languages', () => {
    for (const id of Object.keys(MENU_LABELS) as MenuLabelId[]) {
      for (const language of MENU_LANGUAGES) {
        const label = menuLabel(id, language)
        expect(label, `${id} / ${language}`).toBeTypeOf('string')
        expect(label.length, `${id} / ${language} is empty`).toBeGreaterThan(0)
      }
    }
  })

  it('a Dutch OS locale narrows the first-paint menu language to Dutch', () => {
    expect(narrowMenuLanguage('nl-BE')).toBe('nl')
    expect(narrowMenuLanguage('nl')).toBe('nl')
  })

  it('an unsupported or missing OS locale falls back to English', () => {
    expect(narrowMenuLanguage('fr-FR')).toBe('en')
    expect(narrowMenuLanguage('en-GB')).toBe('en')
    expect(narrowMenuLanguage('')).toBe('en')
    expect(narrowMenuLanguage(null)).toBe('en')
    expect(narrowMenuLanguage(undefined)).toBe('en')
  })
})

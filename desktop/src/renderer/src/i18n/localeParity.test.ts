// Structural gates on the message catalogues. These are the tests that keep a
// half-finished translation from shipping quietly.
//
// LP1 — no key is defined twice ACROSS modules. The composed catalogue is a
//        spread, so a duplicate is silently swallowed with the last module
//        winning — a bug with no symptom until a reviewer notices one surface's
//        wording appearing on another.
// LP2 — every NL key exists in EN. (``Partial<Messages>`` makes this a compile
//        error too; the runtime check catches a key added past a cast.)
// LP3 — placeholder NAMES match between EN and NL for every shared key. A
//        translation that drops ``{default}`` renders a hint with a missing
//        number; one that invents ``{standaard}`` renders a literal brace.
// LP4 — NL translates a key to something OTHER than the English string, except
//        for an explicit allow-list of terms that are identical by design
//        (product names, format names, symbols). Catches a key that was copied
//        into the NL file and never translated.
// LP5 — the two WIRED surfaces are fully translated, because they are the ones
//        a user can actually flip today.

import { describe, expect, it } from 'vitest'

import { EN, EN_MODULES, type MessageKey } from './locales/en'
import { NL, NL_MODULES } from './locales/nl'

/** Strings that are deliberately identical in EN and NL: product names, file
 *  formats, standards bodies, axis symbols, and abbreviations that BE/NL
 *  geotechnical practice leaves in English. Each entry is a decision, not an
 *  omission — adding one is how you record "this should not be translated". */
const INTENTIONALLY_IDENTICAL: ReadonlySet<MessageKey> = new Set([
  // Product + format names — never translated, in any locale.
  'app.name',
  'export.dxf',
  'export.dStability',
  'export.dSheetPiling',
  'export.title', // "Exports" is the plural used in BE Dutch too
  'sections.toolbar.export',
  // Loanwords that are the SAME word in Dutch.
  'spine.data',
  'spine.parameters',
  'spine.export',
  'params.title', // "Parameters & analyses" — both words are Dutch as-is
  'project.status',
  'project.statusOnHold', // "on hold" is idiomatic in BE professional Dutch
  'project.phaseMonitoring',
  'lab.atterberg', // eponym
  // Abbreviations shown on space-constrained chrome; expanding them in one
  // locale only would break the spine/track layout.
  'spine.lithology',
  'spine.geotechnical',
  'sections.header.formalStratigraphyShort',
  'sections.header.informalStratigraphyShort',
  'sections.header.geotechnicalCodingShort',
  // Already Dutch at source: DOV's own product name, and the DOV borehole
  // header field label. Translating either would disagree with the data.
  'sections.vb.title',
  'borelog.boring',
])

describe('locale catalogues', () => {
  it('LP1 — no key is defined in two modules (a spread would swallow one)', () => {
    for (const [locale, modules] of [
      ['en', EN_MODULES],
      ['nl', NL_MODULES],
    ] as const) {
      const owner = new Map<string, string>()
      const duplicates: string[] = []
      for (const [moduleName, table] of Object.entries(modules)) {
        for (const key of Object.keys(table)) {
          const previous = owner.get(key)
          if (previous !== undefined) {
            duplicates.push(`${locale}: "${key}" in both ${previous} and ${moduleName}`)
          } else {
            owner.set(key, moduleName)
          }
        }
      }
      expect(duplicates).toEqual([])
    }
  })

  it('LP2 — every NL key exists in EN', () => {
    const orphans = Object.keys(NL).filter(
      key => !Object.prototype.hasOwnProperty.call(EN, key),
    )
    expect(orphans).toEqual([])
  })

  it('LP3 — placeholder names match between EN and NL', () => {
    const mismatches: string[] = []
    for (const [key, nlValue] of Object.entries(NL)) {
      const enValue = EN[key as MessageKey]
      if (enValue === undefined || nlValue === undefined) continue
      const enSlots = [...enValue.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
      const nlSlots = [...nlValue.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort()
      if (enSlots.join(',') !== nlSlots.join(',')) {
        mismatches.push(`${key}: en{${enSlots}} vs nl{${nlSlots}}`)
      }
    }
    expect(mismatches).toEqual([])
  })

  it('LP4 — NL differs from EN except where identity is a recorded decision', () => {
    const untranslated: string[] = []
    for (const [key, nlValue] of Object.entries(NL)) {
      const typed = key as MessageKey
      if (INTENTIONALLY_IDENTICAL.has(typed)) continue
      if (nlValue === EN[typed]) untranslated.push(key)
    }
    expect(untranslated).toEqual([])
  })

  it('LP5 — the wired surfaces (settings, data) are fully translated', () => {
    const wired = [...Object.keys(EN_MODULES.settings), ...Object.keys(EN_MODULES.data)]
    const missing = wired.filter(key => !Object.prototype.hasOwnProperty.call(NL, key))
    expect(missing).toEqual([])
  })

  it('LP6 — reports NL coverage of the whole catalogue', () => {
    const total = Object.keys(EN).length
    const translated = Object.keys(NL).length
    // Not a threshold gate — a printed number so a reviewer sees the real
    // coverage instead of assuming "the locale file exists" means "done".
    // eslint-disable-next-line no-console
    console.info(`[i18n] NL coverage: ${translated}/${total} keys`)
    expect(translated).toBeGreaterThan(0)
    expect(translated).toBeLessThanOrEqual(total)
  })
})

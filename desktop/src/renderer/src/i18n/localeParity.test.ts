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
  // ⋯ More menu headings: "Model" and "Export" are the same words in BE Dutch.
  // The third heading, sections.moreGroup.section, becomes "Profiel" and is NOT
  // here. The Export heading matches the bar's own Export dropdown above it.
  'sections.moreGroup.model',
  'sections.moreGroup.export',
  // D-Series export rows carry the product + file-extension name verbatim.
  'sections.export.dstability',
  'sections.export.dsheetpiling',
  // Pure placeholder format strings (no translatable words) + the loanword
  // "contact", which is spelled the same in BE Dutch (its plural "contacten"
  // is NOT here — that one diverges).
  'litho.pillCounts',
  'litho.bodyCount',
  'litho.markers',
  'litho.contactWordOne',
  'geology.unitCount',
  // DOV code chip + its per-code tooltip line: only the "DOV" abbreviation,
  // a colon and interpolated slots, so they read identically in BE Dutch.
  'geology.dovCodes',
  'geology.dovCodeTip',
  // Loanwords that are the SAME word in Dutch.
  'spine.data',
  'spine.parameters',
  'spine.export',
  'params.title', // "Parameters & analyses" — both words are Dutch as-is
  'project.status',
  'project.statusOnHold', // "on hold" is idiomatic in BE professional Dutch
  'project.phaseMonitoring',
  'lab.atterberg', // eponym
  // "band" (singular) is the same word in BE Dutch as in English; only the
  // plural diverges ("bands" → "banden", geotech.bandsLabel, which is NOT here).
  'geotech.bandLabel',
  // "Snap" — the click-to-place snap toggle. BE geotech practice keeps the
  // English term, and the tutorial calls it the Snap-knop (owner ruling 5,
  // 2026-09-06). Recorded as intentionally identical to EN.
  'sections.header.snap',
  // Abbreviations shown on space-constrained chrome; expanding them in one
  // locale only would break the spine/track layout.
  'spine.lithology',
  'spine.geotechnical',
  'sections.header.formalStratigraphyShort',
  'sections.header.informalStratigraphyShort',
  'sections.header.geotechnicalCodingShort',
  // Axis-pill segment abbreviations — kept as-is in BE Dutch, like the
  // stratigraphy short forms above.
  'sections.axis.geoShort',
  'sections.axis.litho',
  'sections.axis.geotech',
  // Already Dutch at source: DOV's own product name, and the DOV borehole
  // header field label. Translating either would disagree with the data.
  'sections.vb.title',
  'borelog.boring',
  // Sheet: "Project" is the same word in BE Dutch; "m TAW" is the Belgian
  // height-datum axis symbol (Tweede Algemene Waterpassing), kept verbatim.
  'sheet.field.project',
  'sheet.mTaw',
  // Pure scale notation ("H 1:{hs} · V 1:{vs}") — only symbols and slots, so it
  // reads identically in BE Dutch.
  'sheet.scaleReadout',
  // "m TAW" — the Belgian height-datum symbol, kept verbatim in the bed-override
  // list rows just like ``sheet.mTaw``.
  'bedOverride.levelSuffix',

  // ---------------------------------------------------------------------------
  // 2026-09-02 renderer coverage pass. Each key below renders identically in
  // BE Dutch by design; grouped by why. A handful (buffer, whisker, box, curve)
  // are also owner-review candidates — the NL catalogue carries a `// FLAG alt:`
  // above them.
  // ---------------------------------------------------------------------------
  // Pure placeholder compositions — the only content is interpolated values
  // (themselves already-translated fragments), so there is no word to translate.
  'data.inspector.count', // "{n} {noun}"
  'litho.gridTooLargeNoRetry', // "{reason} {untouched}"
  'sections.header.lengthBuffer', // "{length} m · buffer ±{buffer} m"
  'sections.inspector.lengthEpsg', // "{length} m · EPSG:{epsg}"
  'params.idDotTooltip', // "{value} {unit} · {elevation} mTAW · {borehole}{sample}"
  // Loanwords / words BE Dutch keeps identical (+ a placeholder or unit).
  'geotech.nadClassParen', // "(NAD {nad})" — NAD is a BE standard abbreviation
  'sections.header.buffer', // "Buffer"
  'sections.vb.modelSlot', // "Model {label}"
  'params.zoneN', // "zone {n}"
  'params.bandCountOne', // "{n} band" — singular "band" like geotech.bandLabel
  'sections.bandEdit.bandWordOne', // "band"
  'params.diameterMm', // "Diameter (mm)"
  'lab.diameterAxis', // "Diameter (mm)"
  'export.heading', // "Export" — like export.title
  'params.markWhisker', // "whisker" — box-plot term kept in BE Dutch
  'params.markBox', // "box" — box-plot term kept in BE Dutch
  'params.curveCountOne', // "{n} curve" — PSD "curve" loanword
  'params.curveCountMany', // "{n} curves"
  // Compact statistic abbreviations (median→mediaan and mean→gemiddelde DO differ).
  'params.statMin', // "min"
  'params.statMax', // "max"
  'params.statSd', // "sd"
  // Axis / readout symbols kept as international notation.
  'sections.header.scaleH', // "H: {scale} px/m"
  'sections.header.scaleV', // "V: {scale} px/m"
  'sections.geotech.qcLabel', // "qc: {statistic}"
  'params.colIcBar', // "Ic̄ (Robertson 2015)"
  // Author-year method citations — proper names, identical in every locale.
  'params.methodRobertsonWride',
  'params.methodMayne',
  'params.methodKulhawyMayne',
  'params.methodUzielli',
  'params.methodRobertson2015',
])

describe('locale catalogues', () => {
  it('LP0 — startup support copy names the packaged Help command and project examples are neutral', () => {
    expect(EN['app.bootFailedBody']).toContain('Help → Save logs for support…')
    expect(NL['app.bootFailedBody']).toContain('Help → Logs opslaan voor support…')
    expect(EN['app.startingLong']).toBeTruthy()
    expect(NL['app.startingLong']).toBeTruthy()

    const projectExamples = [
      EN['project.namePlaceholder'],
      EN['project.namePlaceholderExample'],
      EN['tutorial.project-name.body'],
      NL['project.namePlaceholder'],
      NL['project.namePlaceholderExample'],
      NL['tutorial.project-name.body'],
    ]
    expect(projectExamples.join('\n')).not.toMatch(/GEO-22\/040|Brugge|Bruges/i)
  })

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

  // LP7/LP8 — the stratigraphy display rename (owner ruling, manual review
  // 2026-09-05): "rename geological to stratigraphical, lithostratigraphic to
  // lithological, keep geotechnical as is." This is a DISPLAY rename at the
  // presentation boundary ONLY — keys, DB `kind` values, routes and every code
  // identifier are unchanged. So these gates scan the VALUES a user reads, not
  // the keys. In the user's own words: the stage is "Stratigraphy" /
  // "Stratigrafie", "geological" reads "stratigraphic" / "stratigrafisch", and
  // "lithostratigraphic" reads "lithological" / "lithologisch". The single kept
  // exception is the DOV borehole-observation term "Hydrogeological
  // stratigraphy" — hydrogeology is its own domain word, not the renamed stage.
  it('LP7 — no user-facing value still reads "geological" or "lithostratigraphic"', () => {
    const offenders: string[] = []
    for (const [locale, table] of [
      ['en', EN],
      ['nl', NL],
    ] as const) {
      for (const [key, value] of Object.entries(table)) {
        // The hydrogeology domain term is a deliberate keep — strip it before
        // scanning so it does not masquerade as a leftover stage word.
        const scanned = value.replace(/hydrogeolog\w*/gi, '')
        if (/geolog/i.test(scanned) || /lithostrat/i.test(scanned)) {
          offenders.push(`${locale}: "${key}" = ${JSON.stringify(value)}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it('LP8 — the renamed stage labels read Stratigraphy / Lithological', () => {
    const en = EN as Record<string, string>
    const nl = NL as Record<string, string>
    // Stage label (spine rail + axis pill) and its Dutch sibling.
    expect(en['spine.geology']).toBe('Stratigraphy')
    expect(nl['spine.geology']).toBe('Stratigrafie')
    expect(en['sections.toolbar.geology']).toBe('Stratigraphy')
    expect(nl['sections.toolbar.geology']).toBe('Stratigrafie')
    // "lithostratigraphic model" → "lithological model".
    expect(en['litho.modelFull']).toBe('Lithological model')
    expect(nl['litho.modelFull']).toBe('Lithologisch model')
    // "geotechnical" is explicitly left untouched.
    expect(en['sections.axis.geotech']).toBe('Geotech')
    expect(nl['sections.axis.geotech']).toBe('Geotech')
  })
})

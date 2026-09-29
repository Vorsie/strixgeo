// The track editor offers DOV's own codelists (owner 2026-09-29: "coded
// lithology for example also" / "with the dov codelist ofc"). The picker lists
// the raw DOV tokens the domain stores; the translated meaning shows NEXT to the
// code; free text stays only for the lithological description.
import { describe, expect, it } from 'vitest'

import { SOIL_COLORS } from './soilColors'
import {
  allowedTokens,
  codelistOptions,
  colourTokenLabel,
  optionText,
} from './dovTrackCodelists'

describe('DOV codelists in the track editor', () => {
  it('offers every DOV hoofdnaam code as the main soil of a coded track', () => {
    const options = codelistOptions('coded_lithology', 'mainSoil', { language: 'en' })
    expect(options?.map(o => o.code).sort()).toEqual(Object.keys(SOIL_COLORS).sort())
    expect(options).toHaveLength(127)
  })

  it('shows the label next to the code, in the interface language', () => {
    const en = codelistOptions('coded_lithology', 'mainSoil', { language: 'en' })!
    const nl = codelistOptions('coded_lithology', 'mainSoil', { language: 'nl' })!
    expect(optionText(en.find(o => o.code === 'FZ')!)).toBe('FZ — fine sand')
    expect(optionText(nl.find(o => o.code === 'FZ')!)).toBe('FZ — fijn zand')
  })

  it('offers DOV admixture soils and the five DOV amount steps', () => {
    const soils = codelistOptions('coded_lithology', 'admixtureSoil', { language: 'en' })!
    expect(soils.map(o => o.code)).toEqual(expect.arrayContaining(['GL', 'KL', 'ZN', 'FZ']))
    const amounts = codelistOptions('coded_lithology', 'admixtureAmount', { language: 'en' })!
    expect(amounts.map(o => o.code)).toEqual(expect.arrayContaining(['', 'Z', 'W', 'M', 'V', 'S']))
  })

  it('offers the DOV moisture and consistency lists of the boring XSD', () => {
    const moisture = codelistOptions('moisture', 'value', { language: 'en' })!
    expect(moisture.map(o => o.code)).toEqual([
      'droog',
      'weinig vochtig',
      'vochtig',
      'zeer vochtig',
      'verzadigd',
    ])
    const consistency = codelistOptions('consistency', 'value', { language: 'en' })!
    expect(consistency.map(o => o.code)).toContain('korrelig')
    expect(optionText(consistency.find(o => o.code === 'matig vast')!)).toBe(
      'matig vast — moderately firm',
    )
  })

  it('offers all 294 DOV colour tokens and translates a compound colour', () => {
    const colours = codelistOptions('color', 'value', { language: 'en' })!
    expect(colours).toHaveLength(294)
    expect(colourTokenLabel('groenbruin', 'en')).toBe('green-brown')
    expect(colourTokenLabel('donkerolijfgroen', 'en')).toBe('dark olive green')
    expect(colourTokenLabel('bleek / ontkleurd', 'en')).toBe('pale / bleached')
    // In Dutch the stored word IS the label: no duplicate text next to the code.
    expect(optionText({ code: 'groenbruin', label: colourTokenLabel('groenbruin', 'nl') })).toBe(
      'groenbruin',
    )
  })

  it('keeps the lithological description free text', () => {
    expect(codelistOptions('lithological_description', 'description', { language: 'en' })).toBeNull()
    expect(allowedTokens('lithological_description', 'description', {})).toBeNull()
  })

  it('lists formal stratigraphy units from the DOV catalog once it has loaded', () => {
    const formalUnits = [
      { code: 'Bm', name_nl: 'Formatie van Boom', age_rank: null, color_hex: null },
      { code: 'Q', name_nl: 'Quartair', age_rank: null, color_hex: null },
    ]
    const options = codelistOptions('formal_stratigraphy', 'description', {
      language: 'en',
      formalUnits,
    })!
    expect(options.map(optionText)).toEqual(['Bm — Formatie van Boom', 'Q — Quartair'])
    // Before the catalog arrives the field cannot be checked: free text.
    expect(allowedTokens('formal_stratigraphy', 'description', {})).toBeNull()
  })

  it('accepts a token the imported track already carries, even outside the list', () => {
    const allowed = allowedTokens('coded_lithology', 'mainSoil', {
      original: [{ top_m: 0, base_m: 1, main_soil_codes: ['ZF'] }],
    })!
    expect(allowed.has('ZF')).toBe(true)
    expect(allowed.has('FZ')).toBe(true)
    expect(allowed.has('QQ')).toBe(false)
  })
})

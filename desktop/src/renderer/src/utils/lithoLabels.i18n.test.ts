/**
 * Language pins for lithoLabels.ts.
 *
 * ``lithoDisplayName`` follows the interface language; ``formatLithoDisplayName``
 * stays the ENGLISH, language-stable form the export path depends on (the fence
 * DXF layer name is a deliverable contract that must read identically whatever
 * the UI language). These pins hold that split.
 */

import { describe, expect, it } from 'vitest'

import {
  admixtureAmountOptions,
  admixtureSoilOptions,
  formatLithoDisplayName,
  lithoDisplayName,
} from './lithoLabels'

describe('lithoDisplayName — Dutch under nl, English-parity under en', () => {
  it('LD1 — base soil word is the Dutch source token under nl', () => {
    expect(lithoDisplayName('ZAND', [], 'nl')).toBe('ZAND')
    expect(lithoDisplayName('KLEI', [], 'nl')).toBe('KLEI')
    expect(lithoDisplayName('VEEN', [], 'nl')).toBe('VEEN')
    expect(lithoDisplayName('GRIND', [], 'nl')).toBe('GRIND')
  })

  it('LD2 — a core adjective admixture with an amount reads in Dutch', () => {
    expect(lithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }], 'nl')).toBe(
      'ZAND | matig kleiig',
    )
  })

  it('LD3 — the "locally" prefix becomes "plaatselijk"', () => {
    expect(lithoDisplayName('KLEI', [{ soil_code: 'ZN', amount: '', locally: true }], 'nl')).toBe(
      'KLEI | plaatselijk zandig',
    )
  })

  it('LD4 — a "with X" noun-phrase admixture drops the connective, takes a quantity word', () => {
    expect(lithoDisplayName('ZAND', [{ soil_code: 'SG', amount: 'W', locally: false }], 'nl')).toBe(
      'ZAND | weinig schelpgruis',
    )
  })

  it('LD5 — under en it is identical to formatLithoDisplayName', () => {
    const adm = [{ soil_code: 'KL', amount: 'M', locally: false }]
    expect(lithoDisplayName('ZAND', adm, 'en')).toBe(formatLithoDisplayName('ZAND', adm))
    expect(lithoDisplayName('KLEI', [], 'en')).toBe(formatLithoDisplayName('KLEI', []))
  })
})

describe('admixture dropdown options — Dutch labels, raw token tooltip (owner ruling 2026-09-06)', () => {
  // The composition dialog ("Samenstelling van het voorstel bewerken") showed
  // "Clay (KL)" and "Very (V)" in the Dutch UI. The options now translate at the
  // presentation boundary: raw DOV code stays the value, the label follows the
  // language (from the existing NL admixture tables), the raw token is the tooltip.
  const soilNl = admixtureSoilOptions('nl')
  const amountNl = admixtureAmountOptions('nl')
  const soilBy = (code: string) => soilNl.find(o => o.code === code)
  const amountBy = (code: string) => amountNl.find(o => o.code === code)

  it('AO1 — the core admixture soils read in Dutch, raw code in the label AND as the tooltip', () => {
    expect(soilBy('KL')).toEqual({ code: 'KL', label: 'Kleiig (KL)', title: 'KL' })
    expect(soilBy('ZN')).toEqual({ code: 'ZN', label: 'Zandig (ZN)', title: 'ZN' })
    expect(soilBy('SL')).toEqual({ code: 'SL', label: 'Siltig (SL)', title: 'SL' })
    expect(soilBy('GL')).toEqual({ code: 'GL', label: 'Grindig (GL)', title: 'GL' })
    expect(soilBy('VE')).toEqual({ code: 'VE', label: 'Venig (VE)', title: 'VE' })
  })

  it('AO2 — the amount scale reads in Dutch ("Very (V)" becomes "Veel (V)"), raw token tooltip', () => {
    expect(amountBy('V')).toEqual({ code: 'V', label: 'Veel (V)', title: 'V' })
    expect(amountBy('Z')).toEqual({ code: 'Z', label: 'Zwak (Z)', title: 'Z' })
    expect(amountBy('W')).toEqual({ code: 'W', label: 'Weinig (W)', title: 'W' })
    // The "unspecified" row carries no raw code, so no tooltip.
    expect(amountBy('')).toEqual({ code: '', label: 'Onbepaald', title: '' })
  })

  it('AO3 — no option keeps the English "Clay (KL)" / "Very (V)" the owner flagged', () => {
    expect(soilNl.some(o => o.label === 'Clay (KL)')).toBe(false)
    expect(amountNl.some(o => o.label === 'Very (V)')).toBe(false)
  })

  it('AO4 — under en the labels are byte-identical to the English option list', () => {
    expect(admixtureSoilOptions('en').find(o => o.code === 'KL')?.label).toBe('Clay (KL)')
    expect(admixtureAmountOptions('en').find(o => o.code === 'V')?.label).toBe('Very (V)')
  })
})

describe('formatLithoDisplayName stays English — the export contract', () => {
  it('LD6 — the export/canonical formatter never renders Dutch', () => {
    // The fence DXF layer name is built from this; it must not follow the UI.
    expect(formatLithoDisplayName('ZAND', [])).toBe('SAND')
    expect(formatLithoDisplayName('KLEI', [{ soil_code: 'ZN', amount: '', locally: true }])).toBe(
      'CLAY | locally sandy',
    )
  })
})

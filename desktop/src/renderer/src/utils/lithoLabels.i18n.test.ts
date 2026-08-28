/**
 * Language pins for lithoLabels.ts.
 *
 * ``lithoDisplayName`` follows the interface language; ``formatLithoDisplayName``
 * stays the ENGLISH, language-stable form the export path depends on (the fence
 * DXF layer name is a deliverable contract that must read identically whatever
 * the UI language). These pins hold that split.
 */

import { describe, expect, it } from 'vitest'

import { formatLithoDisplayName, lithoDisplayName } from './lithoLabels'

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

describe('formatLithoDisplayName stays English — the export contract', () => {
  it('LD6 — the export/canonical formatter never renders Dutch', () => {
    // The fence DXF layer name is built from this; it must not follow the UI.
    expect(formatLithoDisplayName('ZAND', [])).toBe('SAND')
    expect(formatLithoDisplayName('KLEI', [{ soil_code: 'ZN', amount: '', locally: true }])).toBe(
      'CLAY | locally sandy',
    )
  })
})

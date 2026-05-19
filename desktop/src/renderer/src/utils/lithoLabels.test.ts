// Unit tests for lithoLabels.ts — formatLithoDisplayName.
//
// Claims pinned here:
//   L1  No admixtures → just the Dutch base name.
//   L2  Single admixture with amount → "amount adj soilAdj MainName".
//   L3  Single admixture without amount → "soilAdj MainName".
//   L4  locally=true admixture → "lokaal" prefix on the qualifier.
//   L5  Multiple admixtures → comma-separated qualifiers before the base name.
//   L6  Unknown main code falls back to the raw code (passthrough).
//   L7  Unknown soil_code falls back to lowercased raw code.
//   L8  Unknown amount falls back to the raw amount string.
//   L9  Null / undefined admixtures → just the base name.

import { describe, expect, it } from 'vitest'
import { formatLithoDisplayName } from './lithoLabels'

describe('formatLithoDisplayName', () => {
  // L1: no admixtures
  it('L1 — no admixtures returns the Dutch base name', () => {
    expect(formatLithoDisplayName('ZAND', [])).toBe('Zand')
    expect(formatLithoDisplayName('KLEI', [])).toBe('Klei')
    expect(formatLithoDisplayName('SILT', [])).toBe('Silt')
    expect(formatLithoDisplayName('GRIND', [])).toBe('Grind')
    expect(formatLithoDisplayName('VEEN', [])).toBe('Veen')
  })

  // L2: single admixture with amount code
  it('L2 — single admixture with amount → "amount soilAdj MainName"', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }]),
    ).toBe('matig kleiige Zand')
  })

  // L3: single admixture without amount
  it('L3 — single admixture without amount → "soilAdj MainName"', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'SL', amount: '', locally: false }]),
    ).toBe('siltige Zand')
  })

  // L4: locally=true adds "lokaal " prefix
  it('L4 — locally=true admixture has "lokaal" prefix', () => {
    expect(
      formatLithoDisplayName('KLEI', [{ soil_code: 'ZN', amount: '', locally: true }]),
    ).toBe('lokaal zandige Klei')
  })

  // L5: multiple admixtures → comma-separated
  it('L5 — multiple admixtures are comma-separated before the base name', () => {
    expect(
      formatLithoDisplayName('KLEI', [
        { soil_code: 'SL', amount: 'W', locally: false },
        { soil_code: 'ZN', amount: '', locally: true },
      ]),
    ).toBe('weinig siltige, lokaal zandige Klei')
  })

  // L6: unknown main code falls back to raw
  it('L6 — unknown main code falls back to the raw code', () => {
    expect(formatLithoDisplayName('UNKNOWN', [])).toBe('UNKNOWN')
  })

  // L7: unknown soil_code falls back to lowercased raw
  it('L7 — unknown soil_code falls back to lowercased raw code', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'XX', amount: '', locally: false }]),
    ).toBe('xx Zand')
  })

  // L8: unknown amount falls back to raw amount string
  it('L8 — unknown amount falls back to the raw amount string', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'Q', locally: false }]),
    ).toBe('Q kleiige Zand')
  })

  // L9: null/undefined admixtures returns just the base name
  it('L9 — null admixtures returns just the base name', () => {
    expect(formatLithoDisplayName('ZAND', null)).toBe('Zand')
    expect(formatLithoDisplayName('ZAND', undefined)).toBe('Zand')
  })
})

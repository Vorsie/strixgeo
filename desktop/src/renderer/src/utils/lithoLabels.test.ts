// Unit tests for lithoLabels.ts — formatLithoDisplayName.
//
// Claims pinned here (pipe format, 2026-05-22):
//   L1  No admixtures → just the upper-cased base name.
//   L2  Single adjective admixture with amount → "BASE | adv adj".
//   L3  Single adjective admixture without amount → "BASE | adj".
//   L4  locally=true admixture → "locally" prefix on the field.
//   L5  Multiple admixtures → one pipe-separated field each.
//   L6  Unknown main code falls back to the raw code (upper-cased).
//   L7  Unknown soil_code falls back to lowercased raw code.
//   L8  Unknown amount falls back to the raw amount string.
//   L9  Null / undefined admixtures → just the base name.
//   L10 Noun-phrase admixture ("with X") with amount → quantity word,
//       no "with", no adverb (the 2026-05-22 dogfeed grammar bug).
//   L11 Noun-phrase admixture without amount → bare noun, no "with".

import { describe, expect, it } from 'vitest'
import { formatLithoDisplayName } from './lithoLabels'

describe('formatLithoDisplayName', () => {
  // L1: no admixtures
  it('L1 — no admixtures returns the upper-cased base name', () => {
    expect(formatLithoDisplayName('ZAND', [])).toBe('SAND')
    expect(formatLithoDisplayName('KLEI', [])).toBe('CLAY')
    expect(formatLithoDisplayName('SILT', [])).toBe('SILT')
    expect(formatLithoDisplayName('GRIND', [])).toBe('GRAVEL')
    expect(formatLithoDisplayName('VEEN', [])).toBe('PEAT')
  })

  // L2: single adjective admixture with amount code
  it('L2 — single adjective admixture with amount → "BASE | adv adj"', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'M', locally: false }]),
    ).toBe('SAND | moderately clayey')
  })

  // L3: single adjective admixture without amount
  it('L3 — single adjective admixture without amount → "BASE | adj"', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'SL', amount: '', locally: false }]),
    ).toBe('SAND | silty')
  })

  // L4: locally=true adds "locally " prefix
  it('L4 — locally=true admixture has "locally" prefix', () => {
    expect(
      formatLithoDisplayName('KLEI', [{ soil_code: 'ZN', amount: '', locally: true }]),
    ).toBe('CLAY | locally sandy')
  })

  // L5: multiple admixtures → one pipe-separated field each
  it('L5 — multiple admixtures are pipe-separated fields', () => {
    expect(
      formatLithoDisplayName('KLEI', [
        { soil_code: 'SL', amount: 'W', locally: false },
        { soil_code: 'ZN', amount: '', locally: true },
      ]),
    ).toBe('CLAY | slightly silty | locally sandy')
  })

  // L6: unknown main code falls back to raw (upper-cased)
  it('L6 — unknown main code falls back to the raw code', () => {
    expect(formatLithoDisplayName('unknown', [])).toBe('UNKNOWN')
  })

  // L7: unknown soil_code falls back to lowercased raw.
  // 'QQ' is a truly-unknown code (XX is curated as 'unknown').
  it('L7 — unknown soil_code falls back to lowercased raw code', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'QQ', amount: '', locally: false }]),
    ).toBe('SAND | qq')
  })

  // L8: unknown amount falls back to raw amount string
  it('L8 — unknown amount falls back to the raw amount string', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'KL', amount: 'Q', locally: false }]),
    ).toBe('SAND | Q clayey')
  })

  // L9: null/undefined admixtures returns just the base name
  it('L9 — null admixtures returns just the base name', () => {
    expect(formatLithoDisplayName('ZAND', null)).toBe('SAND')
    expect(formatLithoDisplayName('ZAND', undefined)).toBe('SAND')
  })

  // L10: noun-phrase admixture with amount — quantity word, no "with",
  // no adverb. The pre-2026-05-22 prose form produced the broken
  // "slightly with shell debris" here.
  it('L10 — noun-phrase admixture with amount uses a quantity word', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'SG', amount: 'W', locally: false }]),
    ).toBe('SAND | little shell debris')
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'SG', amount: 'V', locally: false }]),
    ).toBe('SAND | much shell debris')
  })

  // L11: noun-phrase admixture without amount — bare noun, no "with"
  it('L11 — noun-phrase admixture without amount drops the "with"', () => {
    expect(
      formatLithoDisplayName('ZAND', [{ soil_code: 'SG', amount: '', locally: false }]),
    ).toBe('SAND | shell debris')
  })
})

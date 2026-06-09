import { describe, expect, it } from 'vitest'
import { readSectionDefaults, buildSectionDefaultsPatch, SECTION_DEFAULTS } from './sectionDefaults'

describe('tieStrikeToleranceM pref', () => {
  it('falls back to the default when absent', () => {
    expect(readSectionDefaults(null).tieStrikeToleranceM).toBe(SECTION_DEFAULTS.tieStrikeToleranceM)
  })
  it('reads a valid stored value', () => {
    const vs = { section_defaults: { tie_strike_tolerance_m: 30 } }
    expect(readSectionDefaults(vs).tieStrikeToleranceM).toBe(30)
  })
  it('rejects out-of-bounds values, falling back to default', () => {
    const vs = { section_defaults: { tie_strike_tolerance_m: 99999 } }
    expect(readSectionDefaults(vs).tieStrikeToleranceM).toBe(SECTION_DEFAULTS.tieStrikeToleranceM)
  })
  it('round-trips through the patch builder', () => {
    const patch = buildSectionDefaultsPatch({ ...SECTION_DEFAULTS, tieStrikeToleranceM: 25 })
    expect((patch.section_defaults as Record<string, unknown>).tie_strike_tolerance_m).toBe(25)
  })
})

/**
 * Reviewer finding F4, 2026-08-22 code hunt: the vertical "two statements
 * meet" seam was drawn whenever ANY construct in the gap emitted 'onlap' —
 * even a LONE onlap whose tie's far side is empty, with nothing on the
 * facing test to meet it. This contradicted the code's own comment: *"where
 * only one side has an open mass there is nobody to meet, so no seam is
 * drawn and it fills through"* — a rule that was already correctly applied
 * to the 'nothing' (open) case but not to 'onlap'.
 */
import { describe, expect, it } from 'vitest'

import { seamMeets } from './constructs'
import type { BandConstruct, RunBand } from './constructs'

const dummyBand = (ci: number): RunBand => ({
  layerId: `l${ci}`,
  formationId: `f${ci}`,
  bodyId: null,
  top: 10,
  base: 0,
  ci,
  x: ci * 100,
})

const construct = (emit: BandConstruct['emit'], ci: number): BandConstruct => ({
  band: dummyBand(ci),
  emit,
  topAt: () => 10,
  baseAt: () => 0,
  topTied: false,
  baseTied: false,
  farX: ci === 0 ? 100 : 0,
})

describe('seamMeets — the vertical seam is drawn only where two statements meet', () => {
  it('SM1 — a LONE onlap on one side, nothing on the other, does not meet', () => {
    expect(seamMeets([construct('onlap', 0), construct('lens', 1)], 0, 1)).toBe(false)
  })

  it('SM2 — two onlaps reaching from opposite tests DO meet', () => {
    expect(seamMeets([construct('onlap', 0), construct('onlap', 1)], 0, 1)).toBe(true)
  })

  it('SM3 — two open (nothing) masses spanning into each other DO meet', () => {
    expect(seamMeets([construct('nothing', 0), construct('nothing', 1)], 0, 1)).toBe(true)
  })

  it('SM4 — a lone open mass on one side, nothing on the other, does not meet', () => {
    expect(seamMeets([construct('nothing', 0), construct('lens', 1)], 0, 1)).toBe(false)
  })

  it('SM5 — an onlap on one side and an open mass on the other does not meet (undocumented mixed case, stays inert)', () => {
    expect(seamMeets([construct('onlap', 0), construct('nothing', 1)], 0, 1)).toBe(false)
  })

  it('SM6 — two lenses, nothing to meet at all', () => {
    expect(seamMeets([construct('lens', 0), construct('lens', 1)], 0, 1)).toBe(false)
  })
})

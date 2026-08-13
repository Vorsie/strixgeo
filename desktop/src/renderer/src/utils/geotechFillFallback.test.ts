/**
 * Behaviour net for the geotech axis's LITHO-COLOUR FALLBACK rule.
 *
 * Owner ruling 2026-08-13: the geotech axis renders the DIRECT geotech
 * partition ("we don't need to invent the fill bands engine, it is built for
 * the litho stage — we only have more classes"), and litho geometry stays
 * visually authoritative on top of it. Where the geotech model has NO bands for
 * a litho region, that region must still be painted — in its LITHOLOGY colour —
 * so an un-subdivided interval reads as un-subdivided ground rather than as a
 * hole in the section.
 *
 * Pinned claims:
 *   FB1  Both flanking columns carry packing of the region's own soil → NOT
 *        fallback (the geotech partition already paints there).
 *   FB2  Only ONE flanking column carries packing → still NOT fallback.
 *   FB3  Neither flanking column carries packing at those elevations →
 *        fallback.
 *   FB4  A packing band of a DIFFERENT soil is not coverage — a sand band can
 *        never stand in for a clay region.
 *   FB5  A packing band outside the region's elevation envelope is not
 *        coverage.
 *   FB6  A region whose lithology carries no soil code accepts any packing
 *        soil (mirrors the refinement engine's ``soil == null`` guard).
 */

import { describe, expect, it } from 'vitest'

import {
  selectLithoFallbackRegions,
  type FallbackPackingBand,
  type FallbackCandidateRegion,
} from './geotechFillFallback'

/** Two columns: gap 0 is flanked by LEFT and RIGHT. */
const COLUMN_ORDER = ['LEFT', 'RIGHT']

/** Litho formation ids used across the cases. */
const CLAY_FORMATION = 'litho-clay'
const SAND_FORMATION = 'litho-sand'
const UNKNOWN_FORMATION = 'litho-unknown'

const LITHO_SOIL = new Map<string, string | null>([
  [CLAY_FORMATION, 'KLEI'],
  [SAND_FORMATION, 'ZAND'],
  [UNKNOWN_FORMATION, null],
])

/** A region spanning elevations 5 → 0 in gap 0, of the given lithology. */
function region(formationId: string, topElev = 5, baseElev = 0): FallbackCandidateRegion {
  return {
    gapIndex: 0,
    formationId,
    polygon: [{ elevation: topElev }, { elevation: topElev }, { elevation: baseElev }],
  }
}

/** A packing band of one soil over an elevation interval. */
function band(soilCode: string | null, topElevM: number, baseElevM: number): FallbackPackingBand {
  return { soilCode, topElevM, baseElevM }
}

describe('selectLithoFallbackRegions', () => {
  it('FB1 — a region packed on BOTH sides is not fallback', () => {
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('KLEI', 5, 0)]],
      ['RIGHT', [band('KLEI', 5, 0)]],
    ])
    expect(selectLithoFallbackRegions([region(CLAY_FORMATION)], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual(
      [],
    )
  })

  it('FB2 — one packed side is enough; the region is not fallback', () => {
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('KLEI', 5, 0)]],
      ['RIGHT', []],
    ])
    expect(selectLithoFallbackRegions([region(CLAY_FORMATION)], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual(
      [],
    )
  })

  it('FB3 — a region with no packing on either side IS fallback', () => {
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', []],
      ['RIGHT', []],
    ])
    const target = region(CLAY_FORMATION)
    expect(selectLithoFallbackRegions([target], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual([target])
  })

  it('FB4 — packing of a FOREIGN soil is not coverage', () => {
    // A sand packing band sitting at the clay region's elevations says nothing
    // about that clay: the refinement engine's soil guard refuses it, and so
    // must this. Without the guard a clay region beside a sand column would
    // silently lose its lithology colour.
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('ZAND', 5, 0)]],
      ['RIGHT', [band('ZAND', 5, 0)]],
    ])
    const target = region(CLAY_FORMATION)
    expect(selectLithoFallbackRegions([target], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual([target])
  })

  it('FB5 — packing outside the region envelope is not coverage', () => {
    // The bands sit well BELOW the region (elevations -10 → -20); the region
    // spans 5 → 0 and is therefore unpacked ground.
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('KLEI', -10, -20)]],
      ['RIGHT', [band('KLEI', -10, -20)]],
    ])
    const target = region(CLAY_FORMATION)
    expect(selectLithoFallbackRegions([target], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual([target])
  })

  it('FB6 — a lithology with no soil code accepts any packing soil', () => {
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('ZAND', 5, 0)]],
      ['RIGHT', []],
    ])
    expect(
      selectLithoFallbackRegions([region(UNKNOWN_FORMATION)], COLUMN_ORDER, bands, LITHO_SOIL),
    ).toEqual([])
  })

  it('— a gap whose flanking column is missing from the order falls back', () => {
    // Defensive: a region pointing past the end of the column order has no
    // column to consult, so nothing can claim it is packed.
    const bands = new Map<string, readonly FallbackPackingBand[]>([['LEFT', [band('KLEI', 5, 0)]]])
    const target = { ...region(CLAY_FORMATION), gapIndex: 7 }
    expect(selectLithoFallbackRegions([target], COLUMN_ORDER, bands, LITHO_SOIL)).toEqual([target])
  })

  it('— returns the caller’s own region objects, order preserved', () => {
    const bands = new Map<string, readonly FallbackPackingBand[]>([
      ['LEFT', [band('ZAND', 5, 0)]],
      ['RIGHT', [band('ZAND', 5, 0)]],
    ])
    const clay = region(CLAY_FORMATION)
    const sand = region(SAND_FORMATION)
    const alsoClay = region(CLAY_FORMATION, 2, 1)
    const out = selectLithoFallbackRegions([clay, sand, alsoClay], COLUMN_ORDER, bands, LITHO_SOIL)
    expect(out).toHaveLength(2)
    expect(out[0]).toBe(clay)
    expect(out[1]).toBe(alsoClay)
  })
})

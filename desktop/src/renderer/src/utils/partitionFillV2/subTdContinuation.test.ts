/**
 * A CLOSURE EXISTS TO MEET THE FACING TEST — WHERE THERE IS NOTHING TO MEET, THE UNIT CONTINUES.
 *
 * Owner, 2026-08-21, on S7's thin interbeds rendered as phantom pinches around the short
 * S7A: *"it should be a continuous band starting from S7 but now it is interrupted at
 * S7A's column by a SF clay render."*
 *
 * The scene, reduced to its bones and kept at CS1's real S7A|S7 spacing and elevations: a
 * SHORT test whose log stops at +10.42, and a DEEP test beside it carrying interbeds far
 * below that floor. The short test never read that ground, so its column states nothing
 * there — and a pinch drawn into it is a statement about a reading that does not exist.
 * The unit continues to that column at full thickness instead.
 *
 * The near-miss control is the same scene with the facing log carried all the way down:
 * that test DID read the ground, so the interbed still pinches against it.
 */
import { describe, expect, it } from 'vitest'

import { computeSectionFillV2 } from './computeSectionFillV2'
import { setTwoSidedTerminations } from './tileFlags'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../sectionPartition'

/** Nonzero-winding point-in-polygon (fraction × elevation) — the SVG fill rule. */
function inPolygon(
  px: number,
  py: number,
  poly: readonly { fraction: number; elevation: number }[],
): boolean {
  let wn = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if (a.elevation <= py) {
      if (
        b.elevation > py &&
        (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) > 0
      )
        wn++
    } else if (
      b.elevation <= py &&
      (b.fraction - a.fraction) * (py - a.elevation) - (px - a.fraction) * (b.elevation - a.elevation) < 0
    )
      wn--
  }
  return wn !== 0
}

const paintedAt = (regions: readonly SectionRegion[], f: number, e: number): string | null => {
  let out: string | null = null
  for (const r of regions) if (inPolygon(f, e, r.polygon)) out = r.formationId
  return out
}

/** What is painted at ``f``×``e`` inside ONE gap's own fraction space. */
const paintedInGap = (
  regions: readonly SectionRegion[],
  gap: number,
  f: number,
  e: number,
): string | null => paintedAt(regions.filter((r) => r.gapIndex === gap), f, e)

/** CS1's real S7A|S7 pair: a 1.17 m gap between a short log and a deep one. */
const SHORT_SURFACE = 13.07
const DEEP_SURFACE = 13.1
const ALONG_M = [645.57, 646.74]

const unit = (
  surface: number,
  topElev: number,
  baseElev: number,
  formationId: string,
  layerId: string,
): PartitionColumn['units'][number] => ({
  layerId,
  topDepthM: surface - topElev,
  baseDepthM: surface - baseElev,
  formationId,
  bodyId: `body-${formationId}`,
})

/** The short test: its log stops at +10.42; below that its column says nothing. */
const shortLog: PartitionColumn = {
  investigationId: 'SHORT',
  surfaceElevM: SHORT_SURFACE,
  units: [unit(SHORT_SURFACE, 11.46, 10.42, 'SILT', 'S-silt')],
}

/** The same test, but its log carried down through the interbeds' levels. */
const deepenedLog: PartitionColumn = {
  investigationId: 'SHORT',
  surfaceElevM: SHORT_SURFACE,
  units: [
    unit(SHORT_SURFACE, 11.46, 10.42, 'SILT', 'S-silt'),
    unit(SHORT_SURFACE, 10.42, 4.23, 'KLEI', 'S-klei'),
  ],
}

/** The deep test: an interbed (VEEN +7.75 .. +6.65) sitting far below the short log's floor. */
const deepLog: PartitionColumn = {
  investigationId: 'DEEP',
  surfaceElevM: DEEP_SURFACE,
  units: [
    unit(DEEP_SURFACE, 11.89, 10.11, 'SILT', 'D-silt-top'),
    unit(DEEP_SURFACE, 10.11, 7.75, 'KLEI', 'D-klei-top'),
    unit(DEEP_SURFACE, 7.75, 6.65, 'VEEN', 'D-veen'),
    unit(DEEP_SURFACE, 6.65, 4.23, 'ZAND', 'D-zand'),
  ],
}

/** The same deep test with the interbed sandwiched in ONE lithology — the enclosed-lens carrier. */
const deepLogEnclosed: PartitionColumn = {
  investigationId: 'DEEP',
  surfaceElevM: DEEP_SURFACE,
  units: [
    unit(DEEP_SURFACE, 11.89, 10.11, 'SILT', 'D-silt-top'),
    unit(DEEP_SURFACE, 10.11, 7.75, 'KLEI', 'D-klei-top'),
    unit(DEEP_SURFACE, 7.75, 6.65, 'VEEN', 'D-veen'),
    unit(DEEP_SURFACE, 6.65, 4.23, 'KLEI', 'D-klei-bot'),
  ],
}

/**
 * CS1's real B2 — the first test LEFT of the short one that DID read the interbeds' ground,
 * 67.80 m away, with the short log sitting between it and the deep one.
 */
const FAR_SURFACE = 13.05
const farLog: PartitionColumn = {
  investigationId: 'FAR',
  surfaceElevM: FAR_SURFACE,
  units: [
    unit(FAR_SURFACE, 13.05, 10.05, 'KLEI', 'F-klei-top'),
    unit(FAR_SURFACE, 10.05, 8.05, 'SILT', 'F-silt'),
    unit(FAR_SURFACE, 8.05, 4.25, 'KLEI', 'F-klei'),
    unit(FAR_SURFACE, 4.25, -4.45, 'ZAND', 'F-zand'),
  ],
}
/** FAR | SHORT | DEEP at CS1's real spacing — two gaps, the middle test blind below +10.42. */
const ALONG_M3 = [577.77, 645.57, 646.74]

/**
 * Where the relocated pinch closes, in the FAR|SHORT gap's own fraction space:
 * ``LENS_PINCH_FRACTION`` (0.45) of the DEEP→FAR line, measured from DEEP.
 * 646.74 − 0.45 × 68.97 = 615.70 → (615.70 − 577.77) / 67.80 = 0.559.
 */
const APEX_FRACTION_IN_FAR_GAP = 0.559

const NO_EDGES: CorrelationEdge[] = []

const run = (columns: PartitionColumn[]): SectionRegion[] => {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, NO_EDGES, undefined, ALONG_M)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

const run3 = (columns: PartitionColumn[]): SectionRegion[] => {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, NO_EDGES, undefined, ALONG_M3)
  } finally {
    setTwoSidedTerminations(prev)
  }
}

describe('an interbed facing ground its neighbour never read continues to that column', () => {
  it('the interbed reaches the short test at full thickness', () => {
    const regions = run([shortLog, deepLog])
    // Beside the SHORT test (fraction 0.05) at the interbed's own levels: the short log
    // read nothing here, so there is nothing for a pinch to meet and the interbed is what
    // stands. Sampled top, middle and bottom of its own span — full thickness, not a taper.
    for (const e of [7.7, 7.2, 6.7]) {
      expect(paintedAt(regions, 0.05, e), `beside the short test at ${e}`).toBe('VEEN')
    }
  })

  it('an interbed enclosed in one lithology continues the same way', () => {
    const regions = run([shortLog, deepLogEnclosed])
    for (const e of [7.7, 7.2, 6.7]) {
      expect(paintedAt(regions, 0.05, e), `beside the short test at ${e}`).toBe('VEEN')
    }
  })

  it('the interbed crosses the blind test and pinches against the one that DID read', () => {
    const regions = run3([farLog, shortLog, deepLog])
    // Gap 1 = SHORT|DEEP. The blind test is not a boundary, so the interbed is not closed
    // off there: beside it, top and bottom of the unit's own span, the interbed stands.
    for (const e of [7.7, 6.7]) {
      expect(paintedInGap(regions, 1, 0.05, e), `beside the blind test at ${e}`).toBe('VEEN')
    }
    // Gap 0 = FAR|SHORT. The unit passed straight through the blind test and is still here,
    // tapering toward the test that DID read the ground...
    expect(paintedInGap(regions, 0, 0.95, 7.2), 'just past the blind test').toBe('VEEN')
    expect(paintedInGap(regions, 0, 0.75, 7.2), 'a quarter of the way across').toBe('VEEN')
    // ...and it CLOSES before it gets there — an open pinch, not a wall at the blind test.
    expect(paintedInGap(regions, 0, 0.35, 7.2), 'past the pinch').not.toBe('VEEN')
    expect(paintedInGap(regions, 0, 0.05, 7.2), 'beside the reading test').not.toBe('VEEN')
    // The apex sits where the ordinary pinch puts it: 0.45 of the DEEP→FAR line.
    const straddles =
      paintedInGap(regions, 0, APEX_FRACTION_IN_FAR_GAP + 0.06, 7.2) === 'VEEN' &&
      paintedInGap(regions, 0, APEX_FRACTION_IN_FAR_GAP - 0.06, 7.2) !== 'VEEN'
    expect(straddles, `the pinch closes at fraction ${APEX_FRACTION_IN_FAR_GAP} of the far gap`).toBe(true)
  })

  it('an enclosed interbed crosses the blind test the same way', () => {
    const regions = run3([farLog, shortLog, deepLogEnclosed])
    for (const e of [7.7, 6.7]) {
      expect(paintedInGap(regions, 1, 0.05, e), `beside the blind test at ${e}`).toBe('VEEN')
    }
    expect(paintedInGap(regions, 0, 0.75, 7.2), 'a quarter of the way across').toBe('VEEN')
    expect(paintedInGap(regions, 0, 0.35, 7.2), 'past the pinch').not.toBe('VEEN')
  })

  it('NEAR MISS — where the facing test DID read that ground the interbed still pinches', () => {
    const regions = run([deepenedLog, deepLog])
    // The facing log now reads clay right through the interbed's levels. That is a reading
    // to meet, so the closure stands: the interbed hugs its own test and the clay holds the
    // ground beside the facing one.
    expect(paintedAt(regions, 0.95, 7.2), 'the interbed at its own test').toBe('VEEN')
    expect(paintedAt(regions, 0.05, 7.2), 'the facing test\'s own clay').toBe('KLEI')
  })
})

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
import type { CorrelationEdge, PartitionColumn, SectionRegion } from '../partitionFill'

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

const NO_EDGES: CorrelationEdge[] = []

const run = (columns: PartitionColumn[]): SectionRegion[] => {
  const prev = setTwoSidedTerminations(true)
  try {
    return computeSectionFillV2(columns, NO_EDGES, undefined, ALONG_M)
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

  it('NEAR MISS — where the facing test DID read that ground the interbed still pinches', () => {
    const regions = run([deepenedLog, deepLog])
    // The facing log now reads clay right through the interbed's levels. That is a reading
    // to meet, so the closure stands: the interbed hugs its own test and the clay holds the
    // ground beside the facing one.
    expect(paintedAt(regions, 0.95, 7.2), 'the interbed at its own test').toBe('VEEN')
    expect(paintedAt(regions, 0.05, 7.2), 'the facing test\'s own clay').toBe('KLEI')
  })
})

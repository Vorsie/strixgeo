/**
 * A BAND THE FAR TEST READ IN ONE PIECE STAYS ONE PIECE.
 *
 * Owner, 2026-08-19, on the ground below a short test's TD: *"Below TD there is a SF on
 * the test to the right that gets adopted ... there the SF silt is one band, it gets
 * split below TD at S8? why?"*
 *
 * The scene, reduced to its bones and kept at the real spacing and elevations of CS1's
 * silt chain: a LEFT test with ONE band, a RIGHT test with a FOUR-band stack, and a single
 * tie joining their top bands. Below the left test's own floor there is nothing on the left
 * at all — the right test is the only thing that read that ground, so its stack is what
 * fills it, each band in one piece.
 *
 * What went wrong: the left band's own floor is the run's shallow TD, and the strip between
 * the tied pair's base and that floor was claimed by the LEFT band — a mass that had already
 * ended — threading a foreign class straight through the right test's band.
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

describe('a band the far test read in one piece stays one piece', () => {
  const LEFT_SURFACE = 12.97
  const RIGHT_SURFACE = 12.87
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

  const columns: PartitionColumn[] = [
    {
      investigationId: 'LEFT',
      surfaceElevM: LEFT_SURFACE,
      units: [unit(LEFT_SURFACE, 5.96, 5.01, 'MF', 'L-mf')],
    },
    {
      investigationId: 'RIGHT',
      surfaceElevM: RIGHT_SURFACE,
      units: [
        unit(RIGHT_SURFACE, 6.48, 5.49, 'MF', 'R-mf-top'),
        unit(RIGHT_SURFACE, 5.49, 4.43, 'SF', 'R-sf'),
        unit(RIGHT_SURFACE, 4.43, 3.58, 'MF', 'R-mf-mid'),
        unit(RIGHT_SURFACE, 3.58, 2.51, 'VF', 'R-vf'),
      ],
    },
  ]
  // The one tie of the scene: the two top bands are correlated.
  const edges: CorrelationEdge[] = [{ a: 'L-mf', b: 'R-mf-top', aSide: 'top', bSide: 'top' }]
  const alongM = [422.73, 471.87]

  const run = (): SectionRegion[] => {
    const prev = setTwoSidedTerminations(true)
    try {
      return computeSectionFillV2(columns, edges, undefined, alongM)
    } finally {
      setTwoSidedTerminations(prev)
    }
  }

  it('nothing wraps under the far test\'s own band', () => {
    const regions = run()
    // The right test read SF over 5.49 .. 4.43; the run's floor is the left test's own
    // base, 5.01, so 5.49 .. 5.01 of that band is paintable ground. Sampled beside the
    // test, all of it must read SF: the left band has ended at 5.01 and there is nothing
    // under the lens for it to wrap around.
    for (const e of [5.43, 5.3, 5.2, 5.1, 5.02]) {
      expect(paintedAt(regions, 0.95, e)).toBe('SF')
    }
  })

  it('the correlated top pair still bands across (negative control)', () => {
    const regions = run()
    // Between the tie and the tied pair's own base the two MF bands are one band — the
    // flood must not eat the construct it is supposed to fill around.
    expect(paintedAt(regions, 0.5, 5.9)).toBe('MF')
    expect(paintedAt(regions, 0.1, 5.5)).toBe('MF')
  })
})

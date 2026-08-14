// Behaviour tests for the grain-size (PSD) mini-chart curve maths.
//
// Owner's words for the hover popup: "a mini grain-size distribution chart —
// x = grain diameter in mm on a LOG scale ascending left→right, y = % finer
// by weight 0-100 (compute % finer = 100 - pct_larger), one polyline per
// grain-size test."
//
//   PSD1  % finer is 100 minus % larger, per point.
//   PSD2  points come out ordered by grain diameter, smallest first, however
//         the lab reported them.
//   PSD3  a diameter the log scale cannot place (zero or negative) is dropped,
//         and a ragged pair of arrays only yields the points that pair up.
//   PSD4  no usable points at all → no curve.
//   PSD5  the x axis is a log scale: equal decades take equal width, and the
//         smallest diameter sits at the left edge, the largest at the right.
//   PSD6  the y axis runs 0-100 % with 100 % finer at the top of the box and
//         0 % at the bottom.
//   PSD7  one lab test that reports a single sieve still draws — the decade
//         is padded either side so the point lands mid-box.
//   PSD8  the domain spans every test on the sample, so two polylines share
//         one x axis.

import { describe, expect, it } from 'vitest'

import { psdCurvePoints, psdLogDomain, psdPolyline } from './psdCurve'

/** Parse an SVG polyline "x,y x,y" string back into numbers. */
function parsePolyline(d: string): Array<{ x: number; y: number }> {
  if (d.trim() === '') return []
  return d
    .trim()
    .split(/\s+/)
    .map(pair => {
      const [x, y] = pair.split(',').map(Number)
      return { x, y }
    })
}

describe('psdCurvePoints — % finer by weight, ordered fine-to-coarse', () => {
  it('PSD1: % finer is 100 minus the reported % larger', () => {
    const points = psdCurvePoints({
      diameters_mm: [0.063, 2],
      pct_larger: [90, 10],
    })
    expect(points.map(p => p.pctFiner)).toEqual([10, 90])
  })

  it('PSD2: points are ordered smallest grain first, whatever order the lab reported', () => {
    const points = psdCurvePoints({
      diameters_mm: [2, 0.063, 0.5],
      pct_larger: [10, 90, 50],
    })
    expect(points.map(p => p.diameterMm)).toEqual([0.063, 0.5, 2])
    // The % finer travels with its own diameter, it is not re-sorted separately.
    expect(points.map(p => p.pctFiner)).toEqual([10, 50, 90])
  })

  it('PSD3: a diameter the log scale cannot place is dropped, and a ragged pair only yields matched points', () => {
    const zeroDropped = psdCurvePoints({
      diameters_mm: [0, -1, 0.5],
      pct_larger: [100, 100, 50],
    })
    expect(zeroDropped.map(p => p.diameterMm)).toEqual([0.5])

    const ragged = psdCurvePoints({
      diameters_mm: [0.063, 0.5, 2],
      pct_larger: [90, 50],
    })
    expect(ragged.map(p => p.diameterMm)).toEqual([0.063, 0.5])
  })

  it('PSD4: nothing usable in, nothing out', () => {
    expect(psdCurvePoints({ diameters_mm: [], pct_larger: [] })).toEqual([])
    expect(psdLogDomain([[]])).toBeNull()
    expect(psdLogDomain([])).toBeNull()
  })
})

describe('psdLogDomain / psdPolyline — log x axis, 0-100 % y axis', () => {
  const box = { width: 100, height: 50 }

  it('PSD5: equal decades take equal width, smallest left, largest right', () => {
    // Three decades: 0.01, 0.1, 1 mm. On a log axis they are evenly spaced.
    const points = psdCurvePoints({
      diameters_mm: [0.01, 0.1, 1],
      pct_larger: [100, 50, 0],
    })
    const domain = psdLogDomain([points])
    expect(domain).not.toBeNull()
    const drawn = parsePolyline(psdPolyline(points, domain!, box))

    expect(drawn[0].x).toBeCloseTo(0, 6)
    expect(drawn[2].x).toBeCloseTo(100, 6)
    // The middle decade lands exactly halfway — that is what "log scale" means.
    expect(drawn[1].x).toBeCloseTo(50, 6)
  })

  it('PSD6: 100 % finer sits at the top of the box, 0 % at the bottom', () => {
    const points = psdCurvePoints({
      diameters_mm: [0.01, 1],
      pct_larger: [100, 0],
    })
    const domain = psdLogDomain([points])!
    const drawn = parsePolyline(psdPolyline(points, domain, box))

    // 0 % finer → bottom edge (y = height); 100 % finer → top edge (y = 0).
    expect(drawn[0].y).toBeCloseTo(50, 6)
    expect(drawn[1].y).toBeCloseTo(0, 6)
  })

  it('PSD7: a single-sieve test still draws — the point lands mid-box', () => {
    const points = psdCurvePoints({ diameters_mm: [0.2], pct_larger: [40] })
    const domain = psdLogDomain([points])!
    expect(domain.minMm).toBeLessThan(0.2)
    expect(domain.maxMm).toBeGreaterThan(0.2)

    const drawn = parsePolyline(psdPolyline(points, domain, box))
    expect(drawn).toHaveLength(1)
    expect(drawn[0].x).toBeCloseTo(50, 6)
    // 60 % finer → 60 % of the way UP a 50 px box → 20 px down from the top.
    expect(drawn[0].y).toBeCloseTo(20, 6)
  })

  it('PSD8: two tests on one sample share a single x axis spanning both', () => {
    const fine = psdCurvePoints({ diameters_mm: [0.001, 0.01], pct_larger: [100, 0] })
    const coarse = psdCurvePoints({ diameters_mm: [1, 10], pct_larger: [100, 0] })
    const domain = psdLogDomain([fine, coarse])!

    expect(domain.minMm).toBeCloseTo(0.001, 9)
    expect(domain.maxMm).toBeCloseTo(10, 9)

    // The finest curve starts at the left wall; the coarsest ends at the right.
    expect(parsePolyline(psdPolyline(fine, domain, box))[0].x).toBeCloseTo(0, 6)
    expect(parsePolyline(psdPolyline(coarse, domain, box))[1].x).toBeCloseTo(100, 6)
  })
})

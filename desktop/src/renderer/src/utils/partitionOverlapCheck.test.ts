/**
 * Self-tests for the ``partitionOverlapCheck`` invariant instrument (debt #228).
 *
 * The checker is the INSTRUMENT that the CS1 partition-invariant gates rely
 * on — a broken instrument makes those gates vacuously green, so its own
 * behaviour is pinned here in the checker's vocabulary:
 *
 *  - regions that merely TOUCH (shared edge / shared vertex) share zero area
 *    and are NOT overlaps;
 *  - a hairline sliver of ANY thinness IS an overlap, with its exact area;
 *  - containment is an overlap (the contained region's full area);
 *  - concave rings are handled exactly (a region nested in another's notch
 *    without touching its solid part is NOT an overlap);
 *  - ``kind === 'lens'`` regions are by-design overlays and never reported;
 *  - regions in different gaps are never compared;
 *  - a non-simple (self-intersecting) ring degrades to grid sampling instead
 *    of throwing, and still detects a gross overlap.
 */

import { describe, expect, it } from 'vitest'

import type { SectionRegion } from './sectionPartition'
import { findNonLensOverlaps } from './partitionOverlapCheck'

/** Four-corner region: left edge (f0) from eTop0 down to eBase0, right edge (f1)
 *  from eTop1 down to eBase1. Clockwise-in-screen ring like the engine emits. */
function quad(
  gapIndex: number,
  formationId: string,
  opts: {
    f0?: number
    f1?: number
    eTop0: number
    eTop1: number
    eBase0: number
    eBase1: number
    kind?: SectionRegion['kind']
  },
): SectionRegion {
  const { f0 = 0, f1 = 1, eTop0, eTop1, eBase0, eBase1, kind = 'quad' } = opts
  return {
    formationId,
    bodyId: null,
    kind,
    gapIndex,
    polygon: [
      { fraction: f0, elevation: eTop0 },
      { fraction: f1, elevation: eTop1 },
      { fraction: f1, elevation: eBase1 },
      { fraction: f0, elevation: eBase0 },
    ],
  }
}

describe('findNonLensOverlaps', () => {
  it('reports nothing for disjoint regions', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 8, eBase1: 8 })
    const b = quad(0, 'clay', { eTop0: 6, eTop1: 6, eBase0: 4, eBase1: 4 })
    expect(findNonLensOverlaps([a, b])).toEqual([])
  })

  it('reports nothing for regions sharing an exact edge (touching is not overlapping)', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 9, eBase0: 8, eBase1: 7.5 })
    const b = quad(0, 'clay', { eTop0: 8, eTop1: 7.5, eBase0: 6, eBase1: 5 })
    expect(findNonLensOverlaps([a, b])).toEqual([])
  })

  it('reports a hairline horizontal sliver with its exact area', () => {
    // B's top pokes 1 mm into A across the full gap width → area = 0.001 fraction·m.
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 8, eBase1: 8 })
    const b = quad(0, 'clay', { eTop0: 8.001, eTop1: 8.001, eBase0: 6, eBase1: 6 })
    const reports = findNonLensOverlaps([a, b])
    expect(reports).toHaveLength(1)
    expect(reports[0].areaFracM).toBeCloseTo(0.001, 6)
    expect(reports[0].method).toBe('exact')
  })

  it('reports a one-sided crossing sliver (overlap only near the left column) exactly', () => {
    // A's base slopes 5.0 → 6.0; B's top is flat at 5.2 → they cross at f=0.2:
    // the overlap is the triangle f∈[0, 0.2], area = ½·0.2·0.2 = 0.02.
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 5.0, eBase1: 6.0 })
    const b = quad(0, 'clay', { eTop0: 5.2, eTop1: 5.2, eBase0: 3, eBase1: 3 })
    const reports = findNonLensOverlaps([a, b])
    expect(reports).toHaveLength(1)
    expect(reports[0].areaFracM).toBeCloseTo(0.02, 6)
    // The overlap sits near the left column, below A's sloping base.
    expect(reports[0].centroid.fraction).toBeLessThan(0.2)
    expect(reports[0].centroid.elevation).toBeGreaterThan(5.0)
    expect(reports[0].centroid.elevation).toBeLessThan(5.2)
  })

  it('reports containment with the contained region area', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 0, eBase1: 0 })
    const b = quad(0, 'clay', { f0: 0.4, f1: 0.6, eTop0: 6, eTop1: 6, eBase0: 5, eBase1: 5 })
    const reports = findNonLensOverlaps([a, b])
    expect(reports).toHaveLength(1)
    expect(reports[0].areaFracM).toBeCloseTo(0.2, 6)
  })

  it('handles concave rings exactly (a region inside the notch is not an overlap)', () => {
    // C-shaped concave ring opening to the right; a small quad nested in the
    // mouth of the C touches no solid part of it.
    const cShape: SectionRegion = {
      formationId: 'sand',
      bodyId: null,
      kind: 'quad',
      gapIndex: 0,
      polygon: [
        { fraction: 0.0, elevation: 10 },
        { fraction: 1.0, elevation: 10 },
        { fraction: 1.0, elevation: 8 },
        { fraction: 0.2, elevation: 8 },
        { fraction: 0.2, elevation: 4 },
        { fraction: 1.0, elevation: 4 },
        { fraction: 1.0, elevation: 2 },
        { fraction: 0.0, elevation: 2 },
      ],
    }
    const inNotch = quad(0, 'clay', { f0: 0.4, f1: 0.9, eTop0: 7, eTop1: 7, eBase0: 5, eBase1: 5 })
    expect(findNonLensOverlaps([cShape, inNotch])).toEqual([])
    // Teeth: the same quad shifted up into the C's solid upper arm IS an overlap.
    const inArm = quad(0, 'clay', { f0: 0.4, f1: 0.9, eTop0: 9.5, eTop1: 9.5, eBase0: 8.5, eBase1: 8.5 })
    const reports = findNonLensOverlaps([cShape, inArm])
    expect(reports).toHaveLength(1)
    expect(reports[0].areaFracM).toBeCloseTo(0.5, 6)
  })

  it('never reports lens regions (by-design overlays)', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 0, eBase1: 0 })
    const lens = quad(0, 'silt', { f0: 0.2, f1: 0.8, eTop0: 6, eTop1: 6, eBase0: 4, eBase1: 4, kind: 'lens' })
    expect(findNonLensOverlaps([a, lens])).toEqual([])
  })

  it('never compares regions across gaps', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 0, eBase1: 0 })
    const b = quad(1, 'clay', { eTop0: 10, eTop1: 10, eBase0: 0, eBase1: 0 })
    expect(findNonLensOverlaps([a, b])).toEqual([])
  })

  it('degrades to sampling on a non-simple ring instead of throwing', () => {
    // Asymmetric bowtie (self-intersecting, nonzero net area — a symmetric one
    // has zero shoelace area and is discarded as degenerate before the
    // triangulation-mismatch check this case pins) overlapping a quad across
    // its left lobe.
    const bowtie: SectionRegion = {
      formationId: 'sand',
      bodyId: null,
      kind: 'quad',
      gapIndex: 0,
      polygon: [
        { fraction: 0.0, elevation: 10 },
        { fraction: 1.0, elevation: 2 },
        { fraction: 1.0, elevation: 6 },
        { fraction: 0.0, elevation: 2 },
      ],
    }
    const b = quad(0, 'clay', { f0: 0.0, f1: 0.4, eTop0: 8, eTop1: 8, eBase0: 4, eBase1: 4 })
    const reports = findNonLensOverlaps([bowtie, b])
    expect(reports).toHaveLength(1)
    expect(reports[0].method).toBe('sampled')
    expect(reports[0].areaFracM).toBeGreaterThan(0.1)
  })

  it('ignores overlap area below the configured floor', () => {
    const a = quad(0, 'sand', { eTop0: 10, eTop1: 10, eBase0: 8, eBase1: 8 })
    const b = quad(0, 'clay', { eTop0: 8.001, eTop1: 8.001, eBase0: 6, eBase1: 6 })
    expect(findNonLensOverlaps([a, b], { minAreaFracM: 0.01 })).toEqual([])
  })
})

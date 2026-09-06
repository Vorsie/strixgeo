/**
 * oracle210.test.ts — the owner's 2/1/0 rule as PLAIN SENTENCES, before any geometry.
 *
 * Owner, 2026-09-06 (verbatim, the specification): "Take the first two columns, look at the
 * first litho on the left (how many correlations does it have on the left?) 2: do nothing,
 * 1: emit onlap constructor, 0: emit lens constructor, do the same for the right side. If
 * onlap, follow the onlap and check if it is the same (and if it isn't the outermost left
 * test, you don't have to check left because you already checked it before in the previous
 * two tests). Now do this for all lithos, check the right side of the test. Go to the second
 * test, do the left side of the test, do the right side of the test, continue until
 * everything on the CS is checked."
 *
 * These cases are written in his words, not the code's. Each asserts one clause of the rule.
 */

import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn } from '../sectionPartition'
import { walkSection210 } from './oracle210'

/** A tiny column builder — contiguous units, depth from the top, one formation per unit. */
function col(
  investigationId: string,
  surfaceElevM: number,
  units: { layerId: string; formationId: string; thick: number }[],
): PartitionColumn {
  let depth = 0
  return {
    investigationId,
    surfaceElevM,
    units: units.map((u) => {
      const top = depth
      depth += u.thick
      return { topDepthM: top, baseDepthM: depth, formationId: u.formationId, bodyId: null, layerId: u.layerId }
    }),
  }
}

describe('oracle210 — the owner 2/1/0 rule as sentences', () => {
  it('two ties on a side: nothing to emit (band)', () => {
    // Left column: one clay whose TOP and BASE both tie across to the right clay.
    const left = col('L', 10, [{ layerId: 'L0', formationId: 'CLAY', thick: 4 }])
    const right = col('R', 10, [{ layerId: 'R0', formationId: 'CLAY', thick: 4 }])
    const edges: CorrelationEdge[] = [
      { a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' },
      { a: 'L0', b: 'R0', aSide: 'base', bSide: 'base' },
    ]
    const walk = walkSection210([left, right], edges)
    // The left clay looks right (toward the gap): both its contacts are tied -> a band, nothing to emit.
    expect(walk[0].units[0].right.tieCount).toBe(2)
    expect(walk[0].units[0].right.outcome).toBe('band')
    // The right clay looks left: same two ties -> a band too.
    expect(walk[1].units[0].left.tieCount).toBe(2)
    expect(walk[1].units[0].left.outcome).toBe('band')
  })

  it('one tie: an onlap that must reach the same unit on the neighbour', () => {
    // The left clay ties only its top across to the right clay; its base is untied.
    const left = col('L', 10, [
      { layerId: 'L0', formationId: 'CLAY', thick: 4 },
      { layerId: 'L1', formationId: 'SAND', thick: 4 },
    ])
    const right = col('R', 10, [
      { layerId: 'R0', formationId: 'CLAY', thick: 4 },
      { layerId: 'R1', formationId: 'SAND', thick: 4 },
    ])
    const edges: CorrelationEdge[] = [{ a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' }]
    const walk = walkSection210([left, right], edges)
    const clay = walk[0].units[0].right
    expect(clay.tieCount).toBe(1)
    expect(clay.outcome).toBe('onlap')
    // Follow the onlap: it lands on the right clay, and that IS the same litho.
    expect(clay.partnerLayerId).toBe('R0')
    expect(clay.sameUnit).toBe(true)
  })

  it('one tie that lands on a DIFFERENT litho is an onlap that is not the same', () => {
    // The left clay ties its top to the right SAND (a mixed tie) — an onlap that is not "the same".
    const left = col('L', 10, [{ layerId: 'L0', formationId: 'CLAY', thick: 4 }])
    const right = col('R', 10, [{ layerId: 'R0', formationId: 'SAND', thick: 4 }])
    const edges: CorrelationEdge[] = [{ a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' }]
    const walk = walkSection210([left, right], edges)
    const clay = walk[0].units[0].right
    expect(clay.outcome).toBe('onlap')
    expect(clay.partnerLayerId).toBe('R0')
    expect(clay.sameUnit).toBe(false)
  })

  it('zero ties: a lens', () => {
    // A silt with no correlation on either contact — a lens.
    const left = col('L', 10, [{ layerId: 'L0', formationId: 'SILT', thick: 4 }])
    const right = col('R', 10, [{ layerId: 'R0', formationId: 'SILT', thick: 4 }])
    const walk = walkSection210([left, right], [])
    expect(walk[0].units[0].right.tieCount).toBe(0)
    expect(walk[0].units[0].right.outcome).toBe('lens')
  })

  it('the left side of test k is the right side of test k-1, checked once', () => {
    // One tie across the single gap. The gap is the SAME interface seen from both tests:
    // test 0's RIGHT side and test 1's LEFT side must report the same tie count.
    const left = col('L', 10, [{ layerId: 'L0', formationId: 'CLAY', thick: 4 }])
    const right = col('R', 10, [{ layerId: 'R0', formationId: 'CLAY', thick: 4 }])
    const edges: CorrelationEdge[] = [{ a: 'L0', b: 'R0', aSide: 'top', bSide: 'top' }]
    const walk = walkSection210([left, right], edges)
    expect(walk[0].units[0].right.tieCount).toBe(walk[1].units[0].left.tieCount)
    expect(walk[0].units[0].right.tieCount).toBe(1)
  })

  it('the outermost left test has no left side, the outermost right test has no right side', () => {
    const c0 = col('c0', 10, [{ layerId: 'A', formationId: 'CLAY', thick: 4 }])
    const c1 = col('c1', 10, [{ layerId: 'B', formationId: 'CLAY', thick: 4 }])
    const c2 = col('c2', 10, [{ layerId: 'C', formationId: 'CLAY', thick: 4 }])
    const walk = walkSection210([c0, c1, c2], [])
    expect(walk[0].units[0].left.outcome).toBe('edge-of-section')
    expect(walk[2].units[0].right.outcome).toBe('edge-of-section')
    // A middle test has a real left and a real right (both lenses here, no ties).
    expect(walk[1].units[0].left.outcome).toBe('lens')
    expect(walk[1].units[0].right.outcome).toBe('lens')
  })

  it('a sand around a silt: the silt is a lens, the neighbour sand is a band', () => {
    // Left test: sand over silt over sand. Right test: one sand.
    // The right sand has a top tie (to the upper left sand) and a base tie (to the lower left
    // sand) — two ties, so the sand is a band. The enclosed silt has no ties, so it is a lens.
    const left = col('L', 10, [
      { layerId: 'Lsand_top', formationId: 'SAND', thick: 2 },
      { layerId: 'Lsilt', formationId: 'SILT', thick: 3 },
      { layerId: 'Lsand_bot', formationId: 'SAND', thick: 3 },
    ])
    const right = col('R', 10, [{ layerId: 'Rsand', formationId: 'SAND', thick: 8 }])
    const edges: CorrelationEdge[] = [
      { a: 'Rsand', b: 'Lsand_top', aSide: 'top', bSide: 'top' },
      { a: 'Rsand', b: 'Lsand_bot', aSide: 'base', bSide: 'base' },
    ]
    const walk = walkSection210([left, right], edges)
    // The neighbour sand: two ties -> band.
    expect(walk[1].units[0].left.tieCount).toBe(2)
    expect(walk[1].units[0].left.outcome).toBe('band')
    // The enclosed silt: no ties -> lens.
    const silt = walk[0].units[1]
    expect(silt.formationId).toBe('SILT')
    expect(silt.right.tieCount).toBe(0)
    expect(silt.right.outcome).toBe('lens')
    // Each left sand is a one-tie onlap that reaches the same litho (the right sand).
    expect(walk[0].units[0].right.outcome).toBe('onlap')
    expect(walk[0].units[0].right.sameUnit).toBe(true)
    expect(walk[0].units[2].right.outcome).toBe('onlap')
    expect(walk[0].units[2].right.sameUnit).toBe(true)
  })

  it('a shared contact ties both units meeting there (the base of one is the top of the next)', () => {
    // A tie drawn on the clay TOP also ties the sand ABOVE it (the sand base = the clay top).
    // Owner ruling 8a expressed as the plain geometry: a correlation line on a contact ties the
    // two lithos that meet on that contact.
    const left = col('L', 10, [
      { layerId: 'Lsand', formationId: 'SAND', thick: 3 },
      { layerId: 'Lclay', formationId: 'CLAY', thick: 5 },
    ])
    const right = col('R', 10, [
      { layerId: 'Rsand', formationId: 'SAND', thick: 3 },
      { layerId: 'Rclay', formationId: 'CLAY', thick: 5 },
    ])
    // A single tie on the sand TOP and a single tie on the clay TOP (= the sand BASE, shared).
    const edges: CorrelationEdge[] = [
      { a: 'Lsand', b: 'Rsand', aSide: 'top', bSide: 'top' },
      { a: 'Lclay', b: 'Rclay', aSide: 'top', bSide: 'top' },
    ]
    const walk = walkSection210([left, right], edges)
    // The sand's top is tied AND its base (the shared clay-top contact) is tied -> two ties -> band.
    const sand = walk[0].units[0].right
    expect(sand.tieCount).toBe(2)
    expect(sand.outcome).toBe('band')
  })
})

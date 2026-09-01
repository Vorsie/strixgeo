/**
 * partitionFillV2/mergeTouchingBodies.separations.test.ts — the "Separate" cannot-link
 * threaded into the post-fill weld (owner ruling 2026-08-31, debt #278 R5; dogfeed
 * 2026-09-01 "the seam the owner split must be visible").
 *
 * Separate is a durable cannot-link the resolver honours, but the 2-D fill still WELDS
 * same-class touching masses — so after a split the paint stays one mass and the seam
 * the owner drew is invisible. ``separatedPairs`` (canonical ``a|b`` layer-id pairs,
 * a < b lexicographic) threads that cannot-link into the weld, mirroring the backend's
 * constrained union-find (``resolve_litho_instances._constrained_components``): a union
 * that would put BOTH sides of a separation under one root is skipped.
 *
 * Cases (in the ruling's vocabulary):
 *   (S1) same-gap: two same-class touching regions carrying a separated pair stay
 *        UNWELDED — the paint seam appears;
 *   (S2) BYTE-IDENTICAL invariant: an empty (and an absent) separations input leaves a
 *        non-trivial scene deep-equal to the no-separations call;
 *   (S3) cross-gap: a separation blocks a weld across a shared column boundary too;
 *   (S4) residual: a single region already carrying BOTH sides of a separation cannot be
 *        split by the merge — it stays whole and its unrelated welds still happen.
 */

import { describe, expect, it } from 'vitest'

import {
  mergeTouchingBodies,
  mergeTouchingBodiesWithGroups,
} from './mergeTouchingBodies'
import { type PartitionPoint, type SectionRegion } from '../sectionPartition'

const SAND = 'sand'
const CLAY = 'clay'

/** A rectangular SectionRegion in (fraction, elevation) space — same idiom as the
 *  groups test: ``layerIds`` present on drilled v2 regions, absent on fallback fill. */
function rect(
  gapIndex: number,
  formationId: string,
  bodyId: string | null,
  fLo: number,
  fHi: number,
  eLo: number,
  eHi: number,
  opts?: { fallback?: true; layerIds?: string[] },
): SectionRegion {
  const polygon: PartitionPoint[] = [
    { fraction: fLo, elevation: eHi },
    { fraction: fHi, elevation: eHi },
    { fraction: fHi, elevation: eLo },
    { fraction: fLo, elevation: eLo },
  ]
  return {
    formationId,
    bodyId,
    kind: 'quad',
    polygon,
    gapIndex,
    ...(opts?.fallback ? { fallback: true as const } : {}),
    ...(opts?.layerIds ? { layerIds: opts.layerIds } : {}),
  }
}

describe('mergeTouchingBodiesWithGroups — separations are a cannot-link on the weld', () => {
  it('(S1) same-gap: two same-class touching regions the user Separated stay UNWELDED', () => {
    // Two SAND regions sharing the fraction-0.5 edge weld by default; a standing
    // separation between their two layers must keep them two bodies (the seam shows).
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A'] }),
      rect(0, SAND, 'sand-B', 0.5, 1.0, 4, 8, { layerIds: ['lyr-B'] }),
    ]

    // Baseline: no separation → they weld to one representative id, one group.
    const welded = mergeTouchingBodiesWithGroups(regions, [])
    expect(new Set(welded.regions.map((r) => r.bodyId))).toEqual(new Set(['sand-A']))
    expect(welded.groups).toEqual([['lyr-A', 'lyr-B']])

    // With the separation lyr-A | lyr-B they do NOT weld: each keeps its own body,
    // and neither component reaches two layers, so nothing groups.
    const split = mergeTouchingBodiesWithGroups(regions, [], {
      separatedPairs: new Set(['lyr-A|lyr-B']),
    })
    expect(split.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-B'])
    expect(split.groups).toEqual([])
  })

  it('(S2) an empty (and an absent) separations input is byte-identical on a non-trivial scene', () => {
    // A mixed fallback + drilled chain plus a disconnected SAND block — the same scene
    // the parity pin uses. Passing an EMPTY set, and passing NOTHING, must both be
    // deep-equal to the plain call: the cannot-link is inert when the user separated
    // nothing (the CS1 golden / HIER_COV invariant, at the merge unit).
    const scene = (): SectionRegion[] => [
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4, { layerIds: ['lyr-A'] }),
      rect(0, SAND, 'sand-F', 0.3, 0.6, 0, 4, { fallback: true }),
      rect(0, SAND, 'sand-B', 0.6, 1.0, 0, 4, { layerIds: ['lyr-B'] }),
      rect(1, SAND, 'sand-B', 0.0, 1.0, 0, 4, { layerIds: ['lyr-B', 'lyr-C'] }),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 4, 8, { layerIds: ['lyr-D'] }),
      rect(0, SAND, 'sand-D', 0.0, 1.0, 9, 12, { layerIds: ['lyr-E'] }),
    ]
    const base = mergeTouchingBodiesWithGroups(scene(), [])
    const emptySet = mergeTouchingBodiesWithGroups(scene(), [], {
      separatedPairs: new Set<string>(),
    })
    const absent = mergeTouchingBodiesWithGroups(scene(), [], { excludeFallback: false })
    expect(emptySet).toEqual(base)
    expect(absent).toEqual(base)
  })

  it('(S3) cross-gap: a separation blocks a weld across a shared column boundary', () => {
    // A (gap 0) reaches the shared column; B (gap 1) reaches its left edge — same class,
    // overlapping elevation → they weld across the column by default. The separation
    // lyr-A | lyr-B keeps them apart there too.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 1.0, 0, 4, { layerIds: ['lyr-A'] }),
      rect(1, SAND, 'sand-B', 0.0, 1.0, 0, 4, { layerIds: ['lyr-B'] }),
    ]
    const welded = mergeTouchingBodiesWithGroups(regions, [])
    expect(welded.groups).toEqual([['lyr-A', 'lyr-B']])

    const split = mergeTouchingBodiesWithGroups(regions, [], {
      separatedPairs: new Set(['lyr-A|lyr-B']),
    })
    expect(split.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-B'])
    expect(split.groups).toEqual([])
  })

  it('(S4) a region already carrying BOTH sides is left whole and its unrelated welds still happen', () => {
    // The middle region carries lyr-A AND lyr-B — an already-welded mass the merge cannot
    // split (the recompute/resolver splits identity, not this relabel). With the
    // separation lyr-A | lyr-B present it neither errors nor drops the region, and it
    // still welds to the neighbouring SAND (whose layer is unconstrained).
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-AB', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A', 'lyr-B'] }),
      rect(0, SAND, 'sand-C', 0.5, 1.0, 4, 8, { layerIds: ['lyr-C'] }),
    ]
    const split = mergeTouchingBodiesWithGroups(regions, [], {
      separatedPairs: new Set(['lyr-A|lyr-B']),
    })
    // The two touch and both are unconstrained w.r.t. lyr-C, so they weld to one body.
    expect(new Set(split.regions.map((r) => r.bodyId))).toEqual(new Set(['sand-AB']))
    expect(split.groups).toEqual([['lyr-A', 'lyr-B', 'lyr-C']])
  })

  it('(S5) the legacy mergeTouchingBodies default path is unchanged (no separations arg)', () => {
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A'] }),
      rect(0, SAND, 'sand-B', 0.5, 1.0, 4, 8, { layerIds: ['lyr-B'] }),
    ]
    const merged = mergeTouchingBodies(regions, [])
    expect(new Set(merged.map((r) => r.bodyId))).toEqual(new Set(['sand-A']))
  })
})

/**
 * partitionFillV2/mergeTouchingBodies.groups.test.ts — the opt-in merge-group exposure
 * (``mergeTouchingBodiesWithGroups``, slice 4 of "persist geometric body identity").
 *
 * The 8j post-fill merge relabels regions to a per-section representative and used to
 * DISCARD its union-find. The new entry point exposes the merge groups — the ORIGINAL
 * (pre-merge) non-null body ids per connected component — and can exclude FALLBACK
 * regions (substrate / flood fill, ``fallback === true``) from the adjacency scan so
 * fallback paint never welds two drilled bodies into one identity.
 *
 * Cases (in the rule's vocabulary):
 *   (1) the groups list the original body ids of each merged component;
 *   (2) two same-formation regions touching ONLY via a fallback region stay in
 *       SEPARATE groups under ``excludeFallback`` — but merge without the flag —
 *       within a gap AND across a gap boundary;
 *   (3) parity pin: the existing ``mergeTouchingBodies`` export stays deep-equal to
 *       the pre-change semantics on a mixed (fallback + drilled) fixture.
 */

import { describe, expect, it } from 'vitest'

import { mergeTouchingBodies, mergeTouchingBodiesWithGroups } from './mergeTouchingBodies'
import { type PartitionPoint, type SectionRegion } from '../partitionFill'

const SAND = 'sand'
const CLAY = 'clay'

/** A rectangular SectionRegion in (fraction, elevation) space with an explicit bodyId. */
function rect(
  gapIndex: number,
  formationId: string,
  bodyId: string | null,
  fLo: number,
  fHi: number,
  eLo: number,
  eHi: number,
  fallback?: true,
): SectionRegion {
  const polygon: PartitionPoint[] = [
    { fraction: fLo, elevation: eHi },
    { fraction: fHi, elevation: eHi },
    { fraction: fHi, elevation: eLo },
    { fraction: fLo, elevation: eLo },
  ]
  return { formationId, bodyId, kind: 'quad', polygon, gapIndex, ...(fallback ? { fallback } : {}) }
}

describe('mergeTouchingBodiesWithGroups — merge groups carry the ORIGINAL body ids', () => {
  it('(1) each connected component reports its original (pre-merge) non-null body ids', () => {
    // Two SAND regions sharing the fraction-0.5 edge weld into one component; the CLAY
    // band below is its own component. The groups name the ORIGINAL ids — the relabelled
    // output ids are the representative's, but identity persistence needs the members.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.5, 4, 8),
      rect(0, SAND, 'sand-B', 0.5, 1.0, 4, 8),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 0, 4),
    ]
    const { regions: merged, groups } = mergeTouchingBodiesWithGroups(regions, [])
    // The relabel matches the existing merge: both SANDs take the representative id.
    const sandBodies = new Set(merged.filter((r) => r.formationId === SAND).map((r) => r.bodyId))
    expect(sandBodies).toEqual(new Set(['sand-A']))
    // The groups carry BOTH original ids of the welded component, plus the lone CLAY.
    expect(groups).toContainEqual(['sand-A', 'sand-B'])
    expect(groups).toContainEqual(['clay-C'])
  })

  it('(2a) same-gap: a chain welded ONLY through a fallback region splits under excludeFallback', () => {
    // SAND A and SAND B touch ONLY via the fallback SAND F between them. Without the flag
    // the chain welds (one group, one id); with ``excludeFallback`` F creates no union and
    // joins no group, so A and B stay separate identities.
    const chain: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4),
      rect(0, SAND, 'sand-F', 0.3, 0.6, 0, 4, true),
      rect(0, SAND, 'sand-B', 0.6, 1.0, 0, 4),
    ]
    const without = mergeTouchingBodiesWithGroups(chain, [])
    expect(without.groups).toContainEqual(['sand-A', 'sand-F', 'sand-B'])
    expect(new Set(without.regions.map((r) => r.bodyId))).toEqual(new Set(['sand-A']))

    const excluded = mergeTouchingBodiesWithGroups(chain, [], { excludeFallback: true })
    expect(excluded.groups).toContainEqual(['sand-A'])
    expect(excluded.groups).toContainEqual(['sand-B'])
    // The fallback region joins NO group.
    for (const g of excluded.groups) expect(g).not.toContain('sand-F')
    // No union happened: every region keeps its own original id.
    expect(excluded.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-F', 'sand-B'])
  })

  it('(2b) cross-gap: a fallback region bridging a shared column creates no union either', () => {
    // A (gap 0) reaches the shared column; F (gap 1, fallback) spans gap 1 and touches
    // B (gap 2) at the next column. The only connection A->B runs THROUGH F, across two
    // shared-column adjacencies — both must be skipped under ``excludeFallback``.
    const chain: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 1.0, 0, 4),
      rect(1, SAND, 'sand-F', 0.0, 1.0, 0, 4, true),
      rect(2, SAND, 'sand-B', 0.0, 1.0, 0, 4),
    ]
    const without = mergeTouchingBodiesWithGroups(chain, [])
    expect(without.groups).toContainEqual(['sand-A', 'sand-F', 'sand-B'])

    const excluded = mergeTouchingBodiesWithGroups(chain, [], { excludeFallback: true })
    expect(excluded.groups).toContainEqual(['sand-A'])
    expect(excluded.groups).toContainEqual(['sand-B'])
    expect(excluded.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-F', 'sand-B'])
  })

  it('(3) parity pin: the default mergeTouchingBodies stays byte-identical on a mixed fixture', () => {
    // Expectation constructed from the CURRENT (pre-groups) semantics: fallback regions
    // participate in the union like any other region, the component representative is the
    // smallest (gapIndex, minFraction, maxElev) member, and its id relabels the component.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4),
      rect(0, SAND, 'sand-F', 0.3, 0.6, 0, 4, true),
      rect(0, SAND, 'sand-B', 0.6, 1.0, 0, 4),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 4, 8),
      rect(0, SAND, 'sand-D', 0.0, 1.0, 9, 12), // separated from the chain by CLAY
    ]
    const merged = mergeTouchingBodies(regions, [])
    expect(merged).toEqual([
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4),
      rect(0, SAND, 'sand-A', 0.3, 0.6, 0, 4, true), // relabelled to the representative
      rect(0, SAND, 'sand-A', 0.6, 1.0, 0, 4),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 4, 8),
      rect(0, SAND, 'sand-D', 0.0, 1.0, 9, 12),
    ])
  })
})

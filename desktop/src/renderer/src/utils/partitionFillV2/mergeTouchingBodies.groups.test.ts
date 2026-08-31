/**
 * partitionFillV2/mergeTouchingBodies.groups.test.ts — the opt-in merge-group exposure
 * (``mergeTouchingBodiesWithGroups``, "persist geometric body identity").
 *
 * The 8j post-fill merge relabels regions to a per-section representative and used to
 * DISCARD its union-find. The groups entry point exposes the merge groups in LAYER-id
 * space — per connected component, the union of member regions' ``layerIds`` (the
 * drilled layers whose fill regions form one touching component); components
 * contributing fewer than two layers are dropped. Layer ids are the wire currency
 * BECAUSE they never change: the first design grouped BODY ids and oscillated in
 * production — after a successful merge every refetched region carried the merged id,
 * the next payload's evidence collapsed to singletons, and the wholesale fact replace
 * undid the merge (facts flapping 74→3→69 live, dogfeed 2026-08-12 evening).
 * ``excludeFallback`` keeps FALLBACK regions (substrate / flood fill,
 * ``fallback === true``) out of the adjacency scan so fallback paint never welds two
 * drilled bodies into one identity.
 *
 * Cases (in the rule's vocabulary):
 *   (1) a welded component's group is the union of its member regions' LAYER ids —
 *       never body ids — and a component with fewer than two layers reports nothing;
 *   (2) two same-formation regions touching ONLY via a fallback region stay OUT of
 *       any group under ``excludeFallback`` — but group without the flag — within a
 *       gap AND across a gap boundary;
 *   (3) parity pin: the existing ``mergeTouchingBodies`` export stays deep-equal to
 *       the pre-change semantics on a mixed (fallback + drilled) fixture.
 */

import { describe, expect, it } from 'vitest'

import { mergeTouchingBodies, mergeTouchingBodiesWithGroups } from './mergeTouchingBodies'
import { type PartitionPoint, type SectionRegion } from '../sectionPartition'

const SAND = 'sand'
const CLAY = 'clay'

/** A rectangular SectionRegion in (fraction, elevation) space. ``layerIds`` mirrors the
 *  production contract: present on drilled v2 regions, ABSENT on fallback fill. */
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

describe('mergeTouchingBodiesWithGroups — merge groups carry LAYER ids', () => {
  it('(1) a welded component groups its member regions\' layer ids; sub-2-layer components report nothing', () => {
    // Two SAND regions sharing the fraction-0.5 edge weld into one component; the CLAY
    // band below is its own single-layer component and states no connectivity fact.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A'] }),
      rect(0, SAND, 'sand-B', 0.5, 1.0, 4, 8, { layerIds: ['lyr-B'] }),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 0, 4, { layerIds: ['lyr-C'] }),
    ]
    const { regions: merged, groups } = mergeTouchingBodiesWithGroups(regions, [])
    // The relabel matches the existing merge: both SANDs take the representative id.
    const sandBodies = new Set(merged.filter((r) => r.formationId === SAND).map((r) => r.bodyId))
    expect(sandBodies).toEqual(new Set(['sand-A']))
    // The group names the welded component's LAYERS — never the body ids the
    // recompute rewrites — and the lone CLAY layer states nothing.
    expect(groups).toEqual([['lyr-A', 'lyr-B']])
  })

  it('(1c) identityKeyOf: same CLASS on different formation rows groups as one mass', () => {
    // The geotech model keeps one formation ROW per (class, litho parent,
    // GEOLOGICAL parent), so a mass tied or touching across a geological
    // boundary carries two row ids. The owner ruled identity is the CLASS
    // (2026-08-21, "one mass one body" + option 3): with the key both rows
    // read ZAND|6 and the touching pair states ONE connectivity fact; without
    // it (the litho default) the rows stay two components — unchanged.
    const regions: SectionRegion[] = [
      rect(0, 'row-geo-a', 'body-A', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A'] }),
      rect(0, 'row-geo-b', 'body-B', 0.5, 1.0, 4, 8, { layerIds: ['lyr-B'] }),
    ]
    const classKey = new Map([
      ['row-geo-a', 'ZAND|6'],
      ['row-geo-b', 'ZAND|6'],
    ])
    const withKey = mergeTouchingBodiesWithGroups(regions, [], {
      identityKeyOf: (id) => classKey.get(id) ?? id,
    })
    expect(withKey.groups).toEqual([['lyr-A', 'lyr-B']])
    const withoutKey = mergeTouchingBodiesWithGroups(regions, [])
    expect(withoutKey.groups).toEqual([])
  })

  it('(1d) identityKeyOf never over-groups: different classes stay apart whatever the rows', () => {
    const regions: SectionRegion[] = [
      rect(0, 'row-geo-a', 'body-A', 0.0, 0.5, 4, 8, { layerIds: ['lyr-A'] }),
      rect(0, 'row-geo-b', 'body-B', 0.5, 1.0, 4, 8, { layerIds: ['lyr-B'] }),
    ]
    const classKey = new Map([
      ['row-geo-a', 'ZAND|6'],
      ['row-geo-b', 'ZAND|8'],
    ])
    const { groups } = mergeTouchingBodiesWithGroups(regions, [], {
      identityKeyOf: (id) => classKey.get(id) ?? id,
    })
    expect(groups).toEqual([])
  })

  it('(1b) layer ids union DEDUPED across members; layerless (v1-shaped) regions group nothing', () => {
    // A band face sliced into two gap regions repeats its producing layers on each
    // slice — the group carries each id once. Two touching regions WITHOUT layerIds
    // (v1 output has none) weld visually but report no group.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 1.0, 4, 8, { layerIds: ['lyr-L', 'lyr-R'] }),
      rect(1, SAND, 'sand-A', 0.0, 1.0, 4, 8, { layerIds: ['lyr-R', 'lyr-RR'] }),
      rect(0, CLAY, 'clay-X', 0.0, 0.5, 0, 4),
      rect(0, CLAY, 'clay-Y', 0.5, 1.0, 0, 4),
    ]
    const { groups } = mergeTouchingBodiesWithGroups(regions, [])
    expect(groups).toEqual([['lyr-L', 'lyr-R', 'lyr-RR']])
  })

  it('(2a) same-gap: layers connected ONLY through a fallback region stay ungrouped under excludeFallback', () => {
    // SAND A and SAND B touch ONLY via the fallback SAND F between them. Without the
    // flag the chain welds and the drilled layers group; with ``excludeFallback`` F
    // creates no union, A and B stay single-layer components, and NOTHING is grouped.
    const chain: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4, { layerIds: ['lyr-A'] }),
      rect(0, SAND, 'sand-F', 0.3, 0.6, 0, 4, { fallback: true }),
      rect(0, SAND, 'sand-B', 0.6, 1.0, 0, 4, { layerIds: ['lyr-B'] }),
    ]
    const without = mergeTouchingBodiesWithGroups(chain, [])
    expect(without.groups).toEqual([['lyr-A', 'lyr-B']])
    expect(new Set(without.regions.map((r) => r.bodyId))).toEqual(new Set(['sand-A']))

    const excluded = mergeTouchingBodiesWithGroups(chain, [], { excludeFallback: true })
    expect(excluded.groups).toEqual([])
    // No union happened: every region keeps its own original id.
    expect(excluded.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-F', 'sand-B'])
  })

  it('(2b) cross-gap: a fallback region bridging a shared column creates no union either', () => {
    // A (gap 0) reaches the shared column; F (gap 1, fallback) spans gap 1 and touches
    // B (gap 2) at the next column. The only connection A->B runs THROUGH F, across two
    // shared-column adjacencies — both must be skipped under ``excludeFallback``.
    const chain: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 1.0, 0, 4, { layerIds: ['lyr-A'] }),
      rect(1, SAND, 'sand-F', 0.0, 1.0, 0, 4, { fallback: true }),
      rect(2, SAND, 'sand-B', 0.0, 1.0, 0, 4, { layerIds: ['lyr-B'] }),
    ]
    const without = mergeTouchingBodiesWithGroups(chain, [])
    expect(without.groups).toEqual([['lyr-A', 'lyr-B']])

    const excluded = mergeTouchingBodiesWithGroups(chain, [], { excludeFallback: true })
    expect(excluded.groups).toEqual([])
    expect(excluded.regions.map((r) => r.bodyId)).toEqual(['sand-A', 'sand-F', 'sand-B'])
  })

  it('(3) parity pin: the default mergeTouchingBodies stays byte-identical on a mixed fixture', () => {
    // Expectation constructed from the CURRENT (pre-groups) semantics: fallback regions
    // participate in the union like any other region, the component representative is the
    // smallest (gapIndex, minFraction, maxElev) member, and its id relabels the component.
    const regions: SectionRegion[] = [
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4),
      rect(0, SAND, 'sand-F', 0.3, 0.6, 0, 4, { fallback: true }),
      rect(0, SAND, 'sand-B', 0.6, 1.0, 0, 4),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 4, 8),
      rect(0, SAND, 'sand-D', 0.0, 1.0, 9, 12), // separated from the chain by CLAY
    ]
    const merged = mergeTouchingBodies(regions, [])
    expect(merged).toEqual([
      rect(0, SAND, 'sand-A', 0.0, 0.3, 0, 4),
      rect(0, SAND, 'sand-A', 0.3, 0.6, 0, 4, { fallback: true }), // relabelled to the representative
      rect(0, SAND, 'sand-A', 0.6, 1.0, 0, 4),
      rect(0, CLAY, 'clay-C', 0.0, 1.0, 4, 8),
      rect(0, SAND, 'sand-D', 0.0, 1.0, 9, 12),
    ])
  })
})

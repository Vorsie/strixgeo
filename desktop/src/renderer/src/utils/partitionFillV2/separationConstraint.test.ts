/**
 * partitionFillV2/separationConstraint.test.ts — the "Separate" cannot-link primitives.
 *
 * Direct unit tests for the incidence bookkeeping the two weld engines share (it mirrors
 * the backend's ``resolve_litho_instances._constrained_components``): the pair helpers,
 * per-node seeding, the completion test (only indices present on BOTH roots complete),
 * and the absorb that makes the constraint TRANSITIVE — a component that already holds
 * side A cannot later absorb side B.
 */

import { describe, expect, it } from 'vitest'

import {
  absorbSeparationIncidence,
  canonicalSeparationPair,
  seedSeparationIncidence,
  toSeparatedPairs,
  unionCompletesSeparation,
} from './separationConstraint'

describe('separationConstraint — canonical pairs', () => {
  it('canonicalSeparationPair is order-independent (smaller anchor first)', () => {
    expect(canonicalSeparationPair('lyr-A', 'lyr-B')).toBe('lyr-A|lyr-B')
    expect(canonicalSeparationPair('lyr-B', 'lyr-A')).toBe('lyr-A|lyr-B')
  })

  it('toSeparatedPairs canonicalises and dedupes', () => {
    const set = toSeparatedPairs([
      { layer_a_id: 'b', layer_b_id: 'a' },
      { layer_a_id: 'a', layer_b_id: 'b' }, // same pair, other order → one entry
      { layer_a_id: 'c', layer_b_id: 'd' },
    ])
    expect(set).toEqual(new Set(['a|b', 'c|d']))
  })
})

describe('separationConstraint — incidence bookkeeping', () => {
  it('an empty / absent separations input seeds nothing (pairCount 0)', () => {
    const layerIdsOf = (i: number): string[] => [['a'], ['b']][i]
    expect(seedSeparationIncidence(2, layerIdsOf, () => true, undefined).pairCount).toBe(0)
    expect(seedSeparationIncidence(2, layerIdsOf, () => true, new Set()).pairCount).toBe(0)
  })

  it('a direct A/B pair completes; an unrelated union does not', () => {
    // node0 carries a, node1 carries b, node2 carries c. Separation a|b.
    const layerIdsOf = (i: number): string[] => [['a'], ['b'], ['c']][i]
    const { incidence, pairCount } = seedSeparationIncidence(
      3,
      layerIdsOf,
      () => true,
      new Set(['a|b']),
    )
    expect(pairCount).toBe(1)
    // Merging node0 (A) with node1 (B) would complete the pair → blocked.
    expect(unionCompletesSeparation(incidence, 0, 1)).toBe(true)
    // Merging node0 (A) with node2 (no side of this pair) is fine.
    expect(unionCompletesSeparation(incidence, 0, 2)).toBe(false)
  })

  it('the constraint is TRANSITIVE through absorb: A ∪ neutral, then ∪ B is blocked', () => {
    // node0 = a, node1 = neutral, node2 = b. Separation a|b. First union node1 into
    // node0's root (allowed), then the A-carrying component may not absorb node2 (B).
    const layerIdsOf = (i: number): string[] => [['a'], ['neutral'], ['b']][i]
    const { incidence } = seedSeparationIncidence(3, layerIdsOf, () => true, new Set(['a|b']))
    // 0 ∪ 1: neither completes (node1 carries no side).
    expect(unionCompletesSeparation(incidence, 0, 1)).toBe(false)
    absorbSeparationIncidence(incidence, 0, 1) // root 0 survives
    // Now the component rooted at 0 holds side A; merging with node2 (B) completes a|b.
    expect(unionCompletesSeparation(incidence, 0, 2)).toBe(true)
  })

  it('a node already carrying BOTH sides does not block an unrelated union', () => {
    // node0 carries a AND b (already-welded evidence — the merge cannot split it), node1
    // carries c. The a|b pair sits wholly under node0, so it is not on both roots and the
    // union with node1 proceeds (identity is re-split by the resolver, not this relabel).
    const layerIdsOf = (i: number): string[] => [['a', 'b'], ['c']][i]
    const { incidence } = seedSeparationIncidence(2, layerIdsOf, () => true, new Set(['a|b']))
    expect(unionCompletesSeparation(incidence, 0, 1)).toBe(false)
  })

  it('a non-participating node is not seeded', () => {
    // node1 excluded (participates false) → carries no side, so no pair can complete
    // through it even though it holds b.
    const layerIdsOf = (i: number): string[] => [['a'], ['b']][i]
    const participates = (i: number): boolean => i !== 1
    const { incidence } = seedSeparationIncidence(2, layerIdsOf, participates, new Set(['a|b']))
    expect(incidence.has(1)).toBe(false)
    expect(unionCompletesSeparation(incidence, 0, 1)).toBe(false)
  })
})

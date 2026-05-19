// Direct unit test of the RO-3 stale-ordinal predicate.
//
// Why this file exists (review SF-1): the in-component useMemo could only
// ever be exercised for the badge-ABSENT branch — driving an edge-count
// divergence mid-render is not reachable through LithologyInspector's
// public surface. Extracting the pure predicate makes the badge-PRESENT
// (happy path) branch a one-line assertion, satisfying the DoD's
// happy-path coverage requirement.

import { describe, expect, it } from 'vitest'

import type { GeologicalFormationResponse } from '../../../api/client'
import { computeOrdinalStale } from './ordinalStaleness'

// Only `instance_ordinal_locked` is read by the predicate — a minimal
// cast keeps the fixture honest about what the function actually depends on.
function f(locked: boolean): GeologicalFormationResponse {
  return { instance_ordinal_locked: locked } as GeologicalFormationResponse
}

describe('computeOrdinalStale (RO-3 badge predicate — review SF-1)', () => {
  it('TRUE — locked formation AND edge count diverged from the baseline', () => {
    expect(computeOrdinalStale([f(true)], 2, 1)).toBe(true)
  })

  it('false — no baseline yet (initial fetch in flight)', () => {
    expect(computeOrdinalStale([f(true)], 2, null)).toBe(false)
  })

  it('false — nothing locked, even when the count diverged', () => {
    expect(computeOrdinalStale([f(false)], 5, 1)).toBe(false)
  })

  it('false — edge count unchanged since the baseline', () => {
    expect(computeOrdinalStale([f(true)], 3, 3)).toBe(false)
  })

  it('false — empty formation list', () => {
    expect(computeOrdinalStale([], 2, 1)).toBe(false)
  })
})

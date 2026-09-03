// L8 — the module-level proj4 memo caches must not outlive a project.
//
// The rule (production-readiness audit L8, 2026-09-02): the per-pair projection
// caches in this module grow with every distinct (epsg, x, y) a project's data
// touches. Across a session that opens several projects that growth is
// unbounded, so the project lifecycle clears them on close/open. Projection is
// pure, so clearing is a hygiene fix — never a correctness one — but the caches
// must actually empty when asked.

import { describe, expect, it, beforeEach } from 'vitest'

import {
  projectedToWgs84,
  wgs84ToProjected,
  clearProjectScopedCaches,
  __wgs84CacheSizesForTest,
} from './useWgs84'

beforeEach(() => {
  clearProjectScopedCaches()
})

describe('L8 — proj4 memo caches clear across projects', () => {
  it('holds cached projections while a project is open', () => {
    projectedToWgs84(150000, 200000, 31370)
    projectedToWgs84(155000, 463000, 28992)
    wgs84ToProjected(51, 4, 31370)
    const { to, from } = __wgs84CacheSizesForTest()
    expect(to).toBeGreaterThan(0)
    expect(from).toBeGreaterThan(0)
  })

  it('empties both caches when the project lifecycle clears them', () => {
    projectedToWgs84(150000, 200000, 31370)
    wgs84ToProjected(51, 4, 31370)
    clearProjectScopedCaches()
    const { to, from } = __wgs84CacheSizesForTest()
    expect(to).toBe(0)
    expect(from).toBe(0)
  })
})

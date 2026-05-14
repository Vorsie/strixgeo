// Unit tests for the snap-candidate helper shared between
// BoreholeColumn (click-to-place) and SectionPanel (drag-to-rePick
// via ContactsLayer). The two paths used to walk observations
// independently; extracting to ``collectSnapDepths`` removed the
// duplication. Dedup + filter behaviour is non-trivial enough to
// pin with explicit cases — debt #32 specifically called the dedup
// out as untested.

import { describe, expect, it } from 'vitest'

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import type { PlacedColumn } from './utils'
import {
  STRAT_OBS_TYPES_FOR_SNAP,
  buildFillPolygon,
  buildFloorFillPolygon,
  collectSnapDepths,
  columnsBetween,
} from './utils'

function placedAt(x: number, id: string): PlacedColumn {
  // Minimal PlacedColumn fixture — only ``trueX`` and ``proj.item.id``
  // matter for ``columnsBetween`` selection + ordering.
  return {
    kind: 'cpt',
    trueX: x,
    nudgedX: x,
    width: 20,
    displaced: false,
    proj: {
      item: { id } as any,
      along: x,
      offset: 0,
    } as any,
  } as PlacedColumn
}

function makeObs(
  observation_type: string,
  layerTopsBases: [number, number][],
): ObservationResponse {
  return {
    id: `obs-${observation_type}`,
    observation_type,
    author: null,
    observation_date: null,
    reliability: null,
    score_category: null,
    drill_method_score: null,
    layers: layerTopsBases.map(([top_m, base_m], i) => ({
      id: `${observation_type}-l${i}`,
      top_m,
      base_m,
      color: null,
      main_soil_codes: [],
      description: null,
      layer_index: i,
      admixtures: [],
    })),
  }
}

function makeDetail(observations: ObservationResponse[]): BoreholeDetailResponse {
  return {
    id: 'bh-1',
    name: 'BH-1',
    project_id: 'P',
    test_id: 'T',
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: 10,
    z_epsg: 5710,
    drill_method: null,
    borehole_type: null,
    total_depth_m: 30,
    start_date: null,
    n_drill_segments: 0,
    n_field_log_intervals: 0,
    drill_segments: [],
    field_log_intervals: [],
    observations,
    samples: [],
  } as unknown as BoreholeDetailResponse
}

describe('STRAT_OBS_TYPES_FOR_SNAP', () => {
  it('contains formal + informal stratigraphy only', () => {
    expect(STRAT_OBS_TYPES_FOR_SNAP.has('formal_stratigraphy')).toBe(true)
    expect(STRAT_OBS_TYPES_FOR_SNAP.has('informal_stratigraphy')).toBe(true)
    expect(STRAT_OBS_TYPES_FOR_SNAP.size).toBe(2)
  })

  it('does NOT contain lithology or quaternary streams (would change snap UX)', () => {
    // Smoke-test against regressions if someone extends the set
    // without updating the snap UX expectations.
    expect(STRAT_OBS_TYPES_FOR_SNAP.has('coded_lithology')).toBe(false)
    expect(STRAT_OBS_TYPES_FOR_SNAP.has('geotechnical_coding')).toBe(false)
    expect(STRAT_OBS_TYPES_FOR_SNAP.has('quaternary_stratigraphy')).toBe(false)
  })
})

describe('collectSnapDepths', () => {
  it('returns [] when no observations are present', () => {
    expect(collectSnapDepths(makeDetail([]))).toEqual([])
  })

  it('returns [] when no observation matches the snap-type set', () => {
    const detail = makeDetail([
      makeObs('coded_lithology', [[0, 2]]),
      makeObs('geotechnical_coding', [[0, 5]]),
    ])
    expect(collectSnapDepths(detail)).toEqual([])
  })

  it('emits layer top + base for each in-set observation', () => {
    const detail = makeDetail([
      makeObs('formal_stratigraphy', [[0, 5]]),
    ])
    expect(collectSnapDepths(detail).sort((a, b) => a - b)).toEqual([0, 5])
  })

  it('dedups depths shared between stacked layers (base of N = top of N+1)', () => {
    // Three stacked layers: [0,3] [3,7] [7,15]. Unique boundaries
    // are 0, 3, 7, 15 — four entries, not six.
    const detail = makeDetail([
      makeObs('formal_stratigraphy', [
        [0, 3],
        [3, 7],
        [7, 15],
      ]),
    ])
    const out = collectSnapDepths(detail).sort((a, b) => a - b)
    expect(out).toEqual([0, 3, 7, 15])
  })

  it('dedups depths shared across formal + informal streams', () => {
    // Formal picks 0/5, informal picks 0/5 — same boundaries. The
    // output is the deduped union: just [0, 5].
    const detail = makeDetail([
      makeObs('formal_stratigraphy', [[0, 5]]),
      makeObs('informal_stratigraphy', [[0, 5]]),
    ])
    expect(collectSnapDepths(detail).sort((a, b) => a - b)).toEqual([0, 5])
  })

  it('mixes formal + informal when their boundaries disagree', () => {
    // Formal: 0/5, informal: 0/3/5. Union: 0, 3, 5.
    const detail = makeDetail([
      makeObs('formal_stratigraphy', [[0, 5]]),
      makeObs('informal_stratigraphy', [
        [0, 3],
        [3, 5],
      ]),
    ])
    expect(collectSnapDepths(detail).sort((a, b) => a - b)).toEqual([0, 3, 5])
  })

  it('skips non-snap observation types even when interleaved with snap ones', () => {
    const detail = makeDetail([
      makeObs('coded_lithology', [[0, 100]]),
      makeObs('formal_stratigraphy', [[2, 4]]),
      makeObs('geotechnical_coding', [[5, 8]]),
    ])
    // Only the formal_stratigraphy [2, 4] should contribute.
    expect(collectSnapDepths(detail).sort((a, b) => a - b)).toEqual([2, 4])
  })
})

describe('columnsBetween — shift+drag paint-through gesture', () => {
  it('returns intermediates + target when dragging left-to-right', () => {
    const cols = [
      placedAt(0, 'A'),
      placedAt(20, 'B'),
      placedAt(40, 'C'),
      placedAt(60, 'D'),
      placedAt(80, 'E'),
      placedAt(100, 'F'),
    ]
    // Drag from A (0) to F (100) — B, C, D, E in between, F at the
    // drop. Source A excluded (it already carries the contact).
    const result = columnsBetween(0, 100, cols)
    expect(result.map(c => c.proj.item.id)).toEqual(['B', 'C', 'D', 'E', 'F'])
  })

  it('returns intermediates + target when dragging right-to-left', () => {
    const cols = [
      placedAt(0, 'A'),
      placedAt(20, 'B'),
      placedAt(40, 'C'),
      placedAt(60, 'D'),
    ]
    // Drag from D (60) leftward to A (0) — order follows source→target.
    const result = columnsBetween(60, 0, cols)
    expect(result.map(c => c.proj.item.id)).toEqual(['C', 'B', 'A'])
  })

  it('returns only the target when no columns sit between source and target', () => {
    const cols = [placedAt(0, 'A'), placedAt(20, 'B'), placedAt(80, 'F')]
    // A → B adjacent: nothing between them; B is the drop and is included.
    expect(columnsBetween(0, 20, cols).map(c => c.proj.item.id)).toEqual(['B'])
  })

  it('excludes the source even when float drift would put it inside the band', () => {
    // sourceX comes from drag-start cached position; a column whose
    // trueX equals sourceX is the source itself. EPS guards against
    // float drift re-including it.
    const cols = [placedAt(0.00001, 'A'), placedAt(50, 'B'), placedAt(100, 'F')]
    expect(columnsBetween(0, 100, cols).map(c => c.proj.item.id)).toEqual(['B', 'F'])
  })
})

describe('buildFillPolygon — colored band between two formation tops', () => {
  it('returns a closed M..Z path covering the X overlap', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const bottom = [
      { x: 0, y: 20 },
      { x: 100, y: 22 },
    ]
    const d = buildFillPolygon(top, bottom)
    // Forward along top, reversed along bottom, closes with Z.
    // Path starts at (0, 10), traverses to (100, 12), drops to
    // bottom at (100, 22), reverses to (0, 20), closes.
    expect(d.startsWith('M 0.00 10.00')).toBe(true)
    expect(d).toContain('L 100.00 12.00')
    expect(d).toContain('L 100.00 22.00')
    expect(d).toContain('L 0.00 20.00')
    expect(d.trimEnd().endsWith('Z')).toBe(true)
  })

  it('returns empty string when polylines do not overlap in X', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 50, y: 11 },
    ]
    const bottom = [
      { x: 100, y: 20 },
      { x: 200, y: 22 },
    ]
    expect(buildFillPolygon(top, bottom)).toBe('')
  })

  it('clips to the overlapping X range when domains differ', () => {
    // top spans 0..100, bottom spans 30..150. Overlap = 30..100.
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const bottom = [
      { x: 30, y: 20 },
      { x: 150, y: 24 },
    ]
    const d = buildFillPolygon(top, bottom)
    expect(d.startsWith('M 30.00')).toBe(true)
    // The clipped top at x=30: interpolated linearly (0,10)→(100,12)
    // gives y = 10 + 0.3 * (12-10) = 10.6.
    expect(d).toContain('M 30.00 10.60')
    // The polygon ends along the bottom; should NOT extend past
    // x=100 (top's right edge).
    expect(d).not.toContain('L 150.00')
  })

  it('returns empty string when either polyline is empty', () => {
    expect(buildFillPolygon([], [{ x: 0, y: 0 }])).toBe('')
    expect(buildFillPolygon([{ x: 0, y: 0 }], [])).toBe('')
  })
})

describe('buildFloorFillPolygon — oldest formation extends down to plotBottom', () => {
  it('closes the polygon at the section floor', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const d = buildFloorFillPolygon(top, 50)
    expect(d.startsWith('M 0.00 10.00')).toBe(true)
    expect(d).toContain('L 100.00 12.00')
    // Bottom edge runs along plotBottom (50) from right to left.
    expect(d).toContain('L 100.00 50.00')
    expect(d).toContain('L 0.00 50.00')
    expect(d.trimEnd().endsWith('Z')).toBe(true)
  })

  it('returns empty for an empty top polyline', () => {
    expect(buildFloorFillPolygon([], 50)).toBe('')
  })
})

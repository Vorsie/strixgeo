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
  buildFillBand,
  collectSnapDepths,
  columnsBetween,
  depthAxisAtSurface,
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

describe('buildFillBand — coloured band with pinch-out + floor handling', () => {
  it('builds a closed band between top and the single older polyline', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const older = [
      { x: 0, y: 20 },
      { x: 100, y: 22 },
    ]
    const d = buildFillBand(top, [older], /* floor */ 999)
    expect(d.startsWith('M 0.00 10.00')).toBe(true)
    expect(d).toContain('L 100.00 12.00')
    // Bottom edge uses the older's interpolated Y, not the floor —
    // older covers the whole top range.
    expect(d).toContain('L 100.00 22.00')
    expect(d).toContain('L 0.00 20.00')
    expect(d).not.toContain('999')
    expect(d.trimEnd().endsWith('Z')).toBe(true)
  })

  it('falls through to next-older when immediate-next pinches out', () => {
    // top spans 0..100; KoAa (immediate next) only exists 0..50;
    // KoRo (next-next) covers 0..100. Band's bottom should follow
    // KoAa where it's defined, then drop to KoRo where KoAa is absent.
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const koaa = [
      { x: 0, y: 18 },
      { x: 50, y: 19 },
    ]
    const koro = [
      { x: 0, y: 25 },
      { x: 100, y: 27 },
    ]
    const d = buildFillBand(top, [koaa, koro], 999)
    // At x=50 (KoAa's edge), bottom = KoAa's y (19).
    expect(d).toContain('L 50.00 19.00')
    // At x=100 (KoAa absent), bottom = KoRo's interpolated y (27).
    expect(d).toContain('L 100.00 27.00')
    // Floor is never reached here — both olders cover x=100.
    expect(d).not.toContain('999')
  })

  it('drops to the floor when no older covers an X position', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    // Single older covers only the left half — pinches out by x=50.
    const older = [
      { x: 0, y: 20 },
      { x: 40, y: 22 },
    ]
    const d = buildFillBand(top, [older], /* floor */ 80)
    // Where older is defined (x=0, x=40), bottom = older's y.
    expect(d).toContain('L 40.00 22.00')
    // Where older is absent (x=100), bottom = floor.
    expect(d).toContain('L 100.00 80.00')
  })

  it('uses the floor everywhere when olders is empty (oldest formation)', () => {
    const top = [
      { x: 0, y: 10 },
      { x: 100, y: 12 },
    ]
    const d = buildFillBand(top, [], /* floor */ 50)
    expect(d.startsWith('M 0.00 10.00')).toBe(true)
    expect(d).toContain('L 100.00 12.00')
    expect(d).toContain('L 100.00 50.00')
    expect(d).toContain('L 0.00 50.00')
    expect(d.trimEnd().endsWith('Z')).toBe(true)
  })

  it('returns empty string when the top polyline is empty', () => {
    expect(buildFillBand([], [[{ x: 0, y: 0 }]], 50)).toBe('')
  })
})

describe('depthAxisAtSurface — #168 shared depth↔screen axis', () => {
  // A flipped section transform: deeper level → larger screen Y.
  // levelToScreen(level) = top + (effLevelMax - level) * scaleV.
  const top = 20
  const scaleV = 8 // px per metre
  const effLevelMax = 10
  const levelToScreen = (level: number): number => top + (effLevelMax - level) * scaleV

  it('DA1 — surfaceY + pxPerMetreDown match the hand-rolled sites', () => {
    const surfaceElevationM = 5
    const axis = depthAxisAtSurface(levelToScreen, surfaceElevationM)
    expect(axis.surfaceY).toBe(levelToScreen(surfaceElevationM))
    // Identical to the old oneMetreDownPx = levelToScreen(s-1) - levelToScreen(s).
    expect(axis.pxPerMetreDown).toBe(
      levelToScreen(surfaceElevationM - 1) - levelToScreen(surfaceElevationM),
    )
    expect(axis.pxPerMetreDown).toBe(scaleV)
  })

  it('DA2 — depthAtY is the inverse of yAtDepth', () => {
    const axis = depthAxisAtSurface(levelToScreen, 5)
    for (const depth of [0, 2.5, 9]) {
      expect(axis.depthAtY(axis.yAtDepth(depth))).toBeCloseTo(depth, 6)
    }
    // depth 0 maps to the surface Y.
    expect(axis.yAtDepth(0)).toBe(axis.surfaceY)
  })

  it('DA3 — degenerate axis (zero rate) returns depth 0 instead of dividing by zero', () => {
    const axis = depthAxisAtSurface(() => 42, 5)
    expect(axis.pxPerMetreDown).toBe(0)
    expect(axis.depthAtY(100)).toBe(0)
  })
})

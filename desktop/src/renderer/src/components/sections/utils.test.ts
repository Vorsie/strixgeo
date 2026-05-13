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
import { STRAT_OBS_TYPES_FOR_SNAP, collectSnapDepths } from './utils'

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

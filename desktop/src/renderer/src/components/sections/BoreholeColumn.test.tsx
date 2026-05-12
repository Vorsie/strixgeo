// Smoke + behaviour tests for BoreholeColumn — the narrow lithology
// strip that renders inside each borehole's column band on the
// cross-section. The full borelog detail panel (BoreholeLog.tsx) is
// covered separately; these tests focus on the section-friendly
// reduction: layers in, patterned rects out, depth clipping holds.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import BoreholeColumn from './BoreholeColumn'

// Flipped levelToScreen: deeper points render further down. With
// surfaceElevationM=10 and a 5 m layer this puts the bottom at Y=15.
const flipped = (level: number): number => 20 - level

function makeLayer(overrides: {
  id: string
  top_m: number
  base_m: number
  main_soil_codes?: string[]
}): BoreholeDetailResponse['observations'][number]['layers'][number] {
  return {
    id: overrides.id,
    top_m: overrides.top_m,
    base_m: overrides.base_m,
    color: null,
    main_soil_codes: overrides.main_soil_codes ?? ['FZ'],
    description: null,
    layer_index: 0,
    admixtures: [],
  }
}

function makeObservation(
  observation_type: string,
  layers: BoreholeDetailResponse['observations'][number]['layers'],
): ObservationResponse {
  return {
    id: `obs-${observation_type}`,
    observation_type,
    author: null,
    observation_date: null,
    reliability: null,
    score_category: null,
    drill_method_score: null,
    layers,
  }
}

function makeDetail(observations: ObservationResponse[]): BoreholeDetailResponse {
  // BoreholeColumn only reads ``observations`` — the rest of the
  // detail tree can be empty for these tests.
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
    total_depth_m: 10,
    start_date: null,
    n_drill_segments: 0,
    n_field_log_intervals: 0,
    drill_segments: [],
    field_log_intervals: [],
    observations,
    samples: [],
  } as unknown as BoreholeDetailResponse
}

function renderColumn(detail: BoreholeDetailResponse) {
  return render(
    <svg>
      <BoreholeColumn
        detail={detail}
        screenX={100}
        halfWidth={20}
        surfaceElevationM={10}
        plotTop={0}
        plotBottom={50}
        levelToScreen={flipped}
      />
    </svg>,
  )
}

describe('BoreholeColumn — lithology rendering', () => {
  it('renders one rect per layer of the first coded_lithology observation', () => {
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 2, main_soil_codes: ['FZ'] }),
        makeLayer({ id: 'l2', top_m: 2, base_m: 5, main_soil_codes: ['KL'] }),
      ]),
    ])
    const { container } = renderColumn(detail)
    expect(container.querySelectorAll('rect').length).toBe(2)
  })

  it('falls back to geotechnical_coding when coded_lithology is absent', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 1 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    expect(container.querySelectorAll('rect').length).toBe(1)
  })

  it('renders nothing when no lithology observation exists', () => {
    const detail = makeDetail([
      makeObservation('formal_stratigraphy', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 1 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    expect(container.querySelectorAll('rect').length).toBe(0)
  })

  it('uses the DOV soil pattern URL as the fill for known codes', () => {
    // Pattern ids follow ``soil-${code}`` — KL = clay → ``url(#soil-KL)``.
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 1, main_soil_codes: ['KL'] }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('url(#soil-KL)')
  })

  it('places the rect band centered on screenX', () => {
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 1 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rect = container.querySelector('rect')
    // halfWidth=20, screenX=100 → band sits at x=80, width=40.
    expect(rect?.getAttribute('x')).toBe('80')
    expect(rect?.getAttribute('width')).toBe('40')
  })

  it('clips a layer that extends past plotBottom', () => {
    // surfaceElevation=10, layer 0..30 m. levelToScreen flips with
    // base at 20-10 = 10 (top of layer at surface) down to 20-(-20)
    // = 40 (10 m deep)... wait — layer at depth d is at level
    // surfaceElevation - d = 10 - 30 = -20 → Y=40. So Y range is
    // [10, 40]. plotBottom=50 → no clipping triggered.
    //
    // Bump the layer base further to push past plotBottom (=50):
    // depth 30 m → level=-20 → Y=40. Still inside. Need depth that
    // gives Y > 50: 20 - (10 - depth) > 50 → 10 + depth > 50 →
    // depth > 40.
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 60 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('y')).toBe('10')
    // Height clamped to plotBottom - clampedTop = 50 - 10 = 40.
    expect(rect?.getAttribute('height')).toBe('40')
  })

  it('drops a layer that lives entirely outside the plot area', () => {
    // Layer from depth 100 to 110 → levels -90 to -100 → Y 110-120.
    // Both clamp to plotBottom=50 → height=0 → null.
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'shallow', top_m: 0, base_m: 1 }),
        makeLayer({ id: 'too-deep', top_m: 100, base_m: 110 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    expect(container.querySelectorAll('rect').length).toBe(1)
  })
})

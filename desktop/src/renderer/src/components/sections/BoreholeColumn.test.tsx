// Behaviour tests for BoreholeColumn — the N-strip lithology block
// that renders inside each borehole's column band on the
// cross-section. Each enabled interpretation channel gets its own
// vertical strip (DOV "lengteprofiel" page-3 convention).

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type {
  BoreholeDetailResponse,
  ObservationResponse,
} from '../../api/client'
import BoreholeColumn from './BoreholeColumn'
import {
  DEFAULT_BOREHOLE_CHANNELS,
  type BoreholeChannels,
} from './cptChannels'

// Flipped levelToScreen: deeper points render further down. With
// surface=10 and a 5 m layer this puts the bottom at Y=15.
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

function renderColumn(
  detail: BoreholeDetailResponse,
  channels: Partial<BoreholeChannels> = {},
) {
  return render(
    <svg>
      <BoreholeColumn
        detail={detail}
        channels={{ ...DEFAULT_BOREHOLE_CHANNELS, ...channels }}
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

describe('BoreholeColumn — N-strip rendering', () => {
  it('renders one strip when only geotech is on (the default)', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 2 }),
        makeLayer({ id: 'l2', top_m: 2, base_m: 5 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    // Two layer rects from the single geotech observation.
    expect(container.querySelectorAll('rect').length).toBe(2)
  })

  it('renders three strips side by side when lithology + geotech + formal are on', () => {
    const detail = makeDetail([
      makeObservation('coded_lithology', [makeLayer({ id: 'a', top_m: 0, base_m: 1 })]),
      makeObservation('geotechnical_coding', [makeLayer({ id: 'b', top_m: 0, base_m: 1 })]),
      makeObservation('formal_stratigraphy', [makeLayer({ id: 'c', top_m: 0, base_m: 1 })]),
    ])
    const { container } = renderColumn(detail, {
      lithology: true,
      geotech: true,
      formal_strat: true,
    })
    const rects = Array.from(container.querySelectorAll('rect'))
    expect(rects.length).toBe(3)
    // Strip width = 2 * halfWidth = 40; left edges at 40, 80, 120 for
    // a 3-strip band centred on screenX=100 (band extends [40, 160]).
    const xs = rects.map(r => Number(r.getAttribute('x'))).sort((a, b) => a - b)
    expect(xs).toEqual([40, 80, 120])
  })

  it('renders nothing when no channel is enabled', () => {
    const detail = makeDetail([
      makeObservation('coded_lithology', [makeLayer({ id: 'l1', top_m: 0, base_m: 1 })]),
    ])
    const { container } = renderColumn(detail, {
      lithology: false,
      geotech: false,
      formal_strat: false,
      quaternary: false,
    })
    expect(container.querySelectorAll('rect').length).toBe(0)
  })

  it('uses the DOV soil pattern URL as the fill for known codes', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 1, main_soil_codes: ['KL'] }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('fill')).toBe('url(#soil-KL)')
  })

  it('clips a layer that extends past plotBottom', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'l1', top_m: 0, base_m: 60 }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rect = container.querySelector('rect')
    expect(rect?.getAttribute('y')).toBe('10')
    expect(rect?.getAttribute('height')).toBe('40')
  })

  it('keeps slot positions stable when a borehole is missing the enabled stream', () => {
    // Enabling lithology + geotech, but the borehole only has the
    // geotech observation. The lithology slot stays in its place
    // (slot index 0); the geotech strip sits in slot 1 at the
    // expected X. This is the consistency-of-layout contract.
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'g1', top_m: 0, base_m: 1 }),
      ]),
    ])
    const { container } = renderColumn(detail, {
      lithology: true,
      geotech: true,
    })
    // Only the geotech strip has content (one layer rect). The
    // lithology slot is empty (zero-height background rect).
    const layerRects = Array.from(container.querySelectorAll('rect')).filter(
      r => Number(r.getAttribute('height')) > 0,
    )
    expect(layerRects.length).toBe(1)
    // Band centred on screenX=100, strip width=40, so band spans
    // [60, 140]. geotech is slot index 1 → x = 60 + 1*40 = 100.
    expect(layerRects[0].getAttribute('x')).toBe('100')
  })
})

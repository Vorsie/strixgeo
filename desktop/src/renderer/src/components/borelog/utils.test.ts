import { describe, expect, it } from 'vitest'

import { t } from '../../i18n/translate'
import type { BoreholeDetailResponse } from '../../api/client'
import {
  DRILL_TRACK_WIDTH,
  FIELD_LOG_TRACK_WIDTH,
  HEADER_HEIGHT,
  M_TAW_AXIS_WIDTH,
  OBS_TRACK_WIDTH_LITHOLOGY,
  OBS_TRACK_WIDTH_STRATIGRAPHY,
  SAMPLES_TRACK_WIDTH,
  SVG_X_PAD,
  SVG_Y_PAD,
  TRACK_GAP,
} from './constants'
import {
  computeLayout,
  formatMtaw,
  humanizeObservationType,
  pctForAmount,
  roundTo,
  truncate,
  widthForObservationType,
} from './utils'

function makeBorehole(
  partial: Partial<BoreholeDetailResponse> = {},
): BoreholeDetailResponse {
  return {
    id: 'b1',
    name: 'BH-001',
    project_id: 'p1',
    app_project_id: 'ap1',
    test_id: 'BH-001',
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: null,
    z_epsg: null,
    total_depth_m: 0,
    start_date: null,
    executor: null,
    water_table_depth_m: null,
    drill_method: null,
    drill_segments: [],
    field_log_intervals: [],
    observations: [],
    samples: [],
    ...partial,
  } as BoreholeDetailResponse
}

describe('humanizeObservationType', () => {
  it('translates known tokens to English titles', () => {
    expect(humanizeObservationType(t, 'coded_lithology')).toBe('Coded lithology')
    expect(humanizeObservationType(t, 'formal_stratigraphy')).toBe(
      'Formal stratigraphy',
    )
    expect(
      humanizeObservationType(t, 'informal_hydrogeological_stratigraphy'),
    ).toBe('Informal hydrogeological stratigraphy')
  })

  it('passes unknown tokens through verbatim', () => {
    expect(humanizeObservationType(t, 'something_new')).toBe('something_new')
  })
})

describe('truncate', () => {
  it('returns the input when short enough', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('appends an ellipsis when truncated', () => {
    expect(truncate('abcdefghij', 5)).toBe('abcd…')
  })
})

describe('roundTo', () => {
  it('rounds to the requested decimals', () => {
    expect(roundTo(1.2345, 2)).toBe(1.23)
    expect(roundTo(1.2355, 2)).toBe(1.24)
  })

  it('handles zero decimals + negative inputs', () => {
    expect(roundTo(2.7, 0)).toBe(3)
    expect(roundTo(-1.45, 1)).toBe(-1.4)
  })
})

describe('pctForAmount', () => {
  it('returns 15 for "veel" variants', () => {
    expect(pctForAmount('veel')).toBe(15)
    expect(pctForAmount('Veel klei')).toBe(15)
  })

  it('returns 10 for "matig" variants', () => {
    expect(pctForAmount('matig')).toBe(10)
    expect(pctForAmount('Matig grof')).toBe(10)
  })

  it('returns 5 for "weinig", missing, or unknown amount', () => {
    expect(pctForAmount('weinig')).toBe(5)
    expect(pctForAmount(null)).toBe(5)
    expect(pctForAmount(undefined)).toBe(5)
    expect(pctForAmount('iets onbekends')).toBe(5)
  })
})

describe('formatMtaw', () => {
  it('signs positive levels with a leading +', () => {
    expect(formatMtaw(12.345)).toBe('+12.35')
    expect(formatMtaw(0)).toBe('+0.00')
  })

  it('renders negative levels with the native minus', () => {
    expect(formatMtaw(-3.5)).toBe('-3.50')
  })
})

describe('widthForObservationType', () => {
  it('returns the narrow track for stratigraphy types', () => {
    expect(widthForObservationType('formal_stratigraphy')).toBe(
      OBS_TRACK_WIDTH_STRATIGRAPHY,
    )
    expect(widthForObservationType('hydrogeological_stratigraphy')).toBe(
      OBS_TRACK_WIDTH_STRATIGRAPHY,
    )
  })

  it('returns the wide track for lithology + description types', () => {
    expect(widthForObservationType('coded_lithology')).toBe(
      OBS_TRACK_WIDTH_LITHOLOGY,
    )
    expect(widthForObservationType('lithological_description')).toBe(
      OBS_TRACK_WIDTH_LITHOLOGY,
    )
  })
})

describe('computeLayout', () => {
  it('reserves the mTAW axis even when no extras are present', () => {
    const layout = computeLayout(makeBorehole({ total_depth_m: 5 }), 60)
    expect(layout.canvasLeft).toBe(SVG_X_PAD + M_TAW_AXIS_WIDTH + TRACK_GAP)
    expect(layout.canvasHeight).toBe(5 * 60)
    expect(layout.totalHeight).toBe(
      SVG_Y_PAD + HEADER_HEIGHT + 5 * 60 + SVG_Y_PAD,
    )
  })

  it('orders observation tracks by canonical type sequence', () => {
    const layout = computeLayout(
      makeBorehole({
        total_depth_m: 1,
        observations: [
          {
            id: 'o2',
            observation_type: 'formal_stratigraphy',
            layers: [{ id: 'l1', top_m: 0, base_m: 1 } as never],
          } as never,
          {
            id: 'o1',
            observation_type: 'coded_lithology',
            layers: [{ id: 'l2', top_m: 0, base_m: 1 } as never],
          } as never,
        ],
      }),
      60,
    )
    expect(layout.observationTracks.map(t => t.observation.observation_type)).toEqual([
      'coded_lithology',
      'formal_stratigraphy',
    ])
    // First track gets the wider width.
    expect(layout.observationTracks[0].width).toBe(OBS_TRACK_WIDTH_LITHOLOGY)
    expect(layout.observationTracks[1].width).toBe(OBS_TRACK_WIDTH_STRATIGRAPHY)
  })

  it('skips observation tracks with no layers', () => {
    const layout = computeLayout(
      makeBorehole({
        total_depth_m: 1,
        observations: [
          {
            id: 'o1',
            observation_type: 'coded_lithology',
            layers: [],
          } as never,
        ],
      }),
      60,
    )
    expect(layout.observationTracks).toEqual([])
  })

  it('reserves drill / field-log / samples tracks when present', () => {
    const layout = computeLayout(
      makeBorehole({
        total_depth_m: 2,
        drill_segments: [{ id: 'd1', top_m: 0, base_m: 1, method: 'auger' } as never],
        field_log_intervals: [{ id: 'f1', top_m: 0, base_m: 1 } as never],
        samples: [{ id: 's1', depth_top_m: 0, depth_base_m: 1 } as never],
      }),
      60,
    )
    expect(layout.drillMethodX).not.toBeNull()
    expect(layout.fieldLogX).not.toBeNull()
    expect(layout.samplesX).not.toBeNull()
    // Sanity: cumulative widths advance left-to-right.
    expect(layout.drillMethodX!).toBeLessThan(layout.fieldLogX!)
    expect(layout.fieldLogX!).toBeLessThan(layout.samplesX!)
    expect(layout.samplesX! + SAMPLES_TRACK_WIDTH).toBe(layout.canvasRight)
    // Each optional track contributes its width + gap.
    expect(layout.canvasRight - layout.canvasLeft).toBe(
      DRILL_TRACK_WIDTH + TRACK_GAP + FIELD_LOG_TRACK_WIDTH + TRACK_GAP + SAMPLES_TRACK_WIDTH,
    )
  })

  it('uses the deepest base across header, layers, segments and samples', () => {
    const layout = computeLayout(
      makeBorehole({
        total_depth_m: 1,
        observations: [
          {
            id: 'o1',
            observation_type: 'coded_lithology',
            layers: [{ id: 'l1', top_m: 0, base_m: 4 } as never],
          } as never,
        ],
        drill_segments: [{ id: 'd1', top_m: 0, base_m: 7, method: null } as never],
        samples: [{ id: 's1', depth_top_m: 0, depth_base_m: 9 } as never],
      }),
      10,
    )
    expect(layout.totalDepth).toBe(9)
    expect(layout.canvasHeight).toBe(90)
  })

  // ------------------------------------------------------------------
  // Hidden-tracks support — hiddenTracks param filters tracks from
  // the layout so no gap is left behind and total width recomputes.
  // ------------------------------------------------------------------

  it('excludes a hidden observation track from the layout', () => {
    const layoutAll = computeLayout(
      makeBorehole({
        total_depth_m: 1,
        observations: [
          {
            id: 'o1',
            observation_type: 'coded_lithology',
            layers: [{ id: 'l1', top_m: 0, base_m: 1 } as never],
          } as never,
          {
            id: 'o2',
            observation_type: 'formal_stratigraphy',
            layers: [{ id: 'l2', top_m: 0, base_m: 1 } as never],
          } as never,
        ],
      }),
      60,
    )
    const layoutHidden = computeLayout(
      makeBorehole({
        total_depth_m: 1,
        observations: [
          {
            id: 'o1',
            observation_type: 'coded_lithology',
            layers: [{ id: 'l1', top_m: 0, base_m: 1 } as never],
          } as never,
          {
            id: 'o2',
            observation_type: 'formal_stratigraphy',
            layers: [{ id: 'l2', top_m: 0, base_m: 1 } as never],
          } as never,
        ],
      }),
      60,
      new Set(['formal_stratigraphy'] as const),
    )
    // One less track → totalWidth narrows by stratigraphy track width + gap.
    expect(layoutHidden.totalWidth).toBe(
      layoutAll.totalWidth - (OBS_TRACK_WIDTH_STRATIGRAPHY + TRACK_GAP),
    )
    expect(layoutHidden.observationTracks.map(t => t.observation.observation_type)).toEqual([
      'coded_lithology',
    ])
  })

  it('excludes a hidden drill-method track from the layout', () => {
    const borehole = makeBorehole({
      total_depth_m: 2,
      drill_segments: [{ id: 'd1', top_m: 0, base_m: 2, method: 'auger' } as never],
    })
    const layoutVisible = computeLayout(borehole, 60)
    const layoutHidden = computeLayout(borehole, 60, new Set(['drill_method'] as const))

    expect(layoutVisible.drillMethodX).not.toBeNull()
    expect(layoutHidden.drillMethodX).toBeNull()
    expect(layoutHidden.totalWidth).toBe(
      layoutVisible.totalWidth - (DRILL_TRACK_WIDTH + TRACK_GAP),
    )
  })

  it('excludes a hidden field-log track from the layout', () => {
    const borehole = makeBorehole({
      total_depth_m: 2,
      field_log_intervals: [{ id: 'f1', top_m: 0, base_m: 2 } as never],
    })
    const layoutVisible = computeLayout(borehole, 60)
    const layoutHidden = computeLayout(borehole, 60, new Set(['field_log'] as const))

    expect(layoutVisible.fieldLogX).not.toBeNull()
    expect(layoutHidden.fieldLogX).toBeNull()
    expect(layoutHidden.totalWidth).toBe(
      layoutVisible.totalWidth - (FIELD_LOG_TRACK_WIDTH + TRACK_GAP),
    )
  })

  it('excludes a hidden samples track from the layout', () => {
    const borehole = makeBorehole({
      total_depth_m: 2,
      samples: [{ id: 's1', depth_top_m: 0, depth_base_m: 2 } as never],
    })
    const layoutVisible = computeLayout(borehole, 60)
    const layoutHidden = computeLayout(borehole, 60, new Set(['samples_lab'] as const))

    expect(layoutVisible.samplesX).not.toBeNull()
    expect(layoutHidden.samplesX).toBeNull()
    expect(layoutHidden.totalWidth).toBe(
      layoutVisible.totalWidth - (SAMPLES_TRACK_WIDTH + TRACK_GAP),
    )
  })

  it('defaults to showing all tracks when hiddenTracks is omitted', () => {
    // Backward-compat: existing call sites that don't pass hiddenTracks
    // still work correctly.
    const borehole = makeBorehole({
      total_depth_m: 2,
      drill_segments: [{ id: 'd1', top_m: 0, base_m: 2, method: 'auger' } as never],
    })
    const layoutImplicit = computeLayout(borehole, 60)
    const layoutExplicit = computeLayout(borehole, 60, new Set())
    expect(layoutImplicit.drillMethodX).toBe(layoutExplicit.drillMethodX)
    expect(layoutImplicit.totalWidth).toBe(layoutExplicit.totalWidth)
  })
})

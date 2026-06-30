// Render smoke tests for SampleGeotechOverlay.
//
// SGO1 — renders nothing when boreholeDetails is null (loading state)
// SGO2 — renders one dot per sample that has a geotech_body_id
// SGO3 — skips samples whose geotech_body_id is null
// SGO4 — skips columns not present in boreholeDetails
// SGO5 — selected body id highlights the matching dot (amber fill)
// SGO6 — dots outside [plotTop, plotBottom] are clipped (not rendered)
// SGO7 — clicking a dot calls toggleGeotechBodySelection with the body id

import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SampleGeotechOverlay from './SampleGeotechOverlay'
import type { BoreholeDetailResponse, SampleResponse } from '../../api/client'
import type { BoreholePlacedColumn } from './utils'
import { selectGeotechBody } from '../../utils/geotechBodySelectionStore'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('../../utils/geotechBodySelectionStore', async () => {
  const actual = await vi.importActual<
    typeof import('../../utils/geotechBodySelectionStore')
  >('../../utils/geotechBodySelectionStore')
  return {
    ...actual,
    toggleGeotechBodySelection: vi.fn(),
  }
})

import { toggleGeotechBodySelection } from '../../utils/geotechBodySelectionStore'
const mockToggle = toggleGeotechBodySelection as ReturnType<typeof vi.fn>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const identity = (x: number): number => x

function makeBoreholePlacedColumn(
  id: string,
  along: number,
  elevationM: number | null = 5,
): BoreholePlacedColumn {
  return {
    kind: 'borehole',
    trueX: along,
    nudgedX: along,
    width: 20,
    displaced: false,
    proj: {
      along,
      offset: 0,
      item: {
        id,
        name: id,
        test_id: id,
        location_x: 0,
        location_y: 0,
        epsg: 31370,
        elevation_m: elevationM,
        z_epsg: null,
        elevation_source: 'none',
        drill_method: null,
        borehole_type: null,
        total_depth_m: null,
        start_date: null,
        n_drill_segments: null,
        n_field_log_intervals: null,
      },
    },
  }
}

function makeSample(
  id: string,
  geotechBodyId: string | null = 'body-1',
): SampleResponse {
  return {
    id,
    depth_top_m: 1,
    depth_base_m: 3,
    description: '',
    sample_number: null,
    sample_type: null,
    composition: null,
    instrument: null,
    sampling_date: null,
    geotech_body_id: geotechBodyId,
    geotech_nad_class: geotechBodyId ? 15 : null,
    geotech_assignment_source: geotechBodyId ? 'cpt_interpolated' : null,
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
  }
}

function makeBoreholeDetail(
  id: string,
  samples: SampleResponse[],
): BoreholeDetailResponse {
  return {
    id,
    name: id,
    test_id: id,
    project_id: 'proj-1',
    app_project_id: 'proj-1',
    location_x: 0,
    location_y: 0,
    epsg: 31370,
    elevation_m: 5,
    z_epsg: null,
    elevation_source: 'none',
    drill_method: null,
    borehole_type: null,
    total_depth_m: null,
    start_date: null,
    drill_segments: [],
    field_log_intervals: [],
    observations: [],
    samples,
  } as unknown as BoreholeDetailResponse
}

// Wide open plot bounds for most tests — only SGO6 uses narrow bounds.
const PLOT_TOP = 0
const PLOT_BOTTOM = 9999

function renderOverlay(
  columns: BoreholePlacedColumn[],
  details: Map<string, BoreholeDetailResponse> | null,
) {
  return render(
    <svg>
      <SampleGeotechOverlay
        boreholePlacedColumns={columns}
        boreholeDetails={details}
        warpedXToScreen={identity}
        levelToScreen={identity}
        plotTop={PLOT_TOP}
        plotBottom={PLOT_BOTTOM}
      />
    </svg>,
  )
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockToggle.mockReset()
  // Reset selection store to null before each test (null = deselect).
  selectGeotechBody(null)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SampleGeotechOverlay', () => {
  it('SGO1 — renders a loading group and no dots when boreholeDetails is null', () => {
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], null)
    expect(screen.getByTestId('sample-geotech-overlay-loading')).toBeDefined()
    expect(screen.queryByTestId(/^sample-dot-/)).toBeNull()
  })

  it('SGO2 — renders one dot per sample that has a geotech_body_id', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const sample1 = makeSample('s-1', 'body-1')
    const sample2 = makeSample('s-2', 'body-2')
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [sample1, sample2])]])

    renderOverlay([col], details)

    expect(screen.getByTestId('sample-dot-s-1')).toBeDefined()
    expect(screen.getByTestId('sample-dot-s-2')).toBeDefined()
  })

  it('SGO3 — skips samples whose geotech_body_id is null', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const withBody = makeSample('s-1', 'body-1')
    const withoutBody = makeSample('s-no-body', null)
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [withBody, withoutBody])]])

    renderOverlay([col], details)

    expect(screen.getByTestId('sample-dot-s-1')).toBeDefined()
    expect(screen.queryByTestId('sample-dot-s-no-body')).toBeNull()
  })

  it('SGO4 — skips columns with no entry in boreholeDetails', () => {
    const col = makeBoreholePlacedColumn('bh-absent', 50)
    const details = new Map<string, BoreholeDetailResponse>()

    renderOverlay([col], details)

    expect(screen.queryByTestId(/^sample-dot-/)).toBeNull()
  })

  it('SGO5 — selected body id gives the matching dot the amber fill colour', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const sample = makeSample('s-1', 'body-selected')
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [sample])]])

    // Select the body before render.
    selectGeotechBody({ bodyId: 'body-selected', assignmentSource: null })
    renderOverlay([col], details)

    const dot = screen.getByTestId('sample-dot-s-1')
    // The selected colour is amber-500 (#f59e0b).
    expect(dot.getAttribute('fill')).toBe('#f59e0b')
  })

  it('SGO6 — dots outside [plotTop, plotBottom] are not rendered', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50, 5)
    // depth_top = 1, depth_base = 3 → mid = 2 → elevation = 5 - 2 = 3
    // levelToScreen(3) = 3 → BELOW plotTop(10) → clipped
    const sample = makeSample('s-clip', 'body-1')
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [sample])]])

    // plotTop = 10, plotBottom = 500; sample's Y = 3 < plotTop → clipped
    render(
      <svg>
        <SampleGeotechOverlay
          boreholePlacedColumns={[col]}
          boreholeDetails={details}
          warpedXToScreen={identity}
          levelToScreen={identity}
          plotTop={10}
          plotBottom={500}
        />
      </svg>,
    )

    expect(screen.queryByTestId('sample-dot-s-clip')).toBeNull()
  })

  it('SGO7 — clicking a dot fires toggleGeotechBodySelection with the body id', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const sample = makeSample('s-1', 'body-click')
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [sample])]])

    renderOverlay([col], details)

    const dot = screen.getByTestId('sample-dot-s-1')
    fireEvent.click(dot)

    expect(mockToggle).toHaveBeenCalledWith('body-click', 'cpt_interpolated')
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })
})

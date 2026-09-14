// Behaviour tests for the lab-sample markers on the cross-section.
//
// Owner's words: "Replace the mid-depth dots with extent markers: a vertical
// capsule/bar spanning depth_top_m→depth_base_m at the exact depths ... render
// ALL samples, not only those with a geotech body — a body-less sample gets a
// neutral variant of the marker and its click is a no-op ... the overlay
// renders on the LITHO axis too (body-click stays geotech-only)."
//
//   SGO1   nothing drawn while the borehole details are still loading
//   SGO2   a sample draws a bar spanning its OWN top and base depths, not a
//          dot at its middle
//   SGO3   a spot sample (top == base) still draws, at the minimum height
//   SGO4   a sample with no packing body still draws, in the neutral colour
//   SGO5   clicking a sample with no packing body does nothing
//   SGO6   a column with no detail loaded draws nothing
//   SGO7   the selected body's marker goes amber and wider
//   SGO8   a marker entirely outside the plot area is not drawn; one that runs
//          off the edge is trimmed at the edge rather than dropped
//   SGO9   clicking a sample's marker toggles its packing body
//   SGO10  Enter on a sample's marker toggles its packing body
//   SGO11  on the litho axis, where body-click is off, clicking does nothing
//   SGO12  the hit target is at least 24 px in both directions (WCAG 2.5.8)
//   SGO13  hovering a marker reports the sample; leaving reports nothing

import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import SampleGeotechOverlay from './SampleGeotechOverlay'
import { setPsdPreviewOn } from '../../utils/psdPreviewOnStore'
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
/** Real-shaped vertical transform: deeper elevation → larger y, 10 px per m. */
const levelDown = (level: number): number => (100 - level) * 10

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
  depths: { top: number; base: number } = { top: 1, base: 3 },
): SampleResponse {
  return {
    id,
    depth_top_m: depths.top,
    depth_base_m: depths.base,
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

// Wide open plot bounds for most tests — only SGO8 narrows them.
const PLOT_TOP = 0
const PLOT_BOTTOM = 9999

function renderOverlay(
  columns: BoreholePlacedColumn[],
  details: Map<string, BoreholeDetailResponse> | null,
  overrides: {
    bodyClickEnabled?: boolean
    levelToScreen?: (level: number) => number
    plotTop?: number
    plotBottom?: number
    onSampleHover?: (hover: unknown) => void
  } = {},
) {
  return render(
    <svg>
      <SampleGeotechOverlay
        boreholePlacedColumns={columns}
        boreholeDetails={details}
        warpedXToScreen={identity}
        levelToScreen={overrides.levelToScreen ?? levelDown}
        plotTop={overrides.plotTop ?? PLOT_TOP}
        plotBottom={overrides.plotBottom ?? PLOT_BOTTOM}
        bodyClickEnabled={overrides.bodyClickEnabled ?? true}
        onSampleHover={overrides.onSampleHover as never}
      />
    </svg>,
  )
}

/** Read a numeric SVG attribute. */
function num(el: Element, name: string): number {
  return Number(el.getAttribute(name))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockToggle.mockReset()
  selectGeotechBody(null)
  // The hover card ships on; each tooltip test states the state it needs.
  setPsdPreviewOn(true)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SampleGeotechOverlay — extent markers', () => {
  it('SGO1 — draws nothing while the borehole details are still loading', () => {
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], null)
    expect(screen.getByTestId('sample-geotech-overlay-loading')).toBeDefined()
    expect(screen.queryByTestId(/^sample-marker-/)).toBeNull()
  })

  it('SGO2 — the bar spans the sample top and base depths, not its middle', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    // Surface 5 m; sample 1–3 m below it → elevations 4 and 2 → y 960 and 980.
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])

    renderOverlay([col], details)

    const marker = screen.getByTestId('sample-marker-s-1')
    expect(num(marker, 'y')).toBeCloseTo(960, 6)
    expect(num(marker, 'height')).toBeCloseTo(20, 6)
    // The mid-depth dot this replaces would have sat at y 970 with no height.
    expect(num(marker, 'height')).toBeGreaterThan(0)
  })

  it('SGO3 — a spot sample still draws, at the minimum height', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const spot = makeSample('s-spot', 'body-1', { top: 2, base: 2 })
    const details = new Map([['bh-1', makeBoreholeDetail('bh-1', [spot])]])

    renderOverlay([col], details)

    const marker = screen.getByTestId('sample-marker-s-spot')
    expect(num(marker, 'height')).toBeCloseTo(6, 6)
    // Still centred on the depth it was taken at (elevation 3 → y 970).
    expect(num(marker, 'y') + num(marker, 'height') / 2).toBeCloseTo(970, 6)
  })

  it('SGO4 — every marker draws the same style, packing body or not', () => {
    // Owner (dogfeed 2026-08-14 night): "you dont need to make a diff between
    // packing density or not, they are only on boreholes and will only get a
    // packing density through cpts" — a body-less sample is the NORMAL state
    // before the pipeline runs, not a variant worth its own colour.
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const withBody = makeSample('s-body', 'body-1')
    const withoutBody = makeSample('s-none', null)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [withBody, withoutBody])],
    ])

    renderOverlay([col], details)

    expect(screen.getByTestId('sample-marker-s-body')).toBeDefined()
    // Same lab-data teal for both — no neutral variant.
    expect(screen.getByTestId('sample-marker-s-none').getAttribute('fill')).toBe('#0d9488')
    expect(screen.getByTestId('sample-marker-s-body').getAttribute('fill')).toBe('#0d9488')
  })

  it('SGO5 — clicking a sample with no packing body does nothing', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-none', null)])],
    ])

    renderOverlay([col], details)

    fireEvent.click(screen.getByTestId('sample-hit-s-none'))
    fireEvent.keyDown(screen.getByTestId('sample-hit-s-none'), { key: 'Enter' })

    expect(mockToggle).not.toHaveBeenCalled()
  })

  it('SGO6 — a column with no detail loaded draws nothing', () => {
    renderOverlay(
      [makeBoreholePlacedColumn('bh-absent', 50)],
      new Map<string, BoreholeDetailResponse>(),
    )
    expect(screen.queryByTestId(/^sample-marker-/)).toBeNull()
  })

  it('SGO7 — the selected body’s marker goes amber and wider', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-selected')])],
    ])

    selectGeotechBody({ bodyId: 'body-selected', assignmentSource: null })
    renderOverlay([col], details)

    const marker = screen.getByTestId('sample-marker-s-1')
    // Two orthogonal cues, so selection never rides on hue alone (WCAG 1.4.1).
    expect(marker.getAttribute('fill')).toBe('#f59e0b')
    expect(num(marker, 'width')).toBeGreaterThan(7)
  })

  it('SGO8 — a marker off the plot is dropped; one crossing the edge is trimmed', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    // 1–3 m below a 5 m surface → y 960..980.
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])

    // Plot ends at 900 — the whole marker sits below it.
    const { unmount } = renderOverlay([col], details, {
      plotTop: 0,
      plotBottom: 900,
    })
    expect(screen.queryByTestId('sample-marker-s-1')).toBeNull()
    unmount()

    // Plot ends at 970 — the marker's lower half is off the edge.
    renderOverlay([col], details, { plotTop: 0, plotBottom: 970 })
    const marker = screen.getByTestId('sample-marker-s-1')
    expect(num(marker, 'y')).toBeCloseTo(960, 6)
    expect(num(marker, 'y') + num(marker, 'height')).toBeCloseTo(970, 6)
  })

  it('SGO9 — clicking a marker toggles its packing body', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-click')])],
    ])

    renderOverlay([col], details)
    fireEvent.click(screen.getByTestId('sample-hit-s-1'))

    expect(mockToggle).toHaveBeenCalledWith('body-click', 'cpt_interpolated')
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('SGO10 — Enter on a marker toggles its packing body', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-kb')])],
    ])

    renderOverlay([col], details)
    fireEvent.keyDown(screen.getByTestId('sample-hit-s-1'), { key: 'Enter' })

    expect(mockToggle).toHaveBeenCalledWith('body-kb', 'cpt_interpolated')
    expect(mockToggle).toHaveBeenCalledTimes(1)
  })

  it('SGO11 — on the litho axis the marker draws but clicking does nothing', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])

    renderOverlay([col], details, { bodyClickEnabled: false })

    // The sample is still visible — only the body selection is geotech-only.
    expect(screen.getByTestId('sample-marker-s-1')).toBeDefined()
    fireEvent.click(screen.getByTestId('sample-hit-s-1'))
    fireEvent.keyDown(screen.getByTestId('sample-hit-s-1'), { key: 'Enter' })
    expect(mockToggle).not.toHaveBeenCalled()
  })

  it('SGO12 — the hit target is at least 24 px in both directions', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    // A spot sample is the smallest marker there is — its hit target still has
    // to clear the WCAG 2.5.8 floor.
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1', { top: 2, base: 2 })])],
    ])

    renderOverlay([col], details)

    const hit = screen.getByTestId('sample-hit-s-1')
    expect(num(hit, 'width')).toBeGreaterThanOrEqual(24)
    expect(num(hit, 'height')).toBeGreaterThanOrEqual(24)
  })

  it('SGO13 — hovering a marker reports the sample; leaving reports nothing', () => {
    const col = makeBoreholePlacedColumn('bh-1', 50)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])
    const onSampleHover = vi.fn()

    renderOverlay([col], details, { onSampleHover })

    const hit = screen.getByTestId('sample-hit-s-1')
    fireEvent.mouseEnter(hit)
    expect(onSampleHover).toHaveBeenCalledTimes(1)
    const reported = onSampleHover.mock.calls[0][0] as {
      sample: SampleResponse
      boreholeName: string
    }
    expect(reported.sample.id).toBe('s-1')
    expect(reported.boreholeName).toBe('bh-1')

    fireEvent.mouseLeave(hit)
    expect(onSampleHover).toHaveBeenLastCalledWith(null)
  })
  it('SGO14 — a short sample reads as a RECTANGLE, not a dot (owner 2026-08-14)', () => {
    // Nearly every real sample is 0.35-0.5 m; at section zoom that height sits
    // at the minimum-height floor. "those dots are still there not nice
    // rectangular marks" — full corner rounding turned every floor-height
    // marker into a circle, so the rounding must stay far below half the
    // height however short the marker gets.
    const sample = makeSample('s-short', 'body-1', { top: 2, base: 2.4 })
    renderOverlay(
      [makeBoreholePlacedColumn('bh-1', 50)],
      new Map([['bh-1', makeBoreholeDetail('bh-1', [sample])]]),
    )
    const marker = screen.getByTestId('sample-marker-s-short')
    const rx = num(marker, 'rx')
    const height = num(marker, 'height')
    expect(rx, 'corner radius must not swallow the shape').toBeLessThanOrEqual(2)
    expect(rx, 'rounding stays below half the height').toBeLessThan(height / 2)
    expect(num(marker, 'width'), 'wider than tall-rounded: it reads as a bar').toBeGreaterThan(2 * rx)
  })

  // Owner (dogfeed 2026-08-15): "when i hover a psd, the click to highlight
  // packing density overlaps the psd graph". The OS draws the marker's native
  // tooltip on top of the floating card, and the card already carries the
  // sample number and the depth range — so the tooltip is redundant exactly
  // when it is in the way. With the card switched off it is the only thing
  // left telling the engineer the marker is there to be clicked, so it stays.
  it('SGO15 — while the hover card can show, the marker carries no native tooltip', () => {
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], details, {
      onSampleHover: vi.fn(),
    })

    const hit = screen.getByTestId('sample-hit-s-1')
    expect(hit.querySelector('title')).toBeNull()
  })

  it('SGO16 — with the card switched off the native tooltip is back, unchanged', () => {
    setPsdPreviewOn(false)
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], details, {
      onSampleHover: vi.fn(),
    })

    const title = screen.getByTestId('sample-hit-s-1').querySelector('title')
    expect(title).not.toBeNull()
    expect(title?.textContent).toContain('1.00')
    expect(title?.textContent).toContain('3.00')
    expect(title?.textContent).toContain('Click to highlight packing body')
  })

  it('SGO17 — the hover report says whether a click would highlight a body', () => {
    // The card draws the "click to highlight" line, and only the overlay knows
    // both halves of the answer: the sample has a body AND this axis lets it be
    // clicked. It reports the same verdict its own cursor and role already use.
    const details = new Map([
      [
        'bh-1',
        makeBoreholeDetail('bh-1', [makeSample('s-body', 'body-1'), makeSample('s-none', null)]),
      ],
    ])
    const onSampleHover = vi.fn()
    const { unmount } = renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], details, {
      onSampleHover,
    })

    fireEvent.mouseEnter(screen.getByTestId('sample-hit-s-body'))
    expect(onSampleHover.mock.calls[0][0]).toMatchObject({ bodyClickable: true })
    fireEvent.mouseEnter(screen.getByTestId('sample-hit-s-none'))
    expect(onSampleHover.mock.calls[1][0]).toMatchObject({ bodyClickable: false })
    unmount()

    // Litho axis: the sample still has its body, but nothing happens on click.
    const lithoHover = vi.fn()
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], details, {
      onSampleHover: lithoHover,
      bodyClickEnabled: false,
    })
    fireEvent.mouseEnter(screen.getByTestId('sample-hit-s-body'))
    expect(lithoHover.mock.calls[0][0]).toMatchObject({ bodyClickable: false })
  })
})

// Owner installer #37 dogfeed, GEO-99/201-B1: "right-clicking one of B1's
// packing bands opens the column menu, never the band menu." The lab-sample hit
// rect is painted ON TOP of the borehole's packing-band hit rect, so a
// right-click on a sample capsule was caught by the sample rect (which had no
// onContextMenu) and bubbled to the section's <svg onContextMenu> catch-all,
// which opens the COLUMN menu. The rect must instead forward the right-click to
// the band beneath it.
describe('SampleGeotechOverlay — a right-click reaches the band beneath, not the column menu (owner #37)', () => {
  it('SGO14 — a right-click on a sample capsule does NOT bubble to the section (never opens the column menu)', () => {
    const onSectionContextMenu = vi.fn()
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])
    render(
      <svg onContextMenu={onSectionContextMenu}>
        <SampleGeotechOverlay
          boreholePlacedColumns={[makeBoreholePlacedColumn('bh-1', 50)]}
          boreholeDetails={details}
          warpedXToScreen={identity}
          levelToScreen={levelDown}
          plotTop={PLOT_TOP}
          plotBottom={PLOT_BOTTOM}
          bodyClickEnabled
          onSampleHover={undefined as never}
        />
      </svg>,
    )
    fireEvent.contextMenu(screen.getByTestId('sample-hit-s-1'))
    // The section's catch-all — the one that opens the column menu — must never
    // fire from a right-click that landed on a packing band's sample capsule.
    expect(onSectionContextMenu).not.toHaveBeenCalled()
  })

  it('SGO15 — it forwards the right-click to the hit target BENEATH it (the band)', () => {
    const details = new Map([
      ['bh-1', makeBoreholeDetail('bh-1', [makeSample('s-1', 'body-1')])],
    ])
    renderOverlay([makeBoreholePlacedColumn('bh-1', 50)], details)
    const hit = screen.getByTestId('sample-hit-s-1')

    // Stand in for the packing band rect that sits beneath the sample capsule.
    const bandBeneath = document.createElement('div')
    bandBeneath.setAttribute('data-testid', 'band-beneath')
    document.body.appendChild(bandBeneath)
    const bandContextMenu = vi.fn()
    bandBeneath.addEventListener('contextmenu', bandContextMenu)

    // jsdom has no layout (no ``elementsFromPoint``), so drive the hit-test: the
    // stack is the sample rect (owned, skipped) then the band beneath.
    const docWithHitTest = document as unknown as {
      elementsFromPoint?: (x: number, y: number) => Element[]
    }
    const original = docWithHitTest.elementsFromPoint
    docWithHitTest.elementsFromPoint = vi.fn(() => [hit, bandBeneath])

    fireEvent.contextMenu(hit, { clientX: 40, clientY: 970 })

    expect(bandContextMenu).toHaveBeenCalledTimes(1)
    docWithHitTest.elementsFromPoint = original
    bandBeneath.remove()
  })
})

// Behaviour tests for BoreholeColumn — the N-strip lithology block
// that renders inside each borehole's column band on the
// cross-section. Each enabled interpretation channel gets its own
// vertical strip (DOV "lengteprofiel" page-3 convention).

import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  extras: {
    showHoverReadout?: boolean
    snapToStratigraphy?: boolean
    logFillOpacity?: number
    onCommitDepth?: (anchor: {
      kind: 'borehole'
      boreholeId: string
      boreholeName: string
      depth_m: number
      elevationM: number
    }) => void
  } = {},
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
        showHoverReadout={extras.showHoverReadout}
        snapToStratigraphy={extras.snapToStratigraphy}
        logFillOpacity={extras.logFillOpacity}
        onCommitDepth={extras.onCommitDepth}
      />
    </svg>,
  )
}

function findClickCaptureRect(container: HTMLElement): SVGRectElement {
  // The click+hover capture overlay is the rect with cursor styling
  // (crosshair for pick mode, default for readout-only). It's the
  // only rect with a non-empty ``style`` attribute.
  const rect = Array.from(container.querySelectorAll('rect')).find(
    r => r.getAttribute('style') && r.getAttribute('style')!.includes('cursor'),
  )
  if (!rect) throw new Error('No click/hover capture rect rendered')
  return rect as unknown as SVGRectElement
}

describe('BoreholeColumn — N-strip rendering', () => {
  // Fake timers so the click debounce window (250 ms) can be advanced
  // without real-clock waits in tests.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
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

  it('renders three strips side by side when all three channels are on', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'b', top_m: 0, base_m: 1 })]),
      makeObservation('formal_stratigraphy', [makeLayer({ id: 'c', top_m: 0, base_m: 1 })]),
      makeObservation('informal_stratigraphy', [makeLayer({ id: 'd', top_m: 0, base_m: 1 })]),
    ])
    const { container } = renderColumn(detail, {
      geotech: true,
      formal_strat: true,
      informal_strat: true,
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
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 1 })]),
    ])
    const { container } = renderColumn(detail, {
      geotech: false,
      formal_strat: false,
      informal_strat: false,
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

  it('renders no hover readout text when showHoverReadout is off (default)', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 2 })]),
    ])
    const { container } = renderColumn(detail)
    // No text elements at all — readout would emit two <text> nodes.
    expect(container.querySelectorAll('text').length).toBe(0)
  })

  it('renders no hit-box at all when both onCommitDepth and showHoverReadout are off', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 2 })]),
    ])
    const { container } = renderColumn(detail)
    // No rect with a cursor style — only the layer rects exist.
    const cursorRects = Array.from(container.querySelectorAll('rect')).filter(r =>
      (r.getAttribute('style') ?? '').includes('cursor'),
    )
    expect(cursorRects.length).toBe(0)
  })

  it('renders a depth + mTAW readout after a mousemove when showHoverReadout is on', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 5 })]),
    ])
    const { container } = renderColumn(detail, {}, { showHoverReadout: true })
    // With the fixture: surface elevation 10 m, levelToScreen =
    // 20 - level. surfaceY = 10. bandTopY = 10. A clientY of 5 maps
    // to localY = 5 + 10 = 15 (mid-band), depth = 5 m, elevation
    // = 10 - 5 = 5 m TAW.
    fireEvent.mouseMove(findClickCaptureRect(container), { clientY: 5 })
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent)
    expect(texts).toContain('depth 5.00 m')
    expect(texts).toContain('+5.00 m TAW')
  })

  it('hides the readout on mouseleave', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 5 })]),
    ])
    const { container } = renderColumn(detail, {}, { showHoverReadout: true })
    const hit = findClickCaptureRect(container)
    fireEvent.mouseMove(hit, { clientY: 5 })
    expect(container.querySelectorAll('text').length).toBeGreaterThan(0)
    fireEvent.mouseLeave(hit)
    expect(container.querySelectorAll('text').length).toBe(0)
  })

  it('renders the hit-box with crosshair cursor only when onCommitDepth is wired', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 5 })]),
    ])
    // showHoverReadout=true only → default cursor (no commit on click).
    const { container: readOnly } = renderColumn(detail, {}, { showHoverReadout: true })
    expect(findClickCaptureRect(readOnly).getAttribute('style')).toContain('default')
    // onCommitDepth wired → crosshair cursor.
    const { container: pickable } = renderColumn(detail, {}, {
      showHoverReadout: true,
      onCommitDepth: () => {},
    })
    expect(findClickCaptureRect(pickable).getAttribute('style')).toContain('crosshair')
  })

  it('snaps the click depth to the nearest formal-stratigraphy boundary within tolerance (debt #32)', () => {
    // Fixture: formal_stratigraphy layer [0, 5], total_depth_m=30
    // so the band stretches over plotTop+10..plotTop+40. The
    // candidates resolve to screen Y=10 (depth 0) and Y=15 (depth
    // 5). A click at clientY=4 → localY=14 → raw depth=4 →
    // distance to Y=15 is 1 px, well inside SNAP_TOLERANCE_PX=8.
    // Snap target: depth 5.
    const onCommitDepth = vi.fn()
    const detail = {
      ...makeDetail([
        makeObservation('formal_stratigraphy', [
          makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
        ]),
      ]),
      total_depth_m: 30,
    }
    const { container } = renderColumn(detail, {}, {
      snapToStratigraphy: true,
      onCommitDepth,
    })
    fireEvent.click(findClickCaptureRect(container), { clientY: 4 })
    // Click is queued behind a 250 ms dbl-click gate.
    vi.advanceTimersByTime(250)
    expect(onCommitDepth).toHaveBeenCalledTimes(1)
    expect(onCommitDepth.mock.calls[0][0].depth_m).toBeCloseTo(5, 5)
    // The anchor must report snapped=true so the App handler can
    // set source='borehole_observation' + confidence='high' (debt
    // #22/#23).
    expect(onCommitDepth.mock.calls[0][0].snapped).toBe(true)
  })

  it('does NOT snap when the click is outside the tolerance band (debt #32)', () => {
    const onCommitDepth = vi.fn()
    const detail = {
      ...makeDetail([
        makeObservation('formal_stratigraphy', [
          makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
        ]),
      ]),
      total_depth_m: 30,
    }
    const { container } = renderColumn(detail, {}, {
      snapToStratigraphy: true,
      onCommitDepth,
    })
    // clientY=25 → localY=35 → depth=25. Distance to Y=10 is 25,
    // to Y=15 is 20 — both well outside the 8-px tolerance. Free
    // depth stays 25.
    fireEvent.click(findClickCaptureRect(container), { clientY: 25 })
    vi.advanceTimersByTime(250)
    expect(onCommitDepth).toHaveBeenCalledTimes(1)
    expect(onCommitDepth.mock.calls[0][0].depth_m).toBeCloseTo(25, 5)
    expect(onCommitDepth.mock.calls[0][0].snapped).toBe(false)
  })

  it('does NOT snap when snapToStratigraphy is off, even near a boundary (debt #32)', () => {
    const onCommitDepth = vi.fn()
    const detail = {
      ...makeDetail([
        makeObservation('formal_stratigraphy', [
          makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
        ]),
      ]),
      total_depth_m: 30,
    }
    const { container } = renderColumn(detail, {}, {
      snapToStratigraphy: false,
      onCommitDepth,
    })
    // Same click as the snap test but the toggle is off — raw
    // depth commits unchanged.
    fireEvent.click(findClickCaptureRect(container), { clientY: 4 })
    vi.advanceTimersByTime(250)
    expect(onCommitDepth).toHaveBeenCalledTimes(1)
    expect(onCommitDepth.mock.calls[0][0].depth_m).toBeCloseTo(4, 5)
    expect(onCommitDepth.mock.calls[0][0].snapped).toBe(false)
  })

  it('rerendering across the early-return guard does not violate Rules of Hooks', () => {
    // Pins the bug fixed in the dbl-click-gate follow-up: every hook
    // (incl. useClickDebounce) MUST sit above the
    // ``enabledSlots.length === 0`` early-return, or React throws
    // "Rendered fewer hooks than expected" the frame a borehole
    // gains its first observation channel (CLAUDE.md "Temporal Dead
    // Zone after reordering React component bodies"). Mount with no
    // observations (empty enabledSlots → early return), then
    // rerender with an observation — the original bug crashes here.
    const empty = makeDetail([])
    const populated = makeDetail([
      makeObservation('formal_stratigraphy', [
        makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
      ]),
    ])
    const { rerender } = render(
      <svg>
        <BoreholeColumn
          detail={empty}
          channels={DEFAULT_BOREHOLE_CHANNELS}
          screenX={100}
          halfWidth={20}
          surfaceElevationM={10}
          plotTop={0}
          plotBottom={50}
          levelToScreen={flipped}
        />
      </svg>,
    )
    expect(() =>
      rerender(
        <svg>
          <BoreholeColumn
            detail={populated}
            channels={DEFAULT_BOREHOLE_CHANNELS}
            screenX={100}
            halfWidth={20}
            surfaceElevationM={10}
            plotTop={0}
            plotBottom={50}
            levelToScreen={flipped}
          />
        </svg>,
      ),
    ).not.toThrow()
  })

  it('double-click forwards to onDoubleClickOpen so detail still opens', () => {
    // Pins the dbl-click passthrough fix mirror of ContactPickBar.
    const onCommitDepth = vi.fn()
    const onDoubleClickOpen = vi.fn()
    const detail = {
      ...makeDetail([
        makeObservation('formal_stratigraphy', [
          makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
        ]),
      ]),
      total_depth_m: 30,
    }
    const { container } = render(
      <svg>
        <BoreholeColumn
          detail={detail}
          channels={DEFAULT_BOREHOLE_CHANNELS}
          screenX={100}
          halfWidth={20}
          surfaceElevationM={10}
          plotTop={0}
          plotBottom={50}
          levelToScreen={flipped}
          onCommitDepth={onCommitDepth}
          onDoubleClickOpen={onDoubleClickOpen}
        />
      </svg>,
    )
    const rect = findClickCaptureRect(container)
    fireEvent.click(rect, { clientY: 4 })
    fireEvent.doubleClick(rect, { clientY: 4 })
    vi.advanceTimersByTime(500)
    expect(onCommitDepth).not.toHaveBeenCalled()
    expect(onDoubleClickOpen).toHaveBeenCalledTimes(1)
  })

  it('double-click cancels the queued single-click — no contact placed', () => {
    // Pins the dbl-click race fix: a dbl-click intent (open detail
    // on the outer column) must not commit a contact on click 1.
    const onCommitDepth = vi.fn()
    const detail = {
      ...makeDetail([
        makeObservation('formal_stratigraphy', [
          makeLayer({ id: 'f1', top_m: 0, base_m: 5 }),
        ]),
      ]),
      total_depth_m: 30,
    }
    const { container } = renderColumn(detail, {}, {
      snapToStratigraphy: false,
      onCommitDepth,
    })
    const rect = findClickCaptureRect(container)
    fireEvent.click(rect, { clientY: 4 })
    fireEvent.doubleClick(rect, { clientY: 4 })
    vi.advanceTimersByTime(500)
    expect(onCommitDepth).not.toHaveBeenCalled()
  })

  it('keeps slot positions stable when a borehole is missing the enabled stream', () => {
    // Enabling geotech + formal_strat, but the borehole only carries
    // the formal_strat observation. Slot order is geotech (idx 0),
    // formal_strat (idx 1); formal_strat's strip sits at the slot-1
    // X regardless of the geotech slot being empty.
    const detail = makeDetail([
      makeObservation('formal_stratigraphy', [
        makeLayer({ id: 'f1', top_m: 0, base_m: 1 }),
      ]),
    ])
    const { container } = renderColumn(detail, {
      geotech: true,
      formal_strat: true,
    })
    const layerRects = Array.from(container.querySelectorAll('rect')).filter(
      r => Number(r.getAttribute('height')) > 0,
    )
    expect(layerRects.length).toBe(1)
    // Band centred on screenX=100, strip width=40, so band spans
    // [60, 140]. formal_strat is slot index 1 → x = 60 + 1*40 = 100.
    expect(layerRects[0].getAttribute('x')).toBe('100')
  })
})

// Owner: "same transparency everywhere plz". On the interpretation axes the
// column's own band stack paints OVER this card; an opaque DOV log underneath
// makes that band read brighter here than in the gap beside it, so the fill
// looks like it stops at the borehole. The driller's log is reference there —
// the full-detail read is the borelog panel — so it steps back to a veil.
describe('BoreholeColumn — the log yields to the interpretation fill', () => {
  it('BHC-VEIL1: the caller sets how solid the log strips paint', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 3 })]),
    ])
    const { container } = renderColumn(detail, { geotech: true }, { logFillOpacity: 0.18 })
    const layerRects = Array.from(container.querySelectorAll('rect')).filter(
      r => Number(r.getAttribute('height')) > 0,
    )
    expect(layerRects.length).toBeGreaterThan(0)
    for (const rect of layerRects) {
      expect(rect.getAttribute('fill-opacity')).toBe('0.18')
    }
  })

  it('BHC-VEIL2: unasked, the log paints solid as it always did', () => {
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [makeLayer({ id: 'l1', top_m: 0, base_m: 3 })]),
    ])
    const { container } = renderColumn(detail, { geotech: true })
    const layerRects = Array.from(container.querySelectorAll('rect')).filter(
      r => Number(r.getAttribute('height')) > 0,
    )
    expect(layerRects.length).toBeGreaterThan(0)
    for (const rect of layerRects) {
      expect(rect.getAttribute('fill-opacity')).toBe('1')
    }
  })
})

describe('BoreholeColumn - gecodeerde lithologie (issue #17)', () => {
  // The BORDVV boreholes in the owner's test2.strix carry ONE observation each,
  // of type ``coded_lithology``, with 18 to 26 layers. They drew a bare column.
  const codedOnly = () =>
    makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'c1', top_m: 0, base_m: 0.5 }),
        makeLayer({ id: 'c2', top_m: 0.5, base_m: 1 }),
      ]),
    ])

  it('draws the strip for a borehole whose only stream is coded lithology', () => {
    // Only this stream on, so the count is the two coded layers and nothing
    // else: an enabled stream with no observation still contributes a strip.
    const { container } = renderColumn(codedOnly(), {
      lithology: true,
      geotech: false,
    })
    expect(container.querySelectorAll('rect').length).toBe(2)
  })

  it('draws nothing for it while the stream is off', () => {
    const { container } = renderColumn(codedOnly(), {
      lithology: false,
      geotech: false,
    })
    expect(container.querySelectorAll('rect').length).toBe(0)
  })
  it('paints the coded lithology strip with the DOV soil pattern of each layer', () => {
    // Issue #17 acceptance: the pattern-fill branch for coded_lithology is
    // reachable. Each coded layer fills with its primary soil code's pattern.
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'c1', top_m: 0, base_m: 0.5, main_soil_codes: ['KL'] }),
        makeLayer({ id: 'c2', top_m: 0.5, base_m: 1, main_soil_codes: ['ZG'] }),
      ]),
    ])
    const { container } = renderColumn(detail, { lithology: true, geotech: false })
    const fills = Array.from(container.querySelectorAll('rect')).map(r => r.getAttribute('fill'))
    expect(fills).toEqual(['url(#soil-KL)', 'url(#soil-ZG)'])
  })

  it('a borehole with both geotechnical coding and coded lithology looks as before under the default toggles', () => {
    // No regression: the coded stream is default OFF, so a borehole that
    // carries both streams still draws only its geotech strip, centred on the
    // column axis (band [80, 120] for halfWidth 20).
    const detail = makeDetail([
      makeObservation('coded_lithology', [
        makeLayer({ id: 'c1', top_m: 0, base_m: 1, main_soil_codes: ['ZG'] }),
      ]),
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'g1', top_m: 0, base_m: 1, main_soil_codes: ['KL'] }),
      ]),
    ])
    const { container } = renderColumn(detail)
    const rects = Array.from(container.querySelectorAll('rect'))
    expect(rects.map(r => r.getAttribute('fill'))).toEqual(['url(#soil-KL)'])
    expect(rects[0].getAttribute('x')).toBe('80')
  })

  it('with both streams on, the coded lithology strip sits left of the geotech strip', () => {
    // DOV lengteprofiel reading order: raw coded log first, then geotech.
    // Band of two 40 px strips centred on x=100 spans [60, 140].
    const detail = makeDetail([
      makeObservation('geotechnical_coding', [
        makeLayer({ id: 'g1', top_m: 0, base_m: 1, main_soil_codes: ['KL'] }),
      ]),
      makeObservation('coded_lithology', [
        makeLayer({ id: 'c1', top_m: 0, base_m: 1, main_soil_codes: ['ZG'] }),
      ]),
    ])
    const { container } = renderColumn(detail, { lithology: true, geotech: true })
    const rects = Array.from(container.querySelectorAll('rect'))
    expect(rects.map(r => [r.getAttribute('fill'), r.getAttribute('x')])).toEqual([
      ['url(#soil-ZG)', '60'],
      ['url(#soil-KL)', '100'],
    ])
  })
})

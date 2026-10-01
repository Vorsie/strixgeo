// Behaviour tests for the grain-size hover preview card.
//
// Owner's words: "Hovering a sample marker (litho AND geotech axes) shows a
// small floating popup near the cursor: sample number + depth range, and when
// the sample has grain_sizes, a mini grain-size distribution chart ... No
// grain-size tests → compact popup with the metadata and a 'no grain-size
// test' line. The popup is pointer-events:none, clamps inside the viewport,
// and disappears on mouse-leave."
//
//   SPP1  the card names the sample and the depth range it covers
//   SPP2  a sample with two grain-size tests draws ONE combined curve (owner
//         2026-10-01: "make a combined sieve + hydrometer graph"; one
//         sample = one chart everywhere)
//   SPP3  a sample with no grain-size test says so, and draws no curve
//   SPP4  the card never eats the mouse
//   SPP5  hovering at the right edge keeps the whole card on the panel

import { render, screen, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import SamplePsdPopover from './SamplePsdPopover'
import type { GrainSizeResponse, SampleResponse } from '../../api/client'

afterEach(cleanup)

function makeGrainSize(id: string): GrainSizeResponse {
  return {
    id,
    diameters_mm: [0.063, 0.5, 2],
    pct_larger: [90, 40, 5],
    method: null,
    test_date: null,
    lime_removed: null,
    organics_removed: null,
  }
}

function makeSample(overrides: Partial<SampleResponse> = {}): SampleResponse {
  return {
    id: 's-1',
    depth_top_m: 1.5,
    depth_base_m: 3.25,
    description: '',
    sample_number: 'M12',
    sample_type: null,
    composition: null,
    instrument: null,
    sampling_date: null,
    geotech_body_id: null,
    geotech_nad_class: null,
    geotech_assignment_source: null,
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
    ...overrides,
  }
}

function renderPopover(
  sample: SampleResponse,
  anchor: { x: number; y: number } = { x: 100, y: 100 },
  bodyClickable = false,
) {
  return render(
    <SamplePsdPopover
      sample={sample}
      boreholeName="BH-7"
      anchorX={anchor.x}
      anchorY={anchor.y}
      containerWidth={800}
      containerHeight={500}
      bodyClickable={bodyClickable}
    />,
  )
}

describe('SamplePsdPopover', () => {
  it('SPP1: the card names the sample and the depth range it covers', () => {
    renderPopover(makeSample())
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.textContent).toContain('M12')
    expect(card.textContent).toContain('BH-7')
    // The interval the lab result speaks for, at two decimals.
    expect(card.textContent).toContain('1.50')
    expect(card.textContent).toContain('3.25')
  })

  it('SPP2: a sample with two grain-size tests draws ONE combined curve', () => {
    renderPopover(
      makeSample({
        grain_sizes: [
          makeGrainSize('g-sieve'),
          { ...makeGrainSize('g-hydro'), diameters_mm: [0.002, 0.02, 0.063], pct_larger: [99, 95, 90] },
        ],
      }),
    )
    expect(screen.getAllByTestId('psd-chart')).toHaveLength(1)
    const curves = document.querySelectorAll('polyline')
    expect(curves).toHaveLength(1)
    // The combined curve carries the hydrometer's fines AND the sieve's sand.
    expect(curves[0].getAttribute('points')?.trim().split(/\s+/)).toHaveLength(5)
  })

  it('SPP3: a sample with no grain-size test says so, and draws no curve', () => {
    renderPopover(makeSample({ grain_sizes: [] }))
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.textContent?.toLowerCase()).toContain('no grain-size test')
    expect(screen.queryByTestId('psd-chart')).toBeNull()
  })

  it('SPP4: the card never eats the mouse', () => {
    renderPopover(makeSample())
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.className).toContain('pointer-events-none')
  })

  it('SPP5: hovering at the right edge keeps the whole card on the panel', () => {
    renderPopover(makeSample({ grain_sizes: [makeGrainSize('g-1')] }), {
      x: 795,
      y: 495,
    })
    const card = screen.getByTestId('sample-psd-popover') as HTMLElement
    const left = parseFloat(card.style.left)
    const top = parseFloat(card.style.top)
    const width = parseFloat(card.style.width)

    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + width).toBeLessThanOrEqual(800)
    expect(top).toBeGreaterThanOrEqual(0)
    // The card was pushed off the anchor to stay inside, not left hanging.
    expect(top).toBeLessThan(495)
  })
  it('SPP6 — the x axis is FIXED and inverted: 63 mm labels the left wall, 0.001 mm the right', () => {
    // Owner (dogfeed 2026-08-14 night): "i want a fixed axis scale for the psd
    // previews, so it is always easy to see sand/silt/clay fraction". The axis
    // no longer follows the sample's own span — every card shows the same
    // 63 → 0.001 mm window, coarse left.
    const sample = makeSample({ grain_sizes: [makeGrainSize('g-1')] })
    renderPopover(sample)
    const labels = screen.getByTestId('psd-axis-labels')
    const spans = Array.from(labels.querySelectorAll('span')).map(s => s.textContent ?? '')
    expect(spans[0]).toContain('63')
    expect(spans[spans.length - 1]).toContain('0.001')
  })

  it('SPP7 — the sand/silt/clay fraction boundaries sit at the same x on every card', () => {
    // The point of the fixed axis: the engineer reads the fraction at a glance
    // because the 2 mm / 63 um / 2 um boundary lines never move. Two samples
    // with very different spans must render the boundary lines at identical
    // positions, with the zone labels present.
    const fine = makeSample({
      grain_sizes: [{ ...makeGrainSize('g-f'), diameters_mm: [0.002, 0.02], pct_larger: [90, 10] }],
    })
    const { unmount } = renderPopover(fine)
    const linesA = Array.from(
      document.querySelectorAll('[data-testid="psd-fraction-boundary"]'),
    ).map(l => l.getAttribute('x1'))
    expect(linesA).toHaveLength(3)
    const zoneLabels = Array.from(
      document.querySelectorAll('[data-testid="psd-zone-label"]'),
    ).map(t => t.textContent)
    expect(zoneLabels).toContain('sand')
    expect(zoneLabels).toContain('silt')
    unmount()

    const coarse = makeSample({
      grain_sizes: [{ ...makeGrainSize('g-c'), diameters_mm: [1, 20], pct_larger: [80, 5] }],
    })
    renderPopover(coarse)
    const linesB = Array.from(
      document.querySelectorAll('[data-testid="psd-fraction-boundary"]'),
    ).map(l => l.getAttribute('x1'))
    expect(linesB).toEqual(linesA)
  })

  // Owner ask (dogfeed 2026-08-15): "maybe put organic matter content some
  // where in the psd popup on hover too".
  //
  // Organic MATTER and organic CARBON are different quantities — matter is
  // roughly carbon times a conversion factor — so a carbon value must never be
  // presented under the matter label. The card shows matter when the sample has
  // it, says "carbon" when that is all there is, and simply omits the line when
  // the sample was never tested (no dash, no empty row).
  it('SPP8: organic matter content shows as its own line', () => {
    renderPopover(
      makeSample({
        organic_content_tests: [
          { id: 'o-1', carbon_pct: 2.4, matter_pct: 4.2, method: null, test_date: null },
        ],
      }),
    )
    const line = screen.getByTestId('sample-organic-content')
    expect(line.textContent).toContain('organic matter')
    expect(line.textContent).toContain('4.2')
    expect(line.textContent).not.toContain('carbon')
  })

  it('SPP9: with only carbon measured the line says carbon, never matter', () => {
    renderPopover(
      makeSample({
        organic_content_tests: [
          { id: 'o-1', carbon_pct: 2.4, matter_pct: null, method: null, test_date: null },
        ],
      }),
    )
    const line = screen.getByTestId('sample-organic-content')
    expect(line.textContent).toContain('organic carbon')
    expect(line.textContent).toContain('2.4')
  })

  it('SPP10: matter wins across tests — a later matter result beats an earlier carbon-only one', () => {
    renderPopover(
      makeSample({
        organic_content_tests: [
          { id: 'o-1', carbon_pct: 2.4, matter_pct: null, method: null, test_date: null },
          { id: 'o-2', carbon_pct: null, matter_pct: 4.2, method: null, test_date: null },
        ],
      }),
    )
    const line = screen.getByTestId('sample-organic-content')
    expect(line.textContent).toContain('organic matter')
    expect(line.textContent).toContain('4.2')
  })

  it('SPP11: no organic test → no line at all', () => {
    renderPopover(makeSample({ organic_content_tests: [] }))
    expect(screen.queryByTestId('sample-organic-content')).toBeNull()
    // A test row carrying neither quantity is nothing to show either.
    renderPopover(
      makeSample({
        organic_content_tests: [
          { id: 'o-1', carbon_pct: null, matter_pct: null, method: null, test_date: null },
        ],
      }),
    )
    expect(screen.queryByTestId('sample-organic-content')).toBeNull()
  })

  it('SPP12: the extra line is paid for in the placement, so the card still fits', () => {
    // The card measures itself for ``clampPopoverPosition``; a line added to
    // the render but not to the measurement would hang off the panel's bottom.
    renderPopover(
      makeSample({
        grain_sizes: [makeGrainSize('g-1')],
        organic_content_tests: [
          { id: 'o-1', carbon_pct: null, matter_pct: 4.2, method: null, test_date: null },
        ],
      }),
      { x: 795, y: 495 },
    )
    const card = screen.getByTestId('sample-psd-popover') as HTMLElement
    const top = parseFloat(card.style.top)
    expect(top).toBeGreaterThanOrEqual(0)
    // Header + chart + axis strip + the organic line, all above the panel floor.
    expect(top + 8 * 2 + 30 + 80 + 13 + 12).toBeLessThanOrEqual(500)
  })

  // Owner (dogfeed 2026-08-15): "impossible, i'm 100% sure some have gehalte
  // aan organisch materiaal, it's even under organic matter content in the data
  // stage". On his project that reading lives in the scalar catch-all, not in
  // the typed organic family, and the card was reading only the typed one.
  it('SPP13: the organic line renders from the scalar catch-all row too', () => {
    renderPopover(
      makeSample({
        organic_content_tests: [],
        scalar_lab_tests: [
          {
            id: 'sc-1',
            parameter_group: 'Onderkenning - proeven',
            // Verbatim from his data — DOV repeats the name in its own brackets.
            parameter: 'Gehalte Organische stoffen (Gehalte Organische stoffen)',
            value_numeric: 3.7,
            value_text: null,
            unit: '%',
            method: null,
            test_date: null,
            detection_condition: null,
          },
        ],
      }),
    )
    const line = screen.getByTestId('sample-organic-content')
    // The DOV quantity is organic MATTER, so it must be labelled matter.
    expect(line.textContent).toContain('organic matter')
    expect(line.textContent).toContain('3.7')
    expect(line.textContent).not.toContain('carbon')
  })

  // Owner (dogfeed 2026-08-15): "when i hover a psd, the click to highlight
  // packing density overlaps the psd graph". The affordance moves INTO the
  // card — but only where the click actually does something.
  it('SPP14: a sample whose click highlights a packing body says so on the card', () => {
    renderPopover(makeSample({ geotech_body_id: 'body-1' }), { x: 100, y: 100 }, true)
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.textContent).toContain('Click to highlight packing body')
  })

  it('SPP15: a sample with no packing body never promises a click', () => {
    // Before the packing pipeline divides the boreholes, no sample carries a
    // body — promising a click that does nothing is worse than saying nothing.
    renderPopover(makeSample({ geotech_body_id: null }), { x: 100, y: 100 }, true)
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.textContent).not.toContain('Click to highlight')
  })

  it('SPP16: on the litho axis, where the click is off, the card stays silent', () => {
    renderPopover(makeSample({ geotech_body_id: 'body-1' }), { x: 100, y: 100 }, false)
    const card = screen.getByTestId('sample-psd-popover')
    expect(card.textContent).not.toContain('Click to highlight')
  })

  it('SPP17: the click line is paid for in the placement, so the card still fits', () => {
    renderPopover(
      makeSample({
        geotech_body_id: 'body-1',
        grain_sizes: [makeGrainSize('g-1')],
      }),
      { x: 795, y: 495 },
      true,
    )
    const card = screen.getByTestId('sample-psd-popover') as HTMLElement
    const top = parseFloat(card.style.top)
    expect(top).toBeGreaterThanOrEqual(0)
    // Header + chart + axis strip + the click line, all above the panel floor.
    expect(top + 8 * 2 + 30 + 80 + 13 + 12).toBeLessThanOrEqual(500)
  })
})

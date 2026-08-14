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
//   SPP2  a sample with two grain-size tests draws two curves
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
) {
  return render(
    <SamplePsdPopover
      sample={sample}
      boreholeName="BH-7"
      anchorX={anchor.x}
      anchorY={anchor.y}
      containerWidth={800}
      containerHeight={500}
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

  it('SPP2: a sample with two grain-size tests draws two curves', () => {
    renderPopover(
      makeSample({ grain_sizes: [makeGrainSize('g-1'), makeGrainSize('g-2')] }),
    )
    expect(screen.getByTestId('psd-curve-g-1')).toBeDefined()
    expect(screen.getByTestId('psd-curve-g-2')).toBeDefined()
    expect(screen.getByTestId('psd-chart')).toBeDefined()
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
  it('SPP6 — the x axis is inverted: the coarse end labels the LEFT wall', () => {
    // "the psd x-axis should be inverted" (owner 2026-08-14). The curve, the
    // decade ticks and the edge labels must all agree, so this pins the edge
    // labels: largest diameter left, smallest right.
    // The default fixture spans 0.063 - 2 mm: coarse (2 mm) must label the
    // left edge, fine (0.063 mm) the right edge.
    const sample = makeSample({ grain_sizes: [makeGrainSize('g-1')] })
    renderPopover(sample)
    const labels = screen.getByTestId('psd-axis-labels')
    const spans = Array.from(labels.querySelectorAll('span')).map(s => s.textContent ?? '')
    expect(spans[0]).toContain('2')
    expect(spans[spans.length - 1]).toContain('0.063')
  })
})

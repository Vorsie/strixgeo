// Behaviour tests for ContactPickBar — the CPT hover-driven
// contact-pick affordance. Verifies the readout values interpolate
// from the plot's depth-series and the click fires the right
// anchor payload.

import { fireEvent, render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse } from '../../api/client'
import ContactPickBar from './ContactPickBar'

// Flipped levelToScreen: deeper level renders further down.
// With surface elevation 10 m → surface at Y=10. A 5 m layer
// extends to Y=15.
const flipped = (level: number): number => 20 - level

function makePlot(overrides: Partial<CptPlotResponse> = {}): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: [0, 1, 2, 3, 4, 5],
    qc_mpa: [0, 2, 4, 6, 8, 10],
    fs_mpa: null,
    u2_mpa: null,
    rf_pct: [0, 1, 2, 3, 4, 5],
    qt_mpa: null,
    q_total_mpa: null,
    ic: null,
    rf_source: null,
    ...overrides,
  }
}

function renderBar(overrides: Partial<React.ComponentProps<typeof ContactPickBar>> = {}) {
  const defaults: React.ComponentProps<typeof ContactPickBar> = {
    plot: makePlot(),
    cptType: 'CPTU',
    cptName: 'CPT-1',
    cptId: 'cpt-1',
    screenX: 100,
    halfWidth: 24,
    surfaceElevationM: 10,
    plotTop: 0,
    plotBottom: 50,
    bgTopY: 10,
    bgBottomY: 15,
    levelToScreen: flipped,
    onCommitDepth: vi.fn(),
  }
  return render(
    <svg>
      <ContactPickBar {...defaults} {...overrides} />
    </svg>,
  )
}

describe('ContactPickBar', () => {
  // Fake timers so the click debounce window (250 ms) can be advanced
  // without real-clock waits in tests.
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })
  it('renders the invisible click-capture overlay over the band', () => {
    const { container } = renderBar()
    // The transparent capture rect spans 2 × halfWidth wide and
    // (bgBottomY - bgTopY) tall.
    const rect = container.querySelector('rect[fill="transparent"]')
    expect(rect).not.toBeNull()
    expect(rect?.getAttribute('width')).toBe('48')
    expect(rect?.getAttribute('height')).toBe('5')
    expect(rect?.getAttribute('x')).toBe('76')
    expect(rect?.getAttribute('y')).toBe('10')
  })

  it('does not render the ghost line / readout until the user hovers', () => {
    const { container } = renderBar()
    // Pre-hover: only the capture rect exists, no dashed ghost line.
    expect(container.querySelector('line[stroke-dasharray]')).toBeNull()
  })

  it('renders nothing when the band has no height', () => {
    const { container } = renderBar({ bgTopY: 30, bgBottomY: 30 })
    expect(container.querySelector('rect')).toBeNull()
  })

  it('fires onCommitDepth with the clicked depth on click', () => {
    // jsdom doesn't compute layout, so getBoundingClientRect returns
    // a zero rect by default. We stub the rect so the handler reads
    // a deterministic offset → depth.
    const onCommitDepth = vi.fn()
    const { container } = renderBar({ onCommitDepth })
    const overlay = container.querySelector('rect[fill="transparent"]') as SVGRectElement
    expect(overlay).not.toBeNull()
    // Stub the rect at y=10 (matches bgTopY) so localY 10 + (e.clientY
    // - 10) lands inside the band.
    overlay.getBoundingClientRect = () =>
      ({
        top: 10,
        bottom: 15,
        left: 76,
        right: 124,
        x: 76,
        y: 10,
        width: 48,
        height: 5,
        toJSON: () => ({}),
      }) as DOMRect
    // First move the mouse so cursorY is set; then click to commit.
    // clientY = 13 → localY = 13 - 10 + bgTopY(10) = 13 → clamped to
    // [10, 15] → depth = (13 - surfaceY=10) / 1 = 3 m.
    fireEvent.mouseMove(overlay, { clientY: 13 })
    fireEvent.click(overlay)
    // Click is queued behind a 250 ms dbl-click gate — fires only
    // after the timer elapses with no cancel.
    expect(onCommitDepth).not.toHaveBeenCalled()
    vi.advanceTimersByTime(250)
    expect(onCommitDepth).toHaveBeenCalledTimes(1)
    const arg = onCommitDepth.mock.calls[0][0]
    expect(arg.kind).toBe('cpt')
    expect(arg.cptId).toBe('cpt-1')
    expect(arg.cptName).toBe('CPT-1')
    expect(arg.depth_m).toBeCloseTo(3, 5)
    expect(arg.elevationM).toBeCloseTo(7, 5)
  })

  it('renders the readout after a mouse-move shows the cursor depth', () => {
    const { container } = renderBar()
    const overlay = container.querySelector('rect[fill="transparent"]') as SVGRectElement
    overlay.getBoundingClientRect = () =>
      ({
        top: 10,
        bottom: 15,
        left: 76,
        right: 124,
        x: 76,
        y: 10,
        width: 48,
        height: 5,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.mouseMove(overlay, { clientY: 12 })
    // Ghost line: dashed horizontal line at the cursor Y.
    expect(container.querySelector('line[stroke-dasharray]')).not.toBeNull()
    // Readout texts. depth = (12 - 10) / 1 = 2 m. qc at depth 2 = 4 MPa
    // (linear interp lands exactly on the sample at index 2). Rf = 2 %.
    const texts = Array.from(container.querySelectorAll('text')).map(t => t.textContent ?? '')
    expect(texts.some(t => t.includes('2.00 m'))).toBe(true)
    expect(texts.some(t => t.includes('+8.00 m TAW'))).toBe(true)
    expect(texts.some(t => t.includes('qc'))).toBe(true)
    expect(texts.some(t => t.includes('Rf'))).toBe(true)
  })

  it('rerendering across the early-return guard does not violate Rules of Hooks', () => {
    // Pins the bug fixed in the dbl-click-gate follow-up: every hook
    // (incl. useClickDebounce) MUST sit above the
    // ``bgBottomY - bgTopY <= 0`` early-return, or React throws
    // "Rendered fewer hooks than expected" on the frame the band's
    // height flips from 0 to non-zero (CLAUDE.md "Temporal Dead Zone
    // after reordering React component bodies"). Mount with the
    // collapsed shape, then rerender expanded — the original bug
    // crashes here.
    const defaults: React.ComponentProps<typeof ContactPickBar> = {
      plot: makePlot(),
      cptType: 'CPTU',
      cptName: 'CPT-1',
      cptId: 'cpt-1',
      screenX: 100,
      halfWidth: 24,
      surfaceElevationM: 10,
      plotTop: 0,
      plotBottom: 50,
      bgTopY: 10,
      bgBottomY: 10,  // collapsed → early return
      levelToScreen: flipped,
      onCommitDepth: vi.fn(),
    }
    const { rerender } = render(
      <svg>
        <ContactPickBar {...defaults} />
      </svg>,
    )
    expect(() =>
      rerender(
        <svg>
          <ContactPickBar {...defaults} bgBottomY={15} />
        </svg>,
      ),
    ).not.toThrow()
  })

  it('double-click cancels the queued single-click — no contact placed', () => {
    // Pins the dbl-click race fix: a dbl-click intent (open detail
    // on the outer column) must not commit a contact on click 1.
    const onCommitDepth = vi.fn()
    const { container } = renderBar({ onCommitDepth })
    const overlay = container.querySelector('rect[fill="transparent"]') as SVGRectElement
    overlay.getBoundingClientRect = () =>
      ({
        top: 10,
        bottom: 15,
        left: 76,
        right: 124,
        x: 76,
        y: 10,
        width: 48,
        height: 5,
        toJSON: () => ({}),
      }) as DOMRect
    fireEvent.mouseMove(overlay, { clientY: 13 })
    fireEvent.click(overlay)
    // Within the gate window, a dblclick fires and clears the queued
    // commit. Browser semantics: click, click, dblclick — we simulate
    // click then dblclick directly.
    fireEvent.doubleClick(overlay)
    vi.advanceTimersByTime(500)
    expect(onCommitDepth).not.toHaveBeenCalled()
  })
})

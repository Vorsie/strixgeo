// Pins for the second-dogfeed rulings on the CPT distribution panels
// (owner, 2026-08-27).
//
// S1, verbatim: "make a button on the 3 cpt statistics, to rescale x-axis to
// better fit the data. 0 stays minimum and ofcourse the button has to revert
// too."
// S2, verbatim: "No clamping, if something is off the axis then it doesn't
// render, maybe a notifier # off axis that way."
// S3, verbatim: "I want more sublabels on all axis ticks not too many."
//
// FT1 — pressing the button rescales the X axis to fit the data: 0 stays the
//       minimum, the axis end becomes the pooled max (rounded up to a tick).
// FT2 — the button label states the mode it switches TO, and flips.
// FT3 — reverting restores the EXACT fixed axes (the negative control: the
//       dot returns to its fixed-axis position, the end label reads 40 again).
// OA1 — a reading past the axis max does NOT render in the strip — no
//       clamping, off the axis means it doesn't render.
// OA2 — the panel says how many are off axis, and the numeric readouts keep
//       reporting the true values.
// OA3 — nothing off axis → no notifier.
// OA4 — in fit mode nothing sits ABOVE the axis by construction: every
//       non-negative reading renders and the notifier is gone.
// OA5 — a NEGATIVE reading is off axis in fit mode too (audit F6 — fitAxisMax
//       only raises the ceiling); excluded and counted.
// OA6 — a whisker/box spanning off-axis values is dropped WITH a stated
//       reason, never silently (audit F6).
// TKD1 — the qc row labels intermediate ticks (5 … 35), not just the ends.
// TKD2 — the ticks follow the ACTIVE axis: in fit mode they derive from the
//        fitted span, not the fixed one.

import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import UnitDistributionPanels from './UnitDistributionPanels'
import { computeUnitStatistics, type UnitChannelSeries } from './unitStatistics'

afterEach(cleanup)

/** Statistics over one CPT with the given qc readings (fs/Rf absent). */
function qcStatistics(qcs: number[]) {
  const series = new Map<string, UnitChannelSeries>([
    [
      'cpt-a',
      {
        depthsM: qcs.map((_, i) => i + 1),
        qcMpa: qcs,
        fsMpa: null,
        rfPct: null,
      },
    ],
  ])
  return computeUnitStatistics(
    [{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 100 }],
    series,
  )
}

/** All qc strip dots, as user-space x positions (0–100). */
function qcDotXs(): number[] {
  const row = screen.getByTestId('unit-stats-row-qc')
  return Array.from(
    row.querySelectorAll<SVGCircleElement>('[data-testid="unit-stats-dot-qc"]'),
  ).map(dot => Number(dot.getAttribute('cx')))
}

describe('S1 — the fit-to-data toggle on the CPT panels', () => {
  it('FT1 — the button rescales the X axis to fit the data; 0 stays minimum', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([2, 10])} unitLabel="Zand" />,
    )
    fireEvent.click(screen.getByTestId('unit-stats-fit-toggle'))
    // Pooled max 10 → fitted axis 0–10: the 10 MPa reading now sits at the
    // row end, the 2 MPa one at 20 % — not at 25 % / 5 % of the fixed axis.
    const xs = qcDotXs().sort((a, b) => a - b)
    expect(xs[0]).toBeCloseTo(20, 4)
    expect(xs[1]).toBeCloseTo(100, 4)
    // 0 stays the minimum.
    expect(screen.getByTestId('unit-stats-axis-zero-qc').textContent).toContain('0')
    expect(screen.getByTestId('unit-stats-axis-max-qc').textContent).toContain('10')
  })

  it('FT2 — the button label states the mode it switches TO', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([2, 10])} unitLabel="Zand" />,
    )
    const button = screen.getByTestId('unit-stats-fit-toggle')
    // Fixed axes are active → the button offers the fit.
    expect(button.textContent).toMatch(/fit axes to data/i)
    fireEvent.click(button)
    // Fit is active → the button offers the way back to the standard axes.
    expect(button.textContent).toMatch(/standard cpt axes/i)
  })

  it('FT3 — reverting restores the EXACT fixed axes', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10])} unitLabel="Zand" />,
    )
    const button = screen.getByTestId('unit-stats-fit-toggle')
    fireEvent.click(button)
    expect(qcDotXs()[0]).toBeCloseTo(100, 4) // fitted: 10 on 0–10
    fireEvent.click(button)
    // Back on the fixed 0–40 MPa axis, exactly.
    expect(qcDotXs()[0]).toBeCloseTo(25, 4)
    expect(screen.getByTestId('unit-stats-axis-max-qc').textContent).toContain('40')
  })
})

describe('S2 — no clamping; off the axis means it does not render', () => {
  it('OA1 — a reading past the axis max is absent from the strip', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10, 60])} unitLabel="Vast zand" />,
    )
    // Only the on-axis reading draws; the 60 MPa one does NOT render — and
    // in particular nothing is clamped onto the row end.
    const xs = qcDotXs()
    expect(xs).toHaveLength(1)
    expect(xs[0]).toBeCloseTo(25, 4)
  })

  it('OA2 — the panel counts what is off axis; the readouts keep the true values', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10, 55, 60])} unitLabel="Vast zand" />,
    )
    const note = screen.getByTestId('unit-stats-offaxis-qc')
    expect(note.textContent).toMatch(/2 off axis/i)
    // The numeric readout still reports the true maximum.
    const qcRow = screen.getByTestId('unit-stats-row-qc')
    expect(within(qcRow).getByTestId('unit-stats-max-qc').textContent).toContain('60')
  })

  it('OA3 — nothing off axis, no notifier', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10, 20])} unitLabel="Zand" />,
    )
    expect(screen.queryByTestId('unit-stats-offaxis-qc')).toBeNull()
  })

  it('OA4 — in fit mode nothing is off axis by construction', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10, 60])} unitLabel="Vast zand" />,
    )
    expect(qcDotXs()).toHaveLength(1) // fixed axes: the 60 is off
    fireEvent.click(screen.getByTestId('unit-stats-fit-toggle'))
    // The fitted axis covers the pooled max — every reading renders again.
    expect(qcDotXs()).toHaveLength(2)
    expect(screen.queryByTestId('unit-stats-offaxis-qc')).toBeNull()
  })

  // F6 (audit 2026-08-27): "in fit mode nothing can be off axis" was FALSE
  // for NEGATIVE readings (live: fs down to −0.091 MPa) — fitAxisMax only
  // raises the CEILING. A negative value is off-axis on a zero-anchored axis:
  // excluded and counted, in fit mode too.
  it('OA5 — a negative reading stays off axis in FIT mode, and keeps counting', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([-0.5, 10])} unitLabel="Zand" />,
    )
    fireEvent.click(screen.getByTestId('unit-stats-fit-toggle'))
    // Only the 10 renders; the negative is excluded — never drawn at the 0
    // wall — and the notifier says so.
    expect(qcDotXs()).toHaveLength(1)
    expect(screen.getByTestId('unit-stats-offaxis-qc').textContent).toMatch(/1 off axis/i)
  })

  it('OA6 — a whisker spanning off-axis values is dropped WITH a reason, never silently', () => {
    // Mostly-negative pool: P5 < 0, so the whisker (and box) cannot be placed
    // whole on a zero-anchored axis. Dropping them without a word left the
    // row looking like it had no spread at all.
    render(
      <UnitDistributionPanels
        statistics={qcStatistics([-3, -2, -1, -0.5, 5])}
        unitLabel="Artefact"
      />,
    )
    const row = screen.getByTestId('unit-stats-row-qc')
    expect(row.querySelector('[data-testid="unit-stats-box-qc"]')).toBeNull()
    const note = screen.getByTestId('unit-stats-offaxis-qc')
    expect(note.textContent).toMatch(/4 off axis/i)
    // The reason the marks are missing is stated, not implied.
    expect(screen.getByTestId('unit-stats-marksoff-qc').textContent).toMatch(/not drawn/i)
  })
})

describe('S3 — more sublabels on the value axes, not too many', () => {
  it('TKD1 — the qc row labels intermediate ticks, not just the ends', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([10])} unitLabel="Zand" />,
    )
    const row = screen.getByTestId('unit-stats-row-qc')
    const labels = Array.from(
      row.querySelectorAll('[data-testid="unit-stats-axis-tick-qc"]'),
    ).map(el => el.textContent)
    // The DOV convention steps: 5 … 35 between the two ends.
    expect(labels).toEqual(['5', '10', '15', '20', '25', '30', '35'])
  })

  it('TKD2 — in fit mode the ticks derive from the fitted span', () => {
    render(
      <UnitDistributionPanels statistics={qcStatistics([2, 11.3])} unitLabel="Zand" />,
    )
    fireEvent.click(screen.getByTestId('unit-stats-fit-toggle'))
    const row = screen.getByTestId('unit-stats-row-qc')
    const labels = Array.from(
      row.querySelectorAll('[data-testid="unit-stats-axis-tick-qc"]'),
    ).map(el => el.textContent)
    // Pooled max 11.3 → fitted axis 0–12, step 2.
    expect(labels).toEqual(['2', '4', '6', '8', '10'])
    expect(screen.getByTestId('unit-stats-axis-max-qc').textContent).toContain('12')
  })
})

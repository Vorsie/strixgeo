// Axis pins for the per-unit distribution panel — the owner's first-dogfeed
// ruling, verbatim: "Qc/fs/rf should start at zero, u can use the same axes
// as the cpt plot."
//
// The CPT plot's axes are the DOV standard fixed scales (CptChart):
// qc 0–40 MPa, fs 0–1 MPa, Rf 0–10 %. A distribution drawn on the same axes
// is comparable against every CPT chart in the app AND against every other
// unit — an observed-range axis makes every unit's box look the same width.
//
// AX1 — a qc value maps by the CPT plot's own 0–40 MPa axis (10 MPa → 25 %
//       of the row), never by the observed range.
// AX2 — fs maps by the 0–1 MPa axis (0.25 MPa → 25 %).
// AX3 — Rf maps by the 0–10 % axis (2.5 % → 25 %).
// AX4 — the axis spans 0 → full scale even when the samples span neither end:
//       readings 4 and 16 MPa sit at 10 % and 40 % of the row, not at 0 and 100.
// AX5 — a reading past the CPT plot's full scale does NOT render (no
//       clamping — owner S2, 2026-08-27: "if something is off the axis then
//       it doesn't render") and it never stretches the axis; the readout
//       still reports the true value.
// AX6 — each row names its axis ends (0 and the full-scale value) so the
//       shared scale is readable, not implied.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import UnitDistributionPanels from './UnitDistributionPanels'
import { computeUnitStatistics, type UnitChannelSeries } from './unitStatistics'

afterEach(cleanup)

/** Statistics over one CPT with a single reading per channel. */
function singleReadingStatistics(qc: number, fs: number, rf: number) {
  const series = new Map<string, UnitChannelSeries>([
    ['cpt-a', { depthsM: [1], qcMpa: [qc], fsMpa: [fs], rfPct: [rf] }],
  ])
  return computeUnitStatistics([{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 10 }], series)
}

/** All dots of one channel's strip, as user-space x positions (0–100). */
function dotXs(channel: string): number[] {
  const row = screen.getByTestId(`unit-stats-row-${channel}`)
  return Array.from(
    row.querySelectorAll<SVGCircleElement>(`[data-testid="unit-stats-dot-${channel}"]`),
  ).map(dot => Number(dot.getAttribute('cx')))
}

describe('UnitDistributionPanels — the CPT plot axes, starting at zero', () => {
  it('AX1 — qc maps by the CPT plot 0–40 MPa axis, not the observed range', () => {
    render(
      <UnitDistributionPanels
        statistics={singleReadingStatistics(10, 0.25, 2.5)}
        unitLabel="Zand"
      />,
    )
    // 10 MPa on a 0–40 axis = a quarter of the row.
    expect(dotXs('qc')).toHaveLength(1)
    expect(dotXs('qc')[0]).toBeCloseTo(25, 4)
  })

  it('AX2 — fs maps by the CPT plot 0–1 MPa axis', () => {
    render(
      <UnitDistributionPanels
        statistics={singleReadingStatistics(10, 0.25, 2.5)}
        unitLabel="Zand"
      />,
    )
    expect(dotXs('fs')[0]).toBeCloseTo(25, 4)
  })

  it('AX3 — Rf maps by the CPT plot 0–10 % axis', () => {
    render(
      <UnitDistributionPanels
        statistics={singleReadingStatistics(10, 0.25, 2.5)}
        unitLabel="Zand"
      />,
    )
    expect(dotXs('rf')[0]).toBeCloseTo(25, 4)
  })

  it('AX4 — the axis spans 0 → full scale even when the samples span neither end', () => {
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', { depthsM: [1, 2], qcMpa: [4, 16], fsMpa: null, rfPct: null }],
    ])
    const stats = computeUnitStatistics(
      [{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 10 }],
      series,
    )
    render(<UnitDistributionPanels statistics={stats} unitLabel="Zand" />)

    const xs = dotXs('qc').sort((a, b) => a - b)
    // 4 MPa → 10 % of the row, 16 MPa → 40 % — NOT stretched to 0 and 100.
    expect(xs[0]).toBeCloseTo(10, 4)
    expect(xs[xs.length - 1]).toBeCloseTo(40, 4)
  })

  it('AX5 — a reading past the CPT plot full scale does not render (no clamping)', () => {
    render(
      <UnitDistributionPanels
        statistics={singleReadingStatistics(60, 0.25, 2.5)}
        unitLabel="Vast zand"
      />,
    )
    // 60 MPa is off the CPT plot's 0–40 axis: off the axis means it does not
    // render — nothing is pinned to the row end, the axis never stretches.
    expect(dotXs('qc')).toHaveLength(0)
    // ...and the readout still tells the truth about the value.
    const qcRow = screen.getByTestId('unit-stats-row-qc')
    expect(within(qcRow).getByTestId('unit-stats-max-qc').textContent).toContain('60')
  })

  it('AX6 — each row names its axis ends so the shared scale is readable', () => {
    render(
      <UnitDistributionPanels
        statistics={singleReadingStatistics(10, 0.25, 2.5)}
        unitLabel="Zand"
      />,
    )
    expect(screen.getByTestId('unit-stats-axis-max-qc').textContent).toContain('40')
    expect(screen.getByTestId('unit-stats-axis-max-fs').textContent).toContain('1')
    expect(screen.getByTestId('unit-stats-axis-max-rf').textContent).toContain('10')
    expect(screen.getByTestId('unit-stats-axis-zero-qc').textContent).toContain('0')
  })
})

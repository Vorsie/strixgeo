// Pins for the per-unit distribution panel — the surface the owner ballot
// (2026-08-26) called "per-unit statistics plots (raincloud/box of qc, fs, Rf
// over a selected unit)".
//
// UP1 — all three channels always draw a row, in qc / fs / Rf order, whatever
//       the hole recorded.
// UP2 — a unit with no CPT measurements says so; it never shows an empty box.
// UP3 — the five-number readout carries the real values, so the plot is
//       readable as a table too.
// UP4 — the panel states that these are characterisation outputs, not design
//       parameters (the liability line — docs/commercial-direction.md).
// UP5 — a channel the file never recorded says so in its OWN row while the
//       recorded channels still draw.
// UP6 — the reported n is the true sample count even when the strip draws
//       fewer dots than there are samples.

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import UnitDistributionPanels from './UnitDistributionPanels'
import { computeUnitStatistics, type UnitChannelSeries } from './unitStatistics'

afterEach(cleanup)

/** Statistics over one CPT carrying qc + fs but no Rf column. */
function twoChannelStatistics() {
  const series = new Map<string, UnitChannelSeries>([
    [
      'cpt-a',
      {
        depthsM: [1, 2, 3, 4],
        qcMpa: [4, 8, 12, 16],
        fsMpa: [0.1, 0.2, 0.3, 0.4],
        rfPct: null,
      },
    ],
  ])
  return computeUnitStatistics([{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 10 }], series)
}

describe('UnitDistributionPanels', () => {
  it('UP1 — draws one row per channel, always three, in qc / fs / Rf order', () => {
    render(
      <UnitDistributionPanels statistics={twoChannelStatistics()} unitLabel="Dicht zand" />,
    )

    const rows = screen.getAllByTestId(/^unit-stats-row-/)
    expect(rows.map(r => r.getAttribute('data-testid'))).toEqual([
      'unit-stats-row-qc',
      'unit-stats-row-fs',
      'unit-stats-row-rf',
    ])
  })

  it('UP2 — a unit with no CPT measurements says so instead of drawing an empty box', () => {
    const empty = computeUnitStatistics([], new Map())
    render(<UnitDistributionPanels statistics={empty} unitLabel="Skeleton unit" />)

    expect(screen.getByTestId('unit-stats-empty')).toBeTruthy()
    // No box is drawn for a unit with nothing in it.
    expect(screen.queryByTestId('unit-stats-box-qc')).toBeNull()
  })

  it('UP3 — the five-number readout carries the real values', () => {
    render(
      <UnitDistributionPanels statistics={twoChannelStatistics()} unitLabel="Dicht zand" />,
    )

    const qcRow = screen.getByTestId('unit-stats-row-qc')
    // qc samples are 4, 8, 12, 16 → median 10, min 4, max 16.
    expect(within(qcRow).getByTestId('unit-stats-median-qc').textContent).toContain('10')
    expect(within(qcRow).getByTestId('unit-stats-min-qc').textContent).toContain('4')
    expect(within(qcRow).getByTestId('unit-stats-max-qc').textContent).toContain('16')
    expect(within(qcRow).getByTestId('unit-stats-n-qc').textContent).toContain('4')
  })

  it('UP4 — states that these are characterisation outputs, not design parameters', () => {
    render(
      <UnitDistributionPanels statistics={twoChannelStatistics()} unitLabel="Dicht zand" />,
    )

    const note = screen.getByTestId('unit-stats-characterisation-note')
    expect(note.textContent ?? '').toMatch(/characterisation/i)
  })

  it('UP5 — a channel the file never recorded says so in its own row', () => {
    render(
      <UnitDistributionPanels statistics={twoChannelStatistics()} unitLabel="Dicht zand" />,
    )

    // Rf was never recorded on this hole.
    const rfRow = screen.getByTestId('unit-stats-row-rf')
    expect(within(rfRow).getByTestId('unit-stats-nodata-rf')).toBeTruthy()
    // ...while qc, which WAS recorded, still draws its box.
    expect(screen.getByTestId('unit-stats-box-qc')).toBeTruthy()
  })

  it('UP7 — readings that are all the same draw NO spread, not a full-width box', () => {
    // Rf computed as fs·100/qc comes out identical at every depth on a hole
    // whose fs tracks qc — but in floating point "identical" is 1.1000000000000001
    // vs 1.0999999999999999. Under the CPT plot's fixed 0–10 % Rf axis (the
    // 2026-08-27 axes ruling) every such reading maps to the same spot — the
    // picture must not claim a spread the readout (min = max, sd = 0) denies.
    const rf = [1.1, 1.1 + Number.EPSILON, 1.1 - Number.EPSILON, 1.1]
    const series = new Map<string, UnitChannelSeries>([
      [
        'cpt-a',
        { depthsM: [1, 2, 3, 4], qcMpa: [1, 1, 1, 1], fsMpa: null, rfPct: rf },
      ],
    ])
    const stats = computeUnitStatistics(
      [{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 10 }],
      series,
    )
    render(<UnitDistributionPanels statistics={stats} unitLabel="Uniform" />)

    const box = screen.getByTestId('unit-stats-box-rf')
    const x = Number(box.getAttribute('x'))
    const width = Number(box.getAttribute('width'))
    // One mark at 1.1 % of the 0–10 % axis, not a box spanning the row.
    expect(x).toBeCloseTo(11, 6)
    expect(width).toBeLessThan(1)

    // Every sample dot lands on that same line.
    const rfRow = screen.getByTestId('unit-stats-row-rf')
    const dots = Array.from(
      rfRow.querySelectorAll<SVGCircleElement>('[data-testid="unit-stats-dot-rf"]'),
    )
    expect(dots.length).toBeGreaterThan(0)
    for (const dot of dots) {
      expect(Number(dot.getAttribute('cx'))).toBeCloseTo(11, 6)
    }
  })

  it('UP6 — the reported n is the true sample count, not the number of dots drawn', () => {
    // 900 samples is past the strip's dot budget, so the plot subsamples what
    // it draws. The count the engineer reads must stay the real one.
    const depths = Array.from({ length: 900 }, (_, i) => i * 0.02)
    const qc = depths.map((_, i) => i * 0.01)
    const series = new Map<string, UnitChannelSeries>([
      ['cpt-a', { depthsM: depths, qcMpa: qc, fsMpa: null, rfPct: null }],
    ])
    const stats = computeUnitStatistics(
      [{ cptId: 'cpt-a', topDepthM: 0, baseDepthM: 100 }],
      series,
    )
    render(<UnitDistributionPanels statistics={stats} unitLabel="Deep sand" />)

    const qcRow = screen.getByTestId('unit-stats-row-qc')
    expect(within(qcRow).getByTestId('unit-stats-n-qc').textContent).toContain('900')
    const dots = qcRow.querySelectorAll('[data-testid="unit-stats-dot-qc"]')
    expect(dots.length).toBeGreaterThan(0)
    expect(dots.length).toBeLessThan(900)
  })
})

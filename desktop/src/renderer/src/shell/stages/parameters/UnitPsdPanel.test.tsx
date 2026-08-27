// Pins for the per-unit PSD overlay graph — owner ruling S5, 2026-08-27,
// verbatim: "i'm missing all PSD's on one graph."
//
// PP1 — ALL the unit's grain-size curves overlay on ONE graph, one polyline
//       per curve.
// PP2 — the conventional sieve anchors are labelled: 0.002, 0.063, 0.2, 2,
//       63 mm (log axis).
// PP3 — hovering a curve names borehole + sample + depth.
// PP4 — no curves → the panel does not render at all (no empty jars).
// PP5 — the % passing axis is labelled 0–100.
// PP6 — skipped thin curves are reported next to the graph.

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import UnitPsdPanel from './UnitPsdPanel'
import type { UnitPsdPool } from './unitPsd'

afterEach(cleanup)

function pool(overrides: Partial<UnitPsdPool> = {}): UnitPsdPool {
  return {
    curves: [
      {
        key: 'g1',
        points: [
          { diameterMm: 0.002, pctFiner: 10 },
          { diameterMm: 0.063, pctFiner: 40 },
          { diameterMm: 2, pctFiner: 95 },
        ],
        boreholeName: 'B1',
        sampleNumber: '5',
        depthTopM: 1.2,
        depthBaseM: 1.7,
      },
      {
        key: 'g2',
        points: [
          { diameterMm: 0.063, pctFiner: 20 },
          { diameterMm: 2, pctFiner: 80 },
        ],
        boreholeName: 'B2',
        sampleNumber: null,
        depthTopM: 3,
        depthBaseM: 3.5,
      },
    ],
    skippedCurves: 0,
    ...overrides,
  }
}

describe('UnitPsdPanel — all PSDs on one graph', () => {
  it('PP1 — one polyline per curve, all on one graph', () => {
    const { container } = render(<UnitPsdPanel pool={pool()} />)
    expect(screen.getByTestId('unit-psd-panel')).toBeTruthy()
    const curves = container.querySelectorAll('[data-testid^="unit-psd-curve-"]')
    expect(curves).toHaveLength(2)
  })

  it('PP2 — the conventional sieve anchors are labelled', () => {
    render(<UnitPsdPanel pool={pool()} />)
    const labels = screen
      .getAllByTestId('unit-psd-anchor-label')
      .map(el => el.textContent)
    for (const anchor of ['63', '2', '0.2', '0.063', '0.002']) {
      expect(labels).toContain(anchor)
    }
  })

  it('PP3 — hovering a curve names borehole + sample + depth', () => {
    const { container } = render(<UnitPsdPanel pool={pool()} />)
    const title = container.querySelector('[data-testid="unit-psd-curve-g1"] title')
    expect(title?.textContent).toContain('B1')
    expect(title?.textContent).toContain('sample 5')
    expect(title?.textContent).toContain('1.20')
    expect(title?.textContent).toContain('1.70')
  })

  it('PP4 — no curves, no panel (no empty jars)', () => {
    const { container } = render(
      <UnitPsdPanel pool={{ curves: [], skippedCurves: 2 }} />,
    )
    expect(container.firstChild).toBeNull()
  })

  it('PP5 — the % passing axis is labelled 0–100', () => {
    render(<UnitPsdPanel pool={pool()} />)
    const labels = screen
      .getAllByTestId('unit-psd-pct-label')
      .map(el => el.textContent)
    expect(labels).toContain('0')
    expect(labels).toContain('100')
  })

  it('PP6 — skipped thin curves are reported', () => {
    render(<UnitPsdPanel pool={pool({ skippedCurves: 3 })} />)
    expect(screen.getByTestId('unit-psd-skipped').textContent).toMatch(/3/)
  })
})

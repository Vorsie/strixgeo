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
// PP7 — each curve is inked by its SAMPLE, not its index: a curve's stroke is
//       ``sampleColor(sampleId)`` and two curves of the SAME sample (sieve +
//       hydrometer) share it (owner 2026-08-28).
// PP8 — the diameter (X) and passing (Y) axes carry labelled titles with
//       units (owner 2026-08-28: "properly label all axes").
// PP9 — right-clicking a curve offers "go to the sample on a cross-section",
//       and choosing it hands the curve back to the caller (owner 2026-08-28).
// PP10 — with no reveal handler wired, a right-click opens no menu (the panel
//        never advertises an affordance nothing can honour).

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import UnitPsdPanel from './UnitPsdPanel'
import { sampleColor } from './sampleColor'
import type { UnitPsdCurve, UnitPsdPool } from './unitPsd'

afterEach(cleanup)

function pool(overrides: Partial<UnitPsdPool> = {}): UnitPsdPool {
  return {
    curves: [
      {
        key: 'g1',
        sampleId: 'sample-1',
        boreholeId: 'bh-1',
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
        sampleId: 'sample-2',
        boreholeId: 'bh-2',
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

  it('PP7 — each curve is coloured by its sample, shared with the dots', () => {
    const { container } = render(<UnitPsdPanel pool={pool()} />)
    const c1 = container.querySelector('[data-testid="unit-psd-curve-g1"]')
    const c2 = container.querySelector('[data-testid="unit-psd-curve-g2"]')
    // The colour key is the SAMPLE — the same colour the scatter dots use.
    expect(c1?.getAttribute('stroke')).toBe(sampleColor('sample-1'))
    expect(c2?.getAttribute('stroke')).toBe(sampleColor('sample-2'))
    // Two different samples must not read as one colour.
    expect(c1?.getAttribute('stroke')).not.toBe(c2?.getAttribute('stroke'))
  })

  it('PP7b — two curves of the SAME sample (sieve + hydrometer) share one colour', () => {
    const twoRecords = pool({
      curves: [
        {
          key: 'sieve',
          sampleId: 'sample-9',
          boreholeId: 'bh-1',
          points: [
            { diameterMm: 0.2, pctFiner: 30 },
            { diameterMm: 2, pctFiner: 90 },
          ],
          boreholeName: 'B1',
          sampleNumber: '9',
          depthTopM: 1,
          depthBaseM: 2,
        },
        {
          key: 'hydro',
          sampleId: 'sample-9',
          boreholeId: 'bh-1',
          points: [
            { diameterMm: 0.002, pctFiner: 5 },
            { diameterMm: 0.063, pctFiner: 20 },
          ],
          boreholeName: 'B1',
          sampleNumber: '9',
          depthTopM: 1,
          depthBaseM: 2,
        },
      ],
    })
    const { container } = render(<UnitPsdPanel pool={twoRecords} />)
    const sieve = container.querySelector('[data-testid="unit-psd-curve-sieve"]')
    const hydro = container.querySelector('[data-testid="unit-psd-curve-hydro"]')
    expect(sieve?.getAttribute('stroke')).toBe(sampleColor('sample-9'))
    expect(hydro?.getAttribute('stroke')).toBe(sampleColor('sample-9'))
  })

  it('PP8 — the diameter and passing axes carry labelled titles with units', () => {
    render(<UnitPsdPanel pool={pool()} />)
    expect(screen.getByTestId('unit-psd-xaxis-label').textContent).toMatch(/diameter.*mm/i)
    expect(screen.getByTestId('unit-psd-yaxis-label').textContent).toMatch(/passing.*%|%.*passing/i)
  })

  it('PP9 — right-click a curve → "go to the sample on a cross-section"', () => {
    const onRevealSample = vi.fn<(c: UnitPsdCurve) => void>()
    const { container } = render(<UnitPsdPanel pool={pool()} onRevealSample={onRevealSample} />)
    const curve = container.querySelector('[data-testid="unit-psd-curve-g1"]')!
    fireEvent.contextMenu(curve)
    const item = screen.getByTestId('unit-psd-reveal-sample')
    expect(item.textContent).toMatch(/cross-section/i)
    fireEvent.click(item)
    expect(onRevealSample).toHaveBeenCalledTimes(1)
    expect(onRevealSample.mock.calls[0][0].sampleId).toBe('sample-1')
    expect(onRevealSample.mock.calls[0][0].boreholeId).toBe('bh-1')
  })

  it('PP10 — no reveal handler → a right-click opens no menu', () => {
    const { container } = render(<UnitPsdPanel pool={pool()} />)
    const curve = container.querySelector('[data-testid="unit-psd-curve-g1"]')!
    fireEvent.contextMenu(curve)
    expect(screen.queryByTestId('unit-psd-reveal-sample')).toBeNull()
  })
})

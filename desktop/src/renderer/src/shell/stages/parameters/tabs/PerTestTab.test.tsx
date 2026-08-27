// Regression anchors for PerTestTab (audit F6 cache + the 2026-08-03 reshape).
//
// PT1 — With no plotMap entries: rows render CPTs with ic_avg = "—".
//
// PT2 — After a CPT's plot is loaded: ic_avg is populated for that CPT.
//
// PT3 — Cache stability: loading a second CPT's plot does NOT change the
//        ic_avg displayed for the first CPT (the stats computed in PT2 are
//        served from the cache without recomputing).
//
// PT4 — Owner ruling 2026-08-03: there is NO "SBT (dominant)" column. A single
//        dominant zone over a whole profile is geotechnically meaningless.
//
// PT5 — Owner ruling 2026-08-03: clicking a CPT row SELECTS it (which is what
//        makes the inspector plot it, and warms the plot cache), instead of
//        expanding an inline chart under the table.
//
// PT6 — …and selecting it here must NOT move the Data stage's view mode.
//        Plotting a CPT in Parameters is not a statement about where Data
//        should land the next time the engineer opens it.

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse } from '../../../../api/client'

// ---------------------------------------------------------------------------
// Shared mock state — tests mutate mockCpts and mockPlotMap then re-render.
// ---------------------------------------------------------------------------

let mockCpts: { id: string; name: string; max_depth_m: number | null; location_x: number; location_y: number }[] = []
let mockBoreholes: unknown[] = []
let mockPlotMap: Map<string, CptPlotResponse> = new Map()
let mockSelectedId: string | null = null
const mockHandleSelect = vi.fn(async () => {})
const mockHandleSelectWithoutView = vi.fn(async () => {})
const mockSetView = vi.fn()

vi.mock('../../../ShellContext', () => ({
  useShell: () => ({
    investigations: {
      cpts: mockCpts,
      boreholes: mockBoreholes,
      plotMap: mockPlotMap,
    },
    coordinator: {
      selectedId: mockSelectedId,
      handleSelect: mockHandleSelect,
      handleSelectWithoutView: mockHandleSelectWithoutView,
      setView: mockSetView,
    },
  }),
}))

afterEach(() => {
  cleanup()
  mockCpts = []
  mockBoreholes = []
  mockPlotMap = new Map()
  mockSelectedId = null
  mockHandleSelect.mockClear()
  mockHandleSelectWithoutView.mockClear()
  mockSetView.mockClear()
})

// Minimal CPT plot with a flat ic series.
function makePlot(icValues: number[]): CptPlotResponse {
  return {
    depths: icValues.map((_, i) => i * 0.02),
    qc: icValues.map(() => 5),
    fs: icValues.map(() => 0.05),
    u2: null,
    rf: icValues.map(() => 1),
    qt: null,
    ic: icValues,
  } as unknown as CptPlotResponse
}

import PerTestTab from './PerTestTab'

// Column order: name(0), kind(1), depth(2), x/y(3), ic_avg(4), then Phase-5.
const IC_AVG_CELL = 4

describe('PerTestTab derived-stats cache (audit F6)', () => {
  it('PT1 — CPT rows show "—" when no plot is loaded yet', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]
    mockPlotMap = new Map()

    render(<PerTestTab />)

    const cells = screen.getByTestId('parameters-row-cpt-1').querySelectorAll('td')
    expect(cells[IC_AVG_CELL]?.textContent).toBe('—')
  })

  it('PT2 — ic_avg is populated once the plot arrives', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])]])

    render(<PerTestTab />)

    const cells = screen.getByTestId('parameters-row-cpt-1').querySelectorAll('td')
    expect(cells[IC_AVG_CELL]?.textContent).toBe('1.80')
  })

  it('PT3 — loading a second CPT plot does not change the first CPT stats', async () => {
    mockCpts = [
      { id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 },
      { id: 'cpt-2', name: 'CPT-2', max_depth_m: 15, location_x: 10, location_y: 10 },
    ]
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])]])

    const { rerender } = render(<PerTestTab />)

    const icTextBefore = screen
      .getByTestId('parameters-row-cpt-1')
      .querySelectorAll('td')[IC_AVG_CELL]?.textContent

    // Simulate cpt-2's plot arriving — a NEW Map (mirrors setPlotMap).
    await act(async () => {
      mockPlotMap = new Map([
        ['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])],
        ['cpt-2', makePlot([2.8, 2.8, 2.8, 2.8])],
      ])
      rerender(<PerTestTab />)
    })

    const cells1After = screen.getByTestId('parameters-row-cpt-1').querySelectorAll('td')
    expect(cells1After[IC_AVG_CELL]?.textContent).toBe(icTextBefore)

    const cells2 = screen.getByTestId('parameters-row-cpt-2').querySelectorAll('td')
    expect(cells2[IC_AVG_CELL]?.textContent).toBe('2.80')
  })
})

describe('PerTestTab — owner ruling 2026-08-03', () => {
  it('PT4 — carries no dominant-SBT column', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])]])

    render(<PerTestTab />)

    expect(screen.queryByText(/SBT \(dominant\)/i)).toBeNull()
    // …and the soil name that column used to print is nowhere in the table.
    expect(screen.queryByText('Sand', { exact: true })).toBeNull()
  })

  it('PT5 — clicking a CPT row selects it instead of expanding a chart', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8])]])

    render(<PerTestTab />)
    fireEvent.click(screen.getByTestId('parameters-row-cpt-1'))

    expect(mockHandleSelectWithoutView).toHaveBeenCalledWith('cpt-1')
    // The inline panel the ruling killed must not come back.
    expect(screen.queryByTestId('parameters-ic-sbt-panel')).toBeNull()
  })

  it('PT6 — selecting here does not rewrite where the Data stage lands', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]

    render(<PerTestTab />)
    fireEvent.click(screen.getByTestId('parameters-row-cpt-1'))

    // handleSelect carries a setView('chart') side effect that belongs to the
    // Data stage; the Parameters row click must take the variant without it.
    expect(mockHandleSelect).not.toHaveBeenCalled()
    expect(mockSetView).not.toHaveBeenCalled()
  })

  it('PT5b — the selected CPT row is marked selected for assistive tech', () => {
    mockCpts = [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 }]
    mockSelectedId = 'cpt-1'

    render(<PerTestTab />)

    expect(screen.getByTestId('parameters-row-cpt-1').getAttribute('aria-selected')).toBe('true')
  })
})

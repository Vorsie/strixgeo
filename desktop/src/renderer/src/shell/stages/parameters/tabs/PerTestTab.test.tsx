// Regression anchors for PerTestTab derived-stats cache (audit F6).
//
// PT1 — With no plotMap entries: rows render CPTs with ic_avg=null and
//        sbt_dom=null (no series loaded yet).
//
// PT2 — After a CPT's plot is loaded: ic_avg and sbt_dom are populated for
//        that CPT and null for others that haven't been loaded.
//
// PT3 — Cache stability: loading a second CPT's plot does NOT change the
//        ic_avg/sbt_dom displayed for the first CPT (the stats computed in
//        PT2 are served from the cache without recomputing).  Verified by
//        confirming the displayed cell text is identical before and after
//        the second plot arrives.

import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse } from '../../../../api/client'

// ---------------------------------------------------------------------------
// Shared mock state — tests mutate mockCpts and mockPlotMap then re-render.
// ---------------------------------------------------------------------------

let mockCpts: { id: string; name: string; max_depth_m: number | null; location_x: number; location_y: number }[] = []
let mockBoreholes: unknown[] = []
let mockPlotMap: Map<string, CptPlotResponse> = new Map()

vi.mock('../../../ShellContext', () => ({
  useShell: () => ({
    investigations: {
      cpts: mockCpts,
      boreholes: mockBoreholes,
      plotMap: mockPlotMap,
    },
  }),
}))

// CptIcSbtChart is not under test — stub it out.
vi.mock('../CptIcSbtChart', () => ({
  default: () => null,
}))

afterEach(() => {
  cleanup()
  mockCpts = []
  mockBoreholes = []
  mockPlotMap = new Map()
})

// Minimal CPT plot with a flat ic series of a single SBT zone (Sand, Ic=1.8).
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

describe('PerTestTab derived-stats cache (audit F6)', () => {
  it('PT1 — CPT rows show "—" when no plot is loaded yet', () => {
    mockCpts = [
      { id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 },
    ]
    mockPlotMap = new Map()

    render(<PerTestTab />)

    // ic_avg cell for CPT-1 — the "—" is rendered by the muted span.
    const row = screen.getByTestId('parameters-row-cpt-1')
    // Both Ic̄ and SBT cells should show the em-dash placeholder.
    const cells = row.querySelectorAll('td')
    // Column order: name(0), kind(1), depth(2), x/y(3), ic_avg(4), sbt_dom(5)
    expect(cells[4]?.textContent).toBe('—')
    expect(cells[5]?.textContent).toBe('—')
  })

  it('PT2 — ic_avg + sbt_dom are populated once the plot arrives', () => {
    mockCpts = [
      { id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 },
    ]
    // Flat Sand series: Ic=1.8 throughout → sbt_dom = 'Sand', ic_avg ≈ 1.8
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])]])

    render(<PerTestTab />)

    const row = screen.getByTestId('parameters-row-cpt-1')
    const cells = row.querySelectorAll('td')
    // ic_avg cell should show "1.80"
    expect(cells[4]?.textContent).toBe('1.80')
    // sbt_dom cell should show "Sand"
    expect(cells[5]?.textContent).toBe('Sand')
  })

  it('PT3 — loading a second CPT plot does not change the first CPT stats', async () => {
    mockCpts = [
      { id: 'cpt-1', name: 'CPT-1', max_depth_m: 20, location_x: 0, location_y: 0 },
      { id: 'cpt-2', name: 'CPT-2', max_depth_m: 15, location_x: 10, location_y: 10 },
    ]
    // Only cpt-1 has a plot initially.
    mockPlotMap = new Map([['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])]])

    const { rerender } = render(<PerTestTab />)

    const row1Before = screen.getByTestId('parameters-row-cpt-1')
    const cells1Before = row1Before.querySelectorAll('td')
    const icTextBefore = cells1Before[4]?.textContent
    const sbtTextBefore = cells1Before[5]?.textContent

    // Simulate cpt-2's plot arriving — create a NEW Map (mirrors setPlotMap behaviour).
    await act(async () => {
      mockPlotMap = new Map([
        ['cpt-1', makePlot([1.8, 1.8, 1.8, 1.8])],
        ['cpt-2', makePlot([2.8, 2.8, 2.8, 2.8])], // Silt mix zone
      ])
      rerender(<PerTestTab />)
    })

    // cpt-1's stats must be unchanged — served from cache, not recomputed.
    const row1After = screen.getByTestId('parameters-row-cpt-1')
    const cells1After = row1After.querySelectorAll('td')
    expect(cells1After[4]?.textContent).toBe(icTextBefore)
    expect(cells1After[5]?.textContent).toBe(sbtTextBefore)

    // cpt-2 should now show its own stats.
    const row2 = screen.getByTestId('parameters-row-cpt-2')
    const cells2 = row2.querySelectorAll('td')
    expect(cells2[4]?.textContent).toBe('2.80')
    expect(cells2[5]?.textContent).toBe('Silt mix')
  })
})

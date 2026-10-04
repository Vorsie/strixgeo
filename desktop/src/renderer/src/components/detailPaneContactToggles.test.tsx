// Owner 2026-10-04 (Data-stage dogfeed): "on the data stage make it so that
// i can turn off lithological boundaries and stratigraphic boundaries, now
// it is a mess". Both detail panes (CPT chart and borehole log) carry the
// two switches in their controls row, next to the DOV overlay control.

import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse } from '../api/client'
import { makeFixtureBorehole } from '../test/fixtures/borehole'
import BoreholeLog from './BoreholeLog'
import CptChart from './CptChart'

vi.mock('../hooks/useVirtueleBoringCatalog', () => ({
  useVirtueleBoringCatalog: () => ({ catalog: null, failed: false, status: null }),
}))

const PLOT: CptPlotResponse = {
  cpt_id: 'cpt-1',
  depths_m: [0, 1, 2, 3],
  qc_mpa: [0.5, 1.0, 1.5, 2.0],
  fs_mpa: null,
  u2_mpa: null,
  rf_pct: null,
  qt_mpa: null,
  q_total_mpa: null,
  ic: null,
  rf_source: null,
}

beforeEach(() => {
  localStorage.clear()
})

function expectSwitches(onToggle: ReturnType<typeof vi.fn>): void {
  const strat = screen.getByRole('button', { name: 'Stratigraphic boundaries' })
  const litho = screen.getByRole('button', { name: 'Lithological boundaries' })
  expect(strat.getAttribute('aria-pressed')).toBe('true')
  expect(litho.getAttribute('aria-pressed')).toBe('false')
  fireEvent.click(litho)
  expect(onToggle).toHaveBeenCalledWith('litho')
}

describe('detail-pane boundary switches', () => {
  it('the CPT chart shows the stratigraphic and lithological switches', () => {
    const onToggle = vi.fn()
    render(
      <CptChart
        plot={PLOT}
        name="CPT-1"
        contactOverlayVisibility={{ geology: true, litho: false }}
        onToggleContactOverlay={onToggle}
      />,
    )
    expectSwitches(onToggle)
  })

  it('the borehole log shows the stratigraphic and lithological switches', () => {
    const onToggle = vi.fn()
    render(
      <BoreholeLog
        borehole={makeFixtureBorehole()}
        contactOverlayVisibility={{ geology: true, litho: false }}
        onToggleContactOverlay={onToggle}
      />,
    )
    expectSwitches(onToggle)
  })

  it('no switches when the pane is not given a toggle handler', () => {
    render(<CptChart plot={PLOT} name="CPT-1" />)
    expect(screen.queryByRole('button', { name: 'Lithological boundaries' })).toBeNull()
  })
})

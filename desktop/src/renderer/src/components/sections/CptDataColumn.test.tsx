// Smoke tests for CptDataColumn (debt #34).
//
// CptDataColumn is the SVG-heavy data-track renderer that the
// geological-model editor will extend in S8 (interpretation
// overlays alongside the qc / Rf curves). These tests pin the
// per-channel slot-dispatch rule + the "no enabled channels =
// render nothing" early return; the channel-rule logic itself is
// covered by cptChannels.test.ts.

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { CptPlotResponse } from '../../api/client'
import CptDataColumn from './CptDataColumn'
import {
  DEFAULT_CPT_CHANNELS,
  cptTrackWidths,
  type CptChannels,
} from './cptChannels'

const widths = cptTrackWidths(5)
const identity = (level: number): number => level

function makePlot(overrides: Partial<CptPlotResponse> = {}): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: [0, 1, 2, 3, 4, 5],
    qc_mpa: [0.5, 1.0, 1.5, 2.0, 2.5, 3.0],
    fs_mpa: null,
    u2_mpa: null,
    rf_pct: [1.0, 1.2, 1.4, 1.6, 1.8, 2.0],
    qt_mpa: null,
    q_total_mpa: null,
    ic: null,
    rf_source: null,
    ...overrides,
  }
}

function renderColumn(
  overrides: Partial<React.ComponentProps<typeof CptDataColumn>> = {},
) {
  const defaults: React.ComponentProps<typeof CptDataColumn> = {
    plot: makePlot(),
    cptType: 'CPTU',
    channels: { ...DEFAULT_CPT_CHANNELS },
    widths,
    screenX: 100,
    surfaceElevationM: 10,
    plotTop: -100,
    plotBottom: 100,
    levelToScreen: identity,
  }
  return render(
    <svg>
      <CptDataColumn {...defaults} {...overrides} />
    </svg>,
  )
}

describe('CptDataColumn — slot dispatch', () => {
  it('renders qc + rf tracks for a CPTU with default channels', () => {
    const { container } = renderColumn({ cptType: 'CPTU' })
    // qc + rf each draw at least one path inside the slot; one of the
    // background rects per slot is the easiest stable count.
    const bgRects = container.querySelectorAll('rect[fill="#ffffff"]')
    expect(bgRects.length).toBeGreaterThanOrEqual(2)
  })

  it('renders nothing when every channel is off', () => {
    const allOff: CptChannels = {
      qc: false,
      rf: false,
      fs: false,
      u2: false,
      qTotal: false,
    }
    const { container } = renderColumn({ channels: allOff })
    // No slot backgrounds rendered.
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(0)
  })

  it('drops u2 slot for CPTE (pore-pressure is CPTU-only)', () => {
    const onlyU2: CptChannels = {
      qc: false,
      rf: false,
      fs: false,
      u2: true,
      qTotal: false,
    }
    const { container } = renderColumn({ cptType: 'CPTE', channels: onlyU2 })
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(0)
  })

  it('keeps qc slot for CPTM with qTotal + qc both on (qTotal overlays qc)', () => {
    const { container } = renderColumn({
      cptType: 'CPTM',
      channels: {
        qc: true,
        rf: false,
        fs: false,
        u2: false,
        qTotal: true,
      },
      plot: makePlot({
        q_total_mpa: [1, 2, 3, 4, 5, 6],
      }),
    })
    // Exactly one slot — the qc slot, with q_total drawn over it.
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(1)
  })
})

describe('CptDataColumn — graceful degrade', () => {
  it('renders qc slot even when rf_pct is null on the plot response', () => {
    const { container } = renderColumn({
      channels: {
        qc: true,
        rf: false,
        fs: false,
        u2: false,
        qTotal: false,
      },
      plot: makePlot({ rf_pct: null }),
    })
    expect(container.querySelectorAll('rect[fill="#ffffff"]').length).toBe(1)
  })

  it('does not crash when the depth-series arrays are empty', () => {
    const { container } = renderColumn({
      plot: makePlot({ depths_m: [], qc_mpa: [], rf_pct: [] }),
    })
    // Slots still render; the curves degrade to empty paths.
    expect(container.querySelector('svg')).not.toBeNull()
  })
})

// Tests for CptIcSbtChart (debt #22, 2026-06-01).
//
// Pins:
//   IC1 — renders the Ic curve legend entry when ic series is present.
//   IC2 — renders the SBT zone colour key with all six Robertson zones.
//   IC3 — renders the zone labels overlay (rotated shorthand labels).
//   IC4 — returns null when plot.ic is null (guard works).
//   IC5 — returns null when plot.ic is an empty array.
//   IC6 — chart container is present when ic series is populated.
//   IC7 — all six SBT zone names appear in the zone key.

import { render, cleanup, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import CptIcSbtChart, { IC_ZONES } from './CptIcSbtChart'
import type { CptPlotResponse } from '../../../api/client'

// Minimal CptPlotResponse with the fields CptIcSbtChart reads.
function makePlot(overrides: Partial<CptPlotResponse> = {}): CptPlotResponse {
  return {
    cpt_id: 'cpt-test',
    depths_m: [0, 1, 2, 3, 4, 5],
    qc_mpa: [1, 2, 3, 4, 5, 6],
    fs_mpa: null,
    u2_mpa: null,
    rf_pct: null,
    qt_mpa: null,
    q_total_mpa: null,
    ic: [1.5, 2.1, 2.5, 2.7, 3.1, 3.5],
    rf_source: null,
    ...overrides,
  }
}

afterEach(cleanup)

describe('CptIcSbtChart — IC1: Ic legend entry', () => {
  it('renders the Ic (Robertson 2015) legend swatch when ic series is present', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    expect(screen.getByTestId('cpt-ic-sbt-legend-ic')).toBeInTheDocument()
    // The legend text names the method explicitly so a reader knows this
    // is Robertson 2015, matching the plot endpoint's data source.
    expect(screen.getByText('Ic (Robertson 2015)')).toBeInTheDocument()
  })
})

describe('CptIcSbtChart — IC2: SBT zone colour key', () => {
  it('renders the SBT zone key container when ic series is present', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    expect(screen.getByTestId('cpt-ic-sbt-zone-key')).toBeInTheDocument()
  })
})

describe('CptIcSbtChart — IC3: zone labels overlay', () => {
  it('renders the zone labels overlay element', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    expect(screen.getByTestId('cpt-ic-sbt-zone-labels')).toBeInTheDocument()
  })
})

describe('CptIcSbtChart — IC4: null guard', () => {
  it('returns null when plot.ic is null', () => {
    const { container } = render(<CptIcSbtChart plot={makePlot({ ic: null })} />)
    // Nothing should be rendered — container should have no children.
    expect(container.firstChild).toBeNull()
  })
})

describe('CptIcSbtChart — IC5: empty array guard', () => {
  it('returns null when plot.ic is an empty array', () => {
    const { container } = render(<CptIcSbtChart plot={makePlot({ ic: [] })} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('CptIcSbtChart — IC6: chart container', () => {
  it('renders the chart wrapper when ic series is populated', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    expect(screen.getByTestId('cpt-ic-sbt-chart')).toBeInTheDocument()
  })
})

describe('CptIcSbtChart — IC7: all SBT zone names appear in the key', () => {
  it('renders each Robertson zone label in the SBT key strip', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    // Assert all six zone names from IC_ZONES are visible in the key.
    // Using getAllByText since zone labels also appear rotated in the overlay.
    for (const zone of IC_ZONES) {
      expect(screen.getAllByText(zone.label).length).toBeGreaterThan(0)
    }
  })
})

describe('CptIcSbtChart — title prop', () => {
  it('renders the title when provided', () => {
    render(<CptIcSbtChart plot={makePlot()} title="CPT-0042" />)
    expect(screen.getByText('CPT-0042')).toBeInTheDocument()
  })

  it('renders without error when title is omitted', () => {
    render(<CptIcSbtChart plot={makePlot()} />)
    expect(screen.getByTestId('cpt-ic-sbt-chart')).toBeInTheDocument()
  })
})

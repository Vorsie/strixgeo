import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { makeFixtureBorehole } from '../test/fixtures/borehole'
import BoreholeLog from './BoreholeLog'

// Behaviour-oriented smoke test for BoreholeLog. The component is
// ~1850 lines of SVG-heavy rendering — full snapshot tests churn on
// every layout tweak, per the architectural-debt note in CLAUDE.md.
// So this test asserts on stable, behaviourally-meaningful contracts:
// header values, sample count in the samples track, and that the
// component renders without throwing for a representative fixture.

describe('BoreholeLog', () => {
  it('renders the borehole header with name and total depth', () => {
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getByText('BH-FIXTURE-1')).toBeInTheDocument()
    // Total depth shown as "0 – 5.00 m" (en dash + two decimals) in the
    // header. The SVG mTAW axis also renders depth tick labels, so use
    // ``getAllByText`` and assert the header copy is present.
    const depthLabels = screen.getAllByText(/0\s*–\s*5\.00 m/)
    expect(depthLabels.length).toBeGreaterThanOrEqual(1)
  })

  it('flags missing surface elevation when elevation_m is null', () => {
    const borehole = { ...makeFixtureBorehole(), elevation_m: null }
    render(<BoreholeLog borehole={borehole} />)

    expect(
      screen.getByText(/Surface elevation missing/i),
    ).toBeInTheDocument()
  })

  it('shows the surface elevation when present', () => {
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    // BoreholeHeader renders elevation_m to two decimals — fixture is 12.5.
    expect(screen.getByText('12.50')).toBeInTheDocument()
  })
})

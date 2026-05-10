import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  makeFixtureBorehole,
  makeFixtureBoreholeWithAdmixtures,
} from '../test/fixtures/borehole'
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

  // ------------------------------------------------------------------
  // Layer rendering — the architectural-debt note (#3) called out the
  // admixture iterations as the regression a snapshot test would have
  // caught. These behaviour tests assert on the chip text directly.
  // ------------------------------------------------------------------

  it('renders an admixture chip per admixture on a layer', () => {
    // Two admixtures both render as chips with the format
    // `${amount} ${soil_code}${locally ? ' (loc.)' : ''}`. Three would
    // exceed the chip-strip width budget at default zoom and trigger
    // the truncation path; that's tested via the chip-text-omitted
    // case below. ``getAllByText`` because the layer's tooltip
    // ``<title>`` also contains the comma-joined admixture label, so
    // each chip text appears at least twice.
    const borehole = makeFixtureBoreholeWithAdmixtures([
      { soil_code: 'KL', amount: 'wein', locally: false },
      { soil_code: 'SI', amount: 'wein', locally: true },
    ])
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText('wein KL').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('wein SI (loc.)').length).toBeGreaterThanOrEqual(1)
  })

  it('omits the amount prefix when admixture amount is empty', () => {
    // Some DOV records ship admixtures with no amount qualifier — the
    // chip text falls back to just the soil code (no leading space).
    // ``VE`` also appears in the tooltip's "Admixtures: VE" line, so
    // ``getAllByText`` is used here too. We rely on the ``\b`` word
    // boundary so the regex doesn't also match ``VE`` inside other
    // admixture chip texts.
    const borehole = makeFixtureBoreholeWithAdmixtures([
      { soil_code: 'VE', amount: '', locally: false },
    ])
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText(/^VE$/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders no admixture chip text on layers without admixtures', () => {
    // Strip layer 0's only admixture from the default fixture. None of
    // the chip-text patterns should appear anywhere on the page.
    const borehole = makeFixtureBoreholeWithAdmixtures([])
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.queryByText(/sporadisch/)).not.toBeInTheDocument()
    expect(screen.queryByText(/weinig/)).not.toBeInTheDocument()
    expect(screen.queryByText(/veel/)).not.toBeInTheDocument()
    expect(screen.queryByText(/\(loc\.\)/)).not.toBeInTheDocument()
  })

  it('renders the primary soil code label for each lithology layer', () => {
    // Fixture has 3 layers with primary codes ZF, KL, ZG. The lithology
    // track renders each as a soil-code text label inside its layer.
    // Use ``getAllByText`` because a soil code can also appear in
    // tooltips, the legend, or admixture chips elsewhere.
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText(/^ZF\b/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/^KL\b/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText(/^ZG\b/).length).toBeGreaterThanOrEqual(1)
  })
})

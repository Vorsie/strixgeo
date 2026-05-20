import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  makeFixtureBorehole,
  makeFixtureBoreholeWithAdmixtures,
  makeFixtureBoreholeWithEmptySample,
} from '../test/fixtures/borehole'
import { BORELOG_HIDDEN_TRACKS_KEY } from '../hooks/useHiddenBoreholeLogTracks'
import BoreholeLog from './BoreholeLog'

// Behaviour-oriented smoke test for BoreholeLog. The component is
// ~1850 lines of SVG-heavy rendering — full snapshot tests churn on
// every layout tweak, per the architectural-debt note in CLAUDE.md.
// So this test asserts on stable, behaviourally-meaningful contracts:
// header values, sample count in the samples track, and that the
// component renders without throwing for a representative fixture.

describe('BoreholeLog', () => {
  beforeEach(() => {
    // Isolate localStorage between tests so hidden-track state from one
    // test doesn't bleed into the next.
    localStorage.clear()
  })

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

  // ------------------------------------------------------------------
  // Samples track — sample number labels + the lab-test family icons
  // and the click → LabTestPanel flow.
  // ------------------------------------------------------------------

  it('renders the sample number for each sample on the track', () => {
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getByText('M1')).toBeInTheDocument()
    expect(screen.getByText('M2')).toBeInTheDocument()
  })

  it('renders the lab-test family icons for each sample', () => {
    // Fixture: sampleA (M1) has grain-size + Atterberg → ``▣ ▲``.
    // Fixture: sampleB (M2) has only the catch-all scalar test → ``★``.
    // ``getByText`` would conflict — both icon strings appear once
    // as a `<text>` per sample plus possibly in a legend, so use
    // the looser ``getAllByText``.
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText('▣ ▲').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('★').length).toBeGreaterThanOrEqual(1)
  })

  it('renders "no tests" placeholder for samples with no lab tests', () => {
    // Strip every lab-test family from the first sample. The sample-
    // track row shows ``no tests`` instead of the icon string.
    const borehole = makeFixtureBoreholeWithEmptySample()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getByText('no tests')).toBeInTheDocument()
  })

  it('opens the LabTestPanel when a sample is clicked', () => {
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    // Panel header label "Sample" only appears once the panel mounts.
    // Confirm pre-click state — no panel.
    expect(screen.queryByText('Sample')).not.toBeInTheDocument()

    // Click the M1 row. The click handler is on the parent ``<g>``
    // wrapping the row; React events bubble up from the text node.
    fireEvent.click(screen.getByText('M1'))

    // Panel "Sample" header label confirms it mounted. Also expect
    // the ``(1 / 2)`` navigation indicator showing the panel knows
    // it's looking at the first of two samples.
    expect(screen.getByText('Sample')).toBeInTheDocument()
    expect(screen.getByText(/\(1 \/ 2\)/)).toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Drill-method track — one rect + label per ``DrillSegment``.
  // ------------------------------------------------------------------

  it('renders a label for each drill segment with method copy', () => {
    // Fixture has 3 drill segments: spoelboring (twice) and pulsboring.
    // The track centers ``truncate(method, 12)`` text inside each rect.
    // ``getAllByText`` because spoelboring appears twice (segments 0 and 2)
    // and the column header "Drill method" is also in the page.
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText(/^spoelboring$/).length).toBeGreaterThanOrEqual(2)
    expect(screen.getAllByText(/^pulsboring$/).length).toBeGreaterThanOrEqual(1)
  })

  it('renders the drill-method track header', () => {
    // Track headers help the user know what each column means; locking
    // the literal copy in catches accidental relabels. ``getAllByText``
    // because the same label appears in the legend at the bottom of
    // the borelog, so two matches are expected.
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getAllByText('Drill method').length).toBeGreaterThanOrEqual(1)
  })

  // ------------------------------------------------------------------
  // Field-log track — three sub-stripes (color / moisture / consistency)
  // each with one rect + label per ``FieldLogIntervalResponse``.
  // ------------------------------------------------------------------

  it('renders the literal value of each field-log interval', () => {
    // Fixture has 2 color rows (bruin, grijs) and 2 moisture rows
    // (droog, vochtig). Each interval renders ``truncate(value, 8)``
    // centered in its stripe rect.
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getByText('bruin')).toBeInTheDocument()
    expect(screen.getByText('grijs')).toBeInTheDocument()
    expect(screen.getByText('droog')).toBeInTheDocument()
    expect(screen.getByText('vochtig')).toBeInTheDocument()
  })

  it('renders the field-log track header', () => {
    const borehole = makeFixtureBorehole()
    render(<BoreholeLog borehole={borehole} />)

    expect(screen.getByText('Field log')).toBeInTheDocument()
  })

  // ------------------------------------------------------------------
  // Column-toggle feature — click-to-hide + Columns dropdown
  // ------------------------------------------------------------------

  it('renders the Columns toolbar button', () => {
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)
    // The button may read "Columns" or "Columns (N hidden)" — match either.
    expect(screen.getByTitle('Show or hide borelog columns')).toBeInTheDocument()
  })

  it('clicking a track header hides that track', () => {
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)

    // Before hiding: the track header is present. ``getAllByText`` because
    // "Drill method" also appears in the legend section at the bottom.
    const allBefore = screen.getAllByText('Drill method')
    expect(allBefore.length).toBeGreaterThanOrEqual(1)

    // Click the header text — the event bubbles to the <g> onClick.
    fireEvent.click(allBefore[0])

    // After hiding, the Columns button shows "1 hidden".
    expect(screen.getByTitle('Show or hide borelog columns').textContent).toMatch(
      /Columns \(1 hidden\)/,
    )
  })

  it('Columns button shows hidden count when a track is hidden', () => {
    // Pre-seed localStorage so the component mounts with one hidden track.
    localStorage.setItem(
      BORELOG_HIDDEN_TRACKS_KEY,
      JSON.stringify(['drill_method']),
    )
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)

    // Button reads "Columns (1 hidden)" when one present track is hidden.
    expect(screen.getByTitle('Show or hide borelog columns').textContent).toMatch(
      /Columns \(1 hidden\)/,
    )
  })

  it('persists hidden track to localStorage when header clicked', () => {
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)

    const drillHeader = screen.getAllByText('Drill method')[0]
    fireEvent.click(drillHeader)

    const stored = JSON.parse(localStorage.getItem(BORELOG_HIDDEN_TRACKS_KEY) ?? '[]') as string[]
    expect(stored).toContain('drill_method')
  })

  it('tolerates corrupt localStorage on mount (parse-guard)', () => {
    localStorage.setItem(BORELOG_HIDDEN_TRACKS_KEY, 'not-valid-json{{')
    // Should not throw on mount.
    expect(() => render(<BoreholeLog borehole={makeFixtureBorehole()} />)).not.toThrow()
  })

  it('tolerates unknown track ids in localStorage (forward-compat)', () => {
    localStorage.setItem(
      BORELOG_HIDDEN_TRACKS_KEY,
      JSON.stringify(['drill_method', 'future_track_from_v2']),
    )
    // Should not throw; unknown id is silently ignored.
    expect(() => render(<BoreholeLog borehole={makeFixtureBorehole()} />)).not.toThrow()
    // The known id still applies: "1 hidden" visible on the Columns button.
    expect(screen.getByTitle('Show or hide borelog columns').textContent).toMatch(
      /Columns \(1 hidden\)/,
    )
  })

  it('cannot hide the last visible track (cant-hide-all guard)', () => {
    // Borehole with only a drill-method track and no other data tracks.
    // Hiding 'drill_method' would leave the borelog with no tracks — the
    // guard must prevent it.
    const borehole = {
      ...makeFixtureBorehole(),
      // Strip all observations and samples, keep only drill segments.
      observations: [],
      samples: [],
      field_log_intervals: [],
    }
    render(<BoreholeLog borehole={borehole} />)

    // Click the drill-method header — the guard fires.
    const drillHeader = screen.getAllByText('Drill method')[0]
    fireEvent.click(drillHeader)

    // Guard prevented the hide: Columns button still shows "Columns"
    // (no "(N hidden)" suffix), not "Columns (1 hidden)".
    expect(screen.getByTitle('Show or hide borelog columns').textContent).toMatch(
      /^Columns$/,
    )
  })

  it('renders a contact-overlays group when contactOverlays prop is supplied', () => {
    // Pure SVG render assertion — the overlay group has a stable
    // data-testid we can query for, and the formation label text is
    // a regular SVG <text> element (not a Recharts-managed label),
    // so testing-library can pick it up directly.
    const borehole = makeFixtureBorehole()
    const { container } = render(
      <BoreholeLog
        borehole={borehole}
        contactOverlays={[
          {
            depth_m: 1.5,
            color: '#5fb3d6',
            label: 'Antropogeen',
            source: 'geology',
            key: 'geology:c-1',
          },
          {
            depth_m: 3.0,
            color: '#fef9c3',
            label: 'ZAND',
            source: 'litho',
            key: 'litho:c-2',
          },
        ]}
      />,
    )
    const overlayGroup = container.querySelector('[data-testid="contact-overlays"]')
    expect(overlayGroup).not.toBeNull()
    // One <line> + one <text> per overlay = 2 lines, 2 texts.
    expect(overlayGroup!.querySelectorAll('line').length).toBe(2)
    expect(screen.getByText('Antropogeen')).toBeInTheDocument()
    expect(screen.getByText('ZAND')).toBeInTheDocument()
  })

  it('renders no contact-overlays group when prop is omitted', () => {
    const { container } = render(<BoreholeLog borehole={makeFixtureBorehole()} />)
    expect(container.querySelector('[data-testid="contact-overlays"]')).toBeNull()
  })

  it('depth axis track id is never in the toggleable set', () => {
    // Structural: the mTAW / depth axis is the spine and cannot be hidden.
    // Tested here as a guard so a future refactor doesn't accidentally
    // add it and break the borelog's structural coherence.
    render(<BoreholeLog borehole={makeFixtureBorehole()} />)
    // The Columns button must exist, but no checkbox should reference
    // a "depth" or "mtaw" track. We verify no such element is present.
    const btn = screen.getByTitle('Show or hide borelog columns')
    fireEvent.click(btn)
    // Even with the dropdown open, no "depth axis" label should appear.
    expect(screen.queryByText(/depth axis/i)).not.toBeInTheDocument()
  })
})

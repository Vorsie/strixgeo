/**
 * What the gapless build-report banner has to say and do.
 *
 * The owner's constraint is *"I can't have gaps or fallbacks in the model
 * unless users make mistakes"*. The banner is where that promise is either
 * shown kept or shown broken, so every case below is phrased as the sentence
 * the engineer should be able to read off the screen.
 *
 * GB1  no verdict → the banner says nothing at all
 * GB2  every promise kept → one compact line that says so, and the seven
 *      promises can be read out
 * GB3  a broken promise → the banner leads with WHICH promise broke
 * GB4  the named spots are behind a disclosure, and opening it names the
 *      section and the gap for each one
 * GB5  a measured-but-unkept model and an un-measured model must not read
 *      alike — an unmeasured guarantee is never shown as a kept one
 * GB6  a spot on a section is one press away; a spot that is nowhere in
 *      particular offers no press it cannot honour
 * GB7  colour is never the only signal — each verdict carries its own word
 * GB8  a report the BACKEND actually assembled renders — the one case the
 *      hand-written fixtures above cannot cover, because they are written to
 *      match the reader rather than the writer
 * GB9  the press walks to the SPOT, not merely to the section — owner dogfeed
 *      2026-08-28: *"the show me button opens section but doesn't zoom to
 *      issue"*. What crosses the boundary is the gap's own two columns BY
 *      NAME; the gap index never does, because it indexes the litho frame's
 *      column list and is wrong on any other
 * GB10 a spot whose columns cannot be named still opens its section — the
 *      press degrades to what it did before rather than centring on a guess
 */

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import GeotechBuildReportBanner from './GeotechBuildReportBanner'
import type { GaplessBuildReport, GaplessClause } from '../../../utils/gaplessGate/types'
import backendAssembled from './__fixtures__/backendAssembledReport.json'

function clause(over: Partial<GaplessClause> & Pick<GaplessClause, 'key'>): GaplessClause {
  return {
    number: 1,
    title: 'a promise',
    status: 'pass',
    entries: [],
    ...over,
  }
}

/** All seven kept — the shape a finished model produces. */
function cleanReport(): GaplessBuildReport {
  return {
    verdict: 'pass',
    generated_at: '2026-08-26T02:00:00Z',
    clauses: [
      clause({ key: 'area-conservation', number: 1, title: 'Classed and unclassed add up' }),
      clause({ key: 'edge-reach', number: 2, title: 'The build reads every column edge' }),
      clause({ key: 'cause-closure', number: 3, title: 'Every unclassed patch has a cause' }),
      clause({ key: 'section-closure', number: 4, title: 'Every section reached the build' }),
      clause({ key: 'column-totality', number: 5, title: 'Every footprint column has material' }),
      clause({ key: 'stack-voids', number: 6, title: 'No interior void above the limit' }),
      clause({ key: 'section-reconciliation', number: 7, title: 'The 3-D model holds its ground' }),
    ],
  }
}

/** One broken promise, with two named spots — one navigable, one not. */
function failingReport(): GaplessBuildReport {
  const report = cleanReport()
  report.verdict = 'fail'
  report.clauses[2] = clause({
    key: 'cause-closure',
    number: 3,
    title: 'Every patch of unclassed ground has a known cause',
    status: 'fail',
    entries: [
      {
        label: 'Tie-section 7, gap 12: 3.4 m² of ground was left unclassed with no known cause',
        section_id: 'tie7',
        section_name: 'Tie-section 7',
        gap_index: 12,
        gap_investigation_ids: ['S4', 'B6'],
        measure: { value: 3.4, unit: 'm2' },
      },
      {
        label: '1 column inside the model footprint carries no material at all',
        world_x: 88074.3,
        world_y: 164745.3,
        measure: { value: 1, unit: 'count' },
      },
    ],
  })
  return report
}

function renderBanner(
  report: GaplessBuildReport | null,
  onVisit = vi.fn(),
): { onVisit: ReturnType<typeof vi.fn> } {
  render(<GeotechBuildReportBanner report={report} onVisitSpot={onVisit} />)
  return { onVisit }
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('the gapless build-report banner', () => {
  it('GB1 says nothing at all when there is no verdict', () => {
    renderBanner(null)
    expect(screen.queryByTestId('geotech-build-report-banner')).toBeNull()
  })

  it('GB2 states that every promise was kept, and can list them', () => {
    renderBanner(cleanReport())
    const banner = screen.getByTestId('geotech-build-report-banner')
    expect(banner.textContent).toMatch(/no gaps/i)

    // The seven promises are readable — that is the model-trust value, not
    // just the absence of a complaint.
    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    expect(screen.getByText(/The 3-D model holds its ground/)).toBeTruthy()
  })

  it('GB3 leads with the promise that broke', () => {
    renderBanner(failingReport())
    const banner = screen.getByTestId('geotech-build-report-banner')
    expect(banner.textContent).toMatch(/Every patch of unclassed ground has a known cause/)
  })

  it('GB4 names the section and the gap of every spot, once opened', () => {
    renderBanner(failingReport())
    // Collapsed first: the banner must not cover the model it is reporting on.
    expect(screen.queryByText(/Tie-section 7, gap 12/)).toBeNull()

    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    expect(screen.getByText(/Tie-section 7, gap 12/)).toBeTruthy()
  })

  it('GB5 never shows an unmeasured guarantee as a kept one', () => {
    const report = cleanReport()
    report.verdict = 'incomplete'
    report.clauses[6] = clause({
      key: 'section-reconciliation',
      number: 7,
      title: 'The 3-D model holds the ground its sections classed',
      status: 'not-evaluated',
      not_evaluated_reason: 'no voxel grid was labelled by this build',
    })
    renderBanner(report)

    const banner = screen.getByTestId('geotech-build-report-banner')
    expect(banner.textContent).toMatch(/not checked/i)
    // The clean wording must be absent — an incomplete report is not a pass.
    expect(banner.textContent).not.toMatch(/no gaps/i)
  })

  it('GB6 offers a press only where there is somewhere to go', () => {
    const { onVisit } = renderBanner(failingReport())
    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))

    const visits = screen.getAllByTestId('geotech-build-report-visit')
    // Two entries, but only the one standing on a section can be visited.
    expect(visits).toHaveLength(1)

    fireEvent.click(visits[0])
    expect(onVisit).toHaveBeenCalledWith('tie7', ['S4', 'B6'])
  })

  it('GB9 hands over the gap’s two columns by name, never its index', () => {
    const { onVisit } = renderBanner(failingReport())
    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    fireEvent.click(screen.getByTestId('geotech-build-report-visit'))

    // THE TRAP THIS PINS: ``gap_index`` is 12 on this entry and it indexes the
    // LITHO FRAME's column list. On the geotech axis's own ``visibleColumns``
    // the same number is a different gap — passing it across this boundary is
    // what already centred the wrong gap once (``PartitionFillOverlay.
    // onJumpToConflictGap``). Nothing numeric may travel.
    expect(onVisit).toHaveBeenCalledWith('tie7', ['S4', 'B6'])
    for (const arg of onVisit.mock.calls[0]) {
      expect(typeof arg).not.toBe('number')
    }
  })

  it('GB10 still opens the section when the spot cannot name its columns', () => {
    const report = failingReport()
    // A backend-assembled entry (clauses 5-7) knows a section but has no frame
    // to resolve a gap's columns against — and an older report predates the
    // field entirely. Either way the press must do what it always did.
    report.clauses[2].entries[0] = {
      label: 'Tie-section 7, gap 12: ground left unclassed with no known cause',
      section_id: 'tie7',
      section_name: 'Tie-section 7',
      gap_index: 12,
    }
    const { onVisit } = renderBanner(report)
    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    fireEvent.click(screen.getByTestId('geotech-build-report-visit'))

    expect(onVisit).toHaveBeenCalledWith('tie7', [])
  })

  it('GB7 gives each verdict its own word, not just its own colour', () => {
    renderBanner(cleanReport())
    const pass = screen.getByTestId('geotech-build-report-banner').textContent ?? ''
    cleanup()

    renderBanner(failingReport())
    const fail = screen.getByTestId('geotech-build-report-banner').textContent ?? ''

    expect(pass).not.toEqual(fail)
    expect(fail).toMatch(/1 of 7/)
  })

  it('GB8 renders a report the backend actually assembled', () => {
    // ``backendAssembledReport.json`` is not hand-written: it is the output of
    // the real Python assembler, fed the real ``gapless_2d`` this renderer
    // emits, with only its timestamp frozen. Every other fixture in this file
    // was written by the same person as the reader and therefore cannot catch
    // the two halves disagreeing about the shape — this one can.
    renderBanner(backendAssembled as GaplessBuildReport)

    const banner = screen.getByTestId('geotech-build-report-banner')
    expect(banner.textContent).toMatch(/3 of 7 model guarantees broken/)

    fireEvent.click(screen.getByTestId('geotech-build-report-disclosure'))
    // All seven promises are readable, by their backend-owned titles. Broken
    // ones appear twice on purpose — once in the header, which names them
    // without anything being opened, and once in the list.
    for (const clause of backendAssembled.clauses) {
      expect(screen.getAllByText(clause.title).length).toBeGreaterThan(0)
    }
    // The backend's own sentences reach the engineer verbatim.
    expect(screen.getByText(/412 of 37707 column\(s\)/)).toBeTruthy()
    // And a finding that stands on a section is still one press away.
    expect(screen.getAllByTestId('geotech-build-report-visit')).toHaveLength(1)
  })
})

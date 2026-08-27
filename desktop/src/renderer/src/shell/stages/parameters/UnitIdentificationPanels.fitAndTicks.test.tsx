// Pins for the second-dogfeed rulings on the identification (OKP) panels
// (owner, 2026-08-27).
//
// S4, verbatim: "make it so that you can scale the OKP values to better fit
// the data." Same toggle mechanic as the CPT panels (S1): zero stays the
// anchor; fit = [0, pooled max rounded up to a tick]. In fit mode each panel
// fits ITS OWN data — the Atterberg pair's shared scale is released, which is
// the one place the default axes visibly do not fit the data.
// S3, verbatim: "I want more sublabels on all axis ticks not too many" — the
// value axes AND the elevation axes label intermediate ticks.
//
// IF1 — the toggle exists; its label states the mode it switches TO.
// IF2 — fit scales each panel to its own data: the plastic-limit dot leaves
//       the shared liquid-limit scale and fills its own row.
// IF3 — reverting restores the exact shared scale.
// IF4 — the fitted axis end is the pooled max rounded up to a tick; the
//       default axis end stays the exact pooled max.
// IF5 — the value axis labels intermediate ticks.
// IF6 — the elevation axis labels metre-round intermediate ticks.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const detailBatch = vi.fn()

vi.mock('../../../api/client', () => ({
  api: { borehole: { detailBatch: (...args: unknown[]) => detailBatch(...args) } },
}))

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1', view_state: null },
  }),
}))

import UnitIdentificationPanels from './UnitIdentificationPanels'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function bhBand(id: string, boreholeId: string, top = 0, base = 20) {
  return {
    id,
    formation_id: 'unit-1',
    cpt_id: null,
    borehole_id: boreholeId,
    depth_top_m: top,
    depth_base_m: base,
    status: 'accepted',
  } as never
}

function sample(top: number, base: number, extras: Record<string, unknown>) {
  return {
    id: `s-${top}`,
    depth_top_m: top,
    depth_base_m: base,
    description: '',
    sample_number: null,
    grain_sizes: [],
    atterberg_limits_tests: [],
    caco3_content_tests: [],
    organic_content_tests: [],
    water_content_tests: [],
    scalar_lab_tests: [],
    ...extras,
  }
}

function bhDetail(id: string, name: string, elevationM: number, samples: unknown[]) {
  return { id, name, elevation_m: elevationM, samples }
}

const SCOPE = { kind: 'geotech' as const, unitId: 'unit-1' }
const MEMBERS = new Set(['bh-1'])

function water(top: number, pct: number) {
  return sample(top, top + 0.5, {
    water_content_tests: [{ id: `w-${top}`, content_pct: pct, method: null, test_date: null }],
  })
}

describe('S4 — fit-to-data for the identification (OKP) panels', () => {
  it('IF1 — the toggle exists and its label states the mode it switches TO', async () => {
    detailBatch.mockResolvedValue([bhDetail('bh-1', 'B1', 10, [water(1, 23)])])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-fit-toggle')).toBeTruthy())
    const button = screen.getByTestId('unit-idtests-fit-toggle')
    expect(button.textContent).toMatch(/fit axes to data/i)
    fireEvent.click(button)
    expect(button.textContent).toMatch(/pooled axes/i)
  })

  it('IF2 — fit scales each panel to its own data (the Atterberg share is released)', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, {
          atterberg_limits_tests: [
            { id: 'a1', liquid_limit_pct: 60, plastic_limit_pct: 20, non_plastic: null, method: null, test_date: null },
          ],
        }),
      ]),
    ])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:plastic_limit')).toBeTruthy())
    // Default: the pair shares one scale — the PL dot sits at a third.
    const plBefore = Number(
      screen.getByTestId('unit-idtests-dot-typed:plastic_limit').getAttribute('cx'),
    )
    fireEvent.click(screen.getByTestId('unit-idtests-fit-toggle'))
    // Fit: the PL panel fits ITS data — 20 on a 0–20 axis fills the row.
    const plAfter = Number(
      screen.getByTestId('unit-idtests-dot-typed:plastic_limit').getAttribute('cx'),
    )
    expect(plAfter).toBeGreaterThan(plBefore * 2)
    expect(plAfter).toBeCloseTo(100, 4)
  })

  it('IF3 — reverting restores the exact shared scale', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, {
          atterberg_limits_tests: [
            { id: 'a1', liquid_limit_pct: 60, plastic_limit_pct: 20, non_plastic: null, method: null, test_date: null },
          ],
        }),
      ]),
    ])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:plastic_limit')).toBeTruthy())
    const button = screen.getByTestId('unit-idtests-fit-toggle')
    fireEvent.click(button)
    fireEvent.click(button)
    const pl = Number(
      screen.getByTestId('unit-idtests-dot-typed:plastic_limit').getAttribute('cx'),
    )
    const ll = Number(
      screen.getByTestId('unit-idtests-dot-typed:liquid_limit').getAttribute('cx'),
    )
    // Back on the shared scale, exactly: positions in the 20/60 ratio again.
    expect(pl / ll).toBeCloseTo(20 / 60, 6)
  })

  it('IF4 — the fitted axis end rounds the pooled max up to a tick', async () => {
    detailBatch.mockResolvedValue([bhDetail('bh-1', 'B1', 10, [water(1, 9), water(2, 23)])])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:water_content')).toBeTruthy())
    // Default: the axis end is the exact pooled max.
    expect(
      screen.getByTestId('unit-idtests-axis-max-typed:water_content').textContent,
    ).toContain('23')
    fireEvent.click(screen.getByTestId('unit-idtests-fit-toggle'))
    // Fit: rounded up to a tick — headroom, nothing glued to the wall.
    expect(
      screen.getByTestId('unit-idtests-axis-max-typed:water_content').textContent,
    ).toContain('25')
    // Zero-anchored throughout: dots stay in the 9/23 ratio.
    const xs = screen
      .getAllByTestId('unit-idtests-dot-typed:water_content')
      .map(d => Number(d.getAttribute('cx')))
      .sort((a, b) => a - b)
    expect(xs[0] / xs[1]).toBeCloseTo(9 / 23, 6)
  })
})

describe('S3 — sublabels on the identification axes', () => {
  it('IF5 — the value axis labels intermediate ticks', async () => {
    detailBatch.mockResolvedValue([bhDetail('bh-1', 'B1', 10, [water(1, 23)])])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:water_content')).toBeTruthy())
    const labels = screen
      .getAllByTestId('unit-idtests-axis-tick-typed:water_content')
      .map(el => el.textContent)
    // Max 23 → step 5: the interior sublabels between the 0 and the end.
    expect(labels).toEqual(['5', '10', '15', '20'])
  })

  it('IF6 — the elevation axis labels metre-round intermediate ticks', async () => {
    // Samples from 1 m to 13 m below a +10 m collar → elevations +8.75 … −2.75.
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [water(1, 20), water(5, 25), water(9, 22), water(13, 28)]),
    ])
    render(
      <UnitIdentificationPanels scope={SCOPE} layers={[bhBand('l1', 'bh-1')]} memberInvestigationIds={MEMBERS} />,
    )
    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:water_content')).toBeTruthy())
    const labels = screen
      .getAllByTestId('unit-idtests-etick-typed:water_content')
      .map(el => Number(el.textContent))
    // At least two labelled interior ticks, every one a whole metre.
    expect(labels.length).toBeGreaterThanOrEqual(2)
    for (const v of labels) {
      expect(Number.isInteger(v)).toBe(true)
      expect(v).toBeLessThan(8.75)
      expect(v).toBeGreaterThan(-2.75)
    }
  })
})

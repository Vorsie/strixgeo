// Pins for the identification-test (OKP) panels — owner ruling R8,
// 2026-08-27: "i want a plot with all OKP's in a layer."
//
// IP1 — one scatter panel per parameter that HAS data; empty parameters
//       render no panel at all (no empty jars).
// IP2 — a unit with zero pooled samples shows one quiet line, never an error.
// IP3 — the value axis starts at ZERO: two dots' x positions are in the exact
//       ratio of their values.
// IP4 — the two Atterberg panels share one value scale, so vloeigrens and
//       uitrolgrens are visually comparable.
// IP5 — only member boreholes are fetched: the batch asks for exactly the
//       pooling population's holes.
// IP6 — a scalar panel's label carries the raw Dutch token as its tooltip
//       (the presentation-boundary rule).

// IP8 — a sample's scatter dot and that sample's PSD curve wear the SAME
//       colour, keyed on the sample (owner 2026-08-28: "make the psd the same
//       colour ... and all dots in the plots above").
// IP9 — each scatter panel labels BOTH axes with units: the parameter + unit
//       on the value axis, mTAW on the elevation axis (owner 2026-08-28:
//       "properly label all axes").

import { cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { sampleColor } from './sampleColor'

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

/** An accepted borehole-anchored band of ``unit-1``. */
function bhBand(id: string, boreholeId: string, top = 0, base = 10) {
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

describe('UnitIdentificationPanels — the OKP scatter panels', () => {
  it('IP1 — one panel per parameter with data; empty parameters absent', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, { water_content_tests: [{ id: 'w1', content_pct: 25, method: null, test_date: null }] }),
        sample(3, 4, { water_content_tests: [{ id: 'w2', content_pct: 35, method: null, test_date: null }] }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:water_content')).toBeTruthy())
    const dots = screen.getAllByTestId('unit-idtests-dot-typed:water_content')
    expect(dots).toHaveLength(2)
    expect(screen.getByTestId('unit-idtests-n-typed:water_content').textContent).toContain('2')
    // No panel exists for a parameter nothing was measured for.
    expect(screen.queryByTestId('unit-idtests-panel-typed:caco3')).toBeNull()
  })

  it('IP2 — zero pooled samples is one quiet line, never an error', async () => {
    detailBatch.mockResolvedValue([bhDetail('bh-1', 'B1', 10, [])])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('unit-idtests-empty')).toBeTruthy())
    expect(screen.getByTestId('unit-idtests-empty').textContent).toMatch(
      /no identification tests in this unit/i,
    )
  })

  it('IP7 — PSD-only data is NOT "no identification tests": the quiet line waits for BOTH pools to be empty', async () => {
    // F8 (audit 2026-08-27): the line rendered off the SCALAR pool alone, so
    // a unit whose only lab data is grain-size curves said "No identification
    // tests in this unit." directly above a populated PSD panel.
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, {
          grain_sizes: [
            { id: 'gs1', diameters_mm: [0.002, 0.063, 2], pct_larger: [90, 40, 5] },
          ],
        }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('unit-psd-panel')).toBeTruthy())
    expect(screen.queryByTestId('unit-idtests-empty')).toBeNull()
  })

  it('IP3 — the value axis starts at zero: dot positions are in the values ratio', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, { water_content_tests: [{ id: 'w1', content_pct: 10, method: null, test_date: null }] }),
        sample(3, 4, { water_content_tests: [{ id: 'w2', content_pct: 40, method: null, test_date: null }] }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getAllByTestId('unit-idtests-dot-typed:water_content')).toHaveLength(2))
    const xs = screen
      .getAllByTestId('unit-idtests-dot-typed:water_content')
      .map(d => Number(d.getAttribute('cx')))
      .sort((a, b) => a - b)
    // Zero-anchored: x(10) / x(40) === 10 / 40, whatever the panel's max is.
    expect(xs[0] / xs[1]).toBeCloseTo(0.25, 6)
  })

  it('IP4 — the Atterberg panels share one value scale', async () => {
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
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('unit-idtests-panel-typed:liquid_limit')).toBeTruthy())
    const ll = Number(
      screen.getByTestId('unit-idtests-dot-typed:liquid_limit').getAttribute('cx'),
    )
    const pl = Number(
      screen.getByTestId('unit-idtests-dot-typed:plastic_limit').getAttribute('cx'),
    )
    // Same scale ⇒ positions in the 20/60 ratio across the two panels.
    expect(pl / ll).toBeCloseTo(20 / 60, 6)
  })

  it('IP5 — only the pooling population is fetched', async () => {
    detailBatch.mockResolvedValue([])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1'), bhBand('l2', 'bh-off')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(detailBatch).toHaveBeenCalledTimes(1))
    expect(detailBatch.mock.calls[0][0]).toEqual(['bh-1'])
  })

  it('IP6 — a scalar panel label tooltips the raw Dutch token', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, {
          scalar_lab_tests: [
            {
              id: 'sc1',
              parameter_group: 'Volumemassa-watergehalte',
              parameter: 'Korrelvolumemassa (korrelvolumemassa)',
              value_numeric: 2.65,
              value_text: null,
              unit: 't/m³',
              method: null,
              test_date: null,
              detection_condition: null,
            },
          ],
        }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() =>
      expect(screen.getByTestId('unit-idtests-label-scalar:Korrelvolumemassa (korrelvolumemassa)')).toBeTruthy(),
    )
    const label = screen.getByTestId(
      'unit-idtests-label-scalar:Korrelvolumemassa (korrelvolumemassa)',
    )
    expect(label.textContent).toContain('Grain density')
    expect(label.getAttribute('title')).toContain('Korrelvolumemassa')
  })

  it('IP8 — a sample dot and its PSD curve wear the same colour', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, {
          water_content_tests: [{ id: 'w1', content_pct: 25, method: null, test_date: null }],
          grain_sizes: [
            { id: 'gs1', diameters_mm: [0.002, 0.063, 2], pct_larger: [90, 40, 5], method: null, test_date: null, lime_removed: null, organics_removed: null },
          ],
        }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() => expect(screen.getByTestId('unit-psd-panel')).toBeTruthy())
    // The ``sample`` helper ids its sample ``s-${top}`` — here ``s-1``.
    const expected = sampleColor('s-1')
    const dot = screen.getByTestId('unit-idtests-dot-typed:water_content')
    const curve = screen.getByTestId('unit-psd-curve-gs1')
    expect(dot.getAttribute('fill')).toBe(expected)
    expect(curve.getAttribute('stroke')).toBe(expected)
    // The heart of the ask: one colour, both surfaces.
    expect(dot.getAttribute('fill')).toBe(curve.getAttribute('stroke'))
  })

  it('IP9 — each scatter panel labels its value axis and its mTAW axis', async () => {
    detailBatch.mockResolvedValue([
      bhDetail('bh-1', 'B1', 10, [
        sample(1, 2, { water_content_tests: [{ id: 'w1', content_pct: 25, method: null, test_date: null }] }),
      ]),
    ])
    render(
      <UnitIdentificationPanels
        scopeBands={[bhBand('l1', 'bh-1')]}
        memberInvestigationIds={new Set(['bh-1'])}
      />,
    )

    await waitFor(() =>
      expect(screen.getByTestId('unit-idtests-panel-typed:water_content')).toBeTruthy(),
    )
    expect(
      screen.getByTestId('unit-idtests-yaxis-label-typed:water_content').textContent,
    ).toMatch(/mtaw/i)
    expect(
      screen.getByTestId('unit-idtests-xaxis-label-typed:water_content').textContent,
    ).toMatch(/water content/i)
  })
})

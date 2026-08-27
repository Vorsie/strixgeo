// The per-CPT plot surface honours the water-table rulings.
//
// PI1 — Nothing selected → an empty state, and NO profile request. A 250-CPT
//        project must not fetch 250 profiles nobody asked for.
//
// PI2 — Selecting a CPT fetches its SBT profile on demand and plots it.
//
// PI3 — The water-table line always says WHERE the number came from
//        (Data Integrity Rule 1): recorded / set by engineer / assumed.
//
// PI4 — Owner ruling: clicking the value opens an inline edit; Enter commits it
//        as a PATCH and the profile is RE-FETCHED (a new water table means a
//        new normalisation), Esc commits nothing.
//
// PI5 — An engineer-set value has a clear affordance, and clearing it sends
//        null (undo the override), not 0 (a water table at the collar).
//
// PI6 — The strip is normalised under the engineer's OWN unit weights — the
//        Settings > Litho segmenter values that also drive the ghost
//        boundaries. Two effective-stress profiles for one CPT is the exact
//        confusion this pane exists to remove.
//
// PI7 — A committed water table marks the project dirty. It is an engineering
//        decision; opening a .gmproj replace-restores the DB from the file, so
//        a decision that never flips the flag is a decision the next open eats.
//
// PI8 — A refused depth says WHY. The 422 range guard is useless to the
//        engineer if the toast only says "could not save".
//
// PI9 — The pane never sits on "loading" forever: if nothing else fetched the
//        plot, it fetches it itself, and a failure offers a retry.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CptPlotResponse, CptSbtProfileResponse, GwtProvenance } from '../../../api/client'

const sbtProfile = vi.fn()
const patchWaterTable = vi.fn()
const fetchPlot = vi.fn()
const toast = vi.fn()
const markMutated = vi.fn()

let mockSelectedId: string | null = null
let mockPlotMap: Map<string, CptPlotResponse> = new Map()
let mockViewState: Record<string, unknown> | null = null

vi.mock('../../../api/client', () => ({
  api: {
    cpt: {
      sbtProfile: (...args: unknown[]) => sbtProfile(...args),
      patchWaterTable: (...args: unknown[]) => patchWaterTable(...args),
      plot: (...args: unknown[]) => fetchPlot(...args),
    },
  },
}))

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1', view_state: mockViewState },
    investigations: {
      cpts: [{ id: 'cpt-1', name: 'CPT-1', max_depth_m: 12.4, cpt_type: 'CPTU' }],
      plotMap: mockPlotMap,
    },
    // No unit is scoped in these cases: they are all about the per-CPT
    // surface. The unit branch has its own spec
    // (``ParametersInspector.unit.test.tsx``).
    geoModel: { geotechLayers: [], geotechFormations: [] },
    coordinator: {
      selectedId: mockSelectedId,
      markMutated,
      selectedParameterUnit: null,
      setSelectedParameterUnit: vi.fn(),
      parametersActiveTab: 'per-test',
      setParametersActiveTab: vi.fn(),
    },
    toasts: { toast },
  }),
}))

import ParametersInspector from './ParametersInspector'

const DEPTHS = [1, 2, 3]

function makePlot(): CptPlotResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: DEPTHS,
    qc_mpa: [2, 4, 6],
    fs_mpa: [0.05, 0.06, 0.07],
    u2_mpa: null,
    rf_pct: [1, 1.2, 1.4],
    qt_mpa: null,
    q_total_mpa: null,
    ic: [2.1, 2.2, 2.3],
    rf_source: null,
  }
}

function makeProfile(gwtM: number, source: GwtProvenance): CptSbtProfileResponse {
  return {
    cpt_id: 'cpt-1',
    depths_m: DEPTHS,
    ic: [2.1, 2.2, 2.3],
    zone_normalised: [5, 5, 4],
    i_sbt: [2.2, 2.3, 2.4],
    zone_non_normalised: [5, 5, 4],
    gwt_m: gwtM,
    gwt_source: source,
  }
}

beforeEach(() => {
  mockSelectedId = 'cpt-1'
  mockPlotMap = new Map([['cpt-1', makePlot()]])
  mockViewState = null
  sbtProfile.mockReset().mockResolvedValue(makeProfile(0, 'assumed'))
  patchWaterTable.mockReset().mockResolvedValue({})
  fetchPlot.mockReset().mockResolvedValue(makePlot())
  toast.mockReset()
  markMutated.mockReset()
})

afterEach(cleanup)

describe('ParametersInspector', () => {
  it('PI1 — nothing selected: an empty state and no profile request', () => {
    mockSelectedId = null

    render(<ParametersInspector />)

    expect(screen.getByText('No test selected')).toBeInTheDocument()
    expect(sbtProfile).not.toHaveBeenCalled()
  })

  it('PI2 — selecting a CPT fetches its profile on demand and plots it', async () => {
    render(<ParametersInspector />)

    expect(sbtProfile).toHaveBeenCalledWith('cpt-1', 'proj-1', expect.anything())
    expect(screen.getByTestId('parameters-inspector-title').textContent).toBe('CPT-1')
    await waitFor(() => expect(screen.getByTestId('cpt-strip-normalised')).toBeInTheDocument())
    expect(screen.getByTestId('cpt-strip-non-normalised')).toBeInTheDocument()
  })

  it.each<[GwtProvenance, string]>([
    ['assumed', 'assumed'],
    ['recorded', 'recorded'],
    ['engineer', 'set by engineer'],
  ])('PI3 — a %s water table says so on the line', async (source, expected) => {
    sbtProfile.mockResolvedValue(makeProfile(1.25, source))

    render(<ParametersInspector />)

    await waitFor(() =>
      expect(screen.getByTestId('parameters-water-table-source').textContent).toContain(expected),
    )
    expect(screen.getByTestId('parameters-water-table-value').textContent).toBe('1.25 m')
  })

  it('PI4 — Enter commits the typed depth and re-fetches the profile', async () => {
    render(<ParametersInspector />)
    await waitFor(() => expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument())
    const fetchesBefore = sbtProfile.mock.calls.length

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: '2.4' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(patchWaterTable).toHaveBeenCalledWith('cpt-1', 'proj-1', { water_depth_m: 2.4 }),
    )
    // The whole normalisation moved with it — the strips must be redrawn.
    await waitFor(() => expect(sbtProfile.mock.calls.length).toBe(fetchesBefore + 1))
  })

  it('PI4b — Esc commits nothing', async () => {
    render(<ParametersInspector />)
    await waitFor(() => expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: '9.9' } })
    fireEvent.keyDown(input, { key: 'Escape' })

    expect(patchWaterTable).not.toHaveBeenCalled()
    expect(screen.queryByTestId('parameters-water-table-input')).toBeNull()
  })

  it('PI4c — a depth that is not a number is refused instead of saved', async () => {
    render(<ParametersInspector />)
    await waitFor(() => expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument())

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: 'deep' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    expect(patchWaterTable).not.toHaveBeenCalled()
    expect(toast).toHaveBeenCalledWith('error', expect.stringContaining('Water table'))
  })

  it('PI5 — only an engineer value offers the clear affordance, and it sends null', async () => {
    sbtProfile.mockResolvedValue(makeProfile(3.1, 'engineer'))

    render(<ParametersInspector />)
    const clear = await screen.findByTestId('parameters-water-table-clear')
    fireEvent.click(clear)

    await waitFor(() =>
      expect(patchWaterTable).toHaveBeenCalledWith('cpt-1', 'proj-1', { water_depth_m: null }),
    )
  })

  it('PI5b — a recorded value carries no clear affordance (it is the file’s, not his)', async () => {
    sbtProfile.mockResolvedValue(makeProfile(1.8, 'recorded'))

    render(<ParametersInspector />)
    await waitFor(() => expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument())

    expect(screen.queryByTestId('parameters-water-table-clear')).toBeNull()
  })

  it('surfaces a failed profile fetch instead of rendering an empty pane', async () => {
    sbtProfile.mockRejectedValue(new Error('boom'))

    render(<ParametersInspector />)

    await waitFor(() =>
      expect(screen.getByTestId('parameters-inspector-error')).toBeInTheDocument(),
    )
  })

  it('PI6 - the profile is requested under the engineers own unit weight', async () => {
    mockViewState = { litho_segmenter: { gunsat_kNm3: 19 } }

    render(<ParametersInspector />)

    await waitFor(() =>
      expect(sbtProfile).toHaveBeenCalledWith('cpt-1', 'proj-1', { gunsatKNm3: 19 }),
    )
  })

  it('PI7 - a committed water table marks the project dirty', async () => {
    render(<ParametersInspector />)
    await waitFor(() =>
      expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: '2.4' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(markMutated).toHaveBeenCalled())
  })

  it('PI7b - a PATCH that failed does NOT claim there is something to save', async () => {
    patchWaterTable.mockRejectedValue(new Error('nope'))
    render(<ParametersInspector />)
    await waitFor(() =>
      expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: '2.4' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(markMutated).not.toHaveBeenCalled()
  })

  it('PI8 - a refused depth tells the engineer what the server objected to', async () => {
    patchWaterTable.mockRejectedValue(new Error('Input should be less than or equal to 500'))
    render(<ParametersInspector />)
    await waitFor(() =>
      expect(screen.getByTestId('parameters-water-table-value')).toBeInTheDocument(),
    )

    fireEvent.click(screen.getByTestId('parameters-water-table-value'))
    const input = screen.getByTestId('parameters-water-table-input')
    fireEvent.change(input, { target: { value: '5000' } })
    fireEvent.keyDown(input, { key: 'Enter' })

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith(
        'error',
        expect.stringContaining('less than or equal to 500'),
      ),
    )
  })

  it('PI9 - with no plot in the shared cache the pane fetches it itself', async () => {
    // loadChart swallows its own failure, so a pane that only reads the shared
    // cache would sit on "Loading depth series..." with no way out.
    mockPlotMap = new Map()

    render(<ParametersInspector />)

    await waitFor(() => expect(fetchPlot).toHaveBeenCalledWith('cpt-1', 'proj-1'))
    await waitFor(() => expect(screen.getByTestId('cpt-strip-normalised')).toBeInTheDocument())
  })

  it('PI9b - a plot that cannot be fetched shows an error with a retry, not a spinner', async () => {
    mockPlotMap = new Map()
    fetchPlot.mockRejectedValue(new Error('plot exploded'))

    render(<ParametersInspector />)

    const retry = await screen.findByTestId('parameters-inspector-retry')
    expect(screen.queryByTestId('parameters-inspector-loading')).toBeNull()

    // Retrying re-runs the whole fetch; make it succeed this time.
    fetchPlot.mockResolvedValue(makePlot())
    fireEvent.click(retry)

    await waitFor(() => expect(screen.getByTestId('cpt-strip-normalised')).toBeInTheDocument())
  })
})

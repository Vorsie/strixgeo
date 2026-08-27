// Pins for the Parameters inspector when a UNIT is what is selected (owner
// ballot 2026-08-26). The per-CPT behaviour is pinned elsewhere; what these
// cases protect is the branch, its precedence, and its way out.
//
// PI1 — a selected unit draws its distributions, not the per-CPT panels.
// PI2 — a unit takes precedence over a selected CPT (it is the later, more
//       explicit gesture; the per-test tab clears it to go back).
// PI3 — the header offers a way out of the unit view.
// PI4 — the unit's name comes from the geotech vocabulary, so an unclassified
//       unit is still named rather than blank.
// PI5 — with no unit and no CPT the pane is the plain empty state.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ParametersInspector from './ParametersInspector'

const setSelectedParameterUnitId = vi.fn()
const plotBatch = vi.fn()

let mockSelectedUnitId: string | null = null
let mockSelectedCptId: string | null = null

vi.mock('../../../api/client', () => ({
  api: {
    cpt: {
      plotBatch: (...args: unknown[]) => plotBatch(...args),
      plot: vi.fn(),
      sbtProfile: vi.fn(),
      patchWaterTable: vi.fn(),
    },
  },
}))

// The depth panels pull the SBT machinery in; this spec is about the branch,
// so the per-CPT surface is mocked to a marker.
vi.mock('./CptSbtDepthPanels', () => ({
  default: () => <div data-testid="cpt-depth-panels" />,
}))

const GEOTECH_LAYERS = [
  {
    id: 'l1',
    formation_id: 'unit-1',
    cpt_id: 'cpt-a',
    borehole_id: null,
    depth_top_m: 1,
    depth_base_m: 3,
    status: 'accepted',
  },
]

const PLOT = {
  cpt_id: 'cpt-a',
  depths_m: [1, 2, 3],
  qc_mpa: [5, 10, 15],
  fs_mpa: null,
  rf_pct: null,
}

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1', view_state: null },
    investigations: {
      cpts: [{ id: 'cpt-a', name: 'CPT-A', max_depth_m: 20, cpt_type: 'CPTU' }],
      // Pre-warmed so the unit branch needs no fetch — the fetch path has its
      // own coverage in the hook; this spec is about what is drawn.
      plotMap: new Map([['cpt-a', PLOT]]),
    },
    geoModel: {
      geotechLayers: GEOTECH_LAYERS,
      geotechFormations: [
        {
          id: 'unit-1',
          name: '',
          nad_class: null,
          litho_main_soil_code: 'KLEI',
          // Always null on a real geotech row — the name is reached through
          // ``source_litho_formation_id`` instead.
          parent_formation_name: null,
          source_litho_formation_id: 'litho-1',
          color: '#abc',
          color_override: null,
        },
      ],
      lithoFormations: [
        {
          id: 'litho-1',
          name: 'Boomse klei',
          nad_class: null,
          litho_main_soil_code: 'KLEI',
          litho_admixtures: [],
        },
      ],
    },
    coordinator: {
      selectedId: mockSelectedCptId,
      markMutated: vi.fn(),
      selectedParameterUnitId: mockSelectedUnitId,
      setSelectedParameterUnitId,
    },
    toasts: { toast: vi.fn() },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockSelectedUnitId = null
  mockSelectedCptId = null
})

describe('ParametersInspector — unit branch', () => {
  it('PI1 — a selected unit draws its distributions', () => {
    mockSelectedUnitId = 'unit-1'
    render(<ParametersInspector />)

    expect(screen.getByTestId('parameters-inspector-unit')).toBeTruthy()
    expect(screen.getByTestId('unit-stats-row-qc')).toBeTruthy()
    // qc over 1–3 m is [5, 10] (3 m is the band base, half-open).
    expect(screen.getByTestId('unit-stats-n-qc').textContent).toContain('2')
  })

  it('PI2 — a unit takes precedence over a selected CPT', () => {
    mockSelectedUnitId = 'unit-1'
    mockSelectedCptId = 'cpt-a'
    render(<ParametersInspector />)

    expect(screen.getByTestId('parameters-inspector-unit')).toBeTruthy()
    expect(screen.queryByTestId('cpt-depth-panels')).toBeNull()
  })

  it('PI3 — the header offers a way out of the unit view', () => {
    mockSelectedUnitId = 'unit-1'
    render(<ParametersInspector />)

    fireEvent.click(screen.getByTestId('parameters-unit-close'))

    expect(setSelectedParameterUnitId).toHaveBeenCalledWith(null)
  })

  it('PI4 — an unclassified unit is still named', () => {
    mockSelectedUnitId = 'unit-1'
    render(<ParametersInspector />)

    const title = screen.getByTestId('unit-stats-title').textContent ?? ''
    expect(title).toMatch(/not yet classified/i)
    expect(title.trim().length).toBeGreaterThan(3)
  })

  it('PI5 — no unit and no CPT is the plain empty state', () => {
    render(<ParametersInspector />)

    expect(screen.queryByTestId('parameters-inspector-unit')).toBeNull()
    expect(screen.queryByTestId('unit-stats-row-qc')).toBeNull()
  })
})

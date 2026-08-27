// Pins for the inspector half of the layout flip (owner ruling R3 2026-08-27,
// verbatim: "The statistics should be the main item, switch statistics and
// list from pane") — the unit LIST lives in the right-hand pane; clicking a
// row selects the unit driving the canvas.
//
// RL1 — on the per-unit tab the inspector shows the unit list.
// RL2 — clicking a row selects that unit (geotech scope).
// RL3 — the list keeps its information: NAD class, source litho unit, band
//       count — and the Phase-5 note stays visible.
// RL4 — a litho-only project lists the litho units, and clicking one selects
//       a LITHO scope (the R1 pooling — whole unit, all packing classes).
// RL5 — on the per-test tab the inspector still serves the per-CPT surface,
//       not the list.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ParametersInspector from './ParametersInspector'

const setSelectedParameterUnit = vi.fn()

let mockTab: 'per-test' | 'per-unit' | 'methods' = 'per-unit'
let mockGeotechFormations: unknown[] = []
let mockGeotechLayers: unknown[] = []

vi.mock('../../../api/client', () => ({
  api: {
    cpt: {
      plotBatch: vi.fn(),
      plot: vi.fn(),
      sbtProfile: vi.fn().mockResolvedValue(null),
      patchWaterTable: vi.fn(),
    },
  },
}))

vi.mock('./CptSbtDepthPanels', () => ({
  default: () => <div data-testid="cpt-depth-panels" />,
}))

vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    project: { id: 'proj-1', view_state: null },
    investigations: { cpts: [], plotMap: new Map() },
    geoModel: {
      lithoFormations: [
        {
          id: 'litho-1',
          name: 'Zand van Diest',
          parent_formation_name: 'Diest',
          nad_class: null,
          litho_main_soil_code: 'ZAND',
          litho_admixtures: [],
        },
      ],
      geotechFormations: mockGeotechFormations,
      geotechLayers: mockGeotechLayers,
    },
    coordinator: {
      selectedId: null,
      markMutated: vi.fn(),
      parametersActiveTab: mockTab,
      selectedParameterUnit: null,
      setSelectedParameterUnit,
    },
    toasts: { toast: vi.fn() },
  }),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  mockTab = 'per-unit'
  mockGeotechFormations = []
  mockGeotechLayers = []
})

function classifiedUnit() {
  return {
    id: 'geo-1',
    name: '',
    nad_class: 6,
    litho_main_soil_code: 'ZAND',
    source_litho_formation_id: 'litho-1',
    parent_formation_name: null,
    color: '#aabbcc',
    color_override: null,
  }
}

function bandOf(unitId: string, id: string) {
  return {
    id,
    formation_id: unitId,
    cpt_id: 'cpt-a',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 2,
    status: 'accepted',
  }
}

describe('ParametersInspector — the unit list lives in the pane (R3)', () => {
  it('RL1 — on the per-unit tab the inspector shows the unit list', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<ParametersInspector />)

    expect(screen.getByTestId('parameters-unit-list')).toBeTruthy()
    expect(screen.getByTestId('parameters-unit-geo-1')).toBeTruthy()
  })

  it('RL2 — clicking a row selects that unit as the canvas scope', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<ParametersInspector />)

    fireEvent.click(screen.getByTestId('parameters-unit-geo-1'))

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'geotech',
      unitId: 'geo-1',
    })
  })

  it('RL3 — the list keeps its information and the Phase-5 note stays visible', () => {
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1'), bandOf('geo-1', 'l2')]
    render(<ParametersInspector />)

    const row = screen.getByTestId('parameters-unit-geo-1')
    const text = row.textContent ?? ''
    // NAD class, source litho unit, band count — the list's information.
    expect(text).toMatch(/NAD 6/)
    expect(text.toLowerCase()).toContain('sand')
    expect(screen.getByTestId('parameters-unit-bands-geo-1').textContent).toContain('2')
    // The φ′/c′/cu/E50 dash columns became a compact hint — still visible.
    const note = screen.getByTestId('parameters-unit-phase5-note').textContent ?? ''
    expect(note).toMatch(/φ′/)
    expect(note).toMatch(/Phase 5/i)
  })

  it('RL4 — a litho-only project lists litho units; clicking selects a LITHO scope', () => {
    render(<ParametersInspector />)

    fireEvent.click(screen.getByTestId('parameters-unit-litho-1'))

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'litho',
      unitId: 'litho-1',
    })
  })

  it('RL5 — on the per-test tab the inspector still serves the per-CPT surface', () => {
    mockTab = 'per-test'
    mockGeotechFormations = [classifiedUnit()]
    mockGeotechLayers = [bandOf('geo-1', 'l1')]
    render(<ParametersInspector />)

    expect(screen.queryByTestId('parameters-unit-list')).toBeNull()
  })
})

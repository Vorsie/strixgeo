// Pins for the inspector half of the layout flip (owner ruling R3 2026-08-27,
// verbatim: "The statistics should be the main item, switch statistics and
// list from pane") — the unit LIST lives in the right-hand pane; clicking a
// row selects the unit driving the canvas.
//
// The pane is now the body TREE (litho unit ▸ litho body ▸ NAD class ▸ geotech
// body); this inspector test is the WIRING check (the tree's own behaviour is
// pinned in UnitListPane.test.tsx). Testids moved to ``parameters-node-*``.
//
// RL1 — on the per-unit tab the inspector shows the unit tree.
// RL2 — clicking a litho-unit node selects the litho-unit scope.
// RL3 — the row states its band count, and the Phase-5 note stays visible.
// RL4 — a litho-only project lists its litho units (never blank).
// RL5 — on the per-test tab the inspector still serves the per-CPT surface,
//       not the tree.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ParametersInspector from './ParametersInspector'

const setSelectedParameterUnit = vi.fn()

let mockTab: 'per-test' | 'per-unit' | 'methods' = 'per-unit'
let mockGeotechFormations: unknown[] = []
let mockGeotechLayers: unknown[] = []
let mockLithoLayers: unknown[] = []

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
          display_order: 0,
          parent_formation_name: 'Diest',
          nad_class: null,
          litho_main_soil_code: 'ZAND',
          litho_admixtures: [],
        },
      ],
      geotechFormations: mockGeotechFormations,
      lithoLayers: mockLithoLayers,
      geotechLayers: mockGeotechLayers,
      // F12: the pane gates on the loaded flag — a mock without it would render
      // the loading state forever.
      geotechLayersLoaded: true,
      activeLithoModel: null,
      activeGeotechModel: null,
    },
    coordinator: {
      selectedId: null,
      markMutated: vi.fn(),
      parametersActiveTab: mockTab,
      selectedParameterUnit: null,
      setSelectedParameterUnit,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
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
  mockLithoLayers = []
})

/** One accepted CPT-anchored litho band of litho-1, body lb1. */
function lithoBand(id: string) {
  return {
    id,
    formation_id: 'litho-1',
    cpt_id: 'cpt-a',
    borehole_id: null,
    depth_top_m: 0,
    depth_base_m: 2,
    status: 'accepted',
    body_id: 'lb1',
    parent_litho_layer_id: null,
  }
}

describe('ParametersInspector — the unit tree lives in the pane (R3)', () => {
  it('RL1 — on the per-unit tab the inspector shows the unit tree', () => {
    mockLithoLayers = [lithoBand('L1')]
    render(<ParametersInspector />)

    expect(screen.getByTestId('parameters-unit-list')).toBeTruthy()
    // The litho unit is the top level of the tree.
    expect(screen.getByTestId('parameters-node-litho-unit:litho-1')).toBeTruthy()
  })

  it('RL2 — clicking a litho-unit node selects the litho-unit scope', () => {
    mockLithoLayers = [lithoBand('L1')]
    render(<ParametersInspector />)

    fireEvent.click(screen.getByTestId('parameters-node-litho-unit:litho-1'))

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'litho-unit',
      unitId: 'litho-1',
    })
  })

  it('RL3 — the row states its band count and the Phase-5 note stays visible', () => {
    mockLithoLayers = [lithoBand('L1'), lithoBand('L2')]
    render(<ParametersInspector />)

    const count = screen.getByTestId('parameters-node-count-litho-unit:litho-1')
    expect(count.textContent).toContain('2 bands')
    expect(count.textContent).toContain('2 with cone')
    // The φ′/c′/cu/E50 dash columns became a compact hint — still visible.
    const note = screen.getByTestId('parameters-unit-phase5-note').textContent ?? ''
    expect(note).toMatch(/φ′/)
    expect(note).toMatch(/Phase 5/i)
  })

  it('RL4 — a litho-only project lists its litho units (never blank)', () => {
    render(<ParametersInspector />)
    expect(screen.getByTestId('parameters-node-litho-unit:litho-1')).toBeTruthy()
  })

  it('RL5 — on the per-test tab the inspector still serves the per-CPT surface', () => {
    mockTab = 'per-test'
    mockLithoLayers = [lithoBand('L1')]
    render(<ParametersInspector />)

    expect(screen.queryByTestId('parameters-unit-list')).toBeNull()
  })
})

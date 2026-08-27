// Smoke + tab-switch test for the Parameters stage canvas.
//
// Scope: the tab bar renders, all three tabs are clickable, the
// active tab's panel shows. Per-tab content is covered by their own
// tests (PerTestTab / PerUnitTab / MethodConfigTab will gain their
// own coverage as Phase-5 logic lands).
//
// useShell is mocked at module level so the canvas doesn't need a
// full ShellContext stub for the empty-bus smoke case.

import { render, cleanup, screen, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ParametersCanvas from './ParametersCanvas'

// Mock useShell to return the minimal slices the three tabs read.
// PerTestTab reads investigations.{cpts, boreholes, plotMap} and
// coordinator.{selectedId, handleSelect}; PerUnitTab reads the unit scope +
// formations; MethodConfigTab reads nothing from the bus.
//
// The tab lives on the coordinator bus since the R3 layout flip, so the mock
// holds it in REAL React state — the canvas's own setter drives the
// re-render, exactly as the App-level state does in production.
import type { ParameterUnitScope } from '../../ShellContext'

let mockSelectedParameterUnit: ParameterUnitScope | null = null

vi.mock('../../ShellContext', async () => {
  const { useState } = await import('react')
  return {
    parameterScopeModel: (s: { kind: string }) =>
      s.kind === 'litho-unit' || s.kind === 'litho-body' ? 'litho' : 'geotech',
    useShell: () => {
      const [tab, setTab] = useState<'per-test' | 'per-unit' | 'methods'>('per-test')
      return {
        project: { id: 'proj-1', view_state: null },
        investigations: {
          cpts: [],
          boreholes: [],
          plotMap: new Map(),
        },
        visibleCpts: [],
        visibleBoreholes: [],
        sections: { visibleSections: [] },
        coordinator: {
          selectedId: null,
          handleSelect: async () => {},
          selectedParameterUnit: mockSelectedParameterUnit,
          setSelectedParameterUnit: vi.fn(),
          parametersActiveTab: tab,
          setParametersActiveTab: setTab,
        },
        geoModel: {
          lithoFormations: [],
          geotechFormations: [],
          lithoLayers: [],
          geotechLayers: [],
        },
      }
    },
  }
})

afterEach(cleanup)

describe('ParametersCanvas — tab scaffold', () => {
  it('renders all three tab buttons on mount', () => {
    render(<ParametersCanvas />)
    expect(screen.getByTestId('parameters-tab-per-test')).toBeInTheDocument()
    expect(screen.getByTestId('parameters-tab-per-unit')).toBeInTheDocument()
    expect(screen.getByTestId('parameters-tab-methods')).toBeInTheDocument()
  })

  it('starts on the per-test panel', () => {
    render(<ParametersCanvas />)
    expect(screen.getByTestId('parameters-panel-per-test')).toBeInTheDocument()
    expect(screen.queryByTestId('parameters-panel-per-unit')).not.toBeInTheDocument()
    expect(screen.queryByTestId('parameters-panel-methods')).not.toBeInTheDocument()
  })

  it('switches to per-unit when its tab is clicked', () => {
    render(<ParametersCanvas />)
    fireEvent.click(screen.getByTestId('parameters-tab-per-unit'))
    expect(screen.getByTestId('parameters-panel-per-unit')).toBeInTheDocument()
    expect(screen.queryByTestId('parameters-panel-per-test')).not.toBeInTheDocument()
  })

  it('switches to methods when its tab is clicked', () => {
    render(<ParametersCanvas />)
    fireEvent.click(screen.getByTestId('parameters-tab-methods'))
    expect(screen.getByTestId('parameters-panel-methods')).toBeInTheDocument()
    expect(screen.queryByTestId('parameters-panel-per-test')).not.toBeInTheDocument()
  })

  it('per-test empty state shows when no tests are loaded', () => {
    render(<ParametersCanvas />)
    expect(screen.getByText('No tests yet')).toBeInTheDocument()
  })

  it('per-unit empty state shows when no litho units exist', () => {
    render(<ParametersCanvas />)
    fireEvent.click(screen.getByTestId('parameters-tab-per-unit'))
    expect(screen.getByText('No units yet')).toBeInTheDocument()
  })

  it('methods tab shows the three pillar headings', () => {
    render(<ParametersCanvas />)
    fireEvent.click(screen.getByTestId('parameters-tab-methods'))
    // The three pillar headers — Correlations / Excel lookups /
    // Probabilistic + ML — assert the hard-separation is structurally
    // visible (debt: don't let a future refactor silently merge them).
    expect(screen.getByText('Correlations')).toBeInTheDocument()
    expect(screen.getByText('Excel lookups')).toBeInTheDocument()
    expect(screen.getByText('Probabilistic + ML')).toBeInTheDocument()
  })

  // PC1 — arriving with a unit already scoped (the layer → parameters jump,
  // owner ballot 2026-08-26) must land on the per-unit tab — where the
  // statistics draw since the R3 flip. Landing on "Per test" would hide what
  // the engineer just navigated to.
  it('PC1 — a scoped unit opens the per-unit tab, not the default per-test one', () => {
    mockSelectedParameterUnit = { kind: 'geotech-unit', unitId: 'unit-7' }
    try {
      render(<ParametersCanvas />)
      expect(screen.getByTestId('parameters-panel-per-unit')).toBeInTheDocument()
      expect(screen.queryByTestId('parameters-panel-per-test')).toBeNull()
    } finally {
      mockSelectedParameterUnit = null
    }
  })
})

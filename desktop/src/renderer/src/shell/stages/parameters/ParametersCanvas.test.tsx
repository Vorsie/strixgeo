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
// PerTestTab reads investigations.{cpts, boreholes, plotMap};
// PerUnitTab reads geoModel.lithoFormations; MethodConfigTab reads
// nothing from the bus.
vi.mock('../../ShellContext', () => ({
  useShell: () => ({
    investigations: {
      cpts: [],
      boreholes: [],
      plotMap: new Map(),
    },
    geoModel: {
      lithoFormations: [],
    },
  }),
}))

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
})

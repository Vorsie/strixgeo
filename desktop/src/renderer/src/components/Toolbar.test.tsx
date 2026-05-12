// Smoke tests for Toolbar (debt #34).
//
// Toolbar is a thin import-dropdown + theme toggle. The dropdown's
// internal state (open / closed) is interaction-driven so we keep
// the test scoped to: the toplevel control renders, the right
// label surfaces per importing/drawingBbox state.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import Toolbar from './Toolbar'

function renderToolbar(overrides: Partial<React.ComponentProps<typeof Toolbar>> = {}) {
  const defaults: React.ComponentProps<typeof Toolbar> = {
    onImportCpt: vi.fn(),
    onImportDov: vi.fn(),
    onImportBoreholeDov: vi.fn(),
    importing: false,
    drawingBbox: false,
  }
  return render(<Toolbar {...defaults} {...overrides} />)
}

describe('Toolbar', () => {
  it('renders the Import dropdown at rest', () => {
    renderToolbar()
    expect(screen.getByText('Import')).toBeInTheDocument()
  })

  it('switches the label to "Drawing bbox…" while drawing', () => {
    renderToolbar({ drawingBbox: true })
    expect(screen.getByText(/Drawing bbox/)).toBeInTheDocument()
  })

  it('exposes the three available import actions in the dropdown', () => {
    renderToolbar()
    // Open the dropdown; menu items are mounted on click.
    fireEvent.click(screen.getByText('Import'))
    expect(screen.getByText('Import CPT (.gef)')).toBeInTheDocument()
    expect(screen.getByText(/Import CPT from DOV/)).toBeInTheDocument()
    expect(screen.getByText(/Import Borehole from DOV/)).toBeInTheDocument()
  })

  it('routes a CPT-import click to onImportCpt', () => {
    const onImportCpt = vi.fn()
    renderToolbar({ onImportCpt })
    fireEvent.click(screen.getByText('Import'))
    fireEvent.click(screen.getByText('Import CPT (.gef)'))
    expect(onImportCpt).toHaveBeenCalledTimes(1)
  })

  it('flags unavailable import actions with a phase tag', () => {
    renderToolbar()
    fireEvent.click(screen.getByText('Import'))
    // DMT / lab / monitoring are marked unavailable in code — they
    // render but get a "Phase 4" tag so the user sees the roadmap.
    expect(screen.getByText('Import DMT')).toBeInTheDocument()
    expect(screen.getAllByText(/Phase 4/).length).toBeGreaterThan(0)
  })
})

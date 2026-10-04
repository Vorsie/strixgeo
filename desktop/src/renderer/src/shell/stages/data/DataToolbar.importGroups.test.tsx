// Owner 2026-10-04: "the import menu now has 3 ways to import CPT's, let's
// clean that up. one button for cpt's with suboptions, same for drillings."
// The Import menu shows ONE row per kind of investigation: CPT and Borehole
// open their import routes in a submenu; lab tests stay a plain row; DMT and
// monitoring stay as dimmed rows with the phase tag.

import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DataToolbar from './DataToolbar'
import { ShellContext } from '../../ShellContext'

function renderToolbar(over: Record<string, unknown> = {}) {
  const handlers = {
    handleImportCpt: vi.fn(),
    handleImportDov: vi.fn(),
    handleImportBoreholeDov: vi.fn(),
    handleImportBoreholeXml: vi.fn().mockResolvedValue(undefined),
    handleImportCptPdf: vi.fn().mockResolvedValue(undefined),
  }
  const value = {
    investigations: {
      importing: false,
      dovImporting: false,
      bboxImportType: null,
      ...handlers,
      ...over,
    },
  }
  render(
    <ShellContext.Provider value={value as never}>
      <DataToolbar />
    </ShellContext.Provider>,
  )
  fireEvent.click(screen.getByTestId('import-menu-button'))
  return handlers
}

/** The visible rows of the top-level Import menu, in order. */
function topRows(): string[] {
  const menu = screen.getAllByRole('menu')[0]
  return within(menu)
    .getAllByRole('menuitem')
    .map(r => r.getAttribute('data-testid') ?? '')
}

describe('DataToolbar Import menu: one row per kind, routes in a submenu', () => {
  it('shows the CPT and Borehole groups, lab tests, and the two future rows', () => {
    renderToolbar()
    expect(topRows()).toEqual([
      'import-group-cpt',
      'import-group-borehole',
      'import-verb-lab',
      'import-verb-dmt',
      'import-verb-monitoring',
    ])
    expect(screen.getByTestId('import-verb-dmt')).toBeDisabled()
    expect(screen.getByTestId('import-verb-monitoring')).toBeDisabled()
    expect(screen.getByTestId('import-verb-dmt').textContent).toContain('Phase 4')
    // The routes sit behind their group, not in the top level.
    expect(screen.queryByTestId('import-verb-cpt-gef')).toBeNull()
    expect(screen.queryByTestId('import-verb-borehole-dov')).toBeNull()
  })

  it('opening the CPT group shows the three CPT routes', () => {
    renderToolbar()
    fireEvent.click(screen.getByTestId('import-group-cpt'))
    const sub = screen.getAllByRole('menu')[1]
    expect(
      within(sub)
        .getAllByRole('menuitem')
        .map(r => r.getAttribute('data-testid')),
    ).toEqual(['import-verb-cpt-gef', 'import-verb-cpt-dov', 'import-verb-cpt-pdf'])
    expect(screen.getByTestId('import-verb-cpt-gef').textContent).toContain('.gef files')
    expect(screen.getByTestId('import-verb-cpt-dov').textContent).toContain('From DOV (draw box)')
    expect(screen.getByTestId('import-verb-cpt-pdf').textContent).toContain('From a PDF report')
  })

  it('the pdf route runs the PDF import', () => {
    const h = renderToolbar()
    fireEvent.click(screen.getByTestId('import-group-cpt'))
    fireEvent.click(screen.getByTestId('import-verb-cpt-pdf'))
    expect(h.handleImportCptPdf).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('opening the Borehole group shows the DOV draw and the DOV XML file routes', () => {
    const h = renderToolbar()
    fireEvent.mouseEnter(screen.getByTestId('import-group-borehole'))
    const sub = screen.getAllByRole('menu')[1]
    expect(
      within(sub)
        .getAllByRole('menuitem')
        .map(r => r.getAttribute('data-testid')),
    ).toEqual(['import-verb-borehole-dov', 'import-verb-borehole-xml'])
    fireEvent.click(screen.getByTestId('import-verb-borehole-dov'))
    expect(h.handleImportBoreholeDov).toHaveBeenCalledTimes(1)
  })

  it('while an import runs, the group rows are disabled too', () => {
    renderToolbar({ importing: true })
    expect(screen.getByTestId('import-group-cpt')).toBeDisabled()
    expect(screen.getByTestId('import-group-borehole')).toBeDisabled()
  })
})

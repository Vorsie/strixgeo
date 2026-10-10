// Owner 2026-10-10 (borehole PDF phase 2): the Data stage Import menu's
// Borehole group gets "From a PDF report" ("Uit een pdf-rapport" in Dutch),
// the CPT group's PDF route twin, and it opens the borehole PDF import.

import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DEFAULT_LANGUAGE } from '../../../i18n/i18n_constants'
import { setLanguage } from '../../../i18n/languageSelect'
import DataToolbar from './DataToolbar'
import { ShellContext } from '../../ShellContext'

afterEach(() => {
  localStorage.clear()
  setLanguage(DEFAULT_LANGUAGE)
})

function renderToolbar(handleImportBoreholePdf?: () => Promise<void>): void {
  const value = {
    investigations: {
      importing: false,
      dovImporting: false,
      bboxImportType: null,
      handleImportCpt: () => {},
      handleImportDov: () => {},
      handleImportBoreholeDov: () => {},
      handleImportBoreholePdf,
    },
  }
  render(
    <ShellContext.Provider value={value as never}>
      <DataToolbar />
    </ShellContext.Provider>,
  )
}

function openBoreholeGroup(): void {
  fireEvent.click(screen.getByTestId('import-menu-button'))
  fireEvent.click(screen.getByTestId('import-group-borehole'))
}

describe('DataToolbar: Borehole > From a PDF report', () => {
  it('offers the route in the Borehole group and opens the PDF import', () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    renderToolbar(handler)
    openBoreholeGroup()
    const verb = screen.getByTestId('import-verb-borehole-pdf')
    expect(verb.textContent).toContain('From a PDF report')
    fireEvent.click(verb)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('reads "Uit een pdf-rapport" in Dutch', () => {
    setLanguage('nl')
    renderToolbar(vi.fn().mockResolvedValue(undefined))
    openBoreholeGroup()
    expect(screen.getByTestId('import-verb-borehole-pdf').textContent).toContain('Uit een pdf-rapport')
  })

  it('a shell without the handler shows no such route', () => {
    renderToolbar(undefined)
    openBoreholeGroup()
    expect(screen.queryByTestId('import-verb-borehole-pdf')).toBeNull()
  })
})

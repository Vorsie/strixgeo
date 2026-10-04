// The Data stage Import menu carries "DOV XML files" in its Borehole group,
// next to the DOV bbox route, and it runs the borehole XML import.

import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import DataToolbar from './DataToolbar'
import { ShellContext } from '../../ShellContext'

function renderToolbar(handleImportBoreholeXml?: () => Promise<void>): void {
  const value = {
    investigations: {
      importing: false,
      dovImporting: false,
      bboxImportType: null,
      handleImportCpt: () => {},
      handleImportDov: () => {},
      handleImportBoreholeDov: () => {},
      handleImportBoreholeXml,
    },
  }
  render(
    <ShellContext.Provider value={value as never}>
      <DataToolbar />
    </ShellContext.Provider>,
  )
}

describe('DataToolbar: Borehole > DOV XML files', () => {
  it('offers the verb and runs the import', () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    renderToolbar(handler)
    fireEvent.click(screen.getByTestId('import-menu-button'))
    fireEvent.click(screen.getByTestId('import-group-borehole'))
    const verb = screen.getByTestId('import-verb-borehole-xml')
    expect(verb.textContent).toContain('DOV XML files')
    fireEvent.click(verb)
    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('a shell without the handler shows no such verb', () => {
    renderToolbar(undefined)
    fireEvent.click(screen.getByTestId('import-menu-button'))
    fireEvent.click(screen.getByTestId('import-group-borehole'))
    expect(screen.queryByTestId('import-verb-borehole-xml')).toBeNull()
  })
})

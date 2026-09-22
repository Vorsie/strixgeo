// Renaming a cross-section in the inspector, in the owner's words (dogfeed
// 2026-09-22, app in Dutch):
//   "it changes back to English when I click it in the bottom right corner"
//     → the properties field opens with "Dwarsprofiel 1", the name he sees.
//   "top left corner ... I want to be able to change it too"
//     → the section list row gets a rename pencil; the row is selected first so
//       the save goes through the selected-section PATCH.
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setLanguage } from '../../../i18n/languageSelect'
import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsInspector from './SectionsInspector'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

vi.mock('../../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function makeCtx(): ShellContextValue {
  const ctx = makeShellCtx('geotechnical')
  // The stored name is the English canonical default the create path writes;
  // the app shows it translated ("Dwarsprofiel 1").
  const section = { ...ctx.sections.sections[0], name: 'Cross-section 1' }
  ctx.sections.sections = [section]
  ctx.sections.visibleSections = [section]
  ctx.sections.selectedSectionId = section.id
  ctx.sections.handleSelectSection = vi.fn()
  ctx.sections.handlePatchSelectedSection = vi.fn().mockResolvedValue(undefined)
  return ctx
}

function renderInspector(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsInspector />
    </ShellContext.Provider>,
  )
}

beforeEach(() => setLanguage('nl'))
afterEach(() => {
  cleanup()
  setLanguage('en')
})

describe('SectionsInspector — renaming a section', () => {
  it('R1 — the properties field opens with the name I see (Dwarsprofiel 1), not the English default', () => {
    const ctx = makeCtx()
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('section-name-edit'))
    const input = screen.getByTestId('section-name-input') as HTMLInputElement
    expect(input.value).toBe('Dwarsprofiel 1')
  })

  it('R2 — closing the field unchanged saves nothing, so the name keeps translating', () => {
    const ctx = makeCtx()
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('section-name-edit'))
    fireEvent.blur(screen.getByTestId('section-name-input'))
    expect(ctx.sections.handlePatchSelectedSection).not.toHaveBeenCalled()
    expect(screen.getByTestId('section-name-edit')).toHaveTextContent('Dwarsprofiel 1')
  })

  it('R3 — a new name typed in the properties field is saved', () => {
    const ctx = makeCtx()
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('section-name-edit'))
    const input = screen.getByTestId('section-name-input')
    fireEvent.change(input, { target: { value: 'Noordwand' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(ctx.sections.handlePatchSelectedSection).toHaveBeenCalledWith({ name: 'Noordwand' })
  })

  it('R4 — the list row has a rename pencil: it selects the row and saves the new name', () => {
    const ctx = makeCtx()
    renderInspector(ctx)
    fireEvent.click(screen.getByTestId('section-row-rename-sec-1'))
    expect(ctx.sections.handleSelectSection).toHaveBeenCalledWith('sec-1')
    const input = screen.getByTestId('section-row-name-input-sec-1') as HTMLInputElement
    expect(input.value).toBe('Dwarsprofiel 1')
    fireEvent.change(input, { target: { value: 'Oostwand' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.blur(input)
    expect(ctx.sections.handlePatchSelectedSection).toHaveBeenCalledWith({ name: 'Oostwand' })
  })
})

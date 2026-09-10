// Owner 2026-09-10 (beta walk): "waar is het knopje om terug te gaan naar map
// view voor cross sections?" The only way back was a small X at the far right
// of the section header. The section view carries the same Map | Section tab
// strip the Data stage shows for a detail, so the way back to the map is a
// labelled tab, not an icon.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import { makeStubContext } from './__fixtures__/shellStub'

vi.mock('../../../components/SectionPanel', () => ({ default: () => null }))
vi.mock('../../../components/MapView', () => ({ default: () => null }))
vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

import SectionsCanvas from './SectionsCanvas'

afterEach(cleanup)

describe('Sections canvas — a labelled way back to the map', () => {
  it('shows a Map tab while a section is open, and the tab returns to the map', () => {
    const ctx = makeStubContext()
    const clearSectionSelection = vi.fn()
    ctx.sections.clearSectionSelection = clearSectionSelection
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsCanvas />
      </ShellContext.Provider>,
    )
    const mapTab = screen.getByRole('button', { name: /^map$|^kaart$/i })
    expect(screen.getByRole('button', { name: /^section$|^profiel$/i })).toBeTruthy()
    fireEvent.click(mapTab)
    expect(clearSectionSelection).toHaveBeenCalledTimes(1)
  })
})

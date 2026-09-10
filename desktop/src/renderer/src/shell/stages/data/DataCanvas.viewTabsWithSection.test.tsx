// Owner 2026-09-10 (beta walk, the day before): "going from a test detail view
// back to map and going from cross section back to map — there is a chart/map
// button, it should always be clickable." A detail opened while a cross-section
// was still the workspace (section double-click → Data stage) rendered NO
// Map/Chart tabs at all, so the only way out was Esc, which lands on the section,
// never on the map. The tabs must be there whenever a detail is open.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import { makeSection, makeStubContext } from '../sections/__fixtures__/shellStub'

vi.mock('../../../components/MapView', () => ({ default: () => <div data-testid="map-stub" /> }))
vi.mock('../../../components/CptChart', () => ({ default: () => <div data-testid="chart-stub" /> }))
vi.mock('../../../components/BoreholeLog', () => ({ default: () => null }))
vi.mock('../../../components/DovImportProgressPanel', () => ({ default: () => null }))

import DataCanvas from './DataCanvas'

afterEach(cleanup)

describe('DataCanvas — the Map/Chart tabs are always there while a detail is open', () => {
  it('shows the Map tab for a test detail opened while a cross-section is still selected, and it goes back to the map', () => {
    const ctx = makeStubContext()
    ctx.sections.visibleSections = [makeSection({ id: 's1', name: 'Section 1' })]
    ctx.sections.selectedSectionId = 's1'
    ctx.coordinator.selectedId = 'cpt-1'
    ctx.coordinator.view = 'chart'
    const setView = vi.fn()
    ctx.coordinator.setView = setView
    render(
      <ShellContext.Provider value={ctx}>
        <DataCanvas />
      </ShellContext.Provider>,
    )
    const mapTab = screen.getByRole('button', { name: /map/i })
    expect(screen.getByRole('button', { name: /chart/i })).toBeTruthy()
    fireEvent.click(mapTab)
    expect(setView).toHaveBeenCalledWith('map')
  })

  it('still shows the tabs with no section selected (the existing behaviour)', () => {
    const ctx = makeStubContext()
    ctx.sections.selectedSectionId = null
    ctx.coordinator.selectedId = 'cpt-1'
    ctx.coordinator.view = 'chart'
    render(
      <ShellContext.Provider value={ctx}>
        <DataCanvas />
      </ShellContext.Provider>,
    )
    expect(screen.getByRole('button', { name: /map/i })).toBeTruthy()
  })
})

// Owner 2026-09-04 ("for some reason i can't enter cross section view by
// clicking on the cs on map"): clicking a cross-section line on the DATA
// stage's map must open that section in the Sections stage, not merely mark
// it selected. The stage switch rides the sections deep-link the shell
// already consumes (AppShell: setActiveStage('sections') + select).
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import { makeSection, makeStubContext } from '../sections/__fixtures__/shellStub'

vi.mock('../../../components/MapView', () => ({
  default: (props: { onSelectSection?: (id: string) => void }) => (
    <button data-testid="map-stub-section" onClick={() => props.onSelectSection?.('s1')} />
  ),
}))
vi.mock('../../../components/CptChart', () => ({ default: () => null }))
vi.mock('../../../components/BoreholeLog', () => ({ default: () => null }))
vi.mock('../../../components/DovImportProgressPanel', () => ({ default: () => null }))

import DataCanvas from './DataCanvas'

afterEach(cleanup)

describe('DataCanvas — a map click on a cross-section opens it', () => {
  it('selects the section AND requests the Sections stage through the deep link', () => {
    const ctx = makeStubContext()
    ctx.sections.visibleSections = [makeSection({ id: 's1', name: 'Section 1' })]
    const handleSelectSection = vi.fn()
    const setSectionsDeepLinkTarget = vi.fn()
    ctx.sections.handleSelectSection = handleSelectSection
    ctx.coordinator.setSectionsDeepLinkTarget = setSectionsDeepLinkTarget
    render(
      <ShellContext.Provider value={ctx}>
        <DataCanvas />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByTestId('map-stub-section'))
    expect(handleSelectSection).toHaveBeenCalledWith('s1')
    expect(setSectionsDeepLinkTarget).toHaveBeenCalledWith({ sectionId: 's1', contactIds: [] })
  })
})

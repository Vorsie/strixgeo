// Behaviour test for the shell-level Esc peel (debt #43).
//
// AppShell mounts the four heavy zone components (spine / toolbar /
// canvas / inspector) which pull in Leaflet + Cesium — mock them to
// null so this test exercises ONLY the new keydown handler. useShellState
// is mocked so the active stage is controllable (the handler is scoped
// to the Data stage).

import { act, render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppShell from './AppShell'
import type { ShellContextValue } from './ShellContext'
import type { StageId } from './StageDescriptor'
import { sectionsRevealColumnCallback } from './stages/sections/sectionColumnRevealBridge'

vi.mock('./StageSpine', () => ({ default: () => null }))
vi.mock('./StageToolbar', () => ({ default: () => null }))
vi.mock('./StageCanvas', () => ({ default: () => null }))
vi.mock('./Inspector', () => ({ default: () => null }))

let mockStage: StageId = 'data'
// Stable across renders so the open-detail→Data-stage effect can be
// asserted (a fresh vi.fn() per render would lose the call history).
const mockSetActiveStage = vi.fn()
vi.mock('./useShellState', () => ({
  useShellState: () => ({
    activeStageId: mockStage,
    inspectorOpen: true,
    setActiveStage: mockSetActiveStage,
    toggleInspector: vi.fn(),
    setInspectorOpen: vi.fn(),
  }),
}))

interface Ctx {
  setSelectedId: ReturnType<typeof vi.fn>
  setSelectedBoreholeId: ReturnType<typeof vi.fn>
  setView: ReturnType<typeof vi.fn>
  ctx: ShellContextValue
}

function makeCtx(
  over: {
    selectedId?: string | null
    selectedBoreholeId?: string | null
    selectedSectionId?: string | null
    bboxImportType?: string | null
    drawingSection?: boolean
    view?: 'map' | 'chart'
    sectionsDeepLinkTarget?: unknown
    geoDeepLinkTarget?: { sectionId: string; contactId: string } | null
  } = {},
): Ctx {
  const setSelectedId = vi.fn()
  const setSelectedBoreholeId = vi.fn()
  const setView = vi.fn()
  // AppShell only touches project.id + the slices the Esc handler reads;
  // children are mocked to null so they never consume the context. A
  // partial object cast is sufficient and keeps the test focused.
  const ctx = {
    project: { id: 'proj-1' },
    investigations: { bboxImportType: over.bboxImportType ?? null },
    sections: {
      drawingSection: over.drawingSection ?? false,
      selectedSectionId: over.selectedSectionId ?? null,
      handleSelectSection: vi.fn(),
      handleFocusContacts: vi.fn(),
      setSectionModelAxis: vi.fn(),
    },
    coordinator: {
      selectedId: over.selectedId ?? null,
      selectedBoreholeId: over.selectedBoreholeId ?? null,
      view: over.view ?? 'map',
      setSelectedId,
      setSelectedBoreholeId,
      setView,
      geoDeepLinkTarget: over.geoDeepLinkTarget ?? null,
      setGeoDeepLinkTarget: vi.fn(),
      sectionsDeepLinkTarget: over.sectionsDeepLinkTarget ?? null,
      setSectionsDeepLinkTarget: vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
    },
  } as unknown as ShellContextValue
  return { setSelectedId, setSelectedBoreholeId, setView, ctx }
}

beforeEach(() => {
  mockStage = 'data'
})

afterEach(() => {
  cleanup()
  sectionsRevealColumnCallback.current = null
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('AppShell geotech report reveal', () => {
  it('waits for the section bridge before clearing a geotech span request', () => {
    vi.useFakeTimers()
    const { ctx } = makeCtx({
      sectionsDeepLinkTarget: {
        sectionId: 'tie7',
        contactIds: [],
        revealInvestigationIds: ['S4', 'B6'],
        sectionModelAxis: 'geotechnical',
      },
    })
    const setTarget = ctx.coordinator.setSectionsDeepLinkTarget as ReturnType<typeof vi.fn>
    const sections = ctx.sections as unknown as {
      setSectionModelAxis: ReturnType<typeof vi.fn>
      handleSelectSection: ReturnType<typeof vi.fn>
    }

    render(<AppShell context={ctx} />)
    expect(sections.setSectionModelAxis).toHaveBeenCalledWith('geotechnical')
    expect(sections.handleSelectSection).toHaveBeenCalledWith('tie7')

    act(() => vi.advanceTimersByTime(600))
    expect(setTarget).not.toHaveBeenCalledWith(null)

    sectionsRevealColumnCallback.current = vi.fn(() => ({
      revealed: true,
      missingInvestigationIds: [],
    }))
    act(() => vi.advanceTimersByTime(50))
    expect(sectionsRevealColumnCallback.current).toHaveBeenCalledWith(['S4', 'B6'])
    expect(setTarget).toHaveBeenCalledWith(null)
  })
})

describe('AppShell "Edit in Geology stage" deep-link (#156)', () => {
  it('lands on the SECTION VIEW (not the 3D globe): switches to the Sections stage, selects the geological axis, selects the section, and focuses the contact with a geological override', () => {
    const { ctx } = makeCtx({
      geoDeepLinkTarget: { sectionId: 'section-1', contactId: 'geo-contact-1' },
    })
    const setGeoTarget = ctx.coordinator.setGeoDeepLinkTarget as ReturnType<typeof vi.fn>
    const sections = ctx.sections as unknown as {
      setSectionModelAxis: ReturnType<typeof vi.fn>
      handleSelectSection: ReturnType<typeof vi.fn>
      handleFocusContacts: ReturnType<typeof vi.fn>
    }

    render(<AppShell context={ctx} />)

    // The geological model is edited on cross-sections, not the globe — so the
    // deep-link opens the Sections stage, NOT the Geology (Cesium) stage.
    expect(mockSetActiveStage).toHaveBeenCalledWith('sections')
    expect(mockSetActiveStage).not.toHaveBeenCalledWith('geology')

    // On the geological axis so the geological contact is the editable one.
    expect(sections.setSectionModelAxis).toHaveBeenCalledWith('geological')
    expect(sections.handleSelectSection).toHaveBeenCalledWith('section-1')

    // The contact is focused with the geological axis stated explicitly, so the
    // amber ring resolves instead of firing "couldn't find the contact".
    expect(sections.handleFocusContacts).toHaveBeenCalledWith(
      ['geo-contact-1'],
      'section-1',
      'geological',
    )

    // Single-fire: the payload is cleared so a later re-render does not re-apply it.
    expect(setGeoTarget).toHaveBeenCalledWith(null)
  })
})

describe('AppShell Esc peel (debt #43)', () => {
  it('clears the Data-stage detail selection on Esc', () => {
    const { ctx, setSelectedId, setSelectedBoreholeId, setView } = makeCtx({
      selectedId: 'cpt-1',
    })
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).toHaveBeenCalledWith(null)
    expect(setSelectedBoreholeId).toHaveBeenCalledWith(null)
    expect(setView).toHaveBeenCalledWith('map')
  })

  it('is a no-op when nothing is selected', () => {
    const { ctx, setSelectedId, setView } = makeCtx()
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
    expect(setView).not.toHaveBeenCalled()
  })

  it('yields to an open modal (role="dialog" present)', () => {
    const { ctx, setSelectedId } = makeCtx({ selectedId: 'cpt-1' })
    render(
      <>
        <div role="dialog">a modal</div>
        <AppShell context={ctx} />
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
  })

  it('yields while a bbox draw is active', () => {
    const { ctx, setSelectedId } = makeCtx({
      selectedId: 'cpt-1',
      bboxImportType: 'cpt',
    })
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
  })

  it('does not act off the Data stage (Sections owns its own Esc peel)', () => {
    mockStage = 'sections'
    const { ctx, setSelectedId } = makeCtx({ selectedId: 'cpt-1' })
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
  })

  it('Esc with a section open backs out to the Sections stage', () => {
    // Detail opened while a cross-section was the workspace: Esc clears
    // the detail AND returns directly to that section (not the bare map).
    const { ctx, setSelectedId, setSelectedBoreholeId, setView } = makeCtx({
      selectedId: 'cpt-1',
      selectedSectionId: 'sec-1',
    })
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).toHaveBeenCalledWith(null)
    expect(setSelectedBoreholeId).toHaveBeenCalledWith(null)
    expect(setView).toHaveBeenCalledWith('map')
    expect(mockSetActiveStage).toHaveBeenCalledWith('sections')
  })

  it('ignores Esc fired from a typing target', () => {
    const { ctx, setSelectedId } = makeCtx({ selectedId: 'cpt-1' })
    render(<AppShell context={ctx} />)
    const input = document.createElement('input')
    document.body.appendChild(input)
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
    input.remove()
  })
})

// Open-a-detail → Data stage (#3 stage-router bug). A section
// double-click sets the selection + view='chart' but the detail only
// renders in the Data stage, so the user "landed on the map" until the
// shell routed the open-detail action to Data.
describe('AppShell open-detail → Data stage (#3)', () => {
  it('switches to the Data stage when a detail is opened from another stage', () => {
    mockStage = 'sections'
    const { ctx } = makeCtx({ selectedId: null, view: 'map' })
    const { rerender } = render(<AppShell context={ctx} />)
    // Drop the mount-time project-open setActiveStage('data') so the
    // assertion isolates the open-detail effect (project.id is unchanged
    // on rerender, so that effect does not re-fire).
    vi.clearAllMocks()

    const { ctx: opened } = makeCtx({ selectedId: 'cpt-1', view: 'chart' })
    rerender(<AppShell context={opened} />)

    expect(mockSetActiveStage).toHaveBeenCalledWith('data')
  })

  it('does not route to Data when the selection is shown on the map', () => {
    mockStage = 'sections'
    const { ctx } = makeCtx({ selectedId: null, view: 'map' })
    const { rerender } = render(<AppShell context={ctx} />)
    vi.clearAllMocks()

    const { ctx: mapSel } = makeCtx({ selectedId: 'cpt-1', view: 'map' })
    rerender(<AppShell context={mapSel} />)

    expect(mockSetActiveStage).not.toHaveBeenCalled()
  })
})

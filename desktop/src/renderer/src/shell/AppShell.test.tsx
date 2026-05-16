// Behaviour test for the shell-level Esc peel (debt #43).
//
// AppShell mounts the four heavy zone components (spine / toolbar /
// canvas / inspector) which pull in Leaflet + Cesium — mock them to
// null so this test exercises ONLY the new keydown handler. useShellState
// is mocked so the active stage is controllable (the handler is scoped
// to the Data stage).

import { render, cleanup, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppShell from './AppShell'
import type { ShellContextValue } from './ShellContext'
import type { StageId } from './StageDescriptor'

vi.mock('./StageSpine', () => ({ default: () => null }))
vi.mock('./StageToolbar', () => ({ default: () => null }))
vi.mock('./StageCanvas', () => ({ default: () => null }))
vi.mock('./Inspector', () => ({ default: () => null }))

let mockStage: StageId = 'data'
vi.mock('./useShellState', () => ({
  useShellState: () => ({
    activeStageId: mockStage,
    inspectorOpen: true,
    setActiveStage: vi.fn(),
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
    },
    coordinator: {
      selectedId: over.selectedId ?? null,
      selectedBoreholeId: over.selectedBoreholeId ?? null,
      setSelectedId,
      setSelectedBoreholeId,
      setView,
    },
  } as unknown as ShellContextValue
  return { setSelectedId, setSelectedBoreholeId, setView, ctx }
}

beforeEach(() => {
  mockStage = 'data'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
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

  it('bails when a section is selected (not the transient detail)', () => {
    const { ctx, setSelectedId } = makeCtx({
      selectedId: 'cpt-1',
      selectedSectionId: 'sec-1',
    })
    render(<AppShell context={ctx} />)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(setSelectedId).not.toHaveBeenCalled()
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

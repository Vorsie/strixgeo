// Pins for the layer → Parameters jump (owner ballot 2026-08-26 — "the
// right-click layer → ... jump-to-parameters link").
//
// The gesture starts on a geotech band in a cross-section and has to end on
// the Parameters stage with that band's UNIT already selected. Nothing but
// AppShell may switch stages, so the section overlay posts a payload onto the
// coordinator bus and AppShell is what acts on it — the same contract
// ``geoDeepLinkTarget`` / ``sectionsDeepLinkTarget`` already run on.
//
// PDL1 — posting a target switches to the Parameters stage.
// PDL2 — ...and preselects the unit that was right-clicked.
// PDL3 — ...and clears the payload, so a later re-mount does not re-navigate.
// PDL4 — no target, no navigation.

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import AppShell from './AppShell'
import type { ParameterUnitScope, ShellContextValue } from './ShellContext'
import type { StageId } from './StageDescriptor'

// The four heavy zones pull in Leaflet + Cesium; mocked to null so this spec
// exercises only the deep-link effect (same approach as AppShell.test.tsx).
vi.mock('./StageSpine', () => ({ default: () => null }))
vi.mock('./StageToolbar', () => ({ default: () => null }))
vi.mock('./StageCanvas', () => ({ default: () => null }))
vi.mock('./Inspector', () => ({ default: () => null }))

let mockStage: StageId = 'sections'
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

function makeCtx(target: ParameterUnitScope | null): {
  ctx: ShellContextValue
  setSelectedParameterUnit: ReturnType<typeof vi.fn>
  setParametersDeepLinkTarget: ReturnType<typeof vi.fn>
} {
  const setSelectedParameterUnit = vi.fn()
  const setParametersDeepLinkTarget = vi.fn()
  const ctx = {
    project: { id: 'proj-1' },
    investigations: { bboxImportType: null },
    sections: {
      drawingSection: false,
      selectedSectionId: null,
      handleSelectSection: vi.fn(),
      handleFocusContacts: vi.fn(),
    },
    coordinator: {
      selectedId: null,
      selectedBoreholeId: null,
      view: 'map',
      setSelectedId: vi.fn(),
      setSelectedBoreholeId: vi.fn(),
      setView: vi.fn(),
      geoDeepLinkTarget: null,
      setGeoDeepLinkTarget: vi.fn(),
      sectionsDeepLinkTarget: null,
      setSectionsDeepLinkTarget: vi.fn(),
      parametersDeepLinkTarget: target,
      setParametersDeepLinkTarget,
      selectedParameterUnit: null,
      setSelectedParameterUnit,
      parametersActiveTab: 'per-test',
      setParametersActiveTab: vi.fn(),
      correlationEdgesRefetchNonce: 0,
      bodyRecomputeLithoNonce: 0,
      bodyRecomputeGeotechNonce: 0,
      requestBodyRecompute: vi.fn(),
    },
  } as unknown as ShellContextValue
  return { ctx, setSelectedParameterUnit, setParametersDeepLinkTarget }
}

beforeEach(() => {
  mockStage = 'sections'
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('AppShell — layer → Parameters deep link', () => {
  it('PDL1 — posting a target switches to the Parameters stage', () => {
    const { ctx } = makeCtx({ kind: 'geotech-unit', unitId: 'unit-7' })
    render(<AppShell context={ctx} />)

    expect(mockSetActiveStage).toHaveBeenCalledWith('parameters')
  })

  it('PDL2 — preselects the node that was right-clicked, kind included', () => {
    const { ctx, setSelectedParameterUnit } = makeCtx({ kind: 'geotech-unit', unitId: 'unit-7' })
    render(<AppShell context={ctx} />)

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({ kind: 'geotech-unit', unitId: 'unit-7' })
  })

  it('PDL5 — a LITHO-unit target arrives as a litho-unit scope (the R1 jump)', () => {
    const { ctx, setSelectedParameterUnit } = makeCtx({ kind: 'litho-unit', unitId: 'litho-3' })
    render(<AppShell context={ctx} />)

    expect(mockSetActiveStage).toHaveBeenCalledWith('parameters')
    expect(setSelectedParameterUnit).toHaveBeenCalledWith({ kind: 'litho-unit', unitId: 'litho-3' })
  })

  it('PDL6 — a geotech-body target arrives intact, body included', () => {
    const { ctx, setSelectedParameterUnit } = makeCtx({
      kind: 'geotech-body',
      unitId: 'unit-7',
      bodyId: 'body-3',
    })
    render(<AppShell context={ctx} />)

    expect(setSelectedParameterUnit).toHaveBeenCalledWith({
      kind: 'geotech-body',
      unitId: 'unit-7',
      bodyId: 'body-3',
    })
  })

  it('PDL7 — a geotech-class target round-trips its litho unit + body + class', () => {
    const target: ParameterUnitScope = {
      kind: 'geotech-class',
      lithoUnitId: 'litho-3',
      lithoBodyId: 'body-9',
      nadClass: 13,
    }
    const { ctx, setSelectedParameterUnit } = makeCtx(target)
    render(<AppShell context={ctx} />)

    expect(setSelectedParameterUnit).toHaveBeenCalledWith(target)
  })

  it('PDL8 — a litho-body target round-trips intact', () => {
    const target: ParameterUnitScope = { kind: 'litho-body', unitId: 'litho-3', bodyId: 'lb-2' }
    const { ctx, setSelectedParameterUnit } = makeCtx(target)
    render(<AppShell context={ctx} />)

    expect(setSelectedParameterUnit).toHaveBeenCalledWith(target)
  })

  it('PDL3 — clears the payload so a re-mount does not re-navigate', () => {
    const { ctx, setParametersDeepLinkTarget } = makeCtx({ kind: 'geotech-unit', unitId: 'unit-7' })
    render(<AppShell context={ctx} />)

    expect(setParametersDeepLinkTarget).toHaveBeenCalledWith(null)
  })

  it('PDL4 — no target, no navigation', () => {
    const { ctx, setSelectedParameterUnit } = makeCtx(null)
    render(<AppShell context={ctx} />)

    expect(mockSetActiveStage).not.toHaveBeenCalledWith('parameters')
    expect(setSelectedParameterUnit).not.toHaveBeenCalled()
  })
})

// SU — a re-subdivide clears the section undo stack (audit F23).
//
// Pipeline step 1 deletes and rewrites every geotech row, but the band-edit undo
// commands hold hard-coded band UUIDs. Nothing invalidated the stack, so the first
// stale Ctrl+Z after a re-subdivide hit "Packing band X was not found", and the
// failure handler then discarded EVERY entry — including litho edits that were
// still perfectly undoable. Clearing at the rebuild is honest: the rebuild is the
// moment the ids the stack holds stop meaning anything.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type { GeologicalModelResponse, ProjectResponse } from '../api/client'

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: vi.fn(),
      listFormations: vi.fn().mockResolvedValue([]),
      listContacts: vi.fn().mockResolvedValue([]),
      listLayers: vi.fn().mockResolvedValue([]),
      listSurfaces: vi.fn().mockResolvedValue([]),
      validateCrossings: vi.fn().mockResolvedValue({ issues: [] }),
      subdivideAllBodies: vi.fn(),
      subdivideCpts: vi.fn(),
      listLithoSolids: vi.fn().mockResolvedValue([]),
      getGaplessBuildReport: vi.fn().mockResolvedValue(null),
      // Debt #266 — the geotech axis reads which columns stand on edited litho.
      geotechLithoStaleness: vi.fn().mockResolvedValue({
        geotech_model_id: '',
        litho_model_id: null,
        stale_columns: [],
        stale_column_count: 0,
        banded_column_count: 0,
        unstamped_column_count: 0,
      }),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
    },
    cpt: { list: vi.fn().mockResolvedValue([]) },
    borehole: { list: vi.fn().mockResolvedValue([]) },
    section: { list: vi.fn().mockResolvedValue([]) },
    project: { get: vi.fn(), update: vi.fn() },
  },
  DuplicateContactError: class DuplicateContactError extends Error {},
}))

vi.mock('../utils/log', () => ({
  log: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

const PROJECT = { id: 'proj-1', name: 'p', view_state: null } as unknown as ProjectResponse

function model(id: string, kind: string, parent: string | null): GeologicalModelResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: id,
    description: null,
    kind,
    is_active: true,
    parent_model_id: parent,
    representative_statistic: 'median',
    classified_with_statistic: null,
  } as unknown as GeologicalModelResponse
}

const GEO_MODEL = model('geo-model-1', 'geological', null)
const LITHO_MODEL = model('litho-model-1', 'lithostratigraphic', 'geo-model-1')
const GEOTECH_MODEL = model('geotech-model-1', 'geotechnical', 'litho-model-1')

function makeArgs(clearUndo: () => void) {
  return {
    project: PROJECT,
    toast: vi.fn(),
    pushUndo: vi.fn(),
    clearUndo,
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    addToSessionImports: vi.fn(),
    removeFromSessionImports: vi.fn(),
    manifestFormationIds: undefined as Set<string> | undefined,
    currentLumping: null,
    stageLumping: vi.fn(),
    requestCorrelationEdgesRefetch: vi.fn(),
    markMutated: vi.fn(),
  }
}

let apiMock: (typeof import('../api/client'))['api']

beforeEach(async () => {
  vi.clearAllMocks()
  const mod = await import('../api/client')
  apiMock = mod.api
  vi.mocked(apiMock.geology.listModels).mockResolvedValue([GEO_MODEL, LITHO_MODEL, GEOTECH_MODEL])
  vi.mocked(apiMock.geology.subdivideCpts).mockResolvedValue({
    geotech_model_id: 'geotech-model-1',
    bodies_processed: 1,
    bodies_split: 0,
    bodies_single_class: 1,
    borehole_only_bodies: 0,
    edges_derived: false,
    created_formation_ids: [],
    ties_proposed: 0,
    sections_spanned: 0,
    ties_reanchored: 0,
    ties_lost: 0,
    ties_needing_review: {},
  } as never)
})

describe('re-subdivide and the undo stack', () => {
  it('SU1 — a successful subdivide clears the stack whose ids it invalidated', async () => {
    const clearUndo = vi.fn()
    const { result } = renderHook(() => useGeologicalModel(makeArgs(clearUndo)))
    await act(async () => {
      await new Promise(r => setTimeout(r, 20))
    })
    await act(async () => {
      await result.current.handleSubdivideAllBodies()
    })
    expect(apiMock.geology.subdivideCpts).toHaveBeenCalled()
    expect(clearUndo).toHaveBeenCalled()
  })

  it('SU2 — a FAILED subdivide leaves the stack alone', async () => {
    // Nothing was rebuilt, so every id the stack holds is still real — clearing
    // here would throw away valid history for an error toast.
    vi.mocked(apiMock.geology.subdivideCpts).mockRejectedValue(new Error('boom'))
    const clearUndo = vi.fn()
    const { result } = renderHook(() => useGeologicalModel(makeArgs(clearUndo)))
    await act(async () => {
      await new Promise(r => setTimeout(r, 20))
    })
    await act(async () => {
      await result.current.handleSubdivideAllBodies()
    })
    expect(apiMock.geology.subdivideCpts).toHaveBeenCalled()
    expect(clearUndo).not.toHaveBeenCalled()
  })

  it('SU3 — a SECTION-SCOPED subdivide also clears the whole stack (deliberate)', async () => {
    // Audit P2-6, resolved as documented behaviour: UndoCommand carries no
    // section identity, so the entries a scoped rebuild invalidated cannot be
    // told apart from the still-valid ones. Clearing everything is the
    // conservative choice — one stale revert firing would trip the F23
    // discard-everything path anyway, after a confusing 422. If undo entries
    // ever grow a section tag, this pin is the one to renegotiate.
    const clearUndo = vi.fn()
    const { result } = renderHook(() => useGeologicalModel(makeArgs(clearUndo)))
    await act(async () => {
      await new Promise(r => setTimeout(r, 20))
    })
    await act(async () => {
      await result.current.handleSubdivideAllBodies({ sectionId: 'section-1' })
    })
    expect(apiMock.geology.subdivideCpts).toHaveBeenCalled()
    expect(clearUndo).toHaveBeenCalled()
  })
})

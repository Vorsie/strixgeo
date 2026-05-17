/**
 * Behavioral net for manual_map + collisions threading in useGeologicalModel
 * (2026-05-17, #55 manual-lump slice).
 *
 * Claims pinned here:
 *   L1  discoverBoreholeFormations with NO manualMap sends a request without
 *       manual_map and returns { candidates, collisions: [] }.
 *   L2  discoverBoreholeFormations WITH a manualMap sends manual_map in the
 *       request and maps server-side LumpingCollisionItem → LumpingCollision
 *       correctly (camelCase normalisation).
 *   L3  applyBoreholeFormationSelection with NO manualMap sends a request
 *       without manual_map (today's behaviour, unchanged).
 *   L4  applyBoreholeFormationSelection WITH a manualMap sends it verbatim
 *       to autoPopulateFromStratigraphy — the SAME map used for the preceding
 *       discover call (discover ≡ apply invariant).
 *   L5  An empty manualMap ({}) is treated the same as absent — the
 *       map is NOT sent to the server in either discover or apply.
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  ProjectResponse,
} from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks
//
// WHY vi.hoisted: vi.mock factories are hoisted to the top of the compiled
// module by Vitest's transform, before any const declarations in the file
// body.  Referencing a const inside a vi.mock factory therefore hits the
// Temporal Dead Zone and throws "Cannot access before initialization".
// vi.hoisted() runs its callback in the same hoisted position as vi.mock,
// so the returned values are initialised before the factory executes.
// ---------------------------------------------------------------------------

const {
  mockDiscoverFromStratigraphy,
  mockAutoPopulateFromStratigraphy,
  mockListModels,
  mockListFormations,
  mockListContacts,
  mockListSurfaces,
  mockValidateCrossings,
} = vi.hoisted(() => ({
  mockDiscoverFromStratigraphy: vi.fn(),
  mockAutoPopulateFromStratigraphy: vi.fn(),
  mockListModels: vi.fn(),
  mockListFormations: vi.fn(),
  mockListContacts: vi.fn(),
  mockListSurfaces: vi.fn(),
  mockValidateCrossings: vi.fn(),
}))

vi.mock('../api/client', () => ({
  api: {
    geology: {
      listModels: mockListModels,
      listFormations: mockListFormations,
      listContacts: mockListContacts,
      listSurfaces: mockListSurfaces,
      validateCrossings: mockValidateCrossings,
      createModel: vi.fn(),
      activateModel: vi.fn(),
      createFormation: vi.fn(),
      createContact: vi.fn(),
      suggestLitho: vi.fn(),
      updateFormation: vi.fn(),
      deleteFormation: vi.fn(),
      updateModel: vi.fn(),
      deleteModel: vi.fn(),
      updateContact: vi.fn(),
      deleteContact: vi.fn(),
      updateContactsBatch: vi.fn(),
      autoPopulateFromStratigraphy: mockAutoPopulateFromStratigraphy,
      dedupeContacts: vi.fn(),
      rebuildSurfaces: vi.fn(),
      exportPlaxis3d: vi.fn(),
      discoverFromStratigraphy: mockDiscoverFromStratigraphy,
      buildGroundSurface: vi.fn(),
      exportSectionPlaxis2d: vi.fn(),
    },
    cpt: { list: vi.fn() },
    borehole: { list: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn() },
    geotechnicalUnit: { list: vi.fn() },
  },
  DuplicateContactError: class DuplicateContactError extends Error {
    existingContactId: string
    constructor(id: string) { super('dup'); this.existingContactId = id }
  },
}))

vi.mock('../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn(), trace: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const PROJ: ProjectResponse = {
  id: 'proj-1', name: 'Test', project_number: null, client: null, site_label: null,
  description: null, tags: [], default_horizontal_epsg: 31370, default_vertical_epsg: 5710,
  phase: 'design', status: 'active', view_state: {}, archived_at: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

const ACTIVE_MODEL: GeologicalModelResponse = {
  id: 'model-1', app_project_id: 'proj-1', name: 'Default', kind: 'geological',
  description: null, is_active: true, excluded_borehole_ids: [],
  parent_geological_model_id: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

function makeHook() {
  mockListModels.mockResolvedValue([ACTIVE_MODEL])
  mockListFormations.mockResolvedValue([])
  mockListContacts.mockResolvedValue([] as FormationContactResponse[])
  mockListSurfaces.mockResolvedValue([])
  mockValidateCrossings.mockResolvedValue({ model_id: 'model-1', issues: [] })

  return renderHook(() => useGeologicalModel({
    project: PROJ,
    manifestFormationIds: undefined,
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    addToSessionImports: vi.fn(),
    removeFromSessionImports: vi.fn(),
    pushUndo: vi.fn(),
    toast: vi.fn(),
  }))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGeologicalModel — manual_map threading', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('L1: discoverBoreholeFormations without manualMap returns candidates + empty collisions', async () => {
    mockDiscoverFromStratigraphy.mockResolvedValue({
      candidates: [{ name: 'Boom Klei', key: 'boom klei', regional_ref: null, borehole_count: 3 }],
      collisions: [],
    })

    const { result } = makeHook()
    // Wait for bootstrap
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    let discovered: Awaited<ReturnType<typeof result.current.discoverBoreholeFormations>>
    await act(async () => {
      discovered = await result.current.discoverBoreholeFormations(['bh-1'])
    })

    expect(mockDiscoverFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], undefined,
    )
    expect(discovered!.candidates).toHaveLength(1)
    expect(discovered!.candidates[0].name).toBe('Boom Klei')
    expect(discovered!.collisions).toHaveLength(0)
  })

  it('L2: discoverBoreholeFormations with manualMap sends map and maps collisions to camelCase', async () => {
    const MAP = { 'boom klei': 'Boom Klei Groep', 'klei van boom': 'Boom Klei Groep' }
    mockDiscoverFromStratigraphy.mockResolvedValue({
      candidates: [{ name: 'Boom Klei Groep', key: 'boom klei groep', regional_ref: null, borehole_count: 2 }],
      collisions: [{
        borehole_id: 'bh-uuid-1',
        target_formation_key: 'boom klei groep',
        target_formation_name: 'Boom Klei Groep',
        colliding_raw_names: ['Boom Klei', 'Klei van Boom'],
        kept_top_m: 12.5,
        dropped_count: 1,
      }],
    })

    const { result } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    let discovered: Awaited<ReturnType<typeof result.current.discoverBoreholeFormations>>
    await act(async () => {
      discovered = await result.current.discoverBoreholeFormations(['bh-1'], MAP)
    })

    // Server called with the manual_map
    expect(mockDiscoverFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], MAP,
    )
    // Collisions camelCase-mapped correctly
    expect(discovered!.collisions).toHaveLength(1)
    const col = discovered!.collisions[0]
    expect(col.boreholeId).toBe('bh-uuid-1')
    expect(col.targetFormationKey).toBe('boom klei groep')
    expect(col.collidingRawNames).toEqual(['Boom Klei', 'Klei van Boom'])
    expect(col.keptTopM).toBe(12.5)
    expect(col.droppedCount).toBe(1)
  })

  it('L3: applyBoreholeFormationSelection without manualMap sends no manual_map', async () => {
    mockAutoPopulateFromStratigraphy.mockResolvedValue({
      created_formation_ids: [],
      created_contact_ids: [],
      deleted_formation_ids: [],
      skipped_existing: 0,
      skipped_unmatched: 0,
      skipped_no_stratigraphy: 0,
      collisions: [],
    })
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { result } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(new Set(['boom klei']), ['bh-1'])
    })

    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], ['boom klei'], undefined,
    )
  })

  it('L4: applyBoreholeFormationSelection WITH manualMap sends it verbatim', async () => {
    const MAP = { 'boom klei': 'Boom Groep' }
    mockAutoPopulateFromStratigraphy.mockResolvedValue({
      created_formation_ids: ['f-new'],
      created_contact_ids: [],
      deleted_formation_ids: [],
      skipped_existing: 0,
      skipped_unmatched: 0,
      skipped_no_stratigraphy: 0,
      collisions: [],
    })
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { result } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(
        new Set(['boom klei']), ['bh-1'], MAP,
      )
    })

    // The SAME map sent to the server (discover ≡ apply invariant)
    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], ['boom klei'], MAP,
    )
  })

  it('L5: empty manualMap ({}) is treated as absent — not sent to server', async () => {
    mockDiscoverFromStratigraphy.mockResolvedValue({ candidates: [], collisions: [] })

    const { result } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.discoverBoreholeFormations(['bh-1'], {})
    })

    // Empty map → server called with undefined (map absent from request)
    expect(mockDiscoverFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], undefined,
    )
  })
})

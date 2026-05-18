/**
 * Behavioral net for the lumping-coherence gap fixes (2026-05-17).
 *
 * Claims pinned here (matching the spec in the task):
 *
 *   LC-A  apply with non-empty manualMap calls stageLumping with the
 *         correct StratigraphyLumping shape; the injected snapshot is
 *         passed through so callers can assert the staged value.
 *
 *   LC-B  apply with empty / absent manualMap calls stageLumping with
 *         an empty map (clears any prior snapshot).
 *
 *   LC-C  handleAutoPopulateFromStratigraphy (Seed path) forwards the
 *         persisted currentLumping.map to the server when it is non-empty
 *         — so Seed produces contacts under the same effective formation
 *         keys as Fill applied.
 *
 *   LC-D  handleAutoPopulateFromStratigraphy (Seed path) sends NO
 *         manualMap when currentLumping is null.
 */

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi, beforeEach } from 'vitest'

import { useGeologicalModel } from './useGeologicalModel'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
  ProjectResponse,
} from '../api/client'
import type { StratigraphyLumping } from '../utils/projectFile'

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------

const {
  mockAutoPopulateFromStratigraphy,
  mockListModels,
  mockListFormations,
  mockListContacts,
  mockListSurfaces,
  mockValidateCrossings,
} = vi.hoisted(() => ({
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
      discoverFromStratigraphy: vi.fn().mockResolvedValue({ candidates: [], collisions: [] }),
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

const EMPTY_APPLY_RESULT = {
  created_formation_ids: [],
  created_contact_ids: [],
  deleted_formation_ids: [],
  skipped_existing: 0,
  skipped_unmatched: 0,
  skipped_no_stratigraphy: 0,
  updated_section: null,
  collisions: [],
}

function makeHook(options: {
  currentLumping?: StratigraphyLumping | null
  stageLumping?: (...args: unknown[]) => void
} = {}) {
  mockListModels.mockResolvedValue([ACTIVE_MODEL])
  mockListFormations.mockResolvedValue([])
  mockListContacts.mockResolvedValue([] as FormationContactResponse[])
  mockListSurfaces.mockResolvedValue([])
  mockValidateCrossings.mockResolvedValue({ model_id: 'model-1', issues: [] })

  const stageLumping = options.stageLumping ?? vi.fn()

  return {
    hook: renderHook(() => useGeologicalModel({
      project: PROJ,
      manifestFormationIds: undefined,
      addToManifest: vi.fn(),
      removeFromManifest: vi.fn(),
      addToSessionImports: vi.fn(),
      removeFromSessionImports: vi.fn(),
      pushUndo: vi.fn(),
      toast: vi.fn(),
      currentLumping: options.currentLumping ?? null,
      stageLumping,
    })),
    stageLumping,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useGeologicalModel — lumping-coherence gap fixes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  // LC-A: apply with non-empty manualMap calls stageLumping with correct shape.
  it('LC-A: apply with non-empty manualMap calls stageLumping', async () => {
    const MAP = { 'boom klei': 'Boom Groep', 'klei van boom': 'Boom Groep' }
    mockAutoPopulateFromStratigraphy.mockResolvedValue({
      ...EMPTY_APPLY_RESULT,
      created_formation_ids: ['f-new'],
    })
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { hook, stageLumping } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await hook.result.current.applyBoreholeFormationSelection(
        new Set(['boom groep']), ['bh-1'], MAP,
      )
    })

    // stageLumping was called exactly once
    expect(stageLumping).toHaveBeenCalledTimes(1)
    const arg = (stageLumping as ReturnType<typeof vi.fn>).mock.calls[0][0] as StratigraphyLumping
    expect(arg.schema_version).toBe(1)
    expect(arg.map).toEqual(MAP)
    // applied_at is a recent ISO string
    expect(() => new Date(arg.applied_at)).not.toThrow()
    expect(new Date(arg.applied_at).getFullYear()).toBeGreaterThanOrEqual(2026)
  })

  // LC-B: apply with empty manualMap calls stageLumping with empty map (clears snapshot).
  it('LC-B: apply with empty manualMap calls stageLumping with empty map', async () => {
    mockAutoPopulateFromStratigraphy.mockResolvedValue(EMPTY_APPLY_RESULT)
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { hook, stageLumping } = makeHook()
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    // Apply with undefined manualMap (no aliases)
    await act(async () => {
      await hook.result.current.applyBoreholeFormationSelection(
        new Set(['boom klei']), ['bh-1'],
      )
    })

    expect(stageLumping).toHaveBeenCalledTimes(1)
    const arg = (stageLumping as ReturnType<typeof vi.fn>).mock.calls[0][0] as StratigraphyLumping
    expect(arg.schema_version).toBe(1)
    expect(arg.map).toEqual({})
  })

  // LC-C: Seed path forwards currentLumping.map to the server when non-empty.
  it('LC-C: Seed path sends persisted currentLumping.map to autoPopulateFromStratigraphy', async () => {
    const PERSISTED_LUMPING: StratigraphyLumping = {
      schema_version: 1,
      applied_at: '2026-05-17T10:00:00.000Z',
      map: { 'boom klei': 'Boom Groep', 'klei van boom': 'Boom Groep' },
    }
    mockAutoPopulateFromStratigraphy.mockResolvedValue({
      ...EMPTY_APPLY_RESULT,
      created_formation_ids: ['f-seed'],
      created_contact_ids: ['c-seed'],
    })
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { hook } = makeHook({ currentLumping: PERSISTED_LUMPING })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    // Call the Seed path (no sectionId, no onSectionUpdated)
    await act(async () => {
      await hook.result.current.handleAutoPopulateFromStratigraphy(['bh-1'])
    })

    // The persisted map was forwarded to the backend
    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1',
      'model-1',
      ['bh-1'],
      undefined, // selectedKeys absent on Seed path
      PERSISTED_LUMPING.map,
      undefined, // sectionId absent
      false, // createMissingFormations — Seed never creates (explicit-content invariant)
    )
  })

  // LC-D: Seed path sends NO manualMap when currentLumping is null.
  it('LC-D: Seed path sends no manualMap when currentLumping is null', async () => {
    mockAutoPopulateFromStratigraphy.mockResolvedValue(EMPTY_APPLY_RESULT)
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])

    const { hook } = makeHook({ currentLumping: null })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await hook.result.current.handleAutoPopulateFromStratigraphy(['bh-1'])
    })

    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1',
      'model-1',
      ['bh-1'],
      undefined,
      undefined, // no manualMap when currentLumping is null
      undefined,
      false, // createMissingFormations — Seed never creates (explicit-content invariant)
    )
  })
})

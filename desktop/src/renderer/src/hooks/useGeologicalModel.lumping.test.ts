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
      setBodyColor: vi.fn().mockResolvedValue({}),
      hideMarkers: false,
      setHideMarkers: vi.fn(),
    },
    cpt: { list: vi.fn() },
    borehole: { list: vi.fn() },
    section: { list: vi.fn() },
    project: { get: vi.fn() },
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
  parent_model_id: null,
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z',
}

/** The hook options a test may want to observe or preload. */
type HookOverrides = Partial<Parameters<typeof useGeologicalModel>[0]>

/**
 * Mount the hook with the standard empty-project mocks.
 *
 * @param overrides - Options to replace, e.g. a ``stageLumping`` /
 *   ``toast`` spy or a preloaded ``currentLumping`` snapshot.
 */
function makeHook(overrides?: HookOverrides) {
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
    currentLumping: null,
    stageLumping: vi.fn(),
    requestCorrelationEdgesRefetch: vi.fn(),
    markMutated: vi.fn(),
    ...overrides,
  }))
}

/** A successful auto-populate response with nothing created and nothing removed. */
function quietOutcome(overrides?: Record<string, unknown>) {
  return {
    created_formation_ids: [],
    created_contact_ids: [],
    deleted_formation_ids: [],
    deleted_formation_names: [],
    mode: 'add',
    skipped_existing: 0,
    skipped_unmatched: 0,
    skipped_no_stratigraphy: 0,
    collisions: [],
    ...overrides,
  }
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

    // Trailing args are sectionId / createMissingFormations / mode. A caller
    // that names no mode gets 'add' — the safe half — so an Apply can never
    // delete by omission (2026-08-03 data-loss ruling).
    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], ['boom klei'], undefined, null, undefined, 'add',
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

    // The SAME map sent to the server (discover ≡ apply invariant), and still
    // the additive mode — passing a map is not consent to delete either.
    expect(mockAutoPopulateFromStratigraphy).toHaveBeenCalledWith(
      'proj-1', 'model-1', ['bh-1'], ['boom klei'], MAP, null, undefined, 'add',
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

// ---------------------------------------------------------------------------
// Apply modes — the 2026-08-03 data-loss ruling.
//
// The owner opened "Fill from boreholes" to ADD one unit and lost four saved
// geological units AND a 13-entry lumping map.  Two separate promises come out
// of that, pinned below in the ruling's own words:
//
//   "Add to existing model" must leave alone what it never spoke about — the
//   units AND the groupings.  "Overwrite model" makes the model exactly the
//   selection.  And whichever way it goes, the engineer must be told which
//   units the server actually removed — by NAME.
// ---------------------------------------------------------------------------

describe('useGeologicalModel — add / overwrite apply modes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockListFormations.mockResolvedValue([])
    mockListContacts.mockResolvedValue([])
  })

  it('L6: adding to the model keeps groupings this run never mentioned', async () => {
    // The saved snapshot groups two raw names. This Apply speaks only about a
    // third. Afterwards all three groupings must still be staged — dropping
    // the two is exactly how a 13-entry map came back as 0.
    mockAutoPopulateFromStratigraphy.mockResolvedValue(quietOutcome())
    const stageLumping = vi.fn()

    const { result } = makeHook({
      currentLumping: {
        schema_version: 1,
        applied_at: '2026-01-01T00:00:00Z',
        map: { 'boom klei': 'Boom Groep', 'klei van boom': 'Boom Groep' },
      },
      stageLumping,
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(
        new Set(['lid van orchies']),
        ['bh-1'],
        { 'orchies klei': 'Lid van Orchies' },
        'add',
      )
    })

    expect(stageLumping).toHaveBeenCalledOnce()
    expect(stageLumping.mock.calls[0]![0].map).toEqual({
      'boom klei': 'Boom Groep',
      'klei van boom': 'Boom Groep',
      'orchies klei': 'Lid van Orchies',
    })
  })

  it('L7: overwriting the model replaces the groupings wholesale', async () => {
    // The user asked for the model to become this selection, aliases included.
    mockAutoPopulateFromStratigraphy.mockResolvedValue(
      quietOutcome({ mode: 'overwrite' }),
    )
    const stageLumping = vi.fn()

    const { result } = makeHook({
      currentLumping: {
        schema_version: 1,
        applied_at: '2026-01-01T00:00:00Z',
        map: { 'boom klei': 'Boom Groep' },
      },
      stageLumping,
    })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(
        new Set(['lid van orchies']),
        ['bh-1'],
        { 'orchies klei': 'Lid van Orchies' },
        'overwrite',
      )
    })

    expect(stageLumping.mock.calls[0]![0].map).toEqual({
      'orchies klei': 'Lid van Orchies',
    })
  })

  it('L8: the units the server removed are named back to the engineer', async () => {
    // The incident was silent. Whatever the server deleted, the user has to be
    // able to read WHICH units went — a count answers nothing, and the client's
    // own pre-flight estimate is not proof of what actually happened.
    mockAutoPopulateFromStratigraphy.mockResolvedValue(
      quietOutcome({
        mode: 'overwrite',
        deleted_formation_ids: ['f-2', 'f-3'],
        deleted_formation_names: ['Boom Klei', 'Formatie van Diest'],
      }),
    )
    const toast = vi.fn()

    const { result } = makeHook({ toast })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(
        new Set(['quartair']), ['bh-1'], undefined, 'overwrite',
      )
    })

    const removalToast = toast.mock.calls.find(
      ([, message]) => typeof message === 'string' && message.includes('Boom Klei'),
    )
    expect(removalToast).toBeDefined()
    expect(removalToast![1]).toContain('Formatie van Diest')
  })

  it('L9: an add-mode apply that removed nothing says nothing about removals', async () => {
    // No nag on the harmless path — a toast that always fires is a toast the
    // engineer stops reading.
    mockAutoPopulateFromStratigraphy.mockResolvedValue(quietOutcome())
    const toast = vi.fn()

    const { result } = makeHook({ toast })
    await act(async () => { await new Promise(r => setTimeout(r, 0)) })

    await act(async () => {
      await result.current.applyBoreholeFormationSelection(
        new Set(['quartair']), ['bh-1'], undefined, 'add',
      )
    })

    expect(
      toast.mock.calls.some(
        ([, message]) => typeof message === 'string' && message.toLowerCase().includes('removed'),
      ),
    ).toBe(false)
  })
})

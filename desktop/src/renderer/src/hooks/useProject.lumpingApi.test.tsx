import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from './useProject'
import type { StratigraphyLumping } from '../utils/projectFile'

// The lumping map's database home (docs/design/autosave-recovery.md §3).
//
// Behaviour under test, in the design's own words:
//   * Apply writes the STAGED slot immediately, under a monotonic revision.
//   * A failed write never unwinds the user's decision — the recovery file
//     then carries the higher revision, which is the "file wins" case.
//   * File → Save PROMOTES staged onto saved (bookkeeping, after the file).
//   * On open the database outranks the file whenever it carries a
//     revision, so a project that crashed mid-edit reopens DIRTY with the
//     map the user applied — that re-seeded dirty state IS the feature.
//   * Discard means discard: the staged slot must stop carrying the map
//     the user threw away, or it resurrects on the next open.
//
// The two boundary surfaces are mocked: ``window.electron.*`` (Electron
// IPC) and ``api.project.*`` (the typed fetch wrappers).

const PROJECT_ID = '01k-LUMP'

const baseProject = {
  id: PROJECT_ID,
  name: 'Lumping site',
  project_number: null,
  client: null,
  site_label: null,
  description: null,
  tags: [],
  default_horizontal_epsg: null,
  default_vertical_epsg: null,
  phase: null,
  status: 'active',
  archived_at: null,
  created_at: '2026-08-02T10:00:00Z',
  updated_at: '2026-08-02T10:00:00Z',
  view_state: {},
}

vi.mock('../api/client', () => ({
  api: {
    project: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      duplicate: vi.fn(),
      restore: vi.fn(),
      bundle: vi.fn(),
      patchViewState: vi.fn(),
      stageLumping: vi.fn(),
      promoteLumping: vi.fn(),
    },
  },
}))

/** A lumping snapshot as the Fill-from-boreholes Apply produces it. */
function lumping(map: Record<string, string>): StratigraphyLumping {
  return { schema_version: 1, applied_at: '2026-08-02T11:00:00Z', map }
}

/** Serialised .gmproj carrying (optionally) a lumping snapshot. */
function projectFileJson(fileLumping: StratigraphyLumping | null): string {
  return JSON.stringify({
    format_version: 3,
    project: { ...baseProject },
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
    stratigraphy_lumping: fileLumping,
  })
}

/** Empty bundle so the save path never needs a real backend. */
function emptyBundle(): Record<string, unknown> {
  return {
    format_version: 3,
    project: { ...baseProject },
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
  }
}

type Mock = ReturnType<typeof vi.fn>

beforeEach(async () => {
  const { api } = await import('../api/client')
  for (const fn of Object.values(api.project)) (fn as Mock).mockReset()
  ;(api.project.bundle as Mock).mockResolvedValue(emptyBundle())
  ;(api.project.stageLumping as Mock).mockResolvedValue({ ...baseProject })
  ;(api.project.promoteLumping as Mock).mockResolvedValue({ ...baseProject })
  ;(api.project.restore as Mock).mockResolvedValue({ ...baseProject })
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    showProjectOpenDialog: vi.fn(),
    showProjectSaveDialog: vi.fn(),
    projectFileExists: vi.fn().mockResolvedValue(true),
    readProjectFile: vi.fn(),
    writeProjectFile: vi.fn().mockResolvedValue(undefined),
    addRecentProject: vi.fn().mockResolvedValue([]),
    getRecentProjects: vi.fn().mockResolvedValue([]),
  }
})

/**
 * Open a project whose DB row carries the given lumping columns.
 *
 * @param columns - The three lumping columns as the project read returns them.
 * @param fileLumping - What the .gmproj on disk carries.
 */
async function openWith(
  columns: {
    stratigraphy_lumping_staged?: Record<string, unknown> | null
    stratigraphy_lumping_saved?: Record<string, unknown> | null
    stratigraphy_lumping_revision?: number | null
  },
  fileLumping: StratigraphyLumping | null = null,
): Promise<ReturnType<typeof renderHook<ReturnType<typeof useProject>, unknown>>> {
  const { api } = await import('../api/client')
  ;(window.electron.readProjectFile as Mock).mockResolvedValue({
    ok: true,
    json: projectFileJson(fileLumping),
  })
  ;(api.project.get as Mock).mockResolvedValue({ ...baseProject, ...columns })
  const rendered = renderHook(() => useProject())
  await act(async () => {
    await rendered.result.current.openProjectFile('C:/path/site.gmproj')
  })
  return rendered
}

describe('useProject — lumping map in its database home', () => {
  // LA-1: Apply writes the staged slot immediately, and each Apply claims
  // the next revision so the server's monotonic guard never rejects it.
  it('LA-1: Apply stages to the database under an incremented revision', async () => {
    const { api } = await import('../api/client')
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    const first = lumping({ 'zand fijn': 'ZAND' })
    await act(async () => {
      await result.current.stageLumping(first)
    })
    expect(api.project.stageLumping).toHaveBeenCalledWith(PROJECT_ID, first, 6)

    const second = lumping({ 'zand fijn': 'ZAND', 'klei stijf': 'KLEI' })
    await act(async () => {
      await result.current.stageLumping(second)
    })
    expect(api.project.stageLumping).toHaveBeenLastCalledWith(PROJECT_ID, second, 7)
    expect(result.current.lumpingRevision).toBe(7)
  })

  // LA-1b: a project that has never been staged starts the counter at 1.
  it('LA-1b: the first Apply on a never-staged project claims revision 1', async () => {
    const { api } = await import('../api/client')
    const { result } = await openWith({ stratigraphy_lumping_revision: null })

    const map = lumping({ 'zand fijn': 'ZAND' })
    await act(async () => {
      await result.current.stageLumping(map)
    })
    expect(api.project.stageLumping).toHaveBeenCalledWith(PROJECT_ID, map, 1)
  })

  // LA-2: the user's decision stands even when the write never lands —
  // the recovery file then carries the higher revision ("file wins").
  it('LA-2: a failed staged write keeps the applied map in memory', async () => {
    const { api } = await import('../api/client')
    ;(api.project.stageLumping as Mock).mockRejectedValue(new Error('backend down'))
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    const map = lumping({ 'zand fijn': 'ZAND' })
    await act(async () => {
      await result.current.stageLumping(map)
    })

    expect(result.current.currentLumping).toEqual(map)
    expect(result.current.dirty).toBe(true)
  })

  // LA-2b: a 409 means this session fell behind another writer. Adopt the
  // server's stored counter so the NEXT Apply clears the guard instead of
  // colliding forever.
  it('LA-2b: a stale-stage 409 adopts the stored revision for the next Apply', async () => {
    const { api } = await import('../api/client')
    ;(api.project.stageLumping as Mock).mockRejectedValueOnce(
      new Error('Stale lumping stage: revision 6 < stored 42'),
    )
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    await act(async () => {
      await result.current.stageLumping(lumping({ a: 'A' }))
    })
    const retry = lumping({ a: 'A', b: 'B' })
    await act(async () => {
      await result.current.stageLumping(retry)
    })

    expect(api.project.stageLumping).toHaveBeenLastCalledWith(PROJECT_ID, retry, 43)
  })

  // LA-3: File → Save promotes staged onto saved, and only after the file
  // was written — a save that never reached disk is not a save.
  it('LA-3: save promotes the staged slot after the file write', async () => {
    const { api } = await import('../api/client')
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    await act(async () => {
      await result.current.saveProject()
    })

    expect(api.project.promoteLumping).toHaveBeenCalledWith(PROJECT_ID)
    const writeOrder = (window.electron.writeProjectFile as Mock).mock.invocationCallOrder[0]
    const promoteOrder = (api.project.promoteLumping as Mock).mock.invocationCallOrder[0]
    expect(promoteOrder).toBeGreaterThan(writeOrder)
  })

  // LA-3b: a promote that fails is bookkeeping lost, not a failed save —
  // the staged slot has been durable since Apply.
  it('LA-3b: a failing promote does not fail the save', async () => {
    const { api } = await import('../api/client')
    ;(api.project.promoteLumping as Mock).mockRejectedValue(new Error('backend down'))
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.saveProject()
    })
    expect(saved).toBe(true)
  })

  // LA-4: the staged slot survived the crash, so the project reopens with
  // the applied map AND dirty — the re-seeded dirty state is the feature.
  it('LA-4: opening a project with a revision seeds from the database and opens dirty', async () => {
    const { result } = await openWith(
      {
        stratigraphy_lumping_staged: {
          schema_version: 1,
          applied_at: '2026-08-02T11:00:00Z',
          map: { 'zand fijn': 'ZAND' },
        },
        stratigraphy_lumping_saved: null,
        stratigraphy_lumping_revision: 9,
      },
      // The file on disk pre-dates the crash and knows nothing of the map.
      null,
    )

    expect(result.current.currentLumping?.map).toEqual({ 'zand fijn': 'ZAND' })
    expect(result.current.savedLumping).toBeNull()
    expect(result.current.dirty).toBe(true)
    expect(result.current.lumpingRevision).toBe(9)
  })

  // LA-5: no revision means no revision-aware client ever staged this
  // project, so the file stays authoritative and the project opens clean.
  it('LA-5: opening a project without a revision seeds both slots from the file', async () => {
    const fileMap = lumping({ 'klei stijf': 'KLEI' })
    const { result } = await openWith({ stratigraphy_lumping_revision: null }, fileMap)

    expect(result.current.currentLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    expect(result.current.savedLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    expect(result.current.dirty).toBe(false)
    expect(result.current.lumpingRevision).toBeNull()
  })

  // LA-5b: the read path on the server is pass-through, so a malformed blob
  // is possible; it must fall back to the file rather than poison the open.
  it('LA-5b: a malformed staged blob falls back to the file', async () => {
    const fileMap = lumping({ 'klei stijf': 'KLEI' })
    const { result } = await openWith(
      {
        stratigraphy_lumping_staged: { schema_version: 99, nonsense: true },
        stratigraphy_lumping_revision: 4,
      },
      fileMap,
    )

    expect(result.current.currentLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    expect(result.current.savedLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    // The counter is a plain integer and stays valid even when the blob
    // beside it is not — dropping it would make the next Apply collide.
    expect(result.current.lumpingRevision).toBe(4)
  })

  // LA-6: Discard means discard — in BOTH database slots.
  //
  // The fixture is the shape every project that pre-dates the lumping columns
  // has: the map lives in the .strix, and staged / saved / revision are all
  // NULL. It opens seeded from the file, the user applies a new grouping, and
  // then discards it. Re-staging the saved snapshot alone would leave
  // staged = the file's map while saved stays NULL — and ``staged !== saved``
  // is exactly the signal the open path reads as dirty, so the project would
  // reopen dirty forever with nothing the user could do about it. The discard
  // has to promote as well.
  it('LA-6: discard re-stages AND promotes the saved snapshot, so both database slots agree', async () => {
    const { api } = await import('../api/client')
    const fileMap = lumping({ 'klei stijf': 'KLEI' })
    const { result } = await openWith({}, fileMap)
    // Precondition of the shape under test: nothing has ever been staged.
    expect(result.current.lumpingRevision).toBeNull()

    // The user applies a new grouping, then throws it away.
    await act(async () => {
      await result.current.stageLumping(lumping({ 'zand fijn': 'ZAND' }))
    })
    await act(async () => {
      await result.current.revertToLastSaved()
    })

    expect(api.project.stageLumping).toHaveBeenLastCalledWith(
      PROJECT_ID,
      expect.objectContaining({ map: { 'klei stijf': 'KLEI' } }),
      2,
    )
    expect(api.project.promoteLumping).toHaveBeenCalledWith(PROJECT_ID)
    // Order matters: promoting BEFORE the re-stage would copy the discarded
    // map into the saved slot — the opposite of what discard means.
    const restageOrder = (api.project.stageLumping as Mock).mock.invocationCallOrder[1]
    const promoteOrder = (api.project.promoteLumping as Mock).mock.invocationCallOrder[0]
    expect(promoteOrder).toBeGreaterThan(restageOrder)
    expect(result.current.currentLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    expect(result.current.dirty).toBe(false)
  })

  // LA-6c: the recovery prompt's Delete backup runs the SAME discard tail
  // directly (owner ruling 2026-08-03: "fully delete, no traces of backup
  // left"). Without it, the map the prompt itemised survives through its
  // staged database home and the project reopens dirty with discarded work.
  it('LA-6c: resetStagedLumpingToSaved alone re-stages, promotes and un-dirties', async () => {
    const { api } = await import('../api/client')
    const fileMap = lumping({ 'klei stijf': 'KLEI' })
    const { result } = await openWith({}, fileMap)

    await act(async () => {
      await result.current.stageLumping(lumping({ 'zand fijn': 'ZAND' }))
    })
    expect(result.current.dirty).toBe(true)
    await act(async () => {
      await result.current.resetStagedLumpingToSaved()
    })

    expect(api.project.stageLumping).toHaveBeenLastCalledWith(
      PROJECT_ID,
      expect.objectContaining({ map: { 'klei stijf': 'KLEI' } }),
      2,
    )
    expect(api.project.promoteLumping).toHaveBeenCalledWith(PROJECT_ID)
    expect(result.current.currentLumping?.map).toEqual({ 'klei stijf': 'KLEI' })
    expect(result.current.dirty).toBe(false)
  })

  // LA-6b: a re-stage that never lands must NOT be promoted — promoting then
  // copies the discarded map (still sitting in ``staged``) into ``saved``.
  it('LA-6b: a failed discard re-stage skips the promote', async () => {
    const { api } = await import('../api/client')
    const fileMap = lumping({ 'klei stijf': 'KLEI' })
    const { result } = await openWith({}, fileMap)

    await act(async () => {
      await result.current.stageLumping(lumping({ 'zand fijn': 'ZAND' }))
    })
    ;(api.project.stageLumping as Mock).mockRejectedValue(new Error('backend down'))
    await act(async () => {
      await result.current.revertToLastSaved()
    })

    expect(api.project.promoteLumping).not.toHaveBeenCalled()
  })

  // LA-7: the sequence bug the reviewer found. A backend blip during Apply
  // leaves the map in memory (by design — "file wins") but NOT in the
  // database. File → Save then writes the new map to the .strix, promotes,
  // and clears the recovery file: without a repair the promote copies the
  // database's STALE map into ``saved``, and the next open seeds the old map
  // while the .strix on disk holds the new one.
  it('LA-7: save re-stages the in-memory map before promoting it', async () => {
    const { api } = await import('../api/client')
    // Only the Apply fails; the repair during save gets through.
    ;(api.project.stageLumping as Mock).mockRejectedValueOnce(new Error('backend down'))
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    const applied = lumping({ 'zand fijn': 'ZAND' })
    await act(async () => {
      await result.current.stageLumping(applied)
    })
    await act(async () => {
      await result.current.saveProject()
    })

    // Two stages: the Apply that failed, and the repair that carries the SAME
    // map under the SAME revision (the backend accepts an equal revision, so
    // the repair is a no-op whenever the Apply landed).
    expect(api.project.stageLumping).toHaveBeenCalledTimes(2)
    expect(api.project.stageLumping).toHaveBeenLastCalledWith(PROJECT_ID, applied, 6)
    const repairOrder = (api.project.stageLumping as Mock).mock.invocationCallOrder[1]
    const promoteOrder = (api.project.promoteLumping as Mock).mock.invocationCallOrder[0]
    expect(promoteOrder).toBeGreaterThan(repairOrder)
  })

  // LA-7b: when the repair itself cannot land, promoting is the one thing
  // that must not happen — it would make the database's stale map permanent.
  // The save still succeeds: the file has the truth either way.
  it('LA-7b: a failed repair skips the promote without failing the save', async () => {
    const { api } = await import('../api/client')
    ;(api.project.stageLumping as Mock).mockRejectedValue(new Error('backend down'))
    const { result } = await openWith({ stratigraphy_lumping_revision: 5 })

    await act(async () => {
      await result.current.stageLumping(lumping({ 'zand fijn': 'ZAND' }))
    })
    let saved: boolean | undefined
    await act(async () => {
      saved = await result.current.saveProject()
    })

    expect(api.project.promoteLumping).not.toHaveBeenCalled()
    expect(saved).toBe(true)
  })
})

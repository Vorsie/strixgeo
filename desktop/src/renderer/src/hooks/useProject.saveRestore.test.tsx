import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from './useProject'
// The REAL error class the HTTP layer throws — imported from the defining
// module, which this file does NOT mock, so every rejection constructed
// below is the exact shape production produces.
import { ApiError } from '../api/clients/shared'

// Save / restore contract for the file-aware project hook.
//
// The rules under test, in the words they were written in:
//
//   * "Opening a .strix must always succeed and bring everything back,
//     even after a DB wipe" — so a MISSING project row (HTTP 404) sends
//     the open down the restore branch, and that restore carries the same
//     collections a revert carries. Nothing decides "the project is gone"
//     by matching an error string.
//   * A .strix written under a trimmed manifest must never contain a
//     litho layer (or contact) whose formation is absent from the same
//     file — the file has to be self-consistent on its own terms.
//   * "Don't Save" may only replace-restore the database from the file
//     that IS this project's latest save. A hand-copied backup, or the
//     file of a save whose write never landed, is not that file.
//   * A save whose file write failed is not a save, and must not report
//     unqualified success to its caller.

const PROJECT_ID = '01k-SR'

const baseProject = {
  id: PROJECT_ID,
  name: 'Save Restore Site',
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
  view_state: {} as Record<string, unknown>,
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

type Row = Record<string, unknown>

/** Every collection a v3 .strix carries, defaulted to empty. */
function fileShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_version: 3,
    project: { id: PROJECT_ID, name: 'Save Restore Site', status: 'active', tags: [] },
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
    litho_contact_correlation_edges: [],
    bodies: [],
    formation_absences: [],
    body_boundary_shapes: [],
    body_boundary_nodes: [],
    body_geometry_facts: [],
    stratigraphy_lumping: null,
    ...overrides,
  }
}

/** Every collection ``GET /projects/{id}/bundle`` returns. */
function bundleShape(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format_version: 3,
    project: baseProject,
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
    litho_contact_correlation_edges: [],
    bodies: [],
    formation_absences: [],
    body_boundary_shapes: [],
    body_boundary_nodes: [],
    body_geometry_facts: [],
    ...overrides,
  }
}

const asMock = (fn: unknown): ReturnType<typeof vi.fn> => fn as ReturnType<typeof vi.fn>

// The database row's ``view_state``, mutated by the view-state PATCH the way
// the server mutates it (shallow merge of top-level keys) and read back by
// GET and by the bundle. Without it, nothing the save writes through
// view_state could ever be observed on the row.
let dbViewState: Record<string, unknown> = {}
// The bytes on "disk": whatever ``writeProjectFile`` wrote last is what
// ``readProjectFile`` hands back. A FAILED write leaves the previous bytes —
// which is precisely the stale-file situation these tests are about.
let diskContent = ''
// Bundle collections the current test wants the server to return.
let bundleOverrides: Record<string, unknown> = {}

function dbProject(): Record<string, unknown> {
  return { ...baseProject, view_state: { ...dbViewState } }
}

beforeEach(async () => {
  const { api } = await import('../api/client')
  for (const fn of Object.values(api.project)) asMock(fn).mockReset()
  dbViewState = {}
  bundleOverrides = {}
  diskContent = JSON.stringify(fileShape())
  asMock(api.project.bundle).mockImplementation(async () =>
    bundleShape({ project: dbProject(), ...bundleOverrides }),
  )
  asMock(api.project.get).mockImplementation(async () => dbProject())
  asMock(api.project.patchViewState).mockImplementation(
    async (_id: string, patch: Record<string, unknown>) => {
      dbViewState = { ...dbViewState, ...patch }
      return dbProject()
    },
  )
  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    showProjectOpenDialog: vi.fn(),
    showProjectSaveDialog: vi.fn(),
    // Present by default: the missing-file branch is opted into per test.
    projectFileExists: vi.fn().mockResolvedValue(true),
    readProjectFile: vi.fn().mockImplementation(async () => ({ ok: true, json: diskContent })),
    writeProjectFile: vi.fn().mockImplementation(async (_path: string, content: string) => {
      diskContent = content
    }),
    addRecentProject: vi.fn().mockResolvedValue([]),
    getRecentProjects: vi.fn().mockResolvedValue([]),
  }
})

/** The last string handed to ``writeProjectFile``, parsed back. */
function lastWrittenFile(): Record<string, unknown> {
  const calls = asMock(window.electron.writeProjectFile).mock.calls
  const [, content] = calls[calls.length - 1] as [string, string]
  return JSON.parse(content)
}

describe('openProjectFile — the file is gone (moved or renamed)', () => {
  // Owner, 2026-08-17: "open from recent project should always open from the
  // strix file, if user moved it you get a toast, file not found, did you
  // change it's location". The file IS the anchor — when it is gone the open
  // must say so, not fall back to the database and pretend nothing happened,
  // and not blame corruption or the API (the old catch-all banner did both).
  it("returns 'file-missing' without touching the file or the API", async () => {
    const { api } = await import('../api/client')
    asMock(window.electron.projectFileExists).mockResolvedValue(false)

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/moved/away.strix')
    })

    expect(returned).toBe('file-missing')
    expect(window.electron.readProjectFile).not.toHaveBeenCalled()
    expect(api.project.get).not.toHaveBeenCalled()
    expect(result.current.project).toBeNull()
  })
})

describe('openProjectFile — the DB row is gone', () => {
  it('restores from the file when GET rejects with the 404 the API client actually produces', async () => {
    const { api } = await import('../api/client')
    diskContent = JSON.stringify(
      fileShape({
        project: { id: PROJECT_ID, name: 'Ghost', status: 'active', tags: [] },
        cpts: [{ id: 'cpt-1' }],
      }),
    )
    // A real 404 from FastAPI: the body carries ``detail: "Project not
    // found"``, so THAT is the error's message — the "→ 404" fallback text
    // the old gate matched can never appear on this route.
    asMock(api.project.get).mockRejectedValue(
      new ApiError('Project not found', 404, { detail: 'Project not found' }),
    )
    const restored = { ...baseProject, name: 'Ghost' }
    asMock(api.project.restore).mockResolvedValue(restored)

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/ghost.strix')
    })

    expect(api.project.restore).toHaveBeenCalledTimes(1)
    expect(returned).toEqual(restored)
    expect(result.current.project).toEqual(restored)
    expect(result.current.manifestCptIds.has('cpt-1')).toBe(true)
  })

  it('does NOT restore when the failure is any status other than 404', async () => {
    const { api } = await import('../api/client')
    asMock(api.project.get).mockRejectedValue(
      new ApiError('Internal Server Error', 500, { detail: 'Internal Server Error' }),
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/boom.strix')
    })

    expect(returned).toBeNull()
    expect(api.project.restore).not.toHaveBeenCalled()
  })

  it('sends the restore the same collections a revert sends — no collection may be dropped', async () => {
    const { api } = await import('../api/client')
    const ghost = fileShape({
      project: { id: PROJECT_ID, name: 'Ghost', status: 'active', tags: [] },
      bodies: [{ id: 'body-1' }],
      litho_contact_correlation_edges: [{ id: 'edge-1' }],
      formation_absences: [{ id: 'abs-1' }],
      body_boundary_shapes: [{ id: 'shape-1' }],
      body_boundary_nodes: [{ id: 'node-1' }],
      body_geometry_facts: [{ id: 'fact-1' }],
      body_separations: [{ id: 'sep-1' }],
      body_unions: [{ id: 'union-1' }],
    })
    diskContent = JSON.stringify(ghost)
    asMock(api.project.get).mockRejectedValue(new ApiError('Project not found', 404))
    asMock(api.project.restore).mockResolvedValue({ ...baseProject, name: 'Ghost' })

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/ghost.strix')
    })

    const [, payload] = asMock(api.project.restore).mock.calls[0] as [
      string,
      Record<string, unknown>,
    ]
    // Every interpretation collection the file carries has to arrive — a
    // body / correlation edge / boundary shape left out of this payload is
    // interpretation the engineer never gets back.
    expect(payload.bodies).toEqual(ghost.bodies)
    expect(payload.litho_contact_correlation_edges).toEqual(
      ghost.litho_contact_correlation_edges,
    )
    expect(payload.formation_absences).toEqual(ghost.formation_absences)
    expect(payload.body_boundary_shapes).toEqual(ghost.body_boundary_shapes)
    expect(payload.body_boundary_nodes).toEqual(ghost.body_boundary_nodes)
    // Owner ruling 2026-08-12: "every same litho that is connected should get
    // the same body id". The facts ARE that connectedness; dropped here, the
    // reopened project comes back with every merged body split again.
    expect(payload.body_geometry_facts).toEqual(ghost.body_geometry_facts)
    // Debt #278 R5: the "these two are NOT the same body" separations are the
    // same evidence class — dropped here, the reopened project re-merges every
    // body the engineer split. (Guards the ``restorePayloadFrom`` line.)
    expect(payload.body_separations).toEqual(ghost.body_separations)
    // Debt #278 (the Join verb): the "these two ARE the same body" unions are
    // the mirror evidence — dropped here, the reopened project re-splits every
    // body the engineer joined. (Guards the ``restorePayloadFrom`` line.)
    expect(payload.body_unions).toEqual(ghost.body_unions)
  })
})

describe('openProjectFile — a DB-lost restore that capped oversized rows', () => {
  // The rule, in its own words (codex L6 / owner): "when opening a .strix
  // drops capped rows, the engineer is told how many and of what, once, in a
  // warning toast; a restore that drops nothing stays silent." The restore
  // path already logged the counts; a log a packaged build never shows is not
  // "told".
  // Owner ruling 2026-09-04 ("yeah just add a small toast"): a restore that is
  // still running after a moment tells the engineer WHY it may be waiting — a
  // body recompute can hold the partition lock for up to 30 s — instead of an
  // open dialog that sits there silently. A restore that finishes quickly says
  // nothing.
  it('tells the engineer a recompute may be holding the lock when the restore is still running after 2 s', async () => {
    vi.useFakeTimers()
    try {
      const { api } = await import('../api/client')
      diskContent = JSON.stringify(
        fileShape({ project: { id: PROJECT_ID, name: 'Slow', status: 'active', tags: [] } }),
      )
      asMock(api.project.get).mockRejectedValue(new ApiError('Project not found', 404))
      let finish: (v: unknown) => void = () => {}
      asMock(api.project.restore).mockImplementation(
        () => new Promise((resolve) => { finish = resolve }),
      )
      const toast = vi.fn()
      const { result } = renderHook(() => useProject({ toast }))
      let opening: Promise<unknown> = Promise.resolve()
      await act(async () => {
        opening = result.current.openProjectFile('C:/path/slow.strix')
        await vi.advanceTimersByTimeAsync(1_900)
      })
      expect(toast).not.toHaveBeenCalled()
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200)
      })
      const waits = toast.mock.calls.filter(([type]) => type === 'warning')
      expect(waits).toHaveLength(1)
      expect((waits[0] as [string, string])[1].toLowerCase()).toContain('recompute')
      await act(async () => {
        finish({ ...baseProject, name: 'Slow', dropped_series: 0, dropped_child_rows: 0 })
        await opening
      })
      expect(toast.mock.calls.filter(([type]) => type === 'warning')).toHaveLength(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('says nothing about the lock when the restore finishes within 2 s', async () => {
    vi.useFakeTimers()
    try {
      const { api } = await import('../api/client')
      diskContent = JSON.stringify(
        fileShape({ project: { id: PROJECT_ID, name: 'Quick', status: 'active', tags: [] } }),
      )
      asMock(api.project.get).mockRejectedValue(new ApiError('Project not found', 404))
      asMock(api.project.restore).mockResolvedValue({
        ...baseProject,
        name: 'Quick',
        dropped_series: 0,
        dropped_child_rows: 0,
      })
      const toast = vi.fn()
      const { result } = renderHook(() => useProject({ toast }))
      await act(async () => {
        await result.current.openProjectFile('C:/path/quick.strix')
      })
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5_000)
      })
      expect(toast.mock.calls.filter(([type]) => type === 'warning')).toHaveLength(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('warns the engineer once, in a warning toast naming the counts, when the restore dropped rows', async () => {
    const { api } = await import('../api/client')
    diskContent = JSON.stringify(
      fileShape({ project: { id: PROJECT_ID, name: 'Ghost', status: 'active', tags: [] } }),
    )
    asMock(api.project.get).mockRejectedValue(new ApiError('Project not found', 404))
    asMock(api.project.restore).mockResolvedValue({
      ...baseProject,
      name: 'Ghost',
      dropped_series: 3,
      dropped_child_rows: 5,
    })
    const toast = vi.fn()

    const { result } = renderHook(() => useProject({ toast }))
    await act(async () => {
      await result.current.openProjectFile('C:/path/ghost.strix')
    })

    // ONCE, and a warning — not an error (the project still opened) and not a
    // success (data was silently trimmed).
    const warnings = toast.mock.calls.filter(([type]) => type === 'warning')
    expect(warnings).toHaveLength(1)
    // "how many and of what": both the depth-series count and the child-row
    // count reach the engineer.
    const [, message] = warnings[0] as [string, string]
    expect(message).toContain('3')
    expect(message).toContain('5')
  })

  it('stays silent when the restore dropped nothing', async () => {
    const { api } = await import('../api/client')
    asMock(api.project.get).mockRejectedValue(new ApiError('Project not found', 404))
    asMock(api.project.restore).mockResolvedValue({
      ...baseProject,
      name: 'Ghost',
      dropped_series: 0,
      dropped_child_rows: 0,
    })
    const toast = vi.fn()

    const { result } = renderHook(() => useProject({ toast }))
    await act(async () => {
      await result.current.openProjectFile('C:/path/ghost.strix')
    })

    // A clean restore reports nothing — the toast is for the exception, not
    // the happy path.
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('openProjectFile — the file is unreadable (damaged / truncated / newer)', () => {
  // The main-process codec flattens a decode failure into { ok: false, reason }
  // instead of throwing across IPC, so the open flow can show the SPECIFIC,
  // honest message — the RAM-corruption-mid-save case must read LOUD, not fall
  // into the generic "corrupt or API unreachable" banner.
  it('returns the specific decode reason verbatim and does NOT hit the DB restore path', async () => {
    const { api } = await import('../api/client')
    const reason = {
      code: 'strix-corrupt',
      message:
        'This StrixGeo project file is damaged and could not be read — re-save it ' +
        'from a build that still has the project open.',
    }
    asMock(window.electron.readProjectFile).mockResolvedValue({ ok: false, reason })

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/damaged.strix')
    })

    // Surfaced verbatim as the discriminated unreadable failure — not folded
    // into a bare null the way a generic parse failure is.
    expect(returned).toEqual({ outcome: 'unreadable', reason })
    // A damaged file must never trigger the DB-lost restore (that path rebuilds
    // the project FROM the file, which we just proved we cannot read).
    expect(api.project.get).not.toHaveBeenCalled()
    expect(api.project.restore).not.toHaveBeenCalled()
    expect(result.current.project).toBeNull()
  })
})

describe('saveProject — the pre-write empty-bundle guard (debt #225)', () => {
  // "Save must never silently write a 0-edge bundle when the model has edges."
  // The observed shape (2026-06-25): a save fetched a bundle whose
  // ``litho_contact_correlation_edges`` came back ``[]`` while the model held
  // 481, and the file was silently overwritten with the empty data.
  //
  // Owner ruling, after the first version blocked a deliberate clear-then-save:
  // RETRY ONCE, THEN ASK. A save is never hard-blocked, because clearing a
  // model on purpose and then saving is a normal thing to do. What must not
  // happen is the overwrite going through WITHOUT the engineer being asked.
  const edgeRows = (n: number): Row[] =>
    Array.from({ length: n }, (_, i) => ({ id: `edge-${i}` }))

  /** Open a .strix that holds ``edges`` correlation edges. */
  async function openWithEdges(edges: number) {
    const toast = vi.fn()
    diskContent = JSON.stringify(
      fileShape({ litho_contact_correlation_edges: edgeRows(edges) }),
    )
    const hook = renderHook(() => useProject({ toast }))
    await act(async () => {
      await hook.result.current.openProjectFile('C:/path/edges.strix')
    })
    return { ...hook, toast }
  }

  it('a bundle that comes back empty is re-fetched once, and a healed re-fetch saves normally', async () => {
    const { api } = await import('../api/client')
    const { result, toast } = await openWithEdges(481)

    // The transient bad export state hits the FIRST fetch only; the retry, as
    // on 2026-06-25, comes back populated.
    bundleOverrides = { litho_contact_correlation_edges: edgeRows(481) }
    asMock(api.project.bundle).mockImplementationOnce(async () =>
      bundleShape({ project: dbProject(), litho_contact_correlation_edges: [] }),
    )
    asMock(window.electron.writeProjectFile).mockClear()
    asMock(api.project.bundle).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    // The save succeeds, writes the HEALED bundle, and never bothers the
    // engineer: a transient glitch that healed is not their problem.
    expect(ok).toBe(true)
    expect(api.project.bundle).toHaveBeenCalledTimes(2)
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    expect(
      (lastWrittenFile().litho_contact_correlation_edges as Row[]).length,
    ).toBe(481)
    expect(toast.mock.calls.filter(([type]) => type === 'error')).toHaveLength(0)
  })

  it('when the re-fetch is still empty the engineer is asked, and cancelling leaves the file untouched', async () => {
    const toast = vi.fn()
    const confirmEmptyBundleOverwrite = vi.fn(async () => false)
    diskContent = JSON.stringify(
      fileShape({ litho_contact_correlation_edges: edgeRows(481) }),
    )
    const { result } = renderHook(() =>
      useProject({ toast, confirmEmptyBundleOverwrite }),
    )
    await act(async () => {
      await result.current.openProjectFile('C:/path/edges.strix')
    })
    // Both the fetch and the re-fetch read empty.
    bundleOverrides = { litho_contact_correlation_edges: [] }
    asMock(window.electron.writeProjectFile).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    // Asked, not silently overwritten; Cancel keeps the last good file.
    expect(confirmEmptyBundleOverwrite).toHaveBeenCalledTimes(1)
    expect(confirmEmptyBundleOverwrite).toHaveBeenCalledWith([
      { collection: 'litho_contact_correlation_edges', expected: 481, fetched: 0 },
    ])
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
    expect(ok).toBe(false)
    expect(result.current.lastSaveWroteFile()).toBe(false)
  })

  it('when the re-fetch is still empty and the engineer says save anyway, the file is written', async () => {
    const toast = vi.fn()
    const confirmEmptyBundleOverwrite = vi.fn(async () => true)
    diskContent = JSON.stringify(
      fileShape({ litho_contact_correlation_edges: edgeRows(481) }),
    )
    const { result } = renderHook(() =>
      useProject({ toast, confirmEmptyBundleOverwrite }),
    )
    await act(async () => {
      await result.current.openProjectFile('C:/path/edges.strix')
    })
    // A deliberate clear-then-save looks exactly like this from here, which is
    // why the guard must not refuse it.
    bundleOverrides = { litho_contact_correlation_edges: [] }
    asMock(window.electron.writeProjectFile).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(confirmEmptyBundleOverwrite).toHaveBeenCalledTimes(1)
    expect(ok).toBe(true)
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    expect(
      (lastWrittenFile().litho_contact_correlation_edges as Row[]).length,
    ).toBe(0)
  })

  it('without a question wired the guard refuses rather than overwrite', async () => {
    const { result } = await openWithEdges(481)
    bundleOverrides = { litho_contact_correlation_edges: [] }
    asMock(window.electron.writeProjectFile).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    // A bare-hook render has no dialog to ask through. Refusing is the safe
    // side: the data is still in the app and the file keeps its last good bytes.
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
    expect(ok).toBe(false)
  })

  it('a genuinely empty project still saves', async () => {
    const toast = vi.fn()
    // Opened empty, fetched empty — nothing to guard.
    const { result } = renderHook(() => useProject({ toast }))
    await act(async () => {
      await result.current.openProjectFile('C:/path/empty.strix')
    })
    asMock(window.electron.writeProjectFile).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(ok).toBe(true)
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    expect(toast.mock.calls.filter(([type]) => type === 'error')).toHaveLength(0)
  })

  it('a bundle whose counts match writes as before, with no second fetch', async () => {
    const { api } = await import('../api/client')
    const { result, toast } = await openWithEdges(481)
    // The fresh fetch returns the same 481 edges — a healthy save.
    bundleOverrides = { litho_contact_correlation_edges: edgeRows(481) }
    asMock(window.electron.writeProjectFile).mockClear()
    asMock(api.project.bundle).mockClear()

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(ok).toBe(true)
    expect(api.project.bundle).toHaveBeenCalledTimes(1)
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    expect(
      (lastWrittenFile().litho_contact_correlation_edges as Row[]).length,
    ).toBe(481)
    expect(toast.mock.calls.filter(([type]) => type === 'error')).toHaveLength(0)
  })

  it('Save As asks before writing a duplicate whose bundle comes back empty', async () => {
    const { api } = await import('../api/client')
    const toast = vi.fn()
    const confirmEmptyBundleOverwrite = vi.fn(async () => false)
    // The source project holds 481 edges (its opened file).
    diskContent = JSON.stringify(
      fileShape({ litho_contact_correlation_edges: edgeRows(481) }),
    )
    const { result } = renderHook(() =>
      useProject({ toast, confirmEmptyBundleOverwrite }),
    )
    await act(async () => {
      await result.current.openProjectFile('C:/path/source.strix')
    })
    // Save As duplicates server-side, then fetches the duplicate's bundle —
    // which comes back with the transient empty edge state, twice.
    asMock(api.project.duplicate).mockResolvedValue({
      ...baseProject,
      id: 'dup-1',
      name: 'Copy',
    })
    asMock(window.electron.showProjectSaveDialog).mockResolvedValue('C:/path/copy.strix')
    bundleOverrides = {
      project: { ...baseProject, id: 'dup-1' },
      litho_contact_correlation_edges: [],
    }
    asMock(window.electron.writeProjectFile).mockClear()

    let returned: unknown
    await act(async () => {
      returned = await result.current.saveAsProject()
    })

    expect(confirmEmptyBundleOverwrite).toHaveBeenCalledTimes(1)
    expect(returned).toBeNull()
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
    // The freshly-minted duplicate row is rolled back so no orphan is left.
    expect(api.project.archive).toHaveBeenCalledWith('dup-1')
  })
})

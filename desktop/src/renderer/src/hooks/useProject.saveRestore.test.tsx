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

describe('saveProject — the written .strix must be self-consistent', () => {
  it('keeps a formation referenced only by a litho layer, even when the manifest never saw it', async () => {
    // The engineer accepted litho suggestions (server-side formations the
    // manifest never learned about) and hits Ctrl+S. Litho and geotech
    // models serialise ``contacts: []`` — their formation references live
    // in ``litho_layers`` only.
    bundleOverrides = {
      geological_formations: [{ id: 'f-litho', name: 'ZAND instance' }],
      geological_models: [
        {
          id: 'm-litho',
          kind: 'lithostratigraphic',
          contacts: [],
          litho_layers: [{ id: 'll-1', formation_id: 'f-litho' }],
        },
      ],
    }

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    asMock(window.electron.writeProjectFile).mockClear()
    await act(async () => {
      await result.current.saveProject()
    })

    // The invariant, stated as a property of the file itself: no layer and
    // no contact in the file may reference a formation the file lacks.
    const written = lastWrittenFile()
    const presentFormationIds = new Set(
      (written.geological_formations as Row[]).map(f => f.id as string),
    )
    const referenced: string[] = []
    for (const m of written.geological_models as Row[]) {
      for (const c of ((m.contacts ?? []) as Row[])) {
        if (typeof c.formation_id === 'string') referenced.push(c.formation_id)
      }
      for (const l of ((m.litho_layers ?? []) as Row[])) {
        if (typeof l.formation_id === 'string') referenced.push(l.formation_id)
      }
    }
    expect(referenced).toContain('f-litho')
    for (const id of referenced) expect(presentFormationIds.has(id)).toBe(true)
  })

  it('still drops a formation nothing references and the manifest never saw', async () => {
    bundleOverrides = {
      geological_formations: [{ id: 'f-orphan', name: 'Never saved' }],
    }

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    asMock(window.electron.writeProjectFile).mockClear()
    await act(async () => {
      await result.current.saveProject()
    })

    expect(lastWrittenFile().geological_formations as Row[]).toHaveLength(0)
  })
})

describe('saveProject — a save whose file write failed is not a save', () => {
  it('reports failure to the caller when writeProjectFile throws', async () => {
    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    asMock(window.electron.writeProjectFile).mockRejectedValue(
      new Error('EBUSY: file locked by another process'),
    )

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    // OneDrive / antivirus held the .strix. The DB is committed but the
    // engineer's anchor file is stale — reporting "saved" here is what
    // later lets a "Don't Save" replay the stale file over the database.
    expect(ok).toBe(false)
    expect(result.current.lastSaveWroteFile()).toBe(false)
  })

  it('still reports success on the happy path', async () => {
    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(ok).toBe(true)
    expect(result.current.lastSaveWroteFile()).toBe(true)
  })
})

describe('saveProject — the anchor that pairs a file with its project row', () => {
  it('stamps one token on the project row and into the file written in the same save', async () => {
    const { api } = await import('../api/client')

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    await act(async () => {
      await result.current.saveProject()
    })

    const rowAnchor = (dbViewState as { save_anchor?: string }).save_anchor
    const fileAnchor = (
      (lastWrittenFile().project as Record<string, unknown>).view_state as {
        save_anchor?: string
      }
    ).save_anchor
    expect(typeof rowAnchor).toBe('string')
    expect(fileAnchor).toBe(rowAnchor)
    expect(api.project.patchViewState).toHaveBeenCalledWith(
      PROJECT_ID,
      expect.objectContaining({ save_anchor: rowAnchor }),
    )
  })

  it('mints a different token on every save', async () => {
    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    await act(async () => {
      await result.current.saveProject()
    })
    const first = (dbViewState as { save_anchor?: string }).save_anchor
    await act(async () => {
      await result.current.saveProject()
    })
    const second = (dbViewState as { save_anchor?: string }).save_anchor

    expect(first).toBeTruthy()
    expect(second).not.toBe(first)
  })

  it('does not fail the save when the anchor PATCH itself fails', async () => {
    const { api } = await import('../api/client')
    // The anchor is bookkeeping. Losing it costs the revert guard its
    // newest data point — it falls back to the previous anchor — but the
    // engineer's save must still reach the disk.
    asMock(api.project.patchViewState).mockRejectedValue(new Error('backend blip'))

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })

    let ok: boolean | undefined
    await act(async () => {
      ok = await result.current.saveProject()
    })

    expect(ok).toBe(true)
    expect(result.current.lastSaveWroteFile()).toBe(true)
  })
})

describe('revertToLastSaved — only the project\u2019s own latest save may replace the DB', () => {
  it('refuses to replace-restore from a file that is not this project\u2019s latest save', async () => {
    const { api } = await import('../api/client')
    // A hand-copied backup: same project id (a byte copy always is), but it
    // carries the anchor of an older save while the live row has moved on.
    diskContent = JSON.stringify(
      fileShape({
        project: {
          id: PROJECT_ID,
          name: 'Save Restore Site',
          status: 'active',
          tags: [],
          view_state: { save_anchor: 'anchor-from-01-august' },
        },
      }),
    )
    dbViewState = { save_anchor: 'anchor-from-08-august' }

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site-backup-0801.strix')
    })

    let reverted: string | undefined
    await act(async () => {
      reverted = await result.current.revertToLastSaved()
    })

    // The REFUSAL is its own outcome. A bare false made the close-flow read
    // it as "never-saved project" and DB-delete the session's creates.
    expect(reverted).toBe('refused-not-latest-save')
    // Nothing was wiped: the replace-restore never ran.
    expect(api.project.restore).not.toHaveBeenCalled()
  })

  it('reverts normally when the file IS the project\u2019s latest save', async () => {
    const { api } = await import('../api/client')
    asMock(api.project.restore).mockResolvedValue(baseProject)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    await act(async () => {
      await result.current.saveProject()
    })

    let reverted: string | undefined
    await act(async () => {
      reverted = await result.current.revertToLastSaved()
    })

    expect(reverted).toBe('reverted')
    expect(api.project.restore).toHaveBeenCalledTimes(1)
  })

  it('reverts for a legacy project that has no anchor on either side', async () => {
    const { api } = await import('../api/client')
    asMock(api.project.restore).mockResolvedValue(baseProject)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/legacy.strix')
    })

    let reverted: string | undefined
    await act(async () => {
      reverted = await result.current.revertToLastSaved()
    })

    expect(reverted).toBe('reverted')
  })

  it('refuses after a save whose file write failed — the file on disk is a save behind', async () => {
    const { api } = await import('../api/client')
    asMock(api.project.restore).mockResolvedValue(baseProject)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.strix')
    })
    // First save lands: file and row now share an anchor.
    await act(async () => {
      await result.current.saveProject()
    })
    // Second save: the write fails, so the row's anchor advances while the
    // file on disk keeps the previous one.
    asMock(window.electron.writeProjectFile).mockRejectedValue(new Error('EBUSY'))
    await act(async () => {
      await result.current.saveProject()
    })

    let reverted: string | undefined
    await act(async () => {
      reverted = await result.current.revertToLastSaved()
    })

    expect(reverted).toBe('refused-not-latest-save')
    expect(api.project.restore).not.toHaveBeenCalled()
  })
})

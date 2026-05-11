import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from './useProject'

// Tests for the file-aware ``useProject`` hook. We mock the two
// boundary surfaces it calls into:
//   * ``window.electron.*`` — Electron IPC for file dialogs / fs / recent
//   * ``api.project.*``     — typed fetch wrappers (mocked at module level
//                             via vi.mock so we don't go near a real socket)

const created = {
  id: '01k-NEW',
  name: 'Site A',
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
  created_at: '2026-05-10T10:00:00Z',
  updated_at: '2026-05-10T10:00:00Z',
}

vi.mock('../api/client', () => ({
  api: {
    project: {
      get: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      archive: vi.fn(),
      unarchive: vi.fn(),
      duplicate: vi.fn(),
      restore: vi.fn(),
      bundle: vi.fn(),
    },
  },
}))

// Empty bundle (no CPTs / boreholes) — used as the default for any flow
// that writes a file for a freshly-created project. ``api.project.bundle``
// returns this so the save path doesn't need a real DB.
function emptyBundle(project: typeof created): {
  format_version: number
  project: typeof created
  cpts: Record<string, unknown>[]
  boreholes: Record<string, unknown>[]
  geological_formations: Record<string, unknown>[]
  geological_models: Record<string, unknown>[]
  cross_sections: Record<string, unknown>[]
  investigation_reviews: Record<string, unknown>[]
} {
  return {
    format_version: 3,
    project,
    cpts: [],
    boreholes: [],
    geological_formations: [],
    geological_models: [],
    cross_sections: [],
    investigation_reviews: [],
  }
}

beforeEach(async () => {
  // Reset all api.project.* mocks between tests.
  const { api } = await import('../api/client')
  for (const fn of Object.values(api.project)) {
    ;(fn as ReturnType<typeof vi.fn>).mockReset()
  }
  // ``bundle`` is called by every save / new-project flow. Default to
  // an empty bundle so tests that don't care about file contents still
  // succeed. Individual tests override when they need a populated one.
  ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue(emptyBundle(created))

  ;(globalThis as unknown as { window: { electron: unknown } }).window.electron = {
    showProjectOpenDialog: vi.fn(),
    showProjectSaveDialog: vi.fn(),
    readProjectFile: vi.fn(),
    writeProjectFile: vi.fn(),
    addRecentProject: vi.fn().mockResolvedValue([]),
    getRecentProjects: vi.fn().mockResolvedValue([]),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('useProject', () => {
  it('starts with no project loaded (no auto-reopen)', () => {
    const { result } = renderHook(() => useProject())
    expect(result.current.project).toBeNull()
    expect(result.current.filePath).toBeNull()
  })

  it('newProject: POSTs, opens save dialog, writes file, adopts result', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/Users/robin/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })

    expect(api.project.create).toHaveBeenCalledWith({ name: 'Site A' })
    expect(window.electron.showProjectSaveDialog).toHaveBeenCalled()
    expect(window.electron.writeProjectFile).toHaveBeenCalledWith(
      'C:/Users/robin/site-a.gmproj',
      // v2 format embeds the project metadata under ``project`` and
      // carries empty cpts / boreholes arrays for a freshly-created
      // project. Both substrings have to appear.
      expect.stringMatching(/"format_version": 3/),
    )
    expect(window.electron.writeProjectFile).toHaveBeenCalledWith(
      'C:/Users/robin/site-a.gmproj',
      expect.stringContaining('"id": "01k-NEW"'),
    )
    expect(window.electron.addRecentProject).toHaveBeenCalledWith(
      'C:/Users/robin/site-a.gmproj',
      'Site A',
    )
    await waitFor(() => expect(result.current.project?.id).toBe('01k-NEW'))
    expect(result.current.filePath).toBe('C:/Users/robin/site-a.gmproj')
  })

  it('newProject: rolls back via archive when save dialog is cancelled', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      null, // user cancelled
    )
    ;(api.project.archive as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    const { result } = renderHook(() => useProject())
    let returned
    await act(async () => {
      returned = await result.current.newProject({ name: 'Site A' })
    })

    expect(returned).toBeNull()
    expect(api.project.archive).toHaveBeenCalledWith('01k-NEW')
    // No file written, no project adopted.
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
    expect(result.current.project).toBeNull()
  })

  it('newProject: rolls back via archive when writeProjectFile fails', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/Users/robin/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('disk full'),
    )
    ;(api.project.archive as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    const { result } = renderHook(() => useProject())
    let returned
    await act(async () => {
      returned = await result.current.newProject({ name: 'Site A' })
    })

    expect(returned).toBeNull()
    expect(api.project.archive).toHaveBeenCalledWith('01k-NEW')
    expect(result.current.project).toBeNull()
  })

  it('openProjectFile: reads file, fetches DB row, adopts result', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: {
          id: '01k-NEW',
          name: 'old snapshot name',
          project_number: null,
          client: null,
          site_label: null,
          description: null,
          tags: [],
          default_horizontal_epsg: null,
          default_vertical_epsg: null,
          phase: null,
          status: 'active',
        },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...created,
      // The DB has the live name; the file's snapshot might be stale.
      name: 'Site A (renamed in DB)',
    })

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })

    expect(api.project.get).toHaveBeenCalledWith('01k-NEW')
    expect(result.current.project?.name).toBe('Site A (renamed in DB)')
    expect(result.current.filePath).toBe('C:/path/site.gmproj')
    expect(window.electron.addRecentProject).toHaveBeenCalledWith(
      'C:/path/site.gmproj',
      'Site A (renamed in DB)',
    )
  })

  it('openProjectFile: returns null when the file is unrecognisable', async () => {
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      'not json at all',
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/bad.gmproj')
    })

    expect(returned).toBeNull()
    expect(result.current.project).toBeNull()
  })

  it('openProjectFile: restores the full bundle when the DB row is missing', async () => {
    const { api } = await import('../api/client')
    // v3 file shape: project + cpts + boreholes + geology + sections +
    // reviews. Every per-project decision rides in the bundle.
    const ghostFile = {
      format_version: 3,
      project: {
        id: '01k-MISSING',
        name: 'Ghost',
        project_number: 'GEO-001',
        client: 'ACME',
        tags: ['foundation'],
        status: 'active',
      },
      cpts: [{ id: 'cpt-1', name: 'CPT-1', series: { depths_m: [0, 1] } }],
      boreholes: [{ id: 'bh-1', name: 'BH-1' }],
      geological_formations: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [{ id: 'rv-1', target_kind: 'cpt', target_id: 'cpt-1' }],
    }
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify(ghostFile),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('GET /projects/01k-MISSING → 404'),
    )
    const restored = { ...created, id: '01k-MISSING', name: 'Ghost' }
    ;(api.project.restore as ReturnType<typeof vi.fn>).mockResolvedValue(restored)

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/ghost.gmproj')
    })

    expect(returned).toEqual(restored)
    expect(result.current.project).toEqual(restored)
    // Restore is called with the full v3 bundle — every per-project
    // decision rides along so the data comes back with the project.
    expect(api.project.restore).toHaveBeenCalledWith(
      '01k-MISSING',
      expect.objectContaining({
        format_version: 3,
        project: expect.objectContaining({ id: '01k-MISSING', name: 'Ghost' }),
        cpts: ghostFile.cpts,
        boreholes: ghostFile.boreholes,
        investigation_reviews: ghostFile.investigation_reviews,
      }),
    )
  })

  it('openProjectFile: returns null for pre-v3 files (legacy formats no longer accepted)', async () => {
    // Pre-shipping, we explicitly dropped v1/v2 readers — anyone
    // holding an old dev .gmproj has to re-save from a current build.
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ format_version: 2, project: { id: 'x' }, cpts: [], boreholes: [] }),
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/legacy.gmproj')
    })

    expect(returned).toBeNull()
    expect(result.current.project).toBeNull()
  })

  it('openProjectFile: returns null when restore itself fails (network down)', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-MISSING', name: 'Ghost', status: 'active', tags: [] },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('GET /projects/01k-MISSING → 404'),
    )
    ;(api.project.restore as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network unreachable'),
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/ghost.gmproj')
    })

    expect(returned).toBeNull()
    expect(result.current.project).toBeNull()
  })

  it('openProjectFile: returns null on non-404 GET failures, no restore attempted', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NET', name: 'Net Down', status: 'active', tags: [] },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('network unreachable'),
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/net.gmproj')
    })

    expect(returned).toBeNull()
    // Restore only fires on a clean 404, not arbitrary errors.
    expect(api.project.restore).not.toHaveBeenCalled()
  })

  it('closeProject clears in-memory state', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/Users/robin/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })
    expect(result.current.project).not.toBeNull()

    act(() => {
      result.current.closeProject()
    })
    expect(result.current.project).toBeNull()
    expect(result.current.filePath).toBeNull()
  })

  // ---------------------------------------------------------------------
  // Two-stage save: applyMetadataDraft + saveProject + dirty
  // ---------------------------------------------------------------------

  it('applyMetadataDraft updates project (live) and flips dirty=true; saved stays put', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/path/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })
    expect(result.current.dirty).toBe(false)

    act(() => {
      result.current.applyMetadataDraft({ description: 'a draft' })
    })
    expect(result.current.dirty).toBe(true)
    expect(result.current.project?.description).toBe('a draft')
    // Saved snapshot unchanged.
    expect(result.current.saved?.description).toBeNull()
  })

  it('saveProject when clean is a silent no-op — no API call, returns true', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/path/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    const updateMock = api.project.update as ReturnType<typeof vi.fn>

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })
    updateMock.mockClear()
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockClear()

    let ok = false
    await act(async () => {
      ok = await result.current.saveProject()
    })
    expect(ok).toBe(true)
    expect(updateMock).not.toHaveBeenCalled()
    expect(window.electron.writeProjectFile).not.toHaveBeenCalled()
  })

  it('saveProject when dirty PATCHes + writes file + clears dirty', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/path/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)
    ;(api.project.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...created,
      description: 'a draft',
    })

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })
    act(() => {
      result.current.applyMetadataDraft({ description: 'a draft' })
    })
    expect(result.current.dirty).toBe(true)

    await act(async () => {
      await result.current.saveProject()
    })
    expect(api.project.update).toHaveBeenCalledWith(
      '01k-NEW',
      expect.objectContaining({ description: 'a draft' }),
    )
    expect(window.electron.writeProjectFile).toHaveBeenCalled()
    expect(result.current.dirty).toBe(false)
    expect(result.current.saved?.description).toBe('a draft')
  })

  it('discardEdits reverts project back to saved (drops in-memory edits)', async () => {
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/path/site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.newProject({ name: 'Site A' })
    })
    act(() => {
      result.current.applyMetadataDraft({ description: 'will be discarded' })
    })
    expect(result.current.project?.description).toBe('will be discarded')

    act(() => {
      result.current.discardEdits()
    })
    expect(result.current.project?.description).toBeNull()
    expect(result.current.dirty).toBe(false)
  })
})

import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useProject } from './useProject'
import type { StratigraphyLumping } from '../utils/projectFile'

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
  view_state: {},
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
      patchViewState: vi.fn(),
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

  it('openProjectFile: restore payload carries geotechnical_units (regression pin)', async () => {
    // Geotechnical units were silently dropped from the restore
    // payload before this fix — every unit saved in a .strix
    // disappeared on a 404→restore open. Same shape of bug as the
    // pre-fix save flow that lost contacts. This pins the
    // geotechnical_units key on the api.project.restore call so
    // the next refactor can't regress it.
    const { api } = await import('../api/client')
    const ghostFile = {
      format_version: 3,
      project: {
        id: '01k-WITH-UNITS',
        name: 'WithUnits',
        status: 'active',
        tags: [],
      },
      cpts: [],
      boreholes: [],
      geological_formations: [{ id: 'f-1', name: 'Boom Klei' }],
      geotechnical_units: [
        { id: 'u-1', geological_formation_id: 'f-1', name: 'Weathered crust' },
      ],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
    }
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify(ghostFile),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('GET /projects/01k-WITH-UNITS → 404'),
    )
    const restored = { ...created, id: '01k-WITH-UNITS', name: 'WithUnits' }
    ;(api.project.restore as ReturnType<typeof vi.fn>).mockResolvedValue(restored)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/with-units.gmproj')
    })

    expect(api.project.restore).toHaveBeenCalledWith(
      '01k-WITH-UNITS',
      expect.objectContaining({
        geotechnical_units: ghostFile.geotechnical_units,
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

  it('saveProject when metadata is clean skips API PATCH but STILL rewrites the file', async () => {
    // Previously this was a "silent no-op" — the dirty gate skipped
    // both the metadata PATCH and the file write. That assumed only
    // metadata could be dirty, which is wrong: every geological
    // contact / formation / model / section is mutated via separate
    // API calls that never touch project metadata. Skipping the file
    // write here was a real data-loss bug — the user's contacts
    // disappeared on the next open. Fix: PATCH is still gated (no
    // need to round-trip identical metadata) but the file write
    // always runs so the .strix stays current with the DB.
    const { api } = await import('../api/client')
    ;(api.project.create as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue({
      project: created,
      cpts: [],
      boreholes: [],
      geological_formations: [],
      geotechnical_units: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
    })
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
    // PATCH stays gated — no metadata changed, no round-trip.
    expect(updateMock).not.toHaveBeenCalled()
    // BUT the file write runs — geological data may have changed
    // since last save without flipping the metadata-dirty flag.
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
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

  // ---------------------------------------------------------------------
  // Manifest model: load-from-.gmproj guarantee
  // ---------------------------------------------------------------------

  it('openProjectFile seeds the manifest from the file bundle', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: {
          id: '01k-NEW',
          name: 'Site A',
          status: 'active',
          tags: [],
        },
        cpts: [{ id: 'cpt-1' }, { id: 'cpt-2' }],
        boreholes: [{ id: 'bh-1' }],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })

    expect(result.current.manifestCptIds.has('cpt-1')).toBe(true)
    expect(result.current.manifestCptIds.has('cpt-2')).toBe(true)
    expect(result.current.manifestBoreholeIds.has('bh-1')).toBe(true)
    expect(result.current.manifestCptIds.size).toBe(2)
    expect(result.current.manifestBoreholeIds.size).toBe(1)
  })

  it('newProject starts with an empty manifest', async () => {
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

    expect(result.current.manifestCptIds.size).toBe(0)
    expect(result.current.manifestBoreholeIds.size).toBe(0)
  })

  it('addToManifest appends + removeFromManifest drops the listed IDs', async () => {
    const { result } = renderHook(() => useProject())

    act(() => {
      result.current.addToManifest('cpt', ['cpt-a', 'cpt-b'])
      result.current.addToManifest('borehole', ['bh-a'])
    })
    expect(result.current.manifestCptIds.has('cpt-a')).toBe(true)
    expect(result.current.manifestCptIds.has('cpt-b')).toBe(true)
    expect(result.current.manifestBoreholeIds.has('bh-a')).toBe(true)

    act(() => {
      result.current.removeFromManifest('cpt', ['cpt-a'])
    })
    expect(result.current.manifestCptIds.has('cpt-a')).toBe(false)
    expect(result.current.manifestCptIds.has('cpt-b')).toBe(true)
  })

  it('closeProject clears the manifest', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NEW', name: 'A', status: 'active', tags: [] },
        cpts: [{ id: 'cpt-1' }],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })
    expect(result.current.manifestCptIds.size).toBe(1)

    act(() => {
      result.current.closeProject()
    })
    expect(result.current.manifestCptIds.size).toBe(0)
    expect(result.current.manifestBoreholeIds.size).toBe(0)
  })

  it('saveProject trims bundle CPTs/boreholes against the manifest before writing', async () => {
    // Simulate the scenario the user described: pre-Ctrl+C imports
    // left extras in the DB. After reopen, manifest = saved IDs
    // only. When the user saves now, the file must contain ONLY
    // the manifest IDs — extras are not written even though the
    // API bundle returns them all.
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NEW', name: 'Site A', status: 'active', tags: [] },
        cpts: [{ id: 'cpt-keep' }],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue({
      format_version: 3,
      project: created,
      cpts: [{ id: 'cpt-keep' }, { id: 'cpt-orphan' }],
      boreholes: [{ id: 'bh-orphan' }],
      geological_formations: [],
      geotechnical_units: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
    })
    ;(api.project.update as ReturnType<typeof vi.fn>).mockResolvedValue({
      ...created,
      description: 'edit',
    })
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })
    // Make the project dirty so saveProject actually runs.
    act(() => {
      result.current.applyMetadataDraft({ description: 'edit' })
    })

    await act(async () => {
      await result.current.saveProject()
    })

    expect(window.electron.writeProjectFile).toHaveBeenCalled()
    const [, written] = (
      window.electron.writeProjectFile as ReturnType<typeof vi.fn>
    ).mock.calls[0]
    // The saved file must contain the manifest CPT but NOT the
    // DB-orphan one. Same for the orphan borehole.
    expect(written).toContain('"cpt-keep"')
    expect(written).not.toContain('"cpt-orphan"')
    expect(written).not.toContain('"bh-orphan"')
  })

  // S5 regression — stratigraphy_lumping must survive a File → Save
  //
  // Before the fix, saveProject called buildProjectFile(trimmedBundle) without
  // passing the lumping state, so every File → Save after a writeLumpingSnapshot
  // overwrote the user's lumping map with null. The fix tracks currentLumping in
  // useState and passes it to buildProjectFile.
  it('S5: saveProject preserves stratigraphy_lumping written by writeLumpingSnapshot', async () => {
    const { api } = await import('../api/client')
    const lumpingMap = { 'boom klei': 'Quartair', 'vlaamse vallei': 'Quartair' }
    const lumping: StratigraphyLumping = {
      schema_version: 1,
      applied_at: '2026-05-17T10:00:00.000Z',
      map: lumpingMap,
    }

    // File on disk has no lumping (simulates a project opened before the Fill dialog ran).
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NEW', name: 'Site A', status: 'active', tags: [] },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
        stratigraphy_lumping: null,
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue(emptyBundle(created))
    // writeLumpingSnapshot reads the current file and patches it.
    // After the patch write, it reads the file back (the same mock returns
    // the patched JSON on the second call — we simulate this by returning
    // the patched content on all subsequent readProjectFile calls).
    const patchedFileContent = JSON.stringify({
      format_version: 3,
      project: { id: '01k-NEW', name: 'Site A', status: 'active', tags: [] },
      cpts: [],
      boreholes: [],
      geological_formations: [],
      geological_models: [],
      cross_sections: [],
      investigation_reviews: [],
      stratigraphy_lumping: lumping,
    })
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })

    // Simulate the user running Fill from boreholes → writeLumpingSnapshot fires.
    // The second read (inside writeLumpingSnapshot) returns the patched content.
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      patchedFileContent,
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockClear()

    await act(async () => {
      await result.current.writeLumpingSnapshot(lumping)
    })

    // writeLumpingSnapshot wrote once (the patch write).
    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)

    // Now File → Save — saveProject must include the lumping in the written file.
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockClear()
    await act(async () => {
      await result.current.saveProject()
    })

    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    const [, savedContent] = (
      window.electron.writeProjectFile as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string]
    // The saved file must contain the lumping map keys/values.
    // Before the S5 fix this assertion would fail because buildProjectFile
    // was called without currentLumping and wrote stratigraphy_lumping: null.
    expect(savedContent).toContain('"stratigraphy_lumping"')
    expect(savedContent).toContain('"boom klei"')
    expect(savedContent).toContain('"Quartair"')
  })

  it('S5: openProjectFile seeds stratigraphy_lumping from the file so saveProject preserves it', async () => {
    // Tests the companion path: when a .gmproj already has stratigraphy_lumping
    // on disk (saved in a prior session), opening the file should seed currentLumping
    // so the VERY FIRST File → Save (before any writeLumpingSnapshot call) still
    // includes the lumping.
    const { api } = await import('../api/client')
    const existingLumping = {
      schema_version: 1,
      applied_at: '2026-05-16T09:00:00.000Z',
      map: { 'holoceen veen': 'Holoceen' },
    }

    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NEW', name: 'Site A', status: 'active', tags: [] },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
        stratigraphy_lumping: existingLumping,
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)
    ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue(emptyBundle(created))
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site-with-lumping.gmproj')
    })

    // saveProject without any writeLumpingSnapshot call in between.
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockClear()
    await act(async () => {
      await result.current.saveProject()
    })

    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    const [, savedContent] = (
      window.electron.writeProjectFile as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string]
    // The lumping seeded from the file must be in the written bundle.
    expect(savedContent).toContain('"stratigraphy_lumping"')
    expect(savedContent).toContain('"holoceen veen"')
    expect(savedContent).toContain('"Holoceen"')
  })

  // C-5: saveAsProject must carry the lumping into the duplicate's .gmproj.
  //
  // The lumping map is keyed on normalised stratigraphy NAMES (not instance ids),
  // so it remains valid for a duplicated project (same stratigraphy names).
  // Before the fix, buildProjectFile(dupBundle) was called without currentLumping,
  // and a Save-As'd copy silently lost the user's aliases — violating the
  // bundle-is-the-anchor invariant.
  it('C-5: saveAsProject carries stratigraphy_lumping into the duplicate file', async () => {
    const { api } = await import('../api/client')
    const existingLumping = {
      schema_version: 1 as const,
      applied_at: '2026-05-17T09:00:00.000Z',
      map: { 'boom klei': 'Quartair', 'pleistoceen': 'Quartair' },
    }

    // Open a project whose file already has stratigraphy_lumping — this seeds
    // currentLumping so saveAsProject can carry it into the duplicate file.
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 3,
        project: { id: '01k-NEW', name: 'Site A', status: 'active', tags: [] },
        cpts: [],
        boreholes: [],
        geological_formations: [],
        geological_models: [],
        cross_sections: [],
        investigation_reviews: [],
        stratigraphy_lumping: existingLumping,
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockResolvedValue(created)

    // The duplicate DB row returned by POST /projects/{id}/duplicate.
    const duplicated = { ...created, id: '01k-DUP', name: 'Copy of Site A' }
    ;(api.project.duplicate as ReturnType<typeof vi.fn>).mockResolvedValue(duplicated)

    // Bundle for the duplicate — empty project; the lumping is not in the bundle
    // (it lives client-side) so buildProjectFile must add it from currentLumping.
    ;(api.project.bundle as ReturnType<typeof vi.fn>).mockResolvedValue(emptyBundle(duplicated))
    ;(window.electron.showProjectSaveDialog as ReturnType<typeof vi.fn>).mockResolvedValue(
      'C:/Users/robin/copy-of-site-a.gmproj',
    )
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined)

    const { result } = renderHook(() => useProject())
    await act(async () => {
      await result.current.openProjectFile('C:/path/site.gmproj')
    })

    // Clear previous writeProjectFile calls (the open flow doesn't write, but
    // be defensive in case the hook shape changes).
    ;(window.electron.writeProjectFile as ReturnType<typeof vi.fn>).mockClear()

    await act(async () => {
      await result.current.saveAsProject()
    })

    expect(window.electron.writeProjectFile).toHaveBeenCalledTimes(1)
    const [, written] = (
      window.electron.writeProjectFile as ReturnType<typeof vi.fn>
    ).mock.calls[0] as [string, string]

    // The duplicate file must carry the lumping — not null.
    // Before the C-5 fix this assertion would fail because buildProjectFile
    // was called without currentLumping and wrote stratigraphy_lumping: null.
    expect(written).toContain('"stratigraphy_lumping"')
    expect(written).toContain('"boom klei"')
    expect(written).toContain('"Quartair"')
    expect(written).not.toContain('"stratigraphy_lumping": null')
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

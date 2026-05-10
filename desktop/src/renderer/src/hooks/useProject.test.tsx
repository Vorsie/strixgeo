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
    },
  },
}))

beforeEach(async () => {
  // Reset all api.project.* mocks between tests.
  const { api } = await import('../api/client')
  for (const fn of Object.values(api.project)) {
    ;(fn as ReturnType<typeof vi.fn>).mockReset()
  }

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
        format_version: 1,
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

  it('openProjectFile: returns null when the DB row no longer exists', async () => {
    const { api } = await import('../api/client')
    ;(window.electron.readProjectFile as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        format_version: 1,
        id: '01k-MISSING',
        name: 'Ghost',
        project_number: null,
        client: null,
        site_label: null,
        description: null,
        tags: [],
        default_horizontal_epsg: null,
        default_vertical_epsg: null,
        phase: null,
        status: 'active',
      }),
    )
    ;(api.project.get as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('GET /projects/01k-MISSING → 404'),
    )

    const { result } = renderHook(() => useProject())
    let returned: unknown
    await act(async () => {
      returned = await result.current.openProjectFile('C:/path/ghost.gmproj')
    })

    expect(returned).toBeNull()
    expect(result.current.project).toBeNull()
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
})

// Only tests a cross-section draws feed the model (owner ruling 2026-09-23:
// "only don't use tests not on sections for the model"). The backend stales
// every built surface of the project when a section is created, deleted, or
// patched in a way that moves tests on or off it; the hook must tell the app
// (``onSectionsChanged``) so the model hook re-reads the surfaces and the
// "rebuild" badge turns amber without a project reopen.
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { CrossSectionResponse } from '../api/client'
import { useSections } from './useSections'

const mockSectionList = vi.fn()
const mockSectionCreate = vi.fn()
const mockSectionUpdate = vi.fn()
const mockSectionDelete = vi.fn()
vi.mock('../api/client', () => ({
  api: {
    section: {
      list: (...args: unknown[]) => mockSectionList(...args),
      create: (...args: unknown[]) => mockSectionCreate(...args),
      update: (...args: unknown[]) => mockSectionUpdate(...args),
      delete: (...args: unknown[]) => mockSectionDelete(...args),
    },
  },
}))

vi.mock('../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

function makeSection(id: string, name = `Section ${id}`): CrossSectionResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    description: null,
    epsg: 31370,
    start_x: 0,
    start_y: 0,
    end_x: 100,
    end_y: 0,
    projection_buffer_m: 50,
    vertical_exaggeration: 1,
    view_state: null,
    excluded_cpt_ids: [],
    excluded_borehole_ids: [],
    min_depth_m: null,
    max_depth_m: null,
    display_order: 0,
    seeded_formation_contact_ids: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

type Args = Parameters<typeof useSections>[0]

function renderWithSections(existing: CrossSectionResponse[]) {
  mockSectionList.mockResolvedValue(existing)
  const onSectionsChanged = vi.fn()
  const args: Args = {
    project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
    ready: true,
    toast: vi.fn(),
    pushUndo: vi.fn(),
    manifestSectionIds: new Set<string>(),
    addToManifest: vi.fn(),
    removeFromManifest: vi.fn(),
    setSessionImportSectionIds: vi.fn(),
    contacts: [],
    lithoContacts: [],
    hasLithoModel: false,
    hasGeotechModel: false,
    boreholes: [],
    cpts: [],
    setSelectedId: vi.fn(),
    setSelectedBoreholeId: vi.fn(),
    onSectionsChanged,
  }
  const rendered = renderHook(() => useSections(args))
  return { ...rendered, onSectionsChanged }
}

const flush = async (): Promise<void> => {
  await act(async () => {
    await new Promise(r => setTimeout(r, 0))
  })
}

beforeEach(() => {
  mockSectionList.mockReset()
  mockSectionCreate.mockReset()
  mockSectionUpdate.mockReset()
  mockSectionDelete.mockReset()
})

describe('useSections — a section change tells the app the model membership moved', () => {
  it('SC1 — drawing a section fires onSectionsChanged once the backend has it', async () => {
    mockSectionCreate.mockResolvedValue(makeSection('sec-new'))
    const { result, onSectionsChanged } = renderWithSections([])
    await flush()
    await act(async () => {
      await result.current.handleSectionLineDrawn({ lat: 51.0, lng: 4.4 }, { lat: 51.0, lng: 4.41 })
    })
    expect(mockSectionCreate).toHaveBeenCalledTimes(1)
    expect(onSectionsChanged).toHaveBeenCalledTimes(1)
  })

  it('SC2 — a corridor patch fires it; a rename does not', async () => {
    const existing = makeSection('sec-1')
    mockSectionUpdate.mockImplementation(
      (_p: string, id: string, patch: Partial<CrossSectionResponse>) =>
        Promise.resolve({ ...existing, id, ...patch }),
    )
    const { result, onSectionsChanged } = renderWithSections([existing])
    await flush()
    act(() => result.current.handleSelectSection('sec-1'))
    await act(async () => {
      await result.current.handlePatchSelectedSection({ name: 'Renamed' })
    })
    expect(mockSectionUpdate).toHaveBeenCalledTimes(1)
    expect(onSectionsChanged).not.toHaveBeenCalled()
    await act(async () => {
      await result.current.handlePatchSelectedSection({ projection_buffer_m: 80 })
    })
    expect(onSectionsChanged).toHaveBeenCalledTimes(1)
    await act(async () => {
      await result.current.handlePatchSelectedSection({ excluded_cpt_ids: ['cpt-9'] })
    })
    expect(onSectionsChanged).toHaveBeenCalledTimes(2)
  })

  it('SC3 — deleting a section fires it', async () => {
    mockSectionDelete.mockResolvedValue(undefined)
    const { result, onSectionsChanged } = renderWithSections([makeSection('sec-1')])
    await flush()
    await act(async () => {
      await result.current.handleDeleteSection('sec-1')
    })
    expect(mockSectionDelete).toHaveBeenCalledTimes(1)
    expect(onSectionsChanged).toHaveBeenCalledTimes(1)
  })

  it('SC4 — a failed create fires nothing', async () => {
    mockSectionCreate.mockRejectedValue(new Error('boom'))
    const { result, onSectionsChanged } = renderWithSections([])
    await flush()
    await act(async () => {
      await result.current.handleSectionLineDrawn({ lat: 51.0, lng: 4.4 }, { lat: 51.0, lng: 4.41 })
    })
    expect(onSectionsChanged).not.toHaveBeenCalled()
  })
})

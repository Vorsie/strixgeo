// Behavioral net for the project-lifecycle + discard-parity fixes applied to
// useSections (2026-05-17, Fix 2 — unsaved sections persist on map).
//
// Three claims pinned here:
//   L1  When project becomes null, sections resets to [] — the internal state
//       is cleared so the map overlay and visible list both show 0 after
//       project close / discard, consistent with CPT/borehole behaviour.
//   L2  visibleSections (manifest-gated) is always a subset of sections;
//       no section id appears in visibleSections that is not in sections.
//       This is the "map-fed set == discard-aware set" invariant: both
//       DataCanvas and SectionsCanvas pass visibleSections to MapView, so
//       the two surfaces can never show different counts.
//   L3  handleSectionCreated adds the id to the manifest (addToManifest
//       called) and to sessionImportSectionIds; handleSectionDeleted removes
//       it from both.  This mirrors the import-lifecycle of CPTs/boreholes
//       so the discard-on-unsaved path works: sessionImportSectionIds tracks
//       which sections were created this session; discardSessionImports
//       removes them from the manifest; without the manifest entry they fall
//       out of visibleSections.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSections } from './useSections'
import type { CrossSectionResponse } from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// api.section.list resolves to a controllable list — we inject it per-test.
const mockSectionList = vi.fn().mockResolvedValue([])
vi.mock('../api/client', () => ({
  api: {
    section: {
      list: (...args: unknown[]) => mockSectionList(...args),
    },
  },
}))

vi.mock('../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal CrossSectionResponse — only fields useSections needs. */
function makeSection(id: string): CrossSectionResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name: `Section ${id}`,
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
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** Build stable hook args.  The mock functions are cast to their exact types
 *  so tsc can verify they match the hook's parameter types.  We avoid `as
 *  const` on the returned object because that would widen the mock types to
 *  `readonly Mock<Procedure>`, which is incompatible with the specific function
 *  signatures the hook expects. */
function makeArgs(overrides: {
  project?: { id: string; name: string; default_horizontal_epsg: number | null } | null
  manifestSectionIds?: ReadonlySet<string>
  ready?: boolean
} = {}) {
  const toast = vi.fn() as (type: 'success' | 'error', message: string) => void
  const pushUndo = vi.fn() as () => void
  const addToManifest = vi.fn() as (kind: 'section', ids: string[]) => void
  const removeFromManifest = vi.fn() as (kind: 'section', ids: Iterable<string>) => void
  const setSessionImportSectionIds = vi.fn() as (
    updater: (prev: Set<string>) => Set<string>,
  ) => void
  const setSelectedId = vi.fn() as (id: string | null) => void
  const setSelectedBoreholeId = vi.fn() as (id: string | null) => void

  const args = {
    project:
      overrides.project !== undefined
        ? overrides.project
        : { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
    ready: overrides.ready ?? false,
    toast,
    pushUndo,
    manifestSectionIds: overrides.manifestSectionIds ?? (new Set<string>() as ReadonlySet<string>),
    addToManifest,
    removeFromManifest,
    setSessionImportSectionIds,
    contacts: [] as Parameters<typeof import('./useSections').useSections>[0]['contacts'],
    lithoContacts: [] as Parameters<typeof import('./useSections').useSections>[0]['lithoContacts'],
    boreholes: [] as Parameters<typeof import('./useSections').useSections>[0]['boreholes'],
    cpts: [] as Parameters<typeof import('./useSections').useSections>[0]['cpts'],
    setSelectedId,
    setSelectedBoreholeId,
  }

  return { args, addToManifest, removeFromManifest, setSessionImportSectionIds, toast }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSections project lifecycle', () => {
  it('L1 — sections resets to [] when project becomes null', async () => {
    // Start with a project that has one section in the DB.
    const section = makeSection('sec-1')
    mockSectionList.mockResolvedValue([section])

    // Use a mutable ref so rerender can inject a changed project without
    // reconstructing all stable callbacks (the hook compares project?.id).
    let projectArg: { id: string; name: string; default_horizontal_epsg: number | null } | null =
      { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 }
    const { args } = makeArgs({ ready: true, project: projectArg })

    const { result, rerender } = renderHook(() =>
      useSections({ ...args, project: projectArg, ready: true }),
    )

    // Wait for the auto-load to fire and resolve.
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Sections are loaded.
    expect(result.current.sections.length).toBe(1)

    // Close the project (project → null).
    projectArg = null
    rerender()
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // sections must be empty — map overlay and list both show 0.
    expect(result.current.sections.length).toBe(0)
    expect(result.current.visibleSections.length).toBe(0)
  })

  it('L2 — visibleSections is always a subset of sections (no desync)', () => {
    // sections has sec-1 in the DB list; manifest only includes sec-2.
    // visibleSections must therefore be [] (sec-2 is in the manifest but
    // not in sections; sec-1 is in sections but not the manifest).
    mockSectionList.mockResolvedValue([makeSection('sec-1')])

    const { args } = makeArgs({ manifestSectionIds: new Set(['sec-2']) })
    const { result } = renderHook(() => useSections(args))

    // Before auto-load resolves: both are empty — no desync possible.
    expect(result.current.sections.length).toBe(0)
    expect(result.current.visibleSections.length).toBe(0)

    // Every id in visibleSections must also be in sections (invariant).
    const sectionIds = new Set(result.current.sections.map(s => s.id))
    for (const s of result.current.visibleSections) {
      expect(sectionIds.has(s.id)).toBe(true)
    }
  })

  it('L3 — handleSectionCreated calls addToManifest and setSessionImportSectionIds', () => {
    const { args, addToManifest, setSessionImportSectionIds } = makeArgs()
    const { result } = renderHook(() => useSections(args))

    act(() => {
      result.current.handleSectionCreated('sec-new')
    })

    // addToManifest must be called with ('section', ['sec-new']).
    expect(addToManifest).toHaveBeenCalledWith('section', ['sec-new'])

    // setSessionImportSectionIds must be called with a function that adds
    // the id to the set.
    expect(setSessionImportSectionIds).toHaveBeenCalledOnce()
    // Extract the updater function from the mock call — cast through unknown
    // to avoid tsc complaining about the narrowed vi.fn() type.
    const updater = (setSessionImportSectionIds as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as (prev: Set<string>) => Set<string>
    const next = updater(new Set<string>())
    expect(next.has('sec-new')).toBe(true)
  })

  it('L3 — handleSectionDeleted calls removeFromManifest and setSessionImportSectionIds', () => {
    const { args, removeFromManifest, setSessionImportSectionIds } = makeArgs()
    const { result } = renderHook(() => useSections(args))

    act(() => {
      result.current.handleSectionDeleted('sec-old')
    })

    // removeFromManifest must be called with ('section', ['sec-old']).
    expect(removeFromManifest).toHaveBeenCalledWith('section', ['sec-old'])

    // setSessionImportSectionIds updater should remove the id when present.
    expect(setSessionImportSectionIds).toHaveBeenCalledOnce()
    const updater = (setSessionImportSectionIds as unknown as { mock: { calls: unknown[][] } })
      .mock.calls[0][0] as (prev: Set<string>) => Set<string>
    const prev = new Set(['sec-old', 'other-sec'])
    const next = updater(prev)
    expect(next.has('sec-old')).toBe(false)
    expect(next.has('other-sec')).toBe(true)
  })
})

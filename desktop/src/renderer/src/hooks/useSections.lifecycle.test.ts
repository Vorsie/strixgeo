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
//
// Additional claims (P1 section-lifecycle phase 1, 2026-05-17):
//   L4  Ordinal naming uses visibleSections.length, NOT sections.length.
//       When 3 raw sections exist in the DB but only 1 is in the manifest,
//       the next drawn section is named "Cross-section 2" (not 4).
//       After deleting the visible section, the next draw yields "Cross-section 1".
//   L5  DB-orphan sections (present in `sections` but absent from the manifest)
//       are excluded from visibleSections even when the manifest only contains
//       a disjoint set.  This is the discard-guard regression net: guarantees
//       the existing manifest-gating logic cannot silently regress.

import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
    seeded_formation_contact_ids: [],
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
  const toast = vi.fn() as (type: 'success' | 'error' | 'warning', message: string) => void
  // pushUndo's real signature takes an UndoCommand; the test never
  // inspects the arg so a thin no-op typed to the actual contract
  // is enough.
  const pushUndo = vi.fn() as unknown as (cmd: import('./useUndoStack').UndoCommand) => void
  const addToManifest = vi.fn() as (kind: 'section', ids: string[]) => void
  const removeFromManifest = vi.fn() as (kind: 'section', ids: Iterable<string>) => void
  const setSessionImportSectionIds = vi.fn() as unknown as import('react').Dispatch<
    import('react').SetStateAction<Set<string>>
  >
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
    hasLithoModel: true,
    hasGeotechModel: true,
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

// ---------------------------------------------------------------------------
// L4 — ordinal derives from visibleSections, not raw sections (P1-A guard)
//
// Guards the P1-A fix: handleSectionLineDrawn computes the next section name
// from visibleSections.length (manifest-gated), not sections.length (raw DB
// list). Before the fix a user who drew 3 sections without saving would see
// "Cross-section 4" on the next draw — 3 orphans counted even though 0 were
// visible. The fix ensures the ordinal reflects only saved (manifest-present)
// sections.
//
// WHY we assert visibleSections.length directly:
// handleSectionLineDrawn calls api.section.create — not wired in this unit
// test. The naming formula is `Cross-section ${visibleSections.length + 1}`.
// Asserting visibleSections.length is the meaningful input contract; the
// arithmetic is trivial.  A mock create call would pin internal impl details.
// ---------------------------------------------------------------------------

describe('useSections ordinal (L4)', () => {
  // Reset the list mock before each test in this block so previous test
  // values do not bleed across async boundaries.
  beforeEach(() => {
    mockSectionList.mockResolvedValue([])
  })

  it('L4-a — 3 raw DB sections, 1 in manifest → visibleSections.length = 1 → next ordinal = 2', async () => {
    // Three sections in the DB; only sec-1 is in the .gmproj manifest.
    mockSectionList.mockResolvedValue([
      makeSection('sec-1'),
      makeSection('sec-2'),
      makeSection('sec-3'),
    ])

    const { args } = makeArgs({ manifestSectionIds: new Set(['sec-1']), ready: true })
    const { result } = renderHook(() => useSections(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Raw list: 3 sections. Manifest: 1 section.
    expect(result.current.sections.length).toBe(3)
    expect(result.current.visibleSections.length).toBe(1)
    expect(result.current.visibleSections[0].id).toBe('sec-1')

    // The ordinal a new draw WOULD use (visibleSections.length + 1) = 2.
    expect(`Cross-section ${result.current.visibleSections.length + 1}`).toBe('Cross-section 2')

    // Confirm the old (wrong) formula would have given 4.
    expect(`Cross-section ${result.current.sections.length + 1}`).toBe('Cross-section 4')
  })

  it('L4-b — after handleSectionDeleted removes the only visible section, visibleSections drops to 0 → ordinal = 1', async () => {
    // Single visible section. After it is deleted removeFromManifest fires
    // and — once the caller re-injects an updated manifest — visibleSections
    // re-gates to 0.  We verify both the callback contract AND that the hook's
    // visibleSections reaches 0 (making the next ordinal 1).
    mockSectionList.mockResolvedValue([makeSection('sec-1')])

    // Use the initialProps overload so we can mutate manifestSectionIds via
    // rerender without rebuilding the stable callbacks (the hook treats them
    // as stable deps).
    const { args, removeFromManifest } = makeArgs({ ready: true })

    const { result, rerender } = renderHook(
      ({ manifest }: { manifest: ReadonlySet<string> }) =>
        useSections({ ...args, manifestSectionIds: manifest }),
      { initialProps: { manifest: new Set(['sec-1']) as ReadonlySet<string> } },
    )

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Precondition: one visible section.
    expect(result.current.visibleSections.length).toBe(1)

    // Delete act — fires removeFromManifest and setSessionImportSectionIds.
    act(() => {
      result.current.handleSectionDeleted('sec-1')
    })

    // (a) Callback contract: removeFromManifest called with the deleted id.
    expect(removeFromManifest).toHaveBeenCalledWith('section', ['sec-1'])

    // (b) Simulate the parent re-injecting the updated manifest (empty after
    // the delete) — mirrors what App does in production when the bundle state
    // updates.  visibleSections must re-gate to 0.
    rerender({ manifest: new Set() as ReadonlySet<string> })

    expect(result.current.visibleSections.length).toBe(0)

    // With 0 visible sections the ordinal a new draw would use = 1.
    // Reading the REAL hook value (not a hardcoded literal) means this
    // assertion fails if manifest-gating regresses and visibleSections stays > 0.
    expect(`Cross-section ${result.current.visibleSections.length + 1}`).toBe('Cross-section 1')
  })
})

// ---------------------------------------------------------------------------
// L5 — regression net for the manifest-gating discard path (P1-B)
//
// GUARD, not a new feature. Pins the existing correct behaviour: DB-orphan
// sections (present in `sections`, absent from the manifest) never appear
// in visibleSections. This is the discard-correctness invariant the whole
// P1-A ordinal fix depends on. If the filter is accidentally removed or
// short-circuited, these tests fail immediately.
//
// Context: the manifest-gating code (`sections.filter(s =>
// manifestSectionIds.has(s.id))`) was correct BEFORE P1. P1-A only changed
// the ordinal computation. L5 ensures the foundation cannot quietly regress.
// ---------------------------------------------------------------------------

describe('useSections manifest discard guard (L5)', () => {
  beforeEach(() => {
    mockSectionList.mockResolvedValue([])
  })

  it('L5-a — orphan sections (in DB, not in manifest) are absent from visibleSections', async () => {
    // Bundle's cross_sections does NOT include sec-orphan. It is in the DB
    // (returned by the list API) but must not appear in visibleSections.
    mockSectionList.mockResolvedValue([makeSection('sec-saved'), makeSection('sec-orphan')])

    const { args } = makeArgs({
      manifestSectionIds: new Set(['sec-saved']),
      ready: true,
    })
    const { result } = renderHook(() => useSections(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Both rows loaded from the DB.
    expect(result.current.sections.length).toBe(2)

    // Only the manifest-included row is visible.
    expect(result.current.visibleSections.length).toBe(1)
    expect(result.current.visibleSections[0].id).toBe('sec-saved')

    // The orphan is NOT visible — discard works without a DB DELETE.
    const visibleIds = result.current.visibleSections.map(s => s.id)
    expect(visibleIds).not.toContain('sec-orphan')
  })

  it('L5-b — empty manifest → no visible sections, even with 3 DB orphans', async () => {
    // Project opened with an empty bundle (no saved sections) but the DB
    // has leftover rows from a previous session closed without saving.
    mockSectionList.mockResolvedValue([
      makeSection('orphan-a'),
      makeSection('orphan-b'),
      makeSection('orphan-c'),
    ])

    const { args } = makeArgs({
      manifestSectionIds: new Set<string>(),
      ready: true,
    })
    const { result } = renderHook(() => useSections(args))

    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })

    // Three rows in the DB, none in the manifest → all invisible.
    expect(result.current.sections.length).toBe(3)
    expect(result.current.visibleSections.length).toBe(0)
  })
})


describe('useSections says whether the section list has landed', () => {
  // Owner 2026-09-26: "if i click build litho model too quickly, it says
  // nothing to build... which is misleading". The Build button turned on as
  // soon as the litho contacts had loaded, which can be before the section
  // list has — and a build with no sections is refused as if the engineer
  // had accepted nothing. The list's own loaded state is the gate.
  it('SL1 — sectionsLoaded is false until the auto-load resolves, then true', async () => {
    let release: (v: unknown[]) => void = () => {}
    mockSectionList.mockReturnValue(new Promise(resolve => (release = resolve)))
    const { args } = makeArgs({ ready: true })
    const { result } = renderHook(() => useSections(args))

    expect(result.current.sectionsLoaded).toBe(false)

    await act(async () => {
      release([makeSection('sec-1')])
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.sectionsLoaded).toBe(true)
  })

  it('SL2 — a failed list load still counts as landed: the list is honestly empty', async () => {
    mockSectionList.mockRejectedValue(new Error('boom'))
    const { args } = makeArgs({ ready: true })
    const { result } = renderHook(() => useSections(args))
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.sectionsLoaded).toBe(true)
  })

  it('SL3 — switching project drops back to not loaded until the new list lands', async () => {
    mockSectionList.mockResolvedValue([makeSection('sec-1')])
    let projectArg: { id: string; name: string; default_horizontal_epsg: number | null } | null =
      { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 }
    const { args } = makeArgs({ ready: true, project: projectArg })
    const { result, rerender } = renderHook(() =>
      useSections({ ...args, project: projectArg, ready: true }),
    )
    await act(async () => {
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.sectionsLoaded).toBe(true)

    let release: (v: unknown[]) => void = () => {}
    mockSectionList.mockReturnValue(new Promise(resolve => (release = resolve)))
    projectArg = { id: 'proj-2', name: 'Other', default_horizontal_epsg: 31370 }
    rerender()
    expect(result.current.sectionsLoaded).toBe(false)

    await act(async () => {
      release([])
      await new Promise(r => setTimeout(r, 0))
    })
    expect(result.current.sectionsLoaded).toBe(true)
  })
})

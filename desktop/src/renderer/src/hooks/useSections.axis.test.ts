// Behavioral net for the slice-2 (#55) axis-routing additions to useSections.
//
// Three claims pinned here:
//   A1  handleFocusContacts with axis='geological' searches `contacts`,
//       not `lithoContacts` — a contact ID that exists only in lithoContacts
//       falls through to the "couldn't find the contact" toast.
//   A2  handleFocusContacts with axis='lithostratigraphic' searches
//       `lithoContacts`, not `contacts` — a contact ID that exists only
//       in `contacts` falls through to the toast.
//   A3  sectionModelAxis defaults to 'geological'; setSectionModelAxis
//       updates it and the subsequent handleFocusContacts call uses the
//       new value.
//
// No mock needed for projectPointOntoLine or wgs84ToProjected —
// we drive the "not found in active set" path (toast fired) which
// short-circuits before any geometry is computed.

import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { useSections } from './useSections'
import type { FormationContactResponse } from '../api/client'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

// api.section.list resolves to an empty array — no network in unit tests.
vi.mock('../api/client', () => ({
  api: {
    section: {
      list: vi.fn().mockResolvedValue([]),
    },
  },
}))

// log is a no-op in tests.
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

/** Minimal FormationContactResponse — only fields useSections reads. */
function makeContact(id: string): FormationContactResponse {
  return {
    id,
    model_id: 'model-geo',
    formation_id: 'form-1',
    borehole_id: 'bh-1',
    cpt_id: null,
    depth_top_m: 1.0,
    source: 'manual_pick',
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** Stable hook args factory — overrides via spread. */
function makeArgs(overrides: {
  contacts?: FormationContactResponse[]
  lithoContacts?: FormationContactResponse[]
} = {}) {
  const toast = vi.fn()
  const pushUndo = vi.fn()
  const addToManifest = vi.fn()
  const removeFromManifest = vi.fn()
  const setSessionImportSectionIds = vi.fn()
  const setSelectedId = vi.fn()
  const setSelectedBoreholeId = vi.fn()

  return {
    args: {
      project: { id: 'proj-1', name: 'Test', default_horizontal_epsg: 31370 },
      ready: false,          // keeps auto-load from firing
      toast,
      pushUndo,
      manifestSectionIds: new Set<string>(),
      addToManifest,
      removeFromManifest,
      setSessionImportSectionIds,
      contacts: overrides.contacts ?? [],
      lithoContacts: overrides.lithoContacts ?? [],
      boreholes: [],
      cpts: [],
      setSelectedId,
      setSelectedBoreholeId,
    } as const,
    toast,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useSections axis routing (slice 2, #55)', () => {
  it('A1 — geological axis: searches contacts; misses contact only in lithoContacts', async () => {
    const geoContact = makeContact('geo-c1')
    const lithoContact = makeContact('litho-c1')
    const { args, toast } = makeArgs({
      contacts: [geoContact],
      lithoContacts: [lithoContact],
    })

    const { result } = renderHook(() => useSections(args))

    // Default axis is 'geological' — a search for litho-c1 should NOT find
    // it in `contacts`, so the "couldn't find" toast fires.
    expect(result.current.sectionModelAxis).toBe('geological')

    act(() => {
      result.current.handleFocusContacts(['litho-c1'])
    })

    expect(toast).toHaveBeenCalledWith(
      'error',
      "Couldn't find the contact in the current project.",
    )
  })

  it('A2 — lithostratigraphic axis: searches lithoContacts; misses contact only in contacts', async () => {
    const geoContact = makeContact('geo-c1')
    const lithoContact = makeContact('litho-c1')
    const { args, toast } = makeArgs({
      contacts: [geoContact],
      lithoContacts: [lithoContact],
    })

    const { result } = renderHook(() => useSections(args))

    // Switch to the litho axis.
    act(() => {
      result.current.setSectionModelAxis('lithostratigraphic')
    })
    expect(result.current.sectionModelAxis).toBe('lithostratigraphic')

    // A search for geo-c1 should NOT find it in `lithoContacts`, so toast fires.
    act(() => {
      result.current.handleFocusContacts(['geo-c1'])
    })

    expect(toast).toHaveBeenCalledWith(
      'error',
      "Couldn't find the contact in the current project.",
    )
  })

  it('A3 — setSectionModelAxis updates state; subsequent handleFocusContacts uses new axis', () => {
    const geoContact = makeContact('geo-c1')
    const lithoContact = makeContact('litho-c1')
    const { args, toast } = makeArgs({
      contacts: [geoContact],
      lithoContacts: [lithoContact],
    })

    const { result } = renderHook(() => useSections(args))

    // Initially geological — geo-c1 found (no toast from "not found");
    // geo-c1 exists in contacts but there's no section, so the
    // "no cross-section contains" toast fires (different message).
    act(() => {
      result.current.handleFocusContacts(['geo-c1'])
    })
    // Should NOT hit "couldn't find" — the contact WAS found in the set.
    expect(toast).not.toHaveBeenCalledWith(
      'error',
      "Couldn't find the contact in the current project.",
    )

    toast.mockClear()

    // Switch to litho axis — now geo-c1 is not in lithoContacts.
    act(() => {
      result.current.setSectionModelAxis('lithostratigraphic')
    })

    act(() => {
      result.current.handleFocusContacts(['geo-c1'])
    })
    // Now geo-c1 is absent from lithoContacts → "couldn't find" toast.
    expect(toast).toHaveBeenCalledWith(
      'error',
      "Couldn't find the contact in the current project.",
    )
  })
})

// ---------------------------------------------------------------------------
// #156 — "Edit in Geology stage" deep-link axis override.
//
// The deep-link fires from the LITHO axis (the user right-clicked a geological
// backdrop contact there) but hands handleFocusContacts a GEOLOGICAL contact
// id. With the plain axis-gate (A2/A3 above) that lookup searches lithoContacts
// and misses → the "Couldn't find the contact" toast (the twin toasts the owner
// saw in the 2026-05-28 dogfeed). The fix is an explicit axis override: the
// caller states the axis the contact id belongs to, so the geological contact
// resolves regardless of which axis the section is currently showing. This is
// the DELIBERATE exception to the A2/A3 axis-gate, not a removal of it.
// ---------------------------------------------------------------------------

describe('useSections handleFocusContacts axis override (#156)', () => {
  it('DL1 — resolves a geological contact via an explicit geological override while the litho axis is active (no "couldn\'t find" toast)', () => {
    const geoContact = makeContact('geo-c1')
    const lithoContact = makeContact('litho-c1')
    const { args, toast } = makeArgs({
      contacts: [geoContact],
      lithoContacts: [lithoContact],
    })

    const { result } = renderHook(() => useSections(args))

    // The user is on the litho axis (the axis "Edit in Geology stage" fires from).
    act(() => {
      result.current.setSectionModelAxis('lithostratigraphic')
    })
    expect(result.current.sectionModelAxis).toBe('lithostratigraphic')

    // Focus the geological contact, but state that it lives on the GEOLOGICAL
    // axis via the third argument. It must be FOUND (in `contacts`) despite the
    // litho axis being active, so the "couldn't find" toast must NOT fire.
    act(() => {
      result.current.handleFocusContacts(['geo-c1'], undefined, 'geological')
    })

    expect(toast).not.toHaveBeenCalledWith(
      'error',
      "Couldn't find the contact in the current project.",
    )
  })
})

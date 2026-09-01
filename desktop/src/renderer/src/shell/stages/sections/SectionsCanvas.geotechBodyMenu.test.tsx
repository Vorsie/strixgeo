// The body menu comes to the geotech axis (owner ruling 2026-08-31, piece B):
// "right click a body give me statistics, name unit, … dissolve body …
// shouldn't we be able to do this in the geotech stage" — RULED yes.
//
// SectionsCanvas hands SectionPanel the body-menu handlers on the GEOTECH axis,
// not the litho axis alone — WITHOUT handing over any contact-edit handler (the
// axis stays view-only for editing; only the body MENU crosses over). The control
// is the litho axis, which keeps them.
//
// Body-verb simplification (owner 2026-09-01 "way too complicated"): Separate /
// Rejoin were removed entirely — no axis is handed onSeparateBodies / onRejoinBody
// / separations any more. Only Name / Dissolve (both axes) + Join / Ontkoppelen
// (geotech only) survive.
//
// GBW1 — on the geotech axis, Name / Dissolve are handed over; Separate / Rejoin
//        are NOT (removed).
// GBW2 — the contact-edit handlers stay withheld on the geotech axis (view-only).
// GBW3 — the litho axis keeps Name / Dissolve; Separate / Rejoin are gone there too.

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

/** Captures SectionPanel's whole prop bag, so handler gating is observable. */
let capturedPanelProps: Record<string, unknown> = {}

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: Record<string, unknown>) => {
    capturedPanelProps = props
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        listGeotechPackingCorrelations: vi.fn().mockResolvedValue([]),
        // The geotech body roster + separations + unions the piece-B / Join fetch reads.
        listLenses: vi.fn().mockResolvedValue([]),
        listBodySeparations: vi.fn().mockResolvedValue([]),
        listBodyUnions: vi.fn().mockResolvedValue([]),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

function renderOn(axis: 'geotechnical' | 'lithostratigraphic'): void {
  const ctx = makeShellCtx(axis)
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsCanvas />
    </ShellContext.Provider>,
  )
}

describe('SectionsCanvas — the body menu comes to the geotech axis (piece B)', () => {
  beforeEach(() => {
    capturedPanelProps = {}
  })

  afterEach(() => {
    cleanup()
  })

  it('GBW1 — the geotech axis gets Name / Dissolve; Separate / Rejoin are removed', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onNameBody).toBeDefined()
    expect(capturedPanelProps.onDissolveBody).toBeDefined()
    // The simplification pin (owner 2026-09-01): Separate / Rejoin are gone.
    expect(capturedPanelProps.onSeparateBodies).toBeUndefined()
    expect(capturedPanelProps.onRejoinBody).toBeUndefined()
    expect(capturedPanelProps.separations).toBeUndefined()
  })

  it('GBW2 — the geotech axis still hands over NO contact-edit handler', () => {
    renderOn('geotechnical')

    // The body menu was added without loosening the view-only editing gate.
    expect(capturedPanelProps.onDeleteContact).toBeUndefined()
    expect(capturedPanelProps.onBatchUpdateContacts).toBeUndefined()
    expect(capturedPanelProps.onBatchCreateContacts).toBeUndefined()
  })

  it('GBW3 — the litho axis keeps Name / Dissolve; Separate / Rejoin are gone', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onNameBody).toBeDefined()
    expect(capturedPanelProps.onDissolveBody).toBeDefined()
    expect(capturedPanelProps.onSeparateBodies).toBeUndefined()
    expect(capturedPanelProps.onRejoinBody).toBeUndefined()
  })

  // Debt #278 — the "Join with…" verb is handed over on the GEOTECH axis ONLY
  // (owner: he would not use it on litho). The no-affordance rule + this gating
  // are what keep Join off the litho axis.
  it('JBW1 — the geotech axis is handed the Join handlers + unions', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onJoinBodies).toBeDefined()
    expect(capturedPanelProps.onDisjoinBody).toBeDefined()
    expect(capturedPanelProps.unions).toBeDefined()
    expect(capturedPanelProps.onJoinNotice).toBeDefined()
  })

  it('JBW2 — the litho axis is NOT handed the Join props (geotech-only verb)', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onJoinBodies).toBeUndefined()
    expect(capturedPanelProps.onDisjoinBody).toBeUndefined()
    expect(capturedPanelProps.unions).toBeUndefined()
    expect(capturedPanelProps.onJoinNotice).toBeUndefined()
  })
})

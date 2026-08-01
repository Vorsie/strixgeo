// Dedupe on the Geology toolbar must ask before it deletes.
//
// The code always believed it did: useGeologicalModelOps.ts justified skipping
// the undo stack because Dedupe is "an explicit clean up old data action with a
// confirmation dialog". The dialog was never built — the button called the API
// straight through — so one click permanently deleted formation contacts,
// including hand-placed ones, with no dialog and no undo.
//
// The rule these pin, in the owner's words: a destructive action confirms first,
// cancelling does nothing at all, and only confirming goes through.
//
//   D1  clicking Dedupe opens the confirmation and deletes nothing yet
//   D2  cancelling deletes nothing and closes the dialog
//   D3  confirming runs the cleanup
//   D4  the dialog says how many contacts the run will remove

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import { makeShellCtx } from '../sections/__fixtures__/sectionsShellContext'
import GeologyToolbar from './GeologyToolbar'

// ---------------------------------------------------------------------------
// Module mocks — the toolbar reaches the API only through the bus handlers, but
// its import graph (GeologyCanvas) pulls the client in.
// ---------------------------------------------------------------------------

vi.mock('../../../api/client', async () => {
  const actual =
    await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
    },
  }
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeGeoModel(): GeologicalModelResponse {
  return {
    id: 'model-geo-1',
    app_project_id: 'proj-1',
    name: 'Default',
    description: null,
    is_active: true,
    excluded_borehole_ids: [],
    kind: 'geological',
    parent_model_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/** A borehole-anchored contact on (borehole, formation). */
function makeContact(
  id: string,
  boreholeId: string,
  formationId: string,
): FormationContactResponse {
  return {
    id,
    model_id: 'model-geo-1',
    formation_id: formationId,
    borehole_id: boreholeId,
    cpt_id: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: 2,
    source: 'manual_pick',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Shell context with an active geological model, so the Dedupe verb is enabled.
 *
 * @param dedupe   The cleanup handler the toolbar is expected NOT to call
 *                 before the user confirms.
 * @param contacts The model's contacts — what the count is computed from.
 */
function makeCtx(
  dedupe: () => Promise<number>,
  contacts: FormationContactResponse[] = [],
): ShellContextValue {
  const base = makeShellCtx('geological')
  return {
    ...base,
    geoModel: {
      ...base.geoModel,
      activeGeologicalModel: makeGeoModel(),
      contacts,
      handleDedupeContacts: dedupe,
    },
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Geology toolbar — Dedupe confirmation', () => {
  it('D1 — clicking Dedupe opens the confirmation and deletes nothing yet', async () => {
    const dedupe = vi.fn().mockResolvedValue(0)
    render(
      <ShellContext.Provider value={makeCtx(dedupe)}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /dedupe/i }))
    expect(
      document.body.querySelector('[data-testid="dedupe-contacts-confirm-dialog"]'),
    ).not.toBeNull()
    // Nothing has been deleted — the whole point of the gate.
    expect(dedupe).not.toHaveBeenCalled()
  })

  it('D2 — cancelling deletes nothing and closes the dialog', () => {
    const dedupe = vi.fn().mockResolvedValue(0)
    render(
      <ShellContext.Provider value={makeCtx(dedupe)}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /dedupe/i }))
    fireEvent.click(screen.getByTestId('dedupe-contacts-cancel'))
    expect(dedupe).not.toHaveBeenCalled()
    expect(
      document.body.querySelector('[data-testid="dedupe-contacts-confirm-dialog"]'),
    ).toBeNull()
  })

  it('D3 — confirming runs the cleanup', async () => {
    const dedupe = vi.fn().mockResolvedValue(2)
    render(
      <ShellContext.Provider value={makeCtx(dedupe)}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /dedupe/i }))
    fireEvent.click(screen.getByTestId('dedupe-contacts-confirm'))
    await vi.waitFor(() => expect(dedupe).toHaveBeenCalledOnce())
  })

  it('D4 — the dialog says how many contacts the run will remove', () => {
    // Two picks of formation f-1 on bh-1 → one of them goes. The third contact
    // is a different formation on the same borehole and is not at risk.
    const dedupe = vi.fn().mockResolvedValue(1)
    const contacts = [
      makeContact('c1', 'bh-1', 'f-1'),
      makeContact('c2', 'bh-1', 'f-1'),
      makeContact('c3', 'bh-1', 'f-2'),
    ]
    render(
      <ShellContext.Provider value={makeCtx(dedupe, contacts)}>
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    fireEvent.click(screen.getByRole('button', { name: /dedupe/i }))
    const count = document.body.querySelector('[data-testid="dedupe-contacts-count"]')
    expect(count?.textContent).toContain('1 contact ')
  })
})

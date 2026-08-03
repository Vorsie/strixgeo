/**
 * "Fill from boreholes" must ask before it removes anything.
 *
 * The incident (2026-08-03, owner's live project): opening Fill to ADD one
 * geological unit deleted four saved ones and blanked a 13-entry lumping map.
 * Nothing asked; nothing warned; the units were simply gone.
 *
 * The owner's ruling, verbatim intent: on Apply, "just prompt the user, add to
 * existing model or overwrite model".
 *
 * Rules pinned here:
 *   P1  a pure addition applies straight away — no dialog for the harmless case
 *   P2  a selection that leaves existing units out asks first, and applies
 *       nothing until answered
 *   P3  "Add to model" applies additively
 *   P4  "Overwrite model" applies destructively AND the copy names the units
 *       that die
 *   P5  Cancel applies nothing
 */

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type {
  FormationContactResponse,
  GeologicalFormationResponse,
  GeologicalModelResponse,
} from '../../../api/client'
import type { FormationCandidate } from '../../../hooks/useGeologicalModel'
import { makeShellCtx } from '../sections/__fixtures__/sectionsShellContext'
import GeologyToolbar from './GeologyToolbar'

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

function makeFormation(id: string, name: string): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#000',
    code: null,
    display_order: 0,
    pinned_order: false,
    regional_ref: null,
    description: null,
    lithology: null,
    nad_class: null,
    parent_formation_id: null,
    litho_main_soil_code: null,
    litho_admixtures: null,
    instance_ordinal: null,
    instance_ordinal_locked: false,
    parent_formation_name: null,
    parent_extrapolated: false,
    source_litho_formation_id: null,
    source_geo_formation_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as GeologicalFormationResponse
}

function makeContact(id: string, formationId: string): FormationContactResponse {
  return {
    id,
    model_id: 'model-geo-1',
    formation_id: formationId,
    borehole_id: 'bh-1',
    cpt_id: null,
    synthetic_x: null,
    synthetic_y: null,
    synthetic_elevation_m: null,
    depth_top_m: 2,
    source: 'borehole_observation',
    confidence: 'high',
    observation_id: null,
    observation_layer_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  } as FormationContactResponse
}

interface CtxOptions {
  candidates: FormationCandidate[]
  formations: GeologicalFormationResponse[]
  contacts: FormationContactResponse[]
  apply: ShellContextValue['geoModel']['applyBoreholeFormationSelection']
}

function makeCtx(opts: CtxOptions): ShellContextValue {
  const base = makeShellCtx('geological')
  return {
    ...base,
    // One visible borehole is all the Fill verb needs to be enabled.
    visibleBoreholes: [{ id: 'bh-1', name: 'BH-1' } as never],
    geoModel: {
      ...base.geoModel,
      activeGeologicalModel: makeGeoModel(),
      formations: opts.formations,
      contacts: opts.contacts,
      discoverBoreholeFormations: async () => ({
        candidates: opts.candidates,
        collisions: [],
      }),
      applyBoreholeFormationSelection: opts.apply,
    },
  }
}

/** Click Fill and wait for the selection dialog to be on screen. */
async function openFillDialog(): Promise<void> {
  fireEvent.click(screen.getByTestId('geology-fill-from-boreholes-button'))
  // The Apply button only exists once the discover scan resolved and the
  // selection dialog mounted — a sharper readiness signal than the title,
  // which the toolbar button itself also renders.
  await waitFor(() => expect(screen.getByRole('button', { name: 'Apply selection' })).toBeDefined())
}

const QUARTAIR: FormationCandidate = {
  name: 'Quartair',
  key: 'quartair',
  boreholeCount: 3,
}
const NEW_UNIT: FormationCandidate = {
  name: 'Formatie van Diest',
  key: 'formatie van diest',
  boreholeCount: 2,
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Fill from boreholes — add / overwrite prompt', () => {
  it('P1: a pure addition applies immediately and additively, with no prompt', async () => {
    // Quartair is already in the model (so it is pre-checked); the user ticks a
    // brand-new unit. Nothing would be removed, so nothing should be asked.
    const apply = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellContext.Provider
        value={makeCtx({
          candidates: [QUARTAIR, NEW_UNIT],
          formations: [makeFormation('f-1', 'Quartair')],
          contacts: [makeContact('c-1', 'f-1')],
          apply,
        })}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    await openFillDialog()

    fireEvent.click(screen.getByRole('checkbox', { name: 'Formatie van Diest' }))
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))

    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(screen.queryByTestId('fill-mode-confirm-dialog')).toBeNull()
    expect(apply.mock.calls[0]![3]).toBe('add')
  })

  it('P2: leaving an existing unit out asks first and applies nothing yet', async () => {
    // Boom Klei is in the model but is not among this run's candidates, so it
    // cannot be kept by ticking anything — exactly the incident's shape.
    const apply = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellContext.Provider
        value={makeCtx({
          candidates: [QUARTAIR],
          formations: [makeFormation('f-1', 'Quartair'), makeFormation('f-2', 'Boom Klei')],
          contacts: [makeContact('c-1', 'f-1'), makeContact('c-2', 'f-2')],
          apply,
        })}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    await openFillDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))

    await waitFor(() => expect(screen.getByTestId('fill-mode-confirm-dialog')).toBeDefined())
    expect(apply).not.toHaveBeenCalled()
  })

  it('P3: "Add to model" applies additively', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellContext.Provider
        value={makeCtx({
          candidates: [QUARTAIR],
          formations: [makeFormation('f-1', 'Quartair'), makeFormation('f-2', 'Boom Klei')],
          contacts: [makeContact('c-1', 'f-1'), makeContact('c-2', 'f-2')],
          apply,
        })}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    await openFillDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    await waitFor(() => expect(screen.getByTestId('fill-mode-add')).toBeDefined())

    fireEvent.click(screen.getByTestId('fill-mode-add'))
    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply.mock.calls[0]![3]).toBe('add')
  })

  it('P4: "Overwrite model" applies destructively and the copy names what dies', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellContext.Provider
        value={makeCtx({
          candidates: [QUARTAIR],
          formations: [makeFormation('f-1', 'Quartair'), makeFormation('f-2', 'Boom Klei')],
          contacts: [makeContact('c-1', 'f-1'), makeContact('c-2', 'f-2')],
          apply,
        })}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    await openFillDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    await waitFor(() => expect(screen.getByTestId('fill-mode-confirm-dialog')).toBeDefined())

    // The unit that would be removed is named, not merely counted.
    const body = screen.getByTestId('fill-mode-confirm-dialog').textContent ?? ''
    expect(body).toContain('Boom Klei')
    expect(body).toContain('1 unit')

    fireEvent.click(screen.getByTestId('fill-mode-overwrite'))
    await waitFor(() => expect(apply).toHaveBeenCalledOnce())
    expect(apply.mock.calls[0]![3]).toBe('overwrite')
  })

  it('P5: cancelling applies nothing', async () => {
    const apply = vi.fn().mockResolvedValue(undefined)
    render(
      <ShellContext.Provider
        value={makeCtx({
          candidates: [QUARTAIR],
          formations: [makeFormation('f-1', 'Quartair'), makeFormation('f-2', 'Boom Klei')],
          contacts: [makeContact('c-1', 'f-1'), makeContact('c-2', 'f-2')],
          apply,
        })}
      >
        <GeologyToolbar />
      </ShellContext.Provider>,
    )
    await openFillDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Apply selection' }))
    await waitFor(() => expect(screen.getByTestId('fill-mode-cancel')).toBeDefined())

    fireEvent.click(screen.getByTestId('fill-mode-cancel'))
    expect(apply).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.queryByTestId('fill-mode-confirm-dialog')).toBeNull())
  })
})

// "Toon me" on a crossing whose contact sits on no cross-section (owner
// dogfeed 2026-09-22): the old answer was a toast telling him to draw one,
// without saying where. Now the app draws an east-west section through the
// offending test and says so; creating a section is undoable, so no dialog.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { GeologicalFormationResponse, GeologicalModelResponse } from '../../../api/client'
import { wgs84ToProjected } from '../../../hooks/useWgs84'
import { makeStubContext, makeLithoModel, makeBorehole, makeContact } from '../sections/__fixtures__/shellStub'
import GeologyInspector from './GeologyInspector'

vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// One crossing between the two formations below, on contact c-1 (borehole bh-1).
vi.mock('../../../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...orig,
    api: {
      ...((orig as Record<string, unknown>).api as object),
      geology: {
        ...(((orig as Record<string, unknown>).api as Record<string, unknown>).geology as object),
        validateCrossings: () =>
          Promise.resolve({
            model_id: 'geo-1',
            issues: [
              {
                kind: 'formation_crossing',
                detail: "Younger formation 'Holoceen' sits below older 'Pleistoceen' by up to 0.29 m — violates stratigraphic superposition.",
                depth_m: 0.29,
                contact_ids: ['c-1'],
                formation_ids: ['f-pleist', 'f-holo'],
              },
            ],
          }),
      },
    },
  }
})

function makeGeoModel(): GeologicalModelResponse {
  return { ...makeLithoModel('geo-1'), kind: 'geological', parent_model_id: null }
}

function makeFormation(id: string, name: string, order: number): GeologicalFormationResponse {
  return {
    id,
    app_project_id: 'proj-1',
    name,
    color: '#b45309',
    code: null,
    regional_ref: null,
    description: null,
    display_order: order,
    pinned_order: false,
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
  }
}

afterEach(cleanup)

describe('GeologyInspector — a crossing on a contact no section contains', () => {
  it('X1 — the warning names the formations, the gap and the test; clicking it draws a section through that test', async () => {
    const borehole = { ...makeBorehole(), id: 'bh-1', name: 'GEO-94/034-B1', location_x: 153600, location_y: 195650 }
    const contact = { ...makeContact('c-1'), borehole_id: 'bh-1', cpt_id: null, formation_id: 'f-holo' }
    const ctx = makeStubContext({ contacts: [contact], visibleBoreholes: [borehole] })
    ctx.geoModel.activeGeologicalModel = makeGeoModel()
    const older = makeFormation('f-pleist', 'Fluviatiel Pleistoceen', 0)
    const younger = makeFormation('f-holo', 'Fluviatiel Holoceen', 1)
    ctx.geoModel.formations = [older, younger]
    ctx.geoModel.visibleFormations = [older, younger]
    ctx.coordinator.manifestFormationIds = new Set(['f-pleist', 'f-holo'])
    ctx.investigations.boreholes = [borehole]
    ctx.sections.sections = []
    ctx.sections.visibleSections = []
    ctx.sections.effectiveHorizontalEpsg = 31370
    const drawn = vi.fn().mockResolvedValue(undefined)
    ctx.sections.handleSectionLineDrawn = drawn
    const toast = vi.fn()
    ctx.toasts.toast = toast

    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )

    const item = await screen.findByTestId('crossings-banner-item')
    // The sentence in the app language, from the issue's fields: both
    // formations, the gap, the test — not the backend's English.
    expect(item).toHaveTextContent(/Fluviatiel Holoceen/)
    expect(item).toHaveTextContent(/Fluviatiel Pleistoceen/)
    expect(item).toHaveTextContent(/0\.29/)
    expect(item).toHaveTextContent(/GEO-94\/034-B1/)
    expect(item).not.toHaveTextContent(/violates stratigraphic superposition/)

    fireEvent.click(item)
    await waitFor(() => expect(drawn).toHaveBeenCalledTimes(1))
    const [start, end] = drawn.mock.calls[0] as [{ lat: number; lng: number }, { lat: number; lng: number }]
    const [sx, sy] = wgs84ToProjected(start.lat, start.lng, 31370)
    const [ex, ey] = wgs84ToProjected(end.lat, end.lng, 31370)
    // East-west through the borehole, 60 m each way.
    expect(sx).toBeCloseTo(153600 - 60, 1)
    expect(ex).toBeCloseTo(153600 + 60, 1)
    expect(sy).toBeCloseTo(195650, 1)
    expect(ey).toBeCloseTo(195650, 1)
    await waitFor(() => expect(toast).toHaveBeenCalledWith('success', expect.stringContaining('GEO-94/034-B1')))
    expect(toast).not.toHaveBeenCalledWith('error', expect.anything())
  })
})

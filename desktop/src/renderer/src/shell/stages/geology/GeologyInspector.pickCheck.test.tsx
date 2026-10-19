// Always-on pick consistency check in the Stratigraphy inspector (owner
// 2026-10-19): the amber banner sits under the crossings banner, names the
// pick that does not fit its neighbours, and "Show" opens a cross-section
// through the flagged test AND its nearest test, the same way a crossing does.
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { GeologicalModelResponse } from '../../../api/client'
import { api } from '../../../api/client'
import { makeStubContext, makeLithoModel, makeBorehole, makeContact, makeSection } from '../sections/__fixtures__/shellStub'
import GeologyInspector from './GeologyInspector'

vi.mock('../../../components/interpretation/FormationDialog', () => ({
  default: () => null,
}))

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// No crossings; one flagged pick on B16 whose nearest test is S16.
vi.mock('../../../api/client', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../../../api/client')>()
  return {
    ...orig,
    api: {
      ...((orig as Record<string, unknown>).api as object),
      geology: {
        ...(((orig as Record<string, unknown>).api as Record<string, unknown>).geology as object),
        validateCrossings: () => Promise.resolve({ model_id: 'geo-1', issues: [] }),
        getContactConsistency: vi.fn().mockResolvedValue({
          model_id: 'geo-1',
          status: 'ready',
          formations: [
            {
              formation_id: 'f-egem',
              formation_name: 'Lid van Egem',
              status: 'checked',
              n_picks: 17,
              skipped_no_location: 0,
              fit: { range_m: 291, sill_sd_m: 4.2, nugget_sd_m: 0.61 },
              coverage_90: 0.82,
              refit_fallbacks: 0,
              reason: null,
              flags: [
                {
                  contact_id: 'c-b16',
                  investigation_id: 'bh-b16',
                  investigation_kind: 'borehole',
                  investigation_name: 'GEO-02/146-B16',
                  pick_elevation_m: -2.45,
                  predicted_elevation_m: -4.14,
                  sigma_m: 0.31,
                  z: 5.4,
                  nearest: {
                    contact_id: 'c-s16',
                    investigation_name: 'GEO-02/145-S16',
                    distance_m: 0.4,
                    pick_elevation_m: -4.15,
                  },
                },
              ],
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

afterEach(cleanup)

describe('GeologyInspector — pick consistency check', () => {
  it('P1 — the flagged pick shows in the inspector; Show opens the section through both tests', async () => {
    const b16 = { ...makeBorehole('bh-b16', 50, 0), name: 'GEO-02/146-B16' }
    const s16 = { ...makeBorehole('bh-s16', 50.4, 0), name: 'GEO-02/145-S16' }
    const contacts = [
      { ...makeContact('c-b16'), borehole_id: 'bh-b16', cpt_id: null, formation_id: 'f-egem' },
      { ...makeContact('c-s16'), borehole_id: 'bh-s16', cpt_id: null, formation_id: 'f-egem' },
    ]
    const ctx = makeStubContext({ contacts, visibleBoreholes: [b16, s16] })
    ctx.geoModel.activeGeologicalModel = makeGeoModel()
    ctx.investigations.boreholes = [b16, s16]
    // One section holds both tests, so Show deep-links straight into it.
    const section = makeSection()
    ctx.sections.sections = [section]
    ctx.sections.visibleSections = [section]
    const deepLink = vi.fn()
    ctx.coordinator.setSectionsDeepLinkTarget = deepLink

    render(
      <ShellContext.Provider value={ctx}>
        <GeologyInspector />
      </ShellContext.Provider>,
    )

    const banner = await screen.findByTestId('pick-check-banner')
    expect(banner).toHaveTextContent(/GEO-02\/146-B16/)
    expect(banner).toHaveTextContent(/GEO-02\/145-S16/)
    expect(api.geology.getContactConsistency).toHaveBeenCalledWith(ctx.project.id, 'geo-1')

    fireEvent.click(screen.getByTestId('pick-check-show-c-b16'))
    await waitFor(() =>
      expect(deepLink).toHaveBeenCalledWith({ sectionId: 'sec-1', contactIds: ['c-b16', 'c-s16'] }),
    )
  })
})

// "Subdivide all bodies" must warn about the hand edits it is about to destroy
// (owner ruling B, 2026-08-01).
//
// SubdivideAllBodies is model-wide and rebuilds every packing band from the CPT
// data, so every band the engineer split or merged by hand is silently gone on
// the next run. The existing re-subdivide confirmation already warns about
// losing packing CONNECTIONS; it must now also name the hand EDITS.
//
// The count comes from the shell's own ``geoModel.geotechLayers`` — the active
// geotech model's layer rows, already in memory with their ``source`` — so the
// dialog needs no round trip to open.
//
// Pinned claims:
//   HW1  With hand-edited bands in the geotech model, the confirm dialog names
//        how many.
//   HW2  The count is of hand-edited bands SPECIFICALLY: the segmenter's own
//        bands, which Subdivide rebuilds anyway, are not counted.
//   HW3  With no hand edits the dialog says nothing about them (an empty
//        warning trains people to ignore the real one).
//   HW4  It warns, it does not block: confirming still runs the subdivide.

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { LithoLayerResponse, LithoLayerSource } from '../../../api/clients/geology.types'
import SectionsToolbar from './SectionsToolbar'
import { makeLithoModel, makeShellCtx } from './__fixtures__/sectionsShellContext'

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
      },
      virtueleBoring: {
        getModels: vi.fn().mockResolvedValue([]),
      },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
  },
}))

afterEach(() => cleanup())

/** One geotech layer row — only ``source`` matters to the warning. */
function layer(id: string, source: LithoLayerSource): LithoLayerResponse {
  return {
    id,
    model_id: 'geotech-model-1',
    formation_id: 'formation-1',
    borehole_id: null,
    cpt_id: 'cpt-1',
    depth_top_m: 0,
    depth_base_m: 1,
    status: 'accepted',
    source,
    confidence: 'medium',
    observation_id: null,
    observation_layer_id: null,
    parent_geo_contact_id: null,
    body_id: null,
    notes: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

/**
 * Render the toolbar on the geotech axis with a re-runnable subdivide.
 *
 * The fixture already carries a live geotech model (so the click is a RE-run
 * and hits the confirmation); the litho parent has to be opted into because the
 * subdivide verb is gated on it.
 */
function renderToolbar(
  geotechLayers: LithoLayerResponse[],
  handleSubdivideAllBodies = vi.fn(() => Promise.resolve()),
): ShellContextValue {
  const ctx = makeShellCtx('geotechnical')
  ctx.geoModel.activeLithoModel = makeLithoModel()
  ctx.geoModel.geotechLayers = geotechLayers
  ctx.geoModel.handleSubdivideAllBodies = handleSubdivideAllBodies
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
  return ctx
}

describe('SectionsToolbar — hand-edit warning before Subdivide all bodies', () => {
  it('HW1 — names how many hand-edited bands the re-run will destroy', () => {
    renderToolbar([
      layer('l1', 'manual'),
      layer('l2', 'manual'),
      layer('l3', 'segmenter'),
    ])
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning).not.toBeNull()
    expect(warning?.textContent).toContain('2')
  })

  it('HW2 — counts hand-edited bands only, never the segmenter’s own', () => {
    renderToolbar([
      layer('l1', 'segmenter'),
      layer('l2', 'segmenter'),
      layer('l3', 'segmenter'),
      layer('l4', 'manual'),
    ])
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent).toContain('1 hand-edited band ')
    expect(warning?.textContent).not.toContain('4')
  })

  it('HW3 — says nothing about hand edits when the engineer made none', () => {
    renderToolbar([layer('l1', 'segmenter'), layer('l2', 'segmenter')])
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    // The dialog still opens — the connections warning is unconditional.
    expect(screen.getByTestId('re-subdivide-confirm-dialog')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')).toBeNull()
  })

  it('HW4 — a warning, not a block: confirming still runs the subdivide', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar([layer('l1', 'manual')], handleSubdivideAllBodies)
    fireEvent.click(screen.getByTestId('geotech-subdivide-all-bodies'))
    expect(handleSubdivideAllBodies).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('re-subdivide-confirm'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith()
  })
})

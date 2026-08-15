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
import { makeLithoLayer } from './__fixtures__/lithoLayer'
import { makeLithoModel, makeShellCtx, onSectionCpt } from './__fixtures__/sectionsShellContext'

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

/**
 * One geotech layer row on ``cpt-1`` — only ``source`` matters to the warning,
 * but the anchor decides whether the press's section reaches it at all.
 */
function layer(
  id: string,
  source: LithoLayerSource,
  cptId = 'cpt-1',
): LithoLayerResponse {
  return makeLithoLayer({
    id,
    source,
    cpt_id: cptId,
    model_id: 'geotech-model-1',
    formation_id: 'formation-1',
    confidence: 'medium',
    body_id: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  })
}

/**
 * Render the toolbar on the geotech axis with a re-runnable subdivide.
 *
 * The fixture already carries a live geotech model (so the click is a RE-run
 * and hits the confirmation); the litho parent has to be opted into because the
 * subdivide verb is gated on it.
 *
 * ``cpt-1`` is placed ON the fixture's section (owner ruling 2026-08-15 — the
 * dialog is scoped to the bands the press will actually rebuild, so a band on
 * a column the section does not carry now raises no dialog at all).
 */
function renderToolbar(
  geotechLayers: LithoLayerResponse[],
  handleSubdivideAllBodies = vi.fn(() => Promise.resolve()),
): ShellContextValue {
  const ctx = makeShellCtx('geotechnical')
  ctx.geoModel.activeLithoModel = makeLithoModel()
  ctx.geoModel.geotechLayers = geotechLayers
  ctx.geoModel.handleSubdivideAllBodies = handleSubdivideAllBodies
  ctx.visibleCpts = [onSectionCpt('cpt-1')]
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
  openPipelineMenu()
  return ctx
}

/** The pipeline steps live in the "Packing pipeline" dropdown (owner
 *  2026-08-05). Open it right after render so the step items are queryable —
 *  an item click auto-closes the menu, which is fine for these single-press
 *  scenes. No-op off the geotech axis (the trigger is absent there). */
function openPipelineMenu(): void {
  const trigger = screen.queryByTestId('geotech-pipeline')
  if (trigger && !(trigger as HTMLButtonElement).disabled) {
    fireEvent.click(trigger)
  }
}


describe('SectionsToolbar — hand-edit warning before Subdivide all bodies', () => {
  it('HW1 — names how many hand-edited bands the re-run will destroy', () => {
    renderToolbar([
      layer('l1', 'manual'),
      layer('l2', 'manual'),
      layer('l3', 'segmenter'),
    ])
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
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
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent).toContain('1 hand-edited band ')
    expect(warning?.textContent).not.toContain('4')
  })

  it('HW3 — says nothing about hand edits when the engineer made none', () => {
    renderToolbar([layer('l1', 'segmenter'), layer('l2', 'segmenter')])
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    // The dialog still opens — the connections warning is unconditional.
    expect(screen.getByTestId('re-subdivide-confirm-dialog')).toBeTruthy()
    expect(document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')).toBeNull()
  })

  it('HW4 — a warning, not a block: confirming still runs the subdivide', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar([layer('l1', 'manual')], handleSubdivideAllBodies)
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(handleSubdivideAllBodies).not.toHaveBeenCalled()
    fireEvent.click(screen.getByTestId('re-subdivide-confirm'))
    // RE-PINNED 2026-08-15: the scope chosen at the press survives the dialog
    // (the shared fixture has "sec-1" open). Confirming must run the SAME
    // press the engineer made — not silently widen it to the whole model.
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      representativeStatistic: null,
    })
  })
})

// ---------------------------------------------------------------------------
// The warning is scoped to the press (owner, dogfeed 2026-08-15)
// ---------------------------------------------------------------------------
//
// "We do however get an overwrite popup on cs2 while there is no subdivision
// there yet. Now it seems like it is warning that i'll overwrite CS 1"
//
// The dialog protects hand-edited bands from being thrown away by a re-run.
// Since the verb became section-scoped it fired on the MODEL's state, so a
// fresh section popped a warning about work living somewhere else — and the
// only reading available to the engineer was that his other section was about
// to be overwritten.
//
//   HS1  a section holding no bands goes straight through — no dialog at all
//   HS2  a section holding bands still confirms, and names that section
//   HS3  the count is the section's, never the model's
//   HS4  a column on two sections IS at risk from either press

describe('SectionsToolbar — the re-subdivide warning is scoped to the press', () => {
  it('HS1 — a section whose columns carry no bands subdivides without a prompt', () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    const ctx = makeShellCtx('geotechnical')
    ctx.geoModel.activeLithoModel = makeLithoModel()
    // The model HAS hand-edited bands — they just sit on a column this
    // section does not carry. That is the owner's CS2.
    ctx.geoModel.geotechLayers = [layer('l1', 'manual', 'cpt-elsewhere')]
    ctx.geoModel.handleSubdivideAllBodies = handleSubdivideAllBodies
    ctx.visibleCpts = [onSectionCpt('cpt-on-this-section')]
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsToolbar />
      </ShellContext.Provider>,
    )
    openPipelineMenu()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))

    expect(screen.queryByTestId('re-subdivide-confirm-dialog')).toBeNull()
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      representativeStatistic: null,
    })
  })

  it('HS2 — a section that DOES carry bands still confirms, and names itself', () => {
    renderToolbar([layer('l1', 'segmenter')])
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    const dialog = screen.getByTestId('re-subdivide-confirm-dialog')
    expect(dialog.textContent ?? '').toContain('Section A-A')
  })

  it('HS3 — the hand-edit count is the section’s, not the model’s', () => {
    const ctx = makeShellCtx('geotechnical')
    ctx.geoModel.activeLithoModel = makeLithoModel()
    ctx.geoModel.geotechLayers = [
      layer('l1', 'manual', 'cpt-1'),
      layer('l2', 'manual', 'cpt-elsewhere'),
      layer('l3', 'manual', 'cpt-elsewhere'),
    ]
    ctx.visibleCpts = [onSectionCpt('cpt-1')]
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsToolbar />
      </ShellContext.Provider>,
    )
    openPipelineMenu()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent ?? '').toContain('1 hand-edited band ')
    expect(warning?.textContent ?? '').not.toContain('3')
  })

  it('HS4 — a column shared with another section is at risk from this press too', () => {
    // Its bands come from its own qc, so either section's press rebuilds
    // them. This case genuinely deserves the warning.
    const ctx = makeShellCtx('geotechnical')
    ctx.geoModel.activeLithoModel = makeLithoModel()
    ctx.geoModel.geotechLayers = [layer('l1', 'manual', 'cpt-shared')]
    ctx.visibleCpts = [onSectionCpt('cpt-shared')]
    ctx.sections = {
      ...ctx.sections,
      sections: [
        ctx.sections.sections[0],
        { ...ctx.sections.sections[0], id: 'sec-2', name: 'Cross-section 2' },
      ],
    }
    render(
      <ShellContext.Provider value={ctx}>
        <SectionsToolbar />
      </ShellContext.Provider>,
    )
    openPipelineMenu()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    const warning = document.body.querySelector('[data-testid="re-subdivide-hand-edits"]')
    expect(warning?.textContent ?? '').toContain('1 hand-edited band ')
    // And it still never implies the neighbour's own work is going.
    const dialog = screen.getByTestId('re-subdivide-confirm-dialog')
    expect(dialog.textContent ?? '').not.toMatch(/other section/i)
    expect(dialog.textContent ?? '').not.toContain('Cross-section 2')
  })
})

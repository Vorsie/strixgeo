// The packing pipeline follows the section on screen.
//
// Owner (dogfeed 2026-08-15), on steps 1, 2 and 3:
//
//   > "I also see that this is model wide and not per section, i don't like
//   > that"
//
// and, for step 1 specifically:
//
//   > "i want subdivide cpt's also to be section scoped"
//
// So each of the first three steps acts on the section he has open.  A second
// "on all sections" item was built beside each of them, and he rejected it the
// next morning:
//
//   > "I didn't ask for the on all sections option, it's ugly and confusing
//   > delete it and keep only on this section"
//
// Step 4 stays model-wide because dividing the boreholes rewrites every
// section — but it has to SAY how many sections are holding it shut, instead
// of showing a bare count on a section he has already cleared.
//
//   SC1  step 1 acts on the section on screen
//   SC2  step 2 acts on the section on screen
//   SC3  step 3 acts on the section on screen
//   SC4  the all-sections items are GONE — there is no second way to press
//   SC5  the labels carry no scope qualifier, because there is one scope
//   SC6  with no section open the three steps are dead, with no escape beside
//   SC7  the toasts name the scope that was actually run
//   SC8  the step-4 gate counts SECTIONS, not just ties
//   SC9  the chip reports the open section, the model total rides the tooltip
//   SC10 the re-subdivide prompt no longer threatens the other sections' bands

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { LithoLayerResponse } from '../../../api/clients/geology.types'
import SectionsToolbar from './SectionsToolbar'
import { makeLithoLayer } from './__fixtures__/lithoLayer'
import { makeShellCtx, makeLithoModel, onSectionCpt } from './__fixtures__/sectionsShellContext'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const geotechTieStatus = vi.fn()
const autoCorrelateGeotech = vi.fn().mockResolvedValue({
  edges_proposed: 3,
  edges_accepted: 1,
  edges_skipped_existing: 0,
  sections_processed: 1,
  skipped_no_lcs: 0,
  skipped_empty_stack: 0,
})
const acceptContactCorrelations = vi
  .fn()
  .mockResolvedValue({ edges_accepted: 3, ordinals_changed: 0 })

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        geotechTieStatus: (...args: unknown[]) => geotechTieStatus(...args),
        autoCorrelateGeotech: (...args: unknown[]) => autoCorrelateGeotech(...args),
        acceptContactCorrelations: (...args: unknown[]) => acceptContactCorrelations(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
    },
  }
})

vi.mock('../../../utils/log', () => ({
  log: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), success: vi.fn() },
}))

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface CtxOverrides {
  geoModel?: Partial<ShellContextValue['geoModel']>
  sections?: Partial<ShellContextValue['sections']>
  toast?: ShellContextValue['toasts']['toast']
  visibleCpts?: ShellContextValue['visibleCpts']
}

function makeCtx(overrides: CtxOverrides = {}): ShellContextValue {
  const base = makeShellCtx('geotechnical')
  return {
    ...base,
    geoModel: {
      ...base.geoModel,
      activeLithoModel: makeLithoModel(),
      ...(overrides.geoModel ?? {}),
    },
    sections: { ...base.sections, ...(overrides.sections ?? {}) },
    toasts: { ...base.toasts, toast: overrides.toast ?? base.toasts.toast },
    visibleCpts: overrides.visibleCpts ?? base.visibleCpts,
  }
}

/** One committed packing band on a CPT — enough to make a press destructive. */
function bandOn(cptId: string): LithoLayerResponse {
  return makeLithoLayer({
    id: `band-${cptId}`,
    cpt_id: cptId,
    model_id: 'geotech-model-1',
    source: 'segmenter',
  })
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** Open the pipeline dropdown; item clicks auto-close it, so re-open between. */
async function openPipeline(): Promise<void> {
  fireEvent.click(screen.getByTestId('geotech-pipeline'))
  await screen.findByTestId('geotech-subdivide-cpts')
}

/** Make the tie-status endpoint answer with a given pending picture. */
function tieStatus(
  pending: number,
  accepted = 0,
  pendingBySection?: Record<string, number>,
): void {
  geotechTieStatus.mockResolvedValue({
    geotech_model_id: 'geotech-model-1',
    pending_tie_count: pending,
    accepted_tie_count: accepted,
    flagged_tie_count: 0,
    ...(pendingBySection === undefined ? {} : { pending_by_section: pendingBySection }),
  })
}

beforeEach(() => {
  tieStatus(0)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// SC — the scoped primaries and their escapes
// ---------------------------------------------------------------------------

describe('SectionsToolbar — the pipeline follows the open section', () => {
  it('SC1: step 1 subdivides the CPTs of the section on screen', async () => {
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(makeCtx({ geoModel: { activeGeotechModel: null, handleSubdivideAllBodies } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      // The qc statistic the engineer may have picked before the model
      // existed (owner 2026-08-15); none picked here.
      representativeStatistic: null,
    })
  })

  it('SC2: step 2 proposes on the section on screen', async () => {
    renderToolbar(makeCtx())
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-auto-correlate'))
    await waitFor(() => expect(autoCorrelateGeotech).toHaveBeenCalled())
    expect(autoCorrelateGeotech).toHaveBeenCalledWith('proj-1', 'geotech-model-1', 'sec-1')
  })

  it('SC3: step 3 accepts on the section on screen', async () => {
    renderToolbar(makeCtx())
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-accept-correlations'))
    await waitFor(() => expect(acceptContactCorrelations).toHaveBeenCalled())
    expect(acceptContactCorrelations).toHaveBeenCalledWith('proj-1', 'geotech-model-1', 'sec-1')
  })

  it('SC4: "on all sections" is gone from all three steps', async () => {
    // "I didn't ask for the on all sections option, it's ugly and confusing
    // delete it" — not hidden, not disabled: absent.
    renderToolbar(makeCtx())
    await openPipeline()
    for (const gone of [
      'geotech-subdivide-cpts-all',
      'geotech-auto-correlate-all',
      'geotech-accept-correlations-all',
    ]) {
      expect(screen.queryByTestId(gone)).toBeNull()
    }
    expect(screen.queryByText(/on all sections/i)).toBeNull()
  })

  it('SC5: the labels carry no scope qualifier — there is only one scope now', async () => {
    renderToolbar(makeCtx())
    await openPipeline()
    for (const step of [
      'geotech-subdivide-cpts',
      'geotech-auto-correlate',
      'geotech-accept-correlations',
    ]) {
      expect(screen.getByTestId(step).textContent ?? '').not.toContain('on this section')
    }
    expect(screen.getByTestId('geotech-subdivide-cpts').textContent ?? '').toContain(
      '1 · Subdivide CPTs',
    )
    expect(screen.getByTestId('geotech-auto-correlate').textContent ?? '').toContain(
      '2 · Auto-correlate',
    )
    expect(screen.getByTestId('geotech-accept-correlations').textContent ?? '').toContain(
      '3 · Accept ties',
    )
  })

  it('SC6: with no section open the three steps are dead, and nothing stands in for them', async () => {
    renderToolbar(makeCtx({ sections: { selectedSectionId: null } }))
    await openPipeline()
    expect(screen.getByTestId('geotech-subdivide-cpts')).toBeDisabled()
    expect(screen.getByTestId('geotech-auto-correlate')).toBeDisabled()
    expect(screen.getByTestId('geotech-accept-correlations')).toBeDisabled()
    // The disabled item has to teach the way out, and the way out is a
    // section — not a second menu item that no longer exists.
    expect(screen.getByTestId('geotech-subdivide-cpts').getAttribute('title') ?? '').not.toContain(
      'on all sections',
    )
  })

  it('SC7: the toast names the scope that actually ran', async () => {
    const toast = vi.fn()
    renderToolbar(makeCtx({ toast }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-auto-correlate'))
    await waitFor(() => expect(toast).toHaveBeenCalled())
    expect(String(toast.mock.calls[0][1])).toContain('this section')
  })

  it('SC10: the re-subdivide prompt no longer threatens the other sections', async () => {
    // A re-run on a project with a SECOND section: the rebuild now deletes
    // only the columns it rebuilds, so a prompt that says the neighbour loses
    // its packing bands is describing something that cannot happen.
    //
    // RE-PINNED 2026-08-15: the prompt only appears when the OPEN section has
    // bands to lose, so the scene has to stage one — otherwise the press goes
    // straight through and there is no dialog to read (owner: "We do however
    // get an overwrite popup on cs2 while there is no subdivision there yet").
    const base = makeShellCtx('geotechnical')
    const twoSections = [
      base.sections.sections[0],
      { ...base.sections.sections[0], id: 'sec-2', name: 'Cross-section 2' },
    ]
    renderToolbar(
      makeCtx({
        sections: { sections: twoSections },
        geoModel: {
          activeLithoModel: makeLithoModel(),
          geotechLayers: [bandOn('cpt-1')],
        },
        visibleCpts: [onSectionCpt('cpt-1')],
      }),
    )
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))

    const dialog = await screen.findByTestId('re-subdivide-confirm-dialog')
    expect(dialog.textContent ?? '').not.toMatch(/other section/i)
    expect(dialog.textContent ?? '').not.toMatch(/on all sections/i)
    // It names the section it IS about, and never the neighbour.
    expect(dialog.textContent ?? '').toContain('Section A-A')
    expect(dialog.textContent ?? '').not.toContain('Cross-section 2')
  })
})

// ---------------------------------------------------------------------------
// SC8/SC9 — the model-wide step 4 has to explain itself
// ---------------------------------------------------------------------------

describe('SectionsToolbar — the step-4 gate explains itself', () => {
  it('SC8: the step-4 gate counts THIS section, not the model', async () => {
    // RE-PINNED 2026-08-15: was "accept 12 on 2 sections", from when step 4
    // rewrote every section. Owner: "i'm reading divide boreholes (whole
    // model), no that should also be section scoped" — so the count that
    // holds it shut is the open section's.
    tieStatus(12, 5, { 'sec-1': 5, 'sec-2': 7 })
    renderToolbar(makeCtx())
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).toBeDisabled()
    expect(divide.textContent ?? '').toContain('accept 5 on this section')
    expect(divide.getAttribute('title') ?? '').toMatch(/this section/i)
  })

  it('SC9: the chip reports THIS section; the model total rides the tooltip', async () => {
    tieStatus(12, 40, { 'sec-1': 5, 'sec-2': 7 })
    renderToolbar(makeCtx())
    const chip = await screen.findByTestId('geotech-pending-tie-chip')
    expect(chip.textContent ?? '').toContain('5')
    const title = chip.getAttribute('title') ?? ''
    expect(title).toContain('12')
    expect(title).toContain('40')
  })

  it('SC9b: a cleared section still shows the model is not clear', async () => {
    // He accepted everything he can see; the chip must not vanish, or step 4
    // would look broken. It reads 0 here, and the tooltip says where the rest
    // are.
    tieStatus(7, 40, { 'sec-2': 7 })
    renderToolbar(makeCtx())
    const chip = await screen.findByTestId('geotech-pending-tie-chip')
    expect(chip.textContent ?? '').toContain('0')
    expect(chip.getAttribute('title') ?? '').toContain('7')
  })
})

// ---------------------------------------------------------------------------
// SC11-SC15 — step 4 joins the other three (owner, 2026-08-15)
// ---------------------------------------------------------------------------
//
//   > "i'm reading divide boreholes (whole model), no that should also be
//   > section scoped"
//
// He read the menu after steps 1-3 were scoped and refused the odd one out.
// The consequence he is after: finish CS1 end to end while CS2 still has
// proposals outstanding.
//
//   SC11 step 4 divides the section on screen
//   SC12 the label drops the "(whole model)" qualifier
//   SC13 the neighbour's proposals no longer hold this section's divide shut
//   SC14 this section's own proposals still do
//   SC15 with no section open the step is dead, like steps 1-3
//   SC16 the pipeline's own tooltip stops calling step 4 model-wide

describe('SectionsToolbar — step 4 follows the open section', () => {
  it('SC11: step 4 divides the boreholes of the section on screen', async () => {
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(makeCtx({ geoModel: { handleDivideBoreholes } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))
    expect(handleDivideBoreholes).toHaveBeenCalledWith({ sectionId: 'sec-1' })
  })

  it('SC12: the label no longer says "(whole model)"', async () => {
    renderToolbar(makeCtx())
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide.textContent ?? '').toContain('4 · Divide boreholes')
    expect(divide.textContent ?? '').not.toMatch(/whole model/i)
  })

  it('SC13: proposals on ANOTHER section no longer hold this one shut', async () => {
    // The case the owner is after: CS1 is clear, CS2 is not, and CS1 divides.
    tieStatus(7, 40, { 'sec-2': 7 })
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(makeCtx({ geoModel: { handleDivideBoreholes } }))
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).not.toBeDisabled()
    fireEvent.click(divide)
    expect(handleDivideBoreholes).toHaveBeenCalledWith({ sectionId: 'sec-1' })
  })

  it('SC14: proposals on THIS section still do', async () => {
    tieStatus(5, 40, { 'sec-1': 5 })
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(makeCtx({ geoModel: { handleDivideBoreholes } }))
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).toBeDisabled()
    fireEvent.click(divide)
    expect(handleDivideBoreholes).not.toHaveBeenCalled()
  })

  it('SC15: with no section open step 4 is dead, exactly like steps 1-3', async () => {
    renderToolbar(makeCtx({ sections: { selectedSectionId: null } }))
    await openPipeline()
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled()
  })

  it('SC16: the pipeline tooltip stops calling step 4 model-wide', async () => {
    renderToolbar(makeCtx())
    const title = screen.getByTestId('geotech-pipeline').getAttribute('title') ?? ''
    expect(title).not.toMatch(/model-wide/i)
    expect(title).not.toMatch(/rewrites every section/i)
  })
})

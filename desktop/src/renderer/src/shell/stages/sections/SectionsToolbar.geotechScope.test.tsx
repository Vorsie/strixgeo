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
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeLithoModel } from './__fixtures__/sectionsShellContext'

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
  }
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
    const base = makeShellCtx('geotechnical')
    const twoSections = [
      base.sections.sections[0],
      { ...base.sections.sections[0], id: 'sec-2', name: 'Cross-section 2' },
    ]
    renderToolbar(makeCtx({ sections: { sections: twoSections } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))

    const dialog = await screen.findByTestId('re-subdivide-confirm-dialog')
    expect(dialog.textContent ?? '').not.toMatch(/other section/i)
    expect(dialog.textContent ?? '').not.toMatch(/on all sections/i)
  })
})

// ---------------------------------------------------------------------------
// SC8/SC9 — the model-wide step 4 has to explain itself
// ---------------------------------------------------------------------------

describe('SectionsToolbar — the model-wide gate explains itself', () => {
  it('SC8: the step-4 gate counts the SECTIONS still carrying proposals', async () => {
    tieStatus(12, 5, { 'sec-1': 5, 'sec-2': 7 })
    renderToolbar(makeCtx())
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).toBeDisabled()
    expect(divide.textContent ?? '').toContain('accept 12 on 2 sections')
    expect(divide.getAttribute('title') ?? '').toContain('2 sections')
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

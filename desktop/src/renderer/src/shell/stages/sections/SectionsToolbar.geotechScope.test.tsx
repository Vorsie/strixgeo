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
//   SC17 steps 2-4 are dead on a section that carries no packing bands
//   SC18 their disabled titles name step 1 on THIS section, not the model
//   SC19 step 1 stays live there — it is the remedy the title names
//   SC20 once this section has bands, steps 2-4 come alive
//   SC21 with no section open at all, the older reason still wins

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import SectionsToolbar from './SectionsToolbar'
import { sectionsDividePartitionCallback } from '../../../hooks/useProjectBodyRecompute'
import {
  makeShellCtx,
  makeGeotechModel,
  makeLithoModel,
  onSectionCpt,
  packingBandOn,
  withSectionPacking,
} from './__fixtures__/sectionsShellContext'

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

/**
 * The open section already carries packing — the state steps 2, 3 and 4 need.
 *
 * Since 2026-08-15 those three are gated on the OPEN section's own bands
 * (SC17-SC21 below), so a scene that presses them has to have run step 1
 * first, the way the engineer does.
 */
function bandedCtx(overrides: CtxOverrides = {}): ShellContextValue {
  return withSectionPacking(makeCtx(overrides))
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
      // First subdivision wins (owner 2026-08-18): no rebuild tag is
      // active in this scene, so the press imports existing bands as-is.
      rebuildExisting: false,
    })
  })

  it('SC1b: a STALE step 1 press is the rebuild, not the skip', async () => {
    // First-subdivision-wins (owner 2026-08-18) has one deliberate exception:
    // when the button itself announces a re-run ("re-run under <statistic>"),
    // the press means rebuild — skipping would keep the old classes and pin
    // the tag on forever.
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx({
        geoModel: {
          activeGeotechModel: {
            ...makeGeotechModel(),
            representative_statistic: 'harmonic',
            classified_with_statistic: 'median',
          },
          handleSubdivideAllBodies,
        },
      }),
    )
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith(
      expect.objectContaining({ rebuildExisting: true }),
    )
  })

  it('SC2: step 2 proposes on the section on screen', async () => {
    renderToolbar(bandedCtx())
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-auto-correlate'))
    await waitFor(() => expect(autoCorrelateGeotech).toHaveBeenCalled())
    expect(autoCorrelateGeotech).toHaveBeenCalledWith('proj-1', 'geotech-model-1', 'sec-1')
  })

  it('SC3: step 3 accepts on the section on screen', async () => {
    renderToolbar(bandedCtx())
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
    renderToolbar(bandedCtx({ toast }))
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
          geotechLayers: [packingBandOn('cpt-1')],
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
    renderToolbar(bandedCtx({ geoModel: { handleDivideBoreholes } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))
    expect(handleDivideBoreholes).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'sec-1' }))
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
    renderToolbar(bandedCtx({ geoModel: { handleDivideBoreholes } }))
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).not.toBeDisabled()
    fireEvent.click(divide)
    expect(handleDivideBoreholes).toHaveBeenCalledWith(expect.objectContaining({ sectionId: 'sec-1' }))
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

// ---------------------------------------------------------------------------
// SC17-SC21 — a model built somewhere else is not packing HERE
// ---------------------------------------------------------------------------
//
// Owner (dogfeed 2026-08-15):
//
//   > "when i switched to cs2 options 2 3 and 4 in the packing pipeline where
//   > clickable this was not the case on the first subdivide in cs1"
//
// All four steps act on the section on screen, so their enablement has to
// follow the same scope. Steps 2, 3 and 4 asked instead whether a geotech
// model EXISTS — a question that gave the right answer exactly once, on CS1's
// first press, when nothing existed anywhere. The moment CS1's step 1 created
// the model, CS2 inherited three live steps with nothing under them to correlate,
// accept or divide: a press there can only be a no-op or a confusing partial.

const OFF_SECTION_Y = 10_000

/**
 * CS1 carries a packing band; CS2 is the open section and carries nothing.
 *
 * CS2's line runs 10 km north of CS1's, well outside the 50 m corridor, so
 * ``cpt-1`` — the band's anchor — is a member of CS1 only.
 */
function bandsOnTheOtherSectionCtx(
  geoModel: Partial<ShellContextValue['geoModel']> = {},
): ShellContextValue {
  const base = makeShellCtx('geotechnical')
  const cs1 = base.sections.sections[0]
  const cs2 = {
    ...cs1,
    id: 'sec-2',
    name: 'Cross-section 2',
    start_y: OFF_SECTION_Y,
    end_y: OFF_SECTION_Y,
  }
  return makeCtx({
    sections: { sections: [cs1, cs2], visibleSections: [cs1, cs2], selectedSectionId: 'sec-2' },
    geoModel: { geotechLayers: [packingBandOn('cpt-1')], ...geoModel },
    visibleCpts: [onSectionCpt('cpt-1')],
  })
}

describe('SectionsToolbar — steps 2-4 follow the open section’s own bands', () => {
  it('SC17: with the bands on ANOTHER section, steps 2, 3 and 4 are dead here', async () => {
    // The exact scene he hit: the model exists (CS1 subdivided), the section on
    // screen has no packing yet, and the three steps were clickable anyway.
    renderToolbar(bandsOnTheOtherSectionCtx())
    await openPipeline()
    expect(screen.getByTestId('geotech-auto-correlate')).toBeDisabled()
    expect(screen.getByTestId('geotech-accept-correlations')).toBeDisabled()
    expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled()
  })

  it('SC18: the disabled titles name step 1 on THIS section, not the model', async () => {
    // "Run 1 first to create packing bands" is a lie on a project whose model
    // already exists — he ran 1, it created the model, and the sentence still
    // says to create it. The remedy is step 1 HERE.
    renderToolbar(bandsOnTheOtherSectionCtx())
    await openPipeline()
    for (const step of [
      'geotech-auto-correlate',
      'geotech-accept-correlations',
      'geotech-divide-boreholes',
    ]) {
      const title = screen.getByTestId(step).getAttribute('title') ?? ''
      expect(title).toContain('Subdivide CPTs')
      expect(title).toContain('on this section first')
      expect(title).not.toContain('first to create packing bands')
      expect(title).not.toContain('first to create the geotech model')
    }
  })

  it('SC19: step 1 stays live there — it is the way out the titles name', async () => {
    renderToolbar(bandsOnTheOtherSectionCtx())
    await openPipeline()
    expect(screen.getByTestId('geotech-subdivide-cpts')).not.toBeDisabled()
  })

  it('SC20: once THIS section has bands, steps 2, 3 and 4 come alive', async () => {
    // The same project one press later: CS2's own CPT now carries packing, so
    // every step has something on screen to act on.
    const base = makeShellCtx('geotechnical')
    const cs1 = base.sections.sections[0]
    const cs2 = {
      ...cs1,
      id: 'sec-2',
      name: 'Cross-section 2',
      start_y: OFF_SECTION_Y,
      end_y: OFF_SECTION_Y,
    }
    renderToolbar(
      makeCtx({
        sections: { sections: [cs1, cs2], visibleSections: [cs1, cs2], selectedSectionId: 'sec-2' },
        geoModel: { geotechLayers: [packingBandOn('cpt-1'), packingBandOn('cpt-2')] },
        visibleCpts: [
          onSectionCpt('cpt-1'),
          { ...onSectionCpt('cpt-2'), location_y: OFF_SECTION_Y },
        ],
      }),
    )
    await openPipeline()
    expect(screen.getByTestId('geotech-auto-correlate')).not.toBeDisabled()
    expect(screen.getByTestId('geotech-accept-correlations')).not.toBeDisabled()
    expect(screen.getByTestId('geotech-divide-boreholes')).not.toBeDisabled()
  })

  it('SC21: with no section open at all, the older reason still wins', async () => {
    // Precedence: no section open is the more basic fault and names its own
    // remedy. "Run step 1 on this section" would be advice about a section he
    // does not have open.
    renderToolbar(
      makeCtx({
        sections: { selectedSectionId: null },
        geoModel: { geotechLayers: [packingBandOn('cpt-1')] },
        visibleCpts: [onSectionCpt('cpt-1')],
      }),
    )
    await openPipeline()
    for (const step of [
      'geotech-auto-correlate',
      'geotech-accept-correlations',
      'geotech-divide-boreholes',
    ]) {
      expect(screen.getByTestId(step)).toBeDisabled()
      expect(screen.getByTestId(step).getAttribute('title') ?? '').toContain(
        'Open a cross-section first',
      )
    }
  })
})


// ---------------------------------------------------------------------------
// SC17-SC18 — step 4 carries the geometry it reads the boreholes off
// ---------------------------------------------------------------------------
//
//   > "the borehole thing is really a geometry problem, we draw half length
//   > lenses between two cpts same for onlaps. you just need to check if a
//   > borehole column intersects a lens or onlap"     (owner, 2026-08-15)
//
// The backend does the intersecting, but it can only intersect geometry it was
// given. These pin the two halves of that hand-off: the partition is assembled
// BEFORE the press (afterwards it would describe the model the press has
// already rewritten), and a failure to assemble it is not a failure to divide.

describe('SectionsToolbar — step 4 carries the section geometry', () => {
  it('SC17: the assembled partition is handed to the divide', async () => {
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    const partition = { 'sec-1': { columns: [], regions: [] } }
    sectionsDividePartitionCallback.current = vi.fn(() => Promise.resolve(partition))

    renderToolbar(bandedCtx({ geoModel: { handleDivideBoreholes } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))

    await waitFor(() =>
      expect(handleDivideBoreholes).toHaveBeenCalledWith(
        expect.objectContaining({ sectionId: 'sec-1', sectionPartitions: partition }),
      ),
    )
    expect(sectionsDividePartitionCallback.current).toHaveBeenCalledWith('sec-1')
  })

  it('SC18: a partition that cannot be assembled still divides', async () => {
    // Null is not a failure — the backend falls back to the donor rule, which
    // is exactly the behaviour that shipped before the geometry existed. A
    // borehole must never go undivided because the geometry did not load.
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    sectionsDividePartitionCallback.current = vi.fn(() => Promise.reject(new Error('boom')))

    renderToolbar(bandedCtx({ geoModel: { handleDivideBoreholes } }))
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-divide-boreholes'))

    await waitFor(() =>
      expect(handleDivideBoreholes).toHaveBeenCalledWith(
        expect.objectContaining({ sectionId: 'sec-1', sectionPartitions: null }),
      ),
    )
  })
})

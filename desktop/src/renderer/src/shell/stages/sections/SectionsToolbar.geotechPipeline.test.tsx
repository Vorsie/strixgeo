// The four-step packing pipeline, read in the owner's words (ruling 2026-08-04).
//
//   > "Subdivide all bodies" did too much at once: it subdivided the CPTs *and*
//   > derived packing ties, and those ties arrived ALREADY ACCEPTED.
//
// The replacement is four numbered presses mirroring the litho stage's suggest →
// accept rhythm — 1 Subdivide CPTs · 2 Auto-correlate · 3 Accept all ties ·
// 4 Divide boreholes — with step 4 GATED on step 3:
//
//   > an accepted tie spanning a borehole decides which CPTs that borehole's
//   > packing comes from, so dividing on unreviewed proposals throws away
//   > evidence the engineer is one press from supplying.
//
// The gate is the load-bearing claim here. It is enforced server-side either
// way; what this suite pins is that the engineer is TOLD — a disabled button
// naming the count, not a 422 discovered by clicking.

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import type { ShellContextValue } from '../../ShellContext'
import type { SectionModelAxis } from '../../../hooks/useSections'
import SectionsToolbar from './SectionsToolbar'
import { makeShellCtx, makeLithoModel } from './__fixtures__/sectionsShellContext'

// ---------------------------------------------------------------------------
// Module mocks
// ---------------------------------------------------------------------------

const geotechTieStatus = vi.fn()
const autoCorrelateGeotech = vi.fn().mockResolvedValue({
  edges_proposed: 3,
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
}

function makeCtx(
  axis: SectionModelAxis = 'geotechnical',
  overrides: CtxOverrides = {},
): ShellContextValue {
  const base = makeShellCtx(axis)
  return {
    ...base,
    geoModel: { ...base.geoModel, ...(overrides.geoModel ?? {}) },
    sections: { ...base.sections, ...(overrides.sections ?? {}) },
  }
}

function renderToolbar(ctx: ShellContextValue): void {
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsToolbar />
    </ShellContext.Provider>,
  )
}

/** The four steps live in the "Packing pipeline" dropdown (owner 2026-08-05) —
 *  open it before querying an item. The menu auto-closes after an item click,
 *  so re-open between presses. */
async function openPipeline(): Promise<void> {
  fireEvent.click(screen.getByTestId('geotech-pipeline'))
  await screen.findByTestId('geotech-subdivide-cpts')
}

/** Make the tie-status endpoint answer with a given pending count. */
function tiesPending(pending: number, accepted = 0): void {
  geotechTieStatus.mockResolvedValue({
    geotech_model_id: 'geotech-model-1',
    pending_tie_count: pending,
    accepted_tie_count: accepted,
    flagged_tie_count: 0,
  })
}

beforeEach(() => {
  tiesPending(0)
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

// ---------------------------------------------------------------------------
// PL — the four steps exist, in order, on the geotech axis
// ---------------------------------------------------------------------------

describe('SectionsToolbar — the four-step packing pipeline', () => {
  it('PL1 — all four numbered steps are in the pipeline menu, in order', async () => {
    renderToolbar(makeCtx('geotechnical', { geoModel: { activeLithoModel: makeLithoModel() } }))
    await openPipeline()
    const labels = [
      'geotech-subdivide-cpts',
      'geotech-auto-correlate',
      'geotech-accept-correlations',
      'geotech-divide-boreholes',
    ].map((id) => screen.getByTestId(id).textContent ?? '')
    expect(labels[0]).toContain('1 · Subdivide CPTs')
    expect(labels[1]).toContain('2 · Auto-correlate')
    // RE-PINNED 2026-08-15: was "3 · Accept all ties". The primary press is
    // now section-scoped ("I also see that this is model wide and not per
    // section, i don't like that"), and "Accept ALL ties on this section" is a
    // contradiction — the label had to lose the "all".
    expect(labels[2]).toContain('3 · Accept ties')
    expect(labels[3]).toContain('4 · Divide boreholes')
    // Document order matches press order — the toolbar reads as the workflow.
    const rendered = document.body.textContent ?? ''
    expect(rendered.indexOf('1 · Subdivide')).toBeLessThan(rendered.indexOf('2 · Auto'))
    expect(rendered.indexOf('2 · Auto')).toBeLessThan(rendered.indexOf('3 · Accept'))
    expect(rendered.indexOf('3 · Accept')).toBeLessThan(rendered.indexOf('4 · Divide'))
    await waitFor(() => expect(geotechTieStatus).toHaveBeenCalled())
  })

  it('PL2 — the pipeline menu is absent on the litho axis (control)', () => {
    renderToolbar(makeCtx('lithostratigraphic'))
    expect(screen.queryByTestId('geotech-pipeline')).toBeNull()
    for (const id of [
      'geotech-subdivide-cpts',
      'geotech-auto-correlate',
      'geotech-accept-correlations',
      'geotech-divide-boreholes',
    ]) {
      expect(screen.queryByTestId(id)).toBeNull()
    }
  })

  it('PL3 — step 1 asks for bands only, never for derived ties', async () => {
    // The whole point of splitting the verb: step 1 must not correlate. If it
    // ever asks for edges again, the ties are back to arriving unreviewed.
    const handleSubdivideAllBodies = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx('geotechnical', {
        geoModel: {
          activeLithoModel: makeLithoModel(),
          activeGeotechModel: null,
          handleSubdivideAllBodies,
        },
      }),
    )
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-subdivide-cpts'))
    // RE-PINNED 2026-08-15: the press now also carries the open section's id
    // (the shared fixture selects "sec-1") and the pre-model qc statistic —
    // null here, because no statistic was picked. The claim under test is
    // unchanged: deriveEdges stays false, i.e. step 1 still correlates nothing.
    expect(handleSubdivideAllBodies).toHaveBeenCalledWith({
      deriveEdges: false,
      sectionId: 'sec-1',
      representativeStatistic: null,
    })
  })
})

// ---------------------------------------------------------------------------
// PG — the gate
// ---------------------------------------------------------------------------

describe('SectionsToolbar — step 4 is gated on step 3', () => {
  it('PG1 — pending ties disable "Divide boreholes" and say how many', async () => {
    tiesPending(12, 5)
    renderToolbar(makeCtx('geotechnical', { geoModel: { activeLithoModel: makeLithoModel() } }))
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    expect(divide).toBeDisabled()
    // A disabled menu item fires no hover events, so the gate's reason is a
    // VISIBLE tag pill on the item — not a tooltip (owner tidy-up 2026-08-05).
    expect(divide.textContent ?? '').toContain('accept 12 first')
    // The full sentence still rides the title attribute for tests + a11y.
    expect(divide.getAttribute('title') ?? '').toContain('12 packing ties')
  })

  it('PG2 — the pending count is shown as a chip beside the accept step', async () => {
    tiesPending(12, 5)
    renderToolbar(makeCtx('geotechnical', { geoModel: { activeLithoModel: makeLithoModel() } }))
    const chip = await screen.findByTestId('geotech-pending-tie-chip')
    expect(chip.textContent).toContain('12')
  })

  it('PG3 — with nothing pending the chip is gone and step 4 is live', async () => {
    tiesPending(0, 40)
    const handleDivideBoreholes = vi.fn(() => Promise.resolve())
    renderToolbar(
      makeCtx('geotechnical', {
        geoModel: { activeLithoModel: makeLithoModel(), handleDivideBoreholes },
      }),
    )
    await waitFor(() => expect(geotechTieStatus).toHaveBeenCalled())
    expect(screen.queryByTestId('geotech-pending-tie-chip')).toBeNull()
    await openPipeline()
    const divide = screen.getByTestId('geotech-divide-boreholes')
    await waitFor(() => expect(divide).not.toBeDisabled())
    fireEvent.click(divide)
    expect(handleDivideBoreholes).toHaveBeenCalled()
  })

  it('PG4 — an UNANSWERED tie-status must not lock the engineer out', async () => {
    // Falling closed on an error would make a 404 (or a backend predating the
    // endpoint) permanently disable step 4. The server enforces the gate
    // regardless, so falling OPEN costs a 422 at worst and never a dead button.
    geotechTieStatus.mockRejectedValue(new Error('boom'))
    renderToolbar(makeCtx('geotechnical', { geoModel: { activeLithoModel: makeLithoModel() } }))
    await waitFor(() => expect(geotechTieStatus).toHaveBeenCalled())
    await openPipeline()
    expect(screen.getByTestId('geotech-divide-boreholes')).not.toBeDisabled()
    expect(screen.queryByTestId('geotech-pending-tie-chip')).toBeNull()
  })

  it('PG5 — the count is re-read after step 2 and after step 3', async () => {
    // The gate is only as honest as its number: proposing ties must raise it and
    // accepting them must clear it, without a manual reload.
    tiesPending(0)
    renderToolbar(makeCtx('geotechnical', { geoModel: { activeLithoModel: makeLithoModel() } }))
    await waitFor(() => expect(geotechTieStatus).toHaveBeenCalledTimes(1))

    tiesPending(3)
    await openPipeline()
    fireEvent.click(screen.getByTestId('geotech-auto-correlate'))
    await waitFor(() => expect(autoCorrelateGeotech).toHaveBeenCalled())
    // The item click auto-closes the menu; the chip lives outside it.
    await screen.findByTestId('geotech-pending-tie-chip')
    await openPipeline()
    await waitFor(() => expect(screen.getByTestId('geotech-divide-boreholes')).toBeDisabled())

    tiesPending(0, 3)
    fireEvent.click(screen.getByTestId('geotech-accept-correlations'))
    await waitFor(() => expect(acceptContactCorrelations).toHaveBeenCalled())
    await waitFor(() => expect(screen.queryByTestId('geotech-pending-tie-chip')).toBeNull())
    await openPipeline()
    await waitFor(() => expect(screen.getByTestId('geotech-divide-boreholes')).not.toBeDisabled())
  })
})

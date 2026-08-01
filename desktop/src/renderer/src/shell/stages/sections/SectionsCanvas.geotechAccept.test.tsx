// A pending geotech tie can be accepted one edge at a time, like a pending litho tie.
//
// The per-edge "Accept correlation" menu item was suppressed on the geotech axis because
// every geotech edge was written approved — there was never anything to accept. The
// standalone geotech auto-correlate breaks that premise: it proposes UNAPPROVED ties for
// review, so the review gesture has to exist on this axis too.
//
// `CorrelationEdgesOverlay` only offers the Accept row when the caller wired
// `onRequestAcceptEdge`, so the prop reaching SectionPanel is what decides whether the
// gesture exists at all. The litho control is the point of AC3: asserting only that
// geotech has the handler would pass just as well if it had been wired for everyone
// regardless of axis.

import { render, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ShellContext } from '../../ShellContext'
import SectionsCanvas from './SectionsCanvas'
import { makeShellCtx } from './__fixtures__/sectionsShellContext'

/** Captures SectionPanel's whole prop bag, so handler gating is observable. */
let capturedPanelProps: Record<string, unknown> = {}

const acceptSingleContactCorrelation = vi
  .fn()
  .mockResolvedValue({ edges_accepted: 1, ordinals_changed: 0 })

vi.mock('../../../components/SectionPanel', () => ({
  default: (props: Record<string, unknown>) => {
    capturedPanelProps = props
    return null
  },
}))

vi.mock('../../../components/MapView', () => ({
  default: () => null,
}))

vi.mock('../../../api/client', async () => {
  const actual = await vi.importActual<typeof import('../../../api/client')>('../../../api/client')
  return {
    ...actual,
    setBaseUrl: vi.fn(),
    api: {
      geology: {
        validateCrossings: vi.fn().mockResolvedValue({ model_id: '', issues: [] }),
        createContactCorrelation: vi.fn().mockResolvedValue(undefined),
        deleteContactCorrelation: vi.fn().mockResolvedValue(undefined),
        listContactCorrelations: vi.fn().mockResolvedValue([]),
        acceptSingleContactCorrelation: (...args: unknown[]) =>
          acceptSingleContactCorrelation(...args),
      },
      virtueleBoring: { getModels: vi.fn().mockResolvedValue([]) },
      section: { list: vi.fn().mockResolvedValue([]), get: vi.fn() },
    },
  }
})

function renderOn(axis: 'geotechnical' | 'lithostratigraphic'): void {
  const ctx = makeShellCtx(axis)
  render(
    <ShellContext.Provider value={ctx}>
      <SectionsCanvas />
    </ShellContext.Provider>,
  )
}

/** The pending edge the engineer right-clicks — shape as the overlay hands it back. */
function pendingGeotechEdge() {
  return {
    id: 'geotech-edge-1',
    model_id: 'geotech-model-1',
    section_id: 'sec-1',
    layer_a_id: 'geo-layer-a',
    layer_b_id: 'geo-layer-b',
    layer_a_side: 'top' as const,
    layer_b_side: 'top' as const,
    source: 'auto',
    user_approved: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  }
}

describe('SectionsCanvas — a pending geotech tie can be accepted', () => {
  beforeEach(() => {
    capturedPanelProps = {}
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('AC1 — the geotech axis offers the per-edge accept gesture', () => {
    renderOn('geotechnical')

    expect(capturedPanelProps.onRequestAcceptEdge).toBeDefined()
  })

  it('AC2 — accepting a geotech edge promotes it on the GEOTECH model', async () => {
    renderOn('geotechnical')

    const accept = capturedPanelProps.onRequestAcceptEdge as (edge: unknown) => void
    accept(pendingGeotechEdge())

    await vi.waitFor(() => expect(acceptSingleContactCorrelation).toHaveBeenCalled())
    // The geotech model id, never the litho parent — accepting against the parent would
    // promote nothing and silently leave the tie pending.
    expect(acceptSingleContactCorrelation).toHaveBeenCalledWith(
      'proj-1',
      'geotech-model-1',
      'geotech-edge-1',
    )
  })

  it('AC3 — the litho axis keeps its own accept, so the gate is about the axis', () => {
    renderOn('lithostratigraphic')

    expect(capturedPanelProps.onRequestAcceptEdge).toBeDefined()
  })
})

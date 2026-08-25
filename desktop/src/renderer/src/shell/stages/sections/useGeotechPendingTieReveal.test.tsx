// Pressing the pending chip has to ANSWER the count, drawable or not.
//
// Owner dogfeed 2026-08-25: *"now i get a one pending notification but i don't
// see any pending ties? Why don't we make that clickable so it highlights the
// tie?"* — the verified scene was one pending tie between a CPT the section
// draws and a borehole it does not, so the count said 1 and the canvas showed
// nothing.
//
//   PR1  a drawable tie is centred and flashed, and reports itself revealed
//   PR2  the panel is asked for the tie's two investigations, nothing else
//   PR3  an UNDRAWABLE tie comes back with a sentence naming both ends
//   PR4  the sentence names the true gate — here, hidden from the project
//   PR5  the sentence names the manifest gate when that is what fired
//   PR6  the sentence names the corridor when the endpoint is genuinely off it
//   PR7  a second press moves to the second tie; a third wraps to the first
//   PR8  nothing pending on this section reports 'none', never a false reveal
//   PR9  with no panel mounted it reports 'unavailable' rather than lying

import { act, cleanup, render } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type {
  LithoContactCorrelationEdge,
  LithoLayerResponse,
} from '../../../api/clients/geology.types'
import type {
  SectionColumnRevealFn,
  SectionColumnRevealResult,
} from '../../../components/sections/sectionColumnReveal'
import { makeLithoLayer } from './__fixtures__/lithoLayer'
import { makeSection } from './__fixtures__/sectionsShellContext'
import {
  useGeotechPendingTieReveal,
  type GeotechPendingTieRevealArgs,
  type PendingTieRevealOutcome,
} from './useGeotechPendingTieReveal'

afterEach(() => cleanup())

// ---------------------------------------------------------------------------
// Scene — the verified dogfeed scene, in miniature
// ---------------------------------------------------------------------------

const S4 = { id: 'cpt-s4', name: 'GEO-10/170-S4', location_x: 50, location_y: 0 }
const S9 = { id: 'cpt-s9', name: 'GEO-10/170-S9', location_x: 70, location_y: 0 }
/** On the line, well inside the corridor — the coordinator verified 3 m off. */
const B6 = { id: 'bh-b6', name: '1411-GEO-23/126-B6', location_x: 60, location_y: 3 }
/** Genuinely off the corridor, for the control. */
const FAR = { id: 'bh-far', name: 'FAR-1', location_x: 60, location_y: 400 }

const bandS4: LithoLayerResponse = makeLithoLayer({
  id: 'band-s4',
  cpt_id: 'cpt-s4',
  borehole_id: null,
  depth_top_m: 18.29,
  depth_base_m: 18.52,
})
const bandS9: LithoLayerResponse = makeLithoLayer({
  id: 'band-s9',
  cpt_id: 'cpt-s9',
  borehole_id: null,
  depth_top_m: 4,
  depth_base_m: 6,
})
const bandB6: LithoLayerResponse = makeLithoLayer({
  id: 'band-b6',
  cpt_id: null,
  borehole_id: 'bh-b6',
  depth_top_m: 13.9,
  depth_base_m: 18.05,
})
const bandFar: LithoLayerResponse = makeLithoLayer({
  id: 'band-far',
  cpt_id: null,
  borehole_id: 'bh-far',
  depth_top_m: 1,
  depth_base_m: 2,
})

function pendingEdge(
  id: string,
  a: string,
  b: string,
  over: Partial<LithoContactCorrelationEdge> = {},
): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: a,
    layer_b_id: b,
    layer_a_side: 'top',
    layer_b_side: 'top',
    model_id: 'geotech-model-1',
    section_id: 'sec-1',
    source: 'auto',
    user_approved: false,
    created_at: '2026-08-20T10:00:00Z',
    ...over,
  }
}

type Args = GeotechPendingTieRevealArgs

function baseArgs(over: Partial<Args> = {}): Omit<Args, 'revealRef'> {
  return {
    sectionId: 'sec-1',
    section: makeSection(),
    edges: [pendingEdge('e-1', 'band-s4', 'band-b6')],
    geotechLayers: [bandS4, bandS9, bandB6, bandFar],
    excludedFromModelIds: [],
    projectCpts: [S4, S9],
    projectBoreholes: [B6, FAR],
    visibleCptIds: ['cpt-s4', 'cpt-s9'],
    visibleBoreholeIds: ['bh-b6', 'bh-far'],
    removedCptIds: new Set<string>(),
    removedBoreholeIds: new Set<string>(),
    columnFocusOn: false,
    ...over,
  }
}

/**
 * Mount the hook with a stubbed panel, and expose the press.
 *
 * The stub stands in for ``SectionPanel``: it answers which of the requested
 * columns it is drawing, which is the ONLY thing the panel is the authority on.
 */
function mountReveal(
  args: Omit<Args, 'revealRef'>,
  panel: SectionColumnRevealFn | null,
): { press: () => PendingTieRevealOutcome; requests: string[][] } {
  const requests: string[][] = []
  let press!: () => PendingTieRevealOutcome
  function Host(): JSX.Element {
    const revealRef = useRef<SectionColumnRevealFn | null>(
      panel === null
        ? null
        : req => {
            requests.push([...req.investigationIds])
            return panel(req)
          },
    )
    press = useGeotechPendingTieReveal({ ...args, revealRef })
    return <div />
  }
  render(<Host />)
  return { press: () => press(), requests }
}

/** A panel that draws exactly the named investigations. */
function panelDrawing(...drawn: string[]): SectionColumnRevealFn {
  return (req): SectionColumnRevealResult => {
    const missing = req.investigationIds.filter(id => !drawn.includes(id))
    return { revealed: missing.length === 0, missingInvestigationIds: missing }
  }
}

// ---------------------------------------------------------------------------
// PR1-PR2 — the tie the section CAN draw
// ---------------------------------------------------------------------------

describe('useGeotechPendingTieReveal — a tie the section draws', () => {
  it('PR1: it is revealed, and the edge to flash is the pending one', () => {
    const panel = vi.fn(panelDrawing('cpt-s4', 'bh-b6'))
    const { press } = mountReveal(baseArgs(), panel)
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    expect(outcome).toEqual({ kind: 'revealed', edgeId: 'e-1' })
    expect(panel).toHaveBeenCalledWith(expect.objectContaining({ flashEdgeId: 'e-1' }))
  })

  it('PR2: the panel is asked for the tie’s two investigations, and only those', () => {
    const { press, requests } = mountReveal(baseArgs(), panelDrawing('cpt-s4', 'bh-b6'))
    act(() => {
      press()
    })
    expect(requests).toEqual([['cpt-s4', 'bh-b6']])
  })
})

// ---------------------------------------------------------------------------
// PR3-PR6 — the tie the section CANNOT draw: the dogfeed case
// ---------------------------------------------------------------------------

describe('useGeotechPendingTieReveal — a tie the section cannot draw', () => {
  it('PR3: it comes back with a sentence naming BOTH ends and their depths', () => {
    const { press } = mountReveal(
      baseArgs({ removedBoreholeIds: new Set(['bh-b6']), visibleBoreholeIds: ['bh-far'] }),
      panelDrawing('cpt-s4'),
    )
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    expect(outcome.kind).toBe('undrawable')
    const message = outcome.kind === 'undrawable' ? outcome.message : ''
    expect(message).toContain('GEO-10/170-S4')
    expect(message).toContain('18.29')
    expect(message).toContain('1411-GEO-23/126-B6')
    expect(message).toContain('13.90')
  })

  it('PR4: it names the gate that actually fired — the project-local hide', () => {
    const { press } = mountReveal(
      baseArgs({ removedBoreholeIds: new Set(['bh-b6']), visibleBoreholeIds: ['bh-far'] }),
      panelDrawing('cpt-s4'),
    )
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    const message = outcome.kind === 'undrawable' ? outcome.message : ''
    expect(message).toMatch(/removed from this project view/i)
    // and NOT the corridor: B6 is 3 m off a 50 m buffer, so blaming the
    // corridor would send the engineer to widen something that is already fine.
    expect(message).not.toMatch(/corridor/i)
  })

  it('PR5: it names the project-file gate when THAT is what dropped the column', () => {
    // In the project's investigation list, not removed by hand, but absent from
    // the visible list — the App-level manifest gate: imported in an earlier
    // session that was never saved into the project file.
    const { press } = mountReveal(
      baseArgs({ visibleBoreholeIds: ['bh-far'] }),
      panelDrawing('cpt-s4'),
    )
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    const message = outcome.kind === 'undrawable' ? outcome.message : ''
    expect(message).toMatch(/not part of the project file/i)
  })

  it('PR6: it names the corridor when the endpoint really is off it', () => {
    const { press } = mountReveal(
      baseArgs({ edges: [pendingEdge('e-far', 'band-s4', 'band-far')] }),
      panelDrawing('cpt-s4'),
    )
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    const message = outcome.kind === 'undrawable' ? outcome.message : ''
    expect(message).toMatch(/corridor/i)
  })
})

// ---------------------------------------------------------------------------
// PR7-PR9 — the walk
// ---------------------------------------------------------------------------

describe('useGeotechPendingTieReveal — walking the pending ties', () => {
  it('PR7: a second press takes the second tie, and a third wraps back', () => {
    const two = [
      pendingEdge('e-first', 'band-s4', 'band-s9', { created_at: '2026-08-01T00:00:00Z' }),
      pendingEdge('e-second', 'band-s9', 'band-b6', { created_at: '2026-08-02T00:00:00Z' }),
    ]
    const { press } = mountReveal(baseArgs({ edges: two }), panelDrawing('cpt-s4', 'cpt-s9', 'bh-b6'))
    const seen: string[] = []
    act(() => {
      for (let i = 0; i < 3; i += 1) {
        const outcome = press()
        seen.push(outcome.kind === 'revealed' ? outcome.edgeId : outcome.kind)
      }
    })
    expect(seen).toEqual(['e-first', 'e-second', 'e-first'])
  })

  it('PR8: nothing pending on this section reports none — never a false reveal', () => {
    const { press } = mountReveal(
      baseArgs({ edges: [pendingEdge('e-1', 'band-s4', 'band-b6', { user_approved: true })] }),
      panelDrawing('cpt-s4', 'bh-b6'),
    )
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    expect(outcome).toEqual({ kind: 'none' })
  })

  it('PR9: with no section panel mounted it says so, rather than claiming success', () => {
    const { press } = mountReveal(baseArgs(), null)
    let outcome!: PendingTieRevealOutcome
    act(() => {
      outcome = press()
    })
    expect(outcome).toEqual({ kind: 'unavailable' })
  })
})

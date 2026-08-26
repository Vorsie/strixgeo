// TC — the section SHOWS which two ties are fighting.
//
// Owner ruling 2026-08-26 ("mark the crossing ties"): when two accepted ties cross they
// mutually suspend — neither bands — and until today the only evidence was a chip
// counting them. The engineer could see that something was wrong and not which two lines
// caused it.
//
// The pair marked here is the pair the chip means, by construction: the keys come from
// the very `TieConflict.edgeKeys` the chip counts, matched through the SAME `edgeKey`
// function the engine used to build them. Nothing is recomputed — a second derivation is
// exactly how a marker drifts from the conflict it claims to name.
//
// The treatment is asserted on PROPERTIES, not on a hex value: a marker exists, it is not
// the tie's own line, and it carries a dash so the state survives a monochrome display
// (WCAG 2.2 §1.4.1 — no information by colour alone).

import { cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import type { LithoContactCorrelationEdge } from '../../api/client'
import { edgeKey } from '../../utils/partitionFillV2'
import type { TieConflict } from '../../utils/partitionFillV2'
import CorrelationEdgesOverlay from './CorrelationEdgesOverlay'
import { overlayEdgeSource } from './correlationOverlayAxis'
import { makeColumn, makeContact, makeFormation } from './__fixtures__/correlationOverlayScene'

/**
 * An accepted geotech tie between two named band contacts.
 *
 * The fixture's own `makeGeotechEdge` pins every edge to one contact pair, which cannot
 * express a CONFLICT — that needs two distinct ties.
 */
function makeTie(
  id: string,
  layerA: string,
  layerB: string,
): LithoContactCorrelationEdge {
  return {
    id,
    layer_a_id: layerA,
    layer_b_id: layerB,
    model_id: 'geotech-model-1',
    section_id: 'sec-1',
    source: 'manual',
    user_approved: true,
    layer_a_side: 'top',
    layer_b_side: 'top',
    created_at: '2026-01-01T00:00:00Z',
  }
}

/** The keys the engine would report for a conflict between these two ties. */
function conflictBetween(
  x: LithoContactCorrelationEdge,
  y: LithoContactCorrelationEdge,
): TieConflict {
  const keys: [string, string] = [
    edgeKey({ a: x.layer_a_id, b: x.layer_b_id, aSide: x.layer_a_side, bSide: x.layer_b_side }),
    edgeKey({ a: y.layer_a_id, b: y.layer_b_id, aSide: y.layer_a_side, bSide: y.layer_b_side }),
  ]
  return { gapIndex: 0, tieIds: keys, edgeKeys: keys }
}

/**
 * Three columns carrying one band each, tied A–B, B–C and A–C.
 *
 * @param conflicts The conflicts the fill engine reported, exactly as the chip receives
 *   them. Omitted = a section with nothing fighting.
 * @param sameLithology When false the tie ends sit in different lithologies, which is the
 *   overlay's OTHER draw path (an open polyline instead of a closed ribbon).
 */
function renderScene(conflicts: readonly TieConflict[], sameLithology = true) {
  const fA = makeFormation('f-nad-12', 'NAD 12')
  const fB = sameLithology ? fA : { ...makeFormation('f-nad-4', 'NAD 4'), litho_main_soil_code: 'KLEI' }
  const conflictEdgeKeys = new Set(conflicts.flatMap(c => c.edgeKeys))
  return render(
    <svg>
      <CorrelationEdgesOverlay
        contacts={[
          makeContact('ca', fA.id, 'inv-A', 2.0),
          makeContact('cb', fB.id, 'inv-B', 2.0),
          makeContact('cc', fA.id, 'inv-C', 2.0),
        ]}
        formations={[fA, fB]}
        placedColumns={[
          makeColumn('inv-A', 100, 5),
          makeColumn('inv-B', 200, 20),
          makeColumn('inv-C', 300, 35),
        ]}
        levelToScreen={(level: number) => 20 + (10 - level) * 10}
        plotTop={20}
        plotBottom={200}
        contactEdges={overlayEdgeSource('geotechnical', [], [TIE_AB, TIE_BC, TIE_AC])}
        acceptEdgeLabel="Accept tie"
        conflictEdgeKeys={conflictEdgeKeys}
      />
    </svg>,
  )
}

const TIE_AB = makeTie('tie-ab', 'ca', 'cb')
const TIE_BC = makeTie('tie-bc', 'cb', 'cc')
/** The bystander: accepted, drawn, and not part of any conflict. */
const TIE_AC = makeTie('tie-ac', 'ca', 'cc')

/** The conflict marker drawn for one tie, if any. */
function marker(container: HTMLElement, tieId: string): Element | null {
  return container.querySelector(`[data-testid="tie-conflict-${tieId}"]`)
}

describe('CorrelationEdgesOverlay — crossing ties are marked in the section', () => {
  afterEach(() => {
    cleanup()
  })

  it('TC1 — both ties of a conflicting pair are marked', () => {
    const { container } = renderScene([conflictBetween(TIE_AB, TIE_BC)])

    expect(marker(container, 'tie-ab')).not.toBeNull()
    expect(marker(container, 'tie-bc')).not.toBeNull()
  })

  it('TC2 — a tie that is not in conflict is never marked', () => {
    const { container } = renderScene([conflictBetween(TIE_AB, TIE_BC)])

    expect(marker(container, 'tie-ac')).toBeNull()
  })

  it('TC3 — a section with no conflicts marks nothing at all', () => {
    const { container } = renderScene([])

    expect(container.querySelector('[data-testid^="tie-conflict-"]')).toBeNull()
  })

  it('TC4 — the marked pair is the pair the chip counts', () => {
    // The chip's Nth press centres conflicts[N]; whatever that entry names must be what
    // is marked. Driving the render from the entry itself is the whole point — a marker
    // built from its own re-derivation could disagree and still look right here.
    const conflict = conflictBetween(TIE_BC, TIE_AC)
    const { container } = renderScene([conflict])

    expect(marker(container, 'tie-bc')).not.toBeNull()
    expect(marker(container, 'tie-ac')).not.toBeNull()
    expect(marker(container, 'tie-ab')).toBeNull()
  })

  it('TC5 — the marker does not rely on colour alone', () => {
    const { container } = renderScene([conflictBetween(TIE_AB, TIE_BC)])
    const el = marker(container, 'tie-ab')!

    expect(el.getAttribute('stroke-dasharray')).toBeTruthy()
    // Wider than the tie it marks, so it reads as a halo around the line rather than as
    // a restyling of the line — the tie keeps saying what kind of tie it is.
    expect(Number(el.getAttribute('stroke-width'))).toBeGreaterThan(2)
  })

  it('TC6 — the marker never eats the gesture on the tie beneath it', () => {
    const { container } = renderScene([conflictBetween(TIE_AB, TIE_BC)])
    const el = marker(container, 'tie-ab')!

    expect(el.getAttribute('pointer-events')).toBe('none')
  })

  it('TC7 — a cross-lithology tie is marked too, on its own draw path', () => {
    // A conflict does not care whether the two ends share a lithology, but the overlay
    // draws those two cases with different elements — a marker wired into only one path
    // would vanish on half the real sections.
    const { container } = renderScene([conflictBetween(TIE_AB, TIE_BC)], false)

    expect(marker(container, 'tie-ab')).not.toBeNull()
  })
})

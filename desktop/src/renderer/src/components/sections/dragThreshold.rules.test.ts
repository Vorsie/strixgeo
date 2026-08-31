/**
 * dragThreshold.rules.test.ts — S105 gate: "a plain CLICK on a litho boundary must NOT
 * reshape/correlate; only a deliberate DRAG past the threshold reshapes" (owner dogfeed
 * 2026-07-24: "i click on the position of the marker and this weird clay quad appears out
 * of nowhere").
 *
 * The rule, in the owner's words: a press-without-drag must leave the boundary "exactly as
 * it was" — no synthetic tie injected, no correlation POSTed, NO fill change; the "clay
 * quad" (a real pinched-out clay snapped to a band by the accidental correlation) must not
 * appear. A press-then-drag past a MINIMUM travel (``DRAG_THRESHOLD``) fires the S103
 * correlate-on-drag as before (snap wedge→band, bend to cursor) and persists on release.
 *
 * THE MECHANISM (S103, gated by S105): the correlate-on-drag injects
 * ``synthesizeContactTie`` into the engine edges the instant an ``isNew`` boundary drag
 * starts. S105 gates that WHEN on ``dragCrossedThreshold(origin, cursor)`` — the injection
 * (and the release persist/POST) is applied ONLY once the cursor has moved ≥ threshold
 * from the mousedown origin. This gate drives the pure decision (``dragCrossedThreshold``)
 * AND its effect on the real engine fill (``pendingContactTieForDrag`` → the injected tie)
 * on the same minimal synthetic two-full-band section the S103 gate uses.
 *
 * RED on pre-S105 code: there is no threshold — the tie injects on mousedown regardless of
 * movement, so a zero-movement click reshapes the fill (the clay quad). GREEN after: a
 * zero-movement click is a no-op (fill byte-identical to the un-tied pinch); a past-
 * threshold drag reshapes exactly as S103.
 */
import { describe, expect, it } from 'vitest'

import { type CorrelationEdge, type PartitionColumn, type SectionRegion } from '../../utils/sectionPartition'
import { computeSectionFillV2 } from '../../utils/partitionFillV2'
import { setTwoSidedTerminations } from '../../utils/partitionFillV2/tileFlags'
import { pendingContactTieForDrag } from './correlateOnDrag'
import { DRAG_THRESHOLD, dragCrossedThreshold } from './dragThreshold'

// Two columns: ZAND (top) over KLEI (bottom) on BOTH — a two-full-band boundary. No edges
// → the ZAND/KLEI contact carries NO tie → renders as a pinch/wedge (0 corr → LENS). This
// is the un-correlated boundary a click must NOT snap to a band.
const ZAND = 'body-zand'
const KLEI = 'body-klei'

function twoFullBandColumns(): PartitionColumn[] {
  const mk = (invId: string): PartitionColumn => ({
    investigationId: invId,
    surfaceElevM: 10,
    units: [
      { topDepthM: 0, baseDepthM: 5, formationId: 'zand', bodyId: ZAND, layerId: `${invId}-zand` },
      { topDepthM: 5, baseDepthM: 12, formationId: 'klei', bodyId: KLEI, layerId: `${invId}-klei` },
    ],
  })
  return [mk('A'), mk('B')]
}

/** A stable signature of the gap-0 fill regions (order-independent). */
function fillSig(regions: SectionRegion[]): string {
  return regions
    .filter((r) => r.gapIndex === 0)
    .map((r) => `${r.bodyId}|${r.kind}|${r.polygon.map((p) => `${p.fraction.toFixed(4)},${p.elevation.toFixed(4)}`).join(';')}`)
    .sort()
    .join('#')
}

/**
 * Emulate the overlay's S105-gated correlate-on-drag: build the engine ``edges`` and, for
 * an ``isNew`` boundary drag, inject the synthetic tie ONLY when the drag crossed the
 * threshold from its mousedown origin. Returns the fill regions.
 */
function fillForGatedDrag(
  columns: readonly PartitionColumn[],
  origin: { x0: number; y0: number },
  cursor: { x: number; y: number },
): SectionRegion[] {
  const edges: CorrelationEdge[] = []
  // The S105 WHEN-gate: only a deliberate drag injects the tie.
  if (dragCrossedThreshold(origin, cursor)) {
    const tie = pendingContactTieForDrag(columns, 0, ZAND, KLEI, edges)
    if (tie) edges.push(tie.edge)
  }
  return computeSectionFillV2([...columns], edges)
}

describe('S105 — a click on a litho boundary is inert; only a drag past the threshold reshapes', () => {
  it('the pure threshold decision: zero movement = click (false); past threshold = drag (true)', () => {
    const origin = { x0: 300, y0: 200 }
    // A pure click: release at the exact mousedown point.
    expect(dragCrossedThreshold(origin, { x: 300, y: 200 }), 'zero-movement press is a click').toBe(false)
    // Sub-threshold jitter (2 px) is still a click.
    expect(dragCrossedThreshold(origin, { x: 301, y: 201 }), 'a pixel of hand jitter is still a click').toBe(false)
    // A deliberate drag past the threshold.
    expect(
      dragCrossedThreshold(origin, { x: 300 + DRAG_THRESHOLD + 1, y: 200 }),
      'a move past the threshold is a deliberate drag',
    ).toBe(true)
    // Diagonal travel exactly at the threshold crosses it.
    const d = DRAG_THRESHOLD / Math.SQRT2 + 0.01
    expect(dragCrossedThreshold(origin, { x: 300 + d, y: 200 + d }), 'diagonal travel ≥ threshold is a drag').toBe(true)
  })

  it('a CLICK (zero movement) does NOT correlate: the fill stays the un-tied pinch, no clay quad', () => {
    setTwoSidedTerminations(true)
    try {
      const columns = twoFullBandColumns()
      // The un-tied baseline: NO drag at all → the pinch/wedge fill.
      const baseline = fillSig(computeSectionFillV2(columns, []))

      // A click: mousedown + mouseup at the SAME point (the marker). Below the threshold.
      const origin = { x0: 300, y0: 200 }
      const clicked = fillForGatedDrag(columns, origin, { x: 300, y: 200 })
      expect(fillSig(clicked), 'a click reshaped the fill (the clay quad appeared out of nowhere)').toBe(baseline)
    } finally {
      setTwoSidedTerminations(false)
    }
  })

  it('a DRAG past the threshold DOES correlate: the wedge snaps to a band (the S103 reshape)', () => {
    setTwoSidedTerminations(true)
    try {
      const columns = twoFullBandColumns()
      const baseline = fillSig(computeSectionFillV2(columns, []))

      const origin = { x0: 300, y0: 200 }
      // A deliberate drag well past the threshold.
      const dragged = fillForGatedDrag(columns, origin, { x: 300 + DRAG_THRESHOLD + 20, y: 220 })
      const draggedSig = fillSig(dragged)
      // The drag correlated the boundary → the fill CHANGED (wedge → flat band).
      expect(draggedSig, 'a deliberate drag did not reshape the boundary').not.toBe(baseline)
      // ZAND + KLEI each snap to a single band (the S103 wedge→band snap).
      const zand = dragged.filter((r) => r.bodyId === ZAND && r.gapIndex === 0)
      const klei = dragged.filter((r) => r.bodyId === KLEI && r.gapIndex === 0)
      expect(zand.length, 'ZAND snaps to a single band on a real drag').toBe(1)
      expect(klei.length, 'KLEI snaps to a single band on a real drag').toBe(1)
    } finally {
      setTwoSidedTerminations(false)
    }
  })
})

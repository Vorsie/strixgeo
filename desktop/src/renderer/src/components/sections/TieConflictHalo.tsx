/**
 * The mark that says "this tie is fighting another one".
 *
 * Owner ruling 2026-08-26: *"mark the crossing ties"* — the other half of the crossing-tie
 * chip. Two accepted ties that cross suspend EACH OTHER, so neither bands; the chip has
 * been able to count and centre those conflicts for a while, but the section never said
 * which two lines were the cause. This is that.
 *
 * Drawn as a fat dashed stroke BEHIND the tie it marks, the same idiom as
 * ``TieFlashHalo``: the tie keeps its own colour and dash, so it still reads as approved
 * / interpretive / cross-lithology while it reads as in-conflict. A marker that restyles
 * its subject has replaced information, not added it.
 *
 * Unlike the landing pulse this is a STATE, not an event — it does not animate and it
 * does not time out. It disappears when the engineer deletes one of the two ties, which
 * is the only thing that resolves the conflict.
 *
 * Its own file rather than another block inside the 1 500-line
 * ``CorrelationEdgesOverlay`` (debt #201).
 */

import {
  TIE_CONFLICT_COLOR,
  TIE_CONFLICT_DASH,
  TIE_CONFLICT_OPACITY,
  TIE_CONFLICT_WIDTH_PX,
} from './TieConflictHalo_constants'

/** Props: the geometry to trace, and whether that geometry closes. */
export interface Props {
  /** SVG ``points`` string of the tie being marked, verbatim from its own shape. */
  points: string
  /**
   * ``true`` when the tie draws as a closed ring (the same-lithology ribbon), ``false``
   * for an open polyline (a cross-lithology surface tie). Tracing a ring with a polyline
   * would leave a visible gap at the join.
   */
  closed: boolean
  /** The edge id, so a test can assert WHICH tie is being marked. */
  edgeId: string
}

/**
 * Render the conflict marker over one tie.
 *
 * Parameters
 * ----------
 * points : string
 *     The tie's own ``points`` string — passed through untouched so the marker can never
 *     drift from the shape it marks.
 * closed : boolean
 *     Whether to trace it as a polygon (ring) or a polyline (open path).
 * edgeId : string
 *     Correlation-edge id, used only for the test id.
 *
 * Returns
 * -------
 * JSX.Element
 *     The marker shape.
 */
export default function TieConflictHalo({ points, closed, edgeId }: Props): JSX.Element {
  const shared = {
    'data-testid': `tie-conflict-${edgeId}`,
    points,
    fill: 'none',
    stroke: TIE_CONFLICT_COLOR,
    strokeWidth: TIE_CONFLICT_WIDTH_PX,
    strokeOpacity: TIE_CONFLICT_OPACITY,
    strokeDasharray: TIE_CONFLICT_DASH,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    pointerEvents: 'none' as const,
  }
  return closed ? <polygon {...shared} /> : <polyline {...shared} />
}

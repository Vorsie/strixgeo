/**
 * The pulse that says "this is the tie you asked for".
 *
 * Owner ask 2026-08-25: *"Why don't we make that clickable so it highlights the
 * tie?"* — the toolbar's pending chip centres the tie, and this is what marks
 * it once the camera has landed. Same idiom as the Ctrl+F column landing flash:
 * a brief amber pulse, ``pointerEvents: none`` so it can never eat the gesture
 * that follows, and gone again on its own.
 *
 * Drawn as a fat, low-opacity stroke BEHIND the tie it marks, so the tie's own
 * dashes stay readable through it — a highlight that hides its subject is not
 * one. Its own file rather than another block inside the 1 500-line
 * ``CorrelationEdgesOverlay`` (debt #201).
 */

import { TIE_FLASH_COLOR, TIE_FLASH_OPACITY, TIE_FLASH_WIDTH_PX } from './TieFlashHalo_constants'

/** Props: the geometry to trace, and whether that geometry closes. */
export interface Props {
  /** SVG ``points`` string of the tie being marked, verbatim from its own shape. */
  points: string
  /**
   * ``true`` when the tie draws as a closed ring (the pending ribbon's
   * outline), ``false`` for an open polyline (a cross-lithology surface tie).
   * Tracing a ring with a polyline would leave a visible gap at the join.
   */
  closed: boolean
  /** The edge id, so a test can assert WHICH tie is being marked. */
  edgeId: string
}

/**
 * Render the amber pulse over one tie.
 *
 * Parameters
 * ----------
 * points : string
 *     The tie's own ``points`` string — passed through untouched so the halo
 *     can never drift from the shape it marks.
 * closed : boolean
 *     Whether to trace it as a polygon (ring) or a polyline (open path).
 * edgeId : string
 *     Correlation-edge id, used only for the test id.
 *
 * Returns
 * -------
 * JSX.Element
 *     The halo shape.
 */
export default function TieFlashHalo({ points, closed, edgeId }: Props): JSX.Element {
  const shared = {
    'data-testid': `tie-flash-${edgeId}`,
    points,
    fill: 'none',
    stroke: TIE_FLASH_COLOR,
    strokeWidth: TIE_FLASH_WIDTH_PX,
    strokeOpacity: TIE_FLASH_OPACITY,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'animate-pulse',
    pointerEvents: 'none' as const,
  }
  return closed ? <polygon {...shared} /> : <polyline {...shared} />
}

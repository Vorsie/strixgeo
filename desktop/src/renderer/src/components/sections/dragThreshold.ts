/**
 * dragThreshold.ts — the S105 click-vs-drag gate for the litho-boundary freedraw
 * gestures. Pure module: no React, no I/O, no Date.now / Math.random.
 *
 * Why this exists (S105 owner dogfeed 2026-07-24: "i click on the position of the marker
 * and this weird clay quad appears out of nowhere"). The S103 correlate-on-drag injects
 * the synthetic tie the INSTANT a boundary drag starts (``isNew``) and persists it on
 * release — so a press WITHOUT drag fires the whole mechanism: it snaps a pinched-out
 * (wedged) layer to a flat band on mousedown and POSTs the correlation on mouseup, even
 * with ZERO cursor movement. The "clay quad" is a real pinched-out clay the click
 * accidentally correlated.
 *
 * The fix: the correlate-on-drag (live tie injection AND on-release persist) and any
 * ``isNew`` node creation fire ONLY after the cursor has moved a minimum distance
 * (``DRAG_THRESHOLD``) from the mousedown origin. A pure click (press-release at the same
 * point) is inert — nothing injected, nothing persisted, no correlation POSTed, no fill
 * change. The threshold is tiny, so a real drag still creates+grabs in one motion; only a
 * pure click is a no-op. Applies to BOTH the boundary/correlate path AND the lens/apex
 * ``isNew`` press-to-grab.
 */

/**
 * Minimum cursor travel (screen px) from a drag's mousedown origin before the drag is
 * treated as a DELIBERATE drag rather than a click.
 *
 * ~4 px: below the ~5 px OS double-click slop, so a real drag crosses it almost
 * instantly (the press-to-grab feel is preserved), yet a genuine click — even with a
 * pixel or two of hand jitter — stays under it and reshapes nothing.
 */
export const DRAG_THRESHOLD = 4

/**
 * Whether a drag has moved past ``DRAG_THRESHOLD`` from its mousedown origin — i.e. it is
 * a deliberate drag, not a click.
 *
 * Returns ``false`` when the origin is unknown (``x0``/``y0`` absent) at the current
 * cursor position, i.e. treated as "not yet moved" — the gated action stays suppressed
 * until a real move updates the cursor away from the (defaulted) origin. In the overlay
 * the origin is always stamped at mousedown, so this only guards pre-S105 fixtures.
 *
 * Parameters
 * ----------
 * origin : { x0?: number; y0?: number }
 *     The drag's mousedown origin (``BoundaryDrag`` / ``LensDrag`` ``x0``/``y0``).
 * cursor : { x: number; y: number }
 *     The drag's current (clamped) live cursor screen position.
 * threshold : number
 *     Minimum travel in px (defaults to ``DRAG_THRESHOLD``).
 *
 * Returns
 * -------
 * boolean
 *     True when ``hypot(cursor - origin) >= threshold`` (a deliberate drag).
 */
export function dragCrossedThreshold(
  origin: { x0?: number; y0?: number },
  cursor: { x: number; y: number },
  threshold: number = DRAG_THRESHOLD,
): boolean {
  const x0 = origin.x0
  const y0 = origin.y0
  // Unknown origin → cannot prove deliberate movement → treat as a click (suppressed).
  if (x0 === undefined || y0 === undefined) return false
  const dx = cursor.x - x0
  const dy = cursor.y - y0
  return Math.hypot(dx, dy) >= threshold
}

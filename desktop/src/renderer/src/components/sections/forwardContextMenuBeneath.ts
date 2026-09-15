/**
 * Re-dispatch a right-click to the element BENEATH the one that caught it.
 *
 * Some section overlays draw transparent hit rects ON TOP of the band-edit
 * overlay's own hit rects — the lab-sample capsules (``SampleGeotechOverlay``)
 * sit over a borehole's packing bands. A right-click on such a rect must reach
 * the band BENEATH it (opening the band menu), not bubble up to the section's
 * ``<svg onContextMenu>`` catch-all that opens the COLUMN menu (owner installer
 * #37 dogfeed, GEO-99/201-B1: "right-clicking one of B1's packing bands opens
 * the column menu, never the band menu"). The covering rect has no meaning for a
 * right-click, so it forwards the event straight through.
 *
 * The mechanism mirrors ``ContactsLayer``'s dismiss-backdrop re-resolve: the
 * caller cannot let the event fall through (it already IS the hit target), so it
 * finds the topmost hit-testable element under the cursor that it does not own
 * and fires a bubbling ``contextmenu`` there. React's delegated listener then
 * runs that element's own ``onContextMenu`` exactly as if the covering rect were
 * not present, so the band overlay opens its band menu at the clicked band.
 *
 * ``elementsFromPoint`` already respects ``pointer-events``, so an element the
 * caller painted with ``pointer-events: none`` (e.g. the visible capsule) never
 * appears in the stack — only real hit targets do.
 *
 * Parameters
 * ----------
 * clientX
 *     Viewport x of the right-click (``MouseEvent.clientX``).
 * clientY
 *     Viewport y of the right-click (``MouseEvent.clientY``).
 * ownedBy
 *     Predicate returning ``true`` for an element the caller owns and must skip,
 *     so the forward lands on the FIRST element the caller does not own — the
 *     band (or the column glyph, when the cursor is past the bands, which is
 *     itself the correct target for the column menu).
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the event was forwarded to an element beneath; ``false``
 *     when nothing lay beneath, the event carried no usable point, or the
 *     environment has no hit-testing (jsdom returns an empty stack).
 */
export function forwardContextMenuBeneath(
  clientX: number,
  clientY: number,
  ownedBy: (el: Element) => boolean,
): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false
  // A synthetic contextmenu built as a plain Event (a test's dispatchEvent, an
  // assistive tool) has no clientX/clientY. Chromium's elementsFromPoint throws
  // on a non-finite coordinate, which would kill the caller's handler before it
  // opens its own menu; without a point there is nothing to re-aim at anyway.
  if (!Number.isFinite(clientX) || !Number.isFinite(clientY)) return false
  const beneath = document
    .elementsFromPoint(clientX, clientY)
    .find((el) => !ownedBy(el))
  if (beneath === undefined) return false
  beneath.dispatchEvent(
    new MouseEvent('contextmenu', {
      bubbles: true,
      cancelable: true,
      clientX,
      clientY,
      button: 2,
    }),
  )
  return true
}

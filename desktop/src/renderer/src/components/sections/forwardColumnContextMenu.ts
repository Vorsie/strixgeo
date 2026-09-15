/**
 * Re-aim a right-click that a FILL overlay caught back onto the COLUMN beneath it.
 *
 * WHY THIS EXISTS — installer #40 dogfeed (owner, verbatim): *"litho axis edit
 * composition is fine (when the model overlay is there, it eats my click however
 * and i only get unit statistics)"*.
 *
 * On the litho axis the section stacks (bottom → top): ``ContactsLayer`` (its
 * per-column litho-band rects + the per-column right-click capture rect, which
 * open the UNIFIED column menu ``litho-band-context-menu``), then
 * ``PartitionFillOverlay`` (Fill bands), then ``ModelFillOverlay`` (the fill cut
 * from the built 3-D solids). SVG paints in document order with no z-index, so
 * the fill overlays sit ON TOP. Their region handlers answer a right-click first
 * — the body menu (Name body / Dissolve / Unit statistics) or the model fill's
 * "Unit statistics…" — and ``stopPropagation`` so the ContactsLayer band beneath
 * never sees it.
 *
 * RULE (owner): a right-click over a COLUMN (inside its half-width) always opens
 * the unified column menu, whatever overlay is painted; the fill's body menu is
 * for the fill BETWEEN columns only. This helper implements the mechanism: the
 * overlay's contextmenu handler asks this to forward the click to the column
 * surface beneath, and only opens its own menu when the click was NOT on a column
 * (i.e. this returned ``false``).
 *
 * It reuses ``forwardContextMenuBeneath`` — the same dismiss-backdrop re-resolve
 * ``SampleGeotechOverlay`` uses to reach the packing band under a lab-sample
 * capsule — with an ``ownedBy`` predicate that treats EVERYTHING except a
 * ContactsLayer column surface as "owned" (skipped). ``forwardContextMenuBeneath``
 * then dispatches a bubbling ``contextmenu`` on the FIRST column surface in the
 * hit stack, so the band's own ``onContextMenu`` opens the column menu exactly as
 * a first-hand right-click would; both fill overlays' elements are skipped, so a
 * second painted fill can never steal it. A miss (the point lies between columns,
 * so no column surface is beneath) returns ``false`` and the caller keeps its own
 * menu.
 */

import { forwardContextMenuBeneath } from './forwardContextMenuBeneath'

/**
 * ``data-testid`` prefixes of the ContactsLayer surfaces that own the unified
 * column menu: the per-column accepted-unit litho bands (right-click → the band
 * menu) and the per-column full-height capture rect (right-click on empty column
 * space → "Add new suggestion here"). Any element whose testid starts with one of
 * these is a column surface the forward should land on.
 */
const COLUMN_MENU_SURFACE_TESTID_PREFIXES = [
  'per-column-litho-band-',
  'per-column-rclick-capture-',
] as const

/**
 * Whether an element is a ContactsLayer column surface that owns the unified
 * column menu.
 *
 * @param el - A DOM element from the hit-test stack.
 * @returns ``true`` when the element is a per-column litho band or the per-column
 *   right-click capture rect.
 */
export function isColumnMenuSurface(el: Element): boolean {
  const testid = el.getAttribute('data-testid')
  if (testid === null) return false
  return COLUMN_MENU_SURFACE_TESTID_PREFIXES.some((prefix) => testid.startsWith(prefix))
}

/**
 * Forward a fill overlay's right-click to the ContactsLayer column surface
 * beneath it, when the point lies on a column.
 *
 * @param clientX - Viewport x of the right-click (``MouseEvent.clientX``).
 * @param clientY - Viewport y of the right-click (``MouseEvent.clientY``).
 * @returns ``true`` when a column surface lay beneath and received the forwarded
 *   ``contextmenu`` (the caller must NOT open its own menu); ``false`` when the
 *   point lies between columns (no column surface beneath), or the environment
 *   has no hit-testing — the caller then opens its own menu as before.
 */
export function forwardContextMenuToColumn(clientX: number, clientY: number): boolean {
  // "Own" (skip) everything that is not a column surface: the fill overlay's own
  // element, the second fill overlay, the section svg. ``forwardContextMenuBeneath``
  // then lands on the FIRST column surface in the stack (the accepted-unit band
  // wins on its own rect, else the full-height capture rect underneath it).
  return forwardContextMenuBeneath(clientX, clientY, (el) => !isColumnMenuSurface(el))
}

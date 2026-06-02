/**
 * Right-click context menu for a ghost pinch-out candidate wedge.
 *
 * Renders two top-level rows — "Accept" and "Dismiss" — so the user can act
 * on a single candidate without committing to the whole candidate list.
 * Right-click is already a deliberate gesture, so these items fire without a
 * confirmation dialog.
 *
 * Rendered inside the SVG canvas via ContextMenu's ``portal="svg"`` variant
 * so it floats above the ghost geometry without fighting the DOM stacking
 * context.
 *
 * @remarks
 * Dismiss removes the candidate from the local list without a DB write —
 * it is a pure UI gesture.  Accept fires ``onAccept`` which calls the
 * backend ``claimBodyExtent`` via the parent chain.
 */

import ContextMenu from '../ui/ContextMenu'
import type { PinchOutCandidate } from '../../api/client'

export interface GhostContextMenuProps {
  /** Screen X of the context-menu anchor (SVG coordinates). */
  x: number
  /** Screen Y of the context-menu anchor (SVG coordinates). */
  y: number
  /** The ghost candidate the user right-clicked. */
  candidate: PinchOutCandidate
  /** Fired when the user picks "Accept" — claims the suggested extent. */
  onAccept: (candidate: PinchOutCandidate) => void
  /** Fired when the user picks "Dismiss" — removes this suggestion only
   *  (no DB write). */
  onDismiss: (candidate: PinchOutCandidate) => void
  /** Close callback — the menu is dismissed. */
  onClose: () => void
}

/** data-testid values for menu items (referenced in GhostContextMenu.test.tsx). */
export const GHOST_CTX_TESTIDS = {
  accept: 'ghost-ctx-accept',
  dismiss: 'ghost-ctx-dismiss',
}

/**
 * Context menu for a ghost pinch-out candidate.
 *
 * Renders via ContextMenu portal="svg" — must be placed inside the SVG that
 * owns the section canvas.  The ``width`` / ``height`` are set generously so
 * the menu panel has room; the menu auto-sizes to its content.
 *
 * Parameters
 * ----------
 * x, y
 *     SVG-canvas coordinates for the menu origin.
 * candidate
 *     The ghost candidate the user right-clicked.
 * onAccept
 *     Fired when the user picks the Accept item.
 * onDismiss
 *     Fired when the user picks the Dismiss item.
 * onClose
 *     Fired on outside-click / Esc.
 *
 * Returns
 * -------
 * JSX.Element
 *     The SVG foreignObject-wrapped menu.
 */
export default function GhostContextMenu({
  x,
  y,
  candidate,
  onAccept,
  onDismiss,
  onClose,
}: GhostContextMenuProps): JSX.Element {
  const acceptLabel =
    candidate.kind === 'open' ? 'Accept open end' : 'Accept pinch-out'

  return (
    <ContextMenu
      portal="svg"
      x={x}
      y={y}
      width={240}
      height={200}
      header="Pinch-out suggestion"
      ariaLabel="Ghost candidate actions"
      testid="ghost-context-menu"
      items={[
        {
          label: acceptLabel,
          testid: GHOST_CTX_TESTIDS.accept,
          key: 'ghost-accept',
          onClick: () => {
            onAccept(candidate)
          },
        },
        {
          label: 'Dismiss suggestion',
          testid: GHOST_CTX_TESTIDS.dismiss,
          key: 'ghost-dismiss',
          onClick: () => {
            onDismiss(candidate)
          },
        },
      ]}
      onClose={onClose}
    />
  )
}

/**
 * Right-click context menu for a body wedge on the cross-section.
 *
 * Renders four top-level rows — "Left extent", "Right extent", "Name body…"
 * and "Dissolve body" — keeping the menu compact. Each side row expands a
 * nested submenu (via ``ContextMenuItem.submenu``) carrying the three claim
 * kinds, plus a "Clear extent" row when that side is already claimed. When a
 * side is claimed, its current kind is shown inline on the parent row
 * (e.g. "Left extent: open").
 *
 * Rendered inside the SVG canvas via ContextMenu's ``portal="svg"`` variant
 * so it floats above the wedge geometry without fighting the DOM stacking
 * context.
 *
 * @remarks
 * Provenance rule: when the caller fires ``onClaimExtent`` and the backend
 * returns 409 (existing user-claimed extent), the parent should open the
 * ProvenanceConflictDialog.  This component is not responsible for that
 * flow — it only fires the intent.
 */

import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'
import type { BodyListItem } from '../../api/client'

/** Extent kind the user can claim from the menu (excludes 'to_target'
 *  which is detector-only). */
export type ClaimableKind = 'pinch_out_halfway' | 'extrapolated' | 'open'

export interface BodyContextMenuProps {
  /** Screen X of the context-menu anchor (SVG coordinates). */
  x: number
  /** Screen Y of the context-menu anchor (SVG coordinates). */
  y: number
  /** The body the user right-clicked. */
  body: BodyListItem
  /** Display label for the header (auto-name = lithology + stacking number, or
   *  the explicit name when set). Falls back to the raw ``name`` when absent. */
  displayLabel?: string
  /** Fired when the user picks a "Claim <side> extent → <kind>" item. */
  onClaimExtent: (bodyId: string, side: 'left' | 'right', kind: ClaimableKind) => void
  /** Fired when the user picks "Clear <side> extent". */
  onClearExtent: (bodyId: string, side: 'left' | 'right') => void
  /** Fired when the user picks "Name body". */
  onNameBody: (bodyId: string) => void
  /** Fired when the user picks "Dissolve body". */
  onDissolveBody: (bodyId: string) => void
  /** Close callback — the menu is dismissed. */
  onClose: () => void
}

/** Human-readable label for each claimable kind. */
const KIND_LABELS: Record<ClaimableKind, string> = {
  pinch_out_halfway: 'Pinch out halfway',
  extrapolated: 'Extrapolate (dip-projection)',
  open: 'Extends to section boundary',
}

/** data-testid values for menu items (referenced in BodyContextMenu.test.tsx). */
export const TESTIDS = {
  /** The "Left extent" / "Right extent" submenu PARENT rows. Hover/click one
   *  to reveal its claim + clear items. */
  sideLeft: 'body-ctx-side-left',
  sideRight: 'body-ctx-side-right',
  claimLeft: (kind: ClaimableKind) => `body-ctx-claim-left-${kind}`,
  claimRight: (kind: ClaimableKind) => `body-ctx-claim-right-${kind}`,
  clearLeft: 'body-ctx-clear-left',
  clearRight: 'body-ctx-clear-right',
  nameBody: 'body-ctx-name-body',
  dissolveBody: 'body-ctx-dissolve-body',
}

const CLAIMABLE_KINDS: ClaimableKind[] = ['pinch_out_halfway', 'extrapolated', 'open']

/**
 * Context menu for a body wedge.
 *
 * Renders via ContextMenu portal="svg" — must be placed inside the SVG
 * that owns the section canvas.  The ``width`` / ``height`` are set
 * generously so the menu panel has enough room; the menu itself
 * auto-sizes to its content.
 *
 * Parameters
 * ----------
 * x, y
 *     SVG-canvas coordinates for the menu origin.
 * body
 *     The body the user right-clicked — used to determine which sides
 *     are already claimed.
 * onClaimExtent
 *     Fired when the user picks a claim item.
 * onClearExtent
 *     Fired when the user picks a clear item.
 * onNameBody
 *     Fired when the user picks "Name body".
 * onDissolveBody
 *     Fired when the user picks "Dissolve body".
 * onClose
 *     Fired on outside-click / Esc.
 *
 * Returns
 * -------
 * JSX.Element
 *     The SVG foreignObject-wrapped menu.
 */
export default function BodyContextMenu({
  x,
  y,
  body,
  displayLabel,
  onClaimExtent,
  onClearExtent,
  onNameBody,
  onDissolveBody,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  const leftClaimed = body.extent_left_kind !== null
  const rightClaimed = body.extent_right_kind !== null

  /**
   * Build the submenu rows for one side: the three claim kinds, plus a
   * "Clear extent" row when that side is already claimed.
   */
  function sideSubmenu(side: 'left' | 'right'): ContextMenuItem[] {
    const claimed = side === 'left' ? leftClaimed : rightClaimed
    const rows: ContextMenuItem[] = CLAIMABLE_KINDS.map(kind => ({
      label: `${KIND_LABELS[kind]} ${side === 'left' ? '←' : '→'}`,
      testid: side === 'left' ? TESTIDS.claimLeft(kind) : TESTIDS.claimRight(kind),
      key: `claim-${side}-${kind}`,
      onClick: () => {
        onClaimExtent(body.id, side, kind)
      },
    }))
    if (claimed) {
      rows.push({
        label: 'Clear extent',
        testid: side === 'left' ? TESTIDS.clearLeft : TESTIDS.clearRight,
        key: `clear-${side}`,
        danger: true,
        topBorder: true,
        onClick: () => {
          onClearExtent(body.id, side)
        },
      })
    }
    return rows
  }

  // Parent rows carry the current claim kind inline (when claimed) and expand
  // their per-side submenu on hover/click. The parent's own onClick is a no-op
  // — ContextMenu toggles the submenu instead of firing it.
  const leftLabel = leftClaimed ? `Left extent: ${body.extent_left_kind}` : 'Left extent'
  const rightLabel = rightClaimed ? `Right extent: ${body.extent_right_kind}` : 'Right extent'

  const items: (ContextMenuItem | false | null)[] = [
    {
      label: leftLabel,
      key: 'side-left',
      testid: TESTIDS.sideLeft,
      submenu: sideSubmenu('left'),
      onClick: () => {
        /* submenu parent — no direct action */
      },
    },
    {
      label: rightLabel,
      key: 'side-right',
      testid: TESTIDS.sideRight,
      submenu: sideSubmenu('right'),
      onClick: () => {
        /* submenu parent — no direct action */
      },
    },
    {
      label: 'Name body…',
      testid: TESTIDS.nameBody,
      key: 'name-body',
      topBorder: true,
      onClick: () => {
        onNameBody(body.id)
      },
    },
    {
      label: 'Dissolve body',
      testid: TESTIDS.dissolveBody,
      key: 'dissolve-body',
      danger: true,
      onClick: () => {
        onDissolveBody(body.id)
      },
    },
  ]

  return (
    <ContextMenu
      portal="svg"
      x={x}
      y={y}
      width={300}
      height={500}
      header={`Lens · ${displayLabel ?? body.name ?? body.id.slice(0, 8)}`}
      ariaLabel="Body extent actions"
      testid="body-context-menu"
      items={items}
      onClose={onClose}
    />
  )
}

/**
 * Right-click context menu for a body wedge on the cross-section.
 *
 * Provides per-side claim submenus (Claim left / right extent) with four
 * kind choices each, plus "Clear left extent" / "Clear right extent" when a
 * side is already claimed.  Also exposes "Name body" and "Dissolve body".
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
  onClaimExtent,
  onClearExtent,
  onNameBody,
  onDissolveBody,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  const leftClaimed = body.extent_left_kind !== null
  const rightClaimed = body.extent_right_kind !== null

  // Build claim items for one side.
  function claimItems(side: 'left' | 'right'): ContextMenuItem[] {
    return CLAIMABLE_KINDS.map(kind => ({
      label: `${KIND_LABELS[kind]} ${side === 'left' ? '←' : '→'}`,
      testid: side === 'left' ? TESTIDS.claimLeft(kind) : TESTIDS.claimRight(kind),
      key: `claim-${side}-${kind}`,
      onClick: () => { onClaimExtent(body.id, side, kind) },
    }))
  }

  const items: (ContextMenuItem | false | null)[] = [
    // Header "Claim left extent" section
    ...(!leftClaimed
      ? [
          {
            label: 'Claim left extent →',
            key: 'claim-left-header',
            disabled: true,
            onClick: () => { /* group header — disabled */ },
          } satisfies ContextMenuItem,
          ...claimItems('left'),
        ]
      : [
          {
            label: `Left extent: ${body.extent_left_kind ?? 'none'}`,
            key: 'left-claimed-info',
            disabled: true,
            onClick: () => { /* info row */ },
          } satisfies ContextMenuItem,
          {
            label: 'Clear left extent',
            testid: TESTIDS.clearLeft,
            key: 'clear-left',
            danger: true,
            onClick: () => { onClearExtent(body.id, 'left') },
          } satisfies ContextMenuItem,
          ...claimItems('left'),
        ]),

    // Separator before right side
    { label: '─', key: 'sep-1', disabled: true, topBorder: true, onClick: () => { /* sep */ } } satisfies ContextMenuItem,

    // Header "Claim right extent" section
    ...(!rightClaimed
      ? [
          {
            label: 'Claim right extent →',
            key: 'claim-right-header',
            disabled: true,
            onClick: () => { /* group header */ },
          } satisfies ContextMenuItem,
          ...claimItems('right'),
        ]
      : [
          {
            label: `Right extent: ${body.extent_right_kind ?? 'none'}`,
            key: 'right-claimed-info',
            disabled: true,
            onClick: () => { /* info row */ },
          } satisfies ContextMenuItem,
          {
            label: 'Clear right extent',
            testid: TESTIDS.clearRight,
            key: 'clear-right',
            danger: true,
            onClick: () => { onClearExtent(body.id, 'right') },
          } satisfies ContextMenuItem,
          ...claimItems('right'),
        ]),

    // Separator before body-level verbs
    { label: '─', key: 'sep-2', disabled: true, topBorder: true, onClick: () => { /* sep */ } } satisfies ContextMenuItem,

    {
      label: 'Name body…',
      testid: TESTIDS.nameBody,
      key: 'name-body',
      onClick: () => { onNameBody(body.id) },
    },
    {
      label: 'Dissolve body',
      testid: TESTIDS.dissolveBody,
      key: 'dissolve-body',
      danger: true,
      onClick: () => { onDissolveBody(body.id) },
    },
  ]

  return (
    <ContextMenu
      portal="svg"
      x={x}
      y={y}
      width={300}
      height={500}
      header={`Body${body.name ? ` · ${body.name}` : ''}`}
      ariaLabel="Body extent actions"
      testid="body-context-menu"
      items={items}
      onClose={onClose}
    />
  )
}

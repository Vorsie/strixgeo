/**
 * Right-click context menu for a body wedge on the cross-section.
 *
 * Renders two top-level rows — "Name body…" and "Dissolve body" — keeping
 * the menu compact. The former "Left extent" / "Right extent" claim submenus
 * were retired along with the detect/suggest/claim body-extent verbs
 * (body-extent retirement, 2026-06-06).
 *
 * Rendered inside the SVG canvas via ContextMenu's ``portal="svg"`` variant
 * so it floats above the wedge geometry without fighting the DOM stacking
 * context.
 *
 * @module components/sections/BodyContextMenu
 */

import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'
import type { BodyListItem } from '../../api/client'

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
  /** Fired when the user picks "Name body". */
  onNameBody: (bodyId: string) => void
  /** Fired when the user picks "Dissolve body". */
  onDissolveBody: (bodyId: string) => void
  /**
   * Fired when the user picks "Unit statistics…" — reports the body's
   * FORMATION id (the statistics are the unit's; owner ruling R1 2026-08-27)
   * plus the body's OWN id (body-scope ruling 2026-08-27: this menu has the
   * body directly, so the jump names it). Absent → the item is not offered.
   */
  onShowUnitStatistics?: (formationId: string, bodyId?: string | null) => void
  /** Close callback — the menu is dismissed. */
  onClose: () => void
}

/** data-testid values for menu items (referenced in BodyContextMenu.test.tsx). */
export const TESTIDS = {
  nameBody: 'body-ctx-name-body',
  dissolveBody: 'body-ctx-dissolve-body',
  unitStatistics: 'body-ctx-unit-statistics',
}

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
 *     The body the user right-clicked.
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
  onNameBody,
  onDissolveBody,
  onShowUnitStatistics,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  const items: (ContextMenuItem | false | null)[] = [
    {
      label: 'Name body…',
      testid: TESTIDS.nameBody,
      key: 'name-body',
      onClick: () => {
        onNameBody(body.id)
      },
    },
    // Navigates away (Parameters stage, scoped to the body's UNIT) — offered
    // only when wired, per the no-affordance rule.
    onShowUnitStatistics !== undefined && {
      label: 'Unit statistics…',
      testid: TESTIDS.unitStatistics,
      key: 'unit-statistics',
      onClick: () => {
        onShowUnitStatistics(body.formation_id, body.id)
      },
    },
    {
      label: 'Dissolve body',
      testid: TESTIDS.dissolveBody,
      key: 'dissolve-body',
      danger: true,
      topBorder: true,
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
      height={200}
      header={
        `Lens · ${displayLabel ?? body.name ?? body.id.slice(0, 8)}` +
        // A2: the derived geological formation this body mostly falls in,
        // shown as context next to the lithology name (e.g. "Sa · Pleistoceen").
        (body.geo_formation_name ? ` · ${body.geo_formation_name}` : '')
      }
      ariaLabel="Body extent actions"
      testid="body-context-menu"
      items={items}
      onClose={onClose}
    />
  )
}

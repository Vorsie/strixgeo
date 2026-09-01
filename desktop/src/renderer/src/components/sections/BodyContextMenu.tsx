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
import { useT } from '../../i18n/translate'

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
  /**
   * Fired when the user picks "Dissolve body". Absent → the item is not offered
   * (the no-affordance rule) — Dissolve stays litho-only, so the geotech axis
   * withholds this handler (owner ruling 2026-08-31, debt #278 R5).
   */
  onDissolveBody?: (bodyId: string) => void
  /**
   * Fired when the user picks "Unit statistics…" — reports the body's
   * FORMATION id (the statistics are the unit's; owner ruling R1 2026-08-27)
   * plus the body's OWN id (body-scope ruling 2026-08-27: this menu has the
   * body directly, so the jump names it). Absent → the item is not offered.
   */
  onShowUnitStatistics?: (formationId: string, bodyId?: string | null) => void
  /**
   * Fired when the user picks "Separate from…" (debt #278 R5). Reports the
   * clicked body's id so SectionPanel can ARM the pick-the-other-body gesture —
   * the verb does not commit here. Absent → the item is not offered (the
   * no-affordance rule). NON-danger: it is reversible via Rejoin, unlike
   * Dissolve.
   */
  onSeparateBody?: (bodyId: string) => void
  /**
   * The existing separations that involve THIS body, each offered back as a
   * "Rejoin with <label>" item. The label is composed by the caller from the
   * backend's server-resolved display info (the OTHER anchor's current body),
   * so this menu owns no body-resolution map. Absent / empty → no Rejoin items.
   */
  separations?: readonly BodyRejoinOption[]
  /** Fired when the user picks a "Rejoin with <label>" item — the separation to lift. */
  onRejoinBody?: (separationId: string) => void
  /** Close callback — the menu is dismissed. */
  onClose: () => void
}

/** One "Rejoin with <label>" option — a standing separation the user can lift. */
export interface BodyRejoinOption {
  /** The ``body_separation`` row id to DELETE on Rejoin. */
  separationId: string
  /** Display label of the other body (caller-composed from the server info). */
  label: string
}

/** data-testid values for menu items (referenced in BodyContextMenu.test.tsx). */
export const TESTIDS = {
  nameBody: 'body-ctx-name-body',
  dissolveBody: 'body-ctx-dissolve-body',
  unitStatistics: 'body-ctx-unit-statistics',
  separateBody: 'body-ctx-separate-body',
  // Each Rejoin item's testid is ``${rejoinBody}-${separationId}`` so multiple
  // standing separations on one body render as distinct, queryable rows.
  rejoinBody: 'body-ctx-rejoin-body',
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
  onSeparateBody,
  separations,
  onRejoinBody,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  // Item labels read the catalogue (the keys already existed; nothing read them
  // before — dead until now). English is the default without any provider, so
  // unit tests that render this menu bare still see English copy.
  const t = useT()
  // R2 (owner ruling 2026-08-31): a body may cross more than one geological
  // formation, so its geological context is the full LIST — every formation it
  // falls in, shallowest first, joined with "+". Falls back to the singular
  // majority field for an old cached response that predates the list.
  const geoContext =
    body.geo_formations && body.geo_formations.length > 0
      ? body.geo_formations.map(g => g.name).join(' + ')
      : (body.geo_formation_name ?? '')

  const items: (ContextMenuItem | false | null)[] = [
    {
      label: t('sections.menu.nameBody'),
      testid: TESTIDS.nameBody,
      key: 'name-body',
      onClick: () => {
        onNameBody(body.id)
      },
    },
    // Navigates away (Parameters stage, scoped to the body's UNIT) — offered
    // only when wired, per the no-affordance rule.
    onShowUnitStatistics !== undefined && {
      label: t('sections.menu.unitStatistics'),
      testid: TESTIDS.unitStatistics,
      key: 'unit-statistics',
      onClick: () => {
        onShowUnitStatistics(body.formation_id, body.id)
      },
    },
    // Separate — the reversible body-identity verb (debt #278 R5). Sits ABOVE
    // the Dissolve divider and is NON-danger: it is undone by Rejoin, so it is
    // not the irreversible red action Dissolve is. Arms rather than commits —
    // SectionPanel owns the pick-the-other-body gesture.
    onSeparateBody !== undefined && {
      label: t('sections.menu.separateBody'),
      testid: TESTIDS.separateBody,
      key: 'separate-body',
      onClick: () => {
        onSeparateBody(body.id)
      },
    },
    // Rejoin — one per standing separation that involves this body. Lifting a
    // separation lets the two anchors re-union (the undo path for Separate).
    // The label is composed by the caller from the backend's server-resolved
    // display info, so this menu owns no body-resolution map.
    ...(onRejoinBody !== undefined
      ? (separations ?? []).map(sep => ({
          label: t('sections.menu.rejoinBody', { label: sep.label }),
          testid: `${TESTIDS.rejoinBody}-${sep.separationId}`,
          key: `rejoin-${sep.separationId}`,
          onClick: () => {
            onRejoinBody(sep.separationId)
          },
        }))
      : []),
    // Dissolve — irreversible, so it is danger-styled and divided off. Withheld
    // on the geotech axis (Dissolve stays litho-only).
    onDissolveBody !== undefined && {
      label: t('sections.menu.dissolveBody'),
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
        // R2: the geological formation(s) this body falls in, shown as context
        // next to the lithology name. One formation reads "Sa · Pleistoceen";
        // a body crossing two reads "Sa · Holoceen + Pleistoceen".
        (geoContext ? ` · ${geoContext}` : '')
      }
      ariaLabel={t('sections.menu.body')}
      testid="body-context-menu"
      items={items}
      onClose={onClose}
    />
  )
}

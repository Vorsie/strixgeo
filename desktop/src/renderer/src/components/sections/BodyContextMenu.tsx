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
import { crossedFormationLabel } from '../../utils/crossedFormationLabel'

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
   * Fired when the user picks "Edit composition…" — repoint the clicked ACCEPTED
   * litho layer to a different composition's unit (installer #21). The caller
   * already resolved which layer the click fell on, so this takes no args. Absent
   * → the item is not offered (the no-affordance rule keeps it litho-only, and
   * only when a single accepted layer resolved under the click).
   */
  onEditComposition?: () => void
  /**
   * Fired when the user picks "Split here" — split the clicked ACCEPTED litho
   * layer at the clicked depth into two same-composition layers (installer #21).
   * The caller already captured the layer + depth, so this takes no args. Absent
   * → the item is not offered.
   */
  onSplitLayer?: () => void
  /**
   * Fired when the user picks "Dissolve body". Absent → the item is not offered
   * (the no-affordance rule). Wired on BOTH the litho and geotech axes — the
   * owner enumerated Dissolve as one of the geotech body verbs (ruling
   * 2026-08-31, piece B / debt #278 R5).
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
   * Fired when the user picks "Voeg samen met…" (Join). Reports the clicked
   * body's id so SectionPanel can ARM the pick-the-other-body gesture — the verb
   * does not commit here. Absent → the item is not offered (the no-affordance
   * rule keeps Join geotech-only, where the owner said he would use it).
   * NON-danger: it is reversible via Ontkoppelen, unlike Dissolve.
   *
   * (Owner ruling 2026-09-01 "way too complicated": the body verbs are stripped
   * to Join + Ontkoppelen — Separate / Rejoin were removed entirely.)
   */
  onJoinBody?: (bodyId: string) => void
  /**
   * The existing groups (unions) that involve THIS body, each offered back as an
   * "Ontkoppelen" item — the un-join undo path for the Join verb. The label is
   * composed by the caller from the backend's server-resolved display info (the
   * OTHER body), so this menu owns no body-resolution map. Absent / empty → no
   * Ontkoppelen items.
   */
  unions?: readonly BodyDisjoinOption[]
  /** Fired when the user picks an "Ontkoppelen" item — the group (union) to lift. */
  onDisjoinBody?: (unionId: string) => void
  /**
   * Hover preview for the "Ontkoppelen" items (D2, owner 2026-09-01): fired with the
   * hovered option as the pointer enters a row, and with ``null`` as it leaves or the
   * menu closes. Lets the canvas highlight WHICH body an un-join refers to — the
   * decisive cue when a body sits in >1 group and the labels collide. Absent → no
   * highlight (the items still work).
   */
  onUnjoinHover?: (option: BodyDisjoinOption | null) => void
  /** Close callback — the menu is dismissed. */
  onClose: () => void
}

/** One "Ontkoppelen" option — a standing group (union) the user can un-join (debt #278). */
export interface BodyDisjoinOption {
  /** The ``body_union`` row id to DELETE on un-join. */
  unionId: string
  /** Display label of the other body (caller-composed from the server info). */
  label: string
  /**
   * The other anchor's current body id (``null`` when unstamped). After a standing
   * union both anchors resolve to the SAME merged body, so this collides between two
   * options on one body — kept for completeness, but ``otherLayerId`` is the
   * disambiguator (D2, owner 2026-09-01).
   */
  otherBodyId?: string | null
  /**
   * The other anchor's LAYER id — a distinct section position per option, so hovering
   * an "Ontkoppelen" item can highlight WHICH body the option refers to even when two
   * options share a label (D2).
   */
  otherLayerId?: string
}

/** data-testid values for menu items (referenced in BodyContextMenu.test.tsx). */
export const TESTIDS = {
  nameBody: 'body-ctx-name-body',
  editComposition: 'body-ctx-edit-composition',
  splitLayer: 'body-ctx-split-layer',
  dissolveBody: 'body-ctx-dissolve-body',
  unitStatistics: 'body-ctx-unit-statistics',
  joinBody: 'body-ctx-join-body',
  // Each Ontkoppelen item's testid is ``${unjoinBody}-${unionId}`` so multiple
  // standing groups on one body render as distinct, queryable rows.
  unjoinBody: 'body-ctx-unjoin-body',
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
  onEditComposition,
  onSplitLayer,
  onDissolveBody,
  onShowUnitStatistics,
  onJoinBody,
  unions,
  onDisjoinBody,
  onUnjoinHover,
  onClose,
}: BodyContextMenuProps): JSX.Element {
  // Item labels read the catalogue (the keys already existed; nothing read them
  // before — dead until now). English is the default without any provider, so
  // unit tests that render this menu bare still see English copy.
  const t = useT()
  // R2 (owner ruling 2026-08-31): a body may cross more than one geological
  // formation, so its geological context is the full LIST — every formation it
  // falls in, shallowest first, joined with "+". Falls back to the singular
  // majority field for an old cached response that predates the list. The
  // Parameters scope header reads the same shape, so the join+fallback lives in
  // one shared helper (extract-on-the-second-copy).
  const geoContext = crossedFormationLabel(body)

  const items: (ContextMenuItem | false | null)[] = [
    {
      label: t('sections.menu.nameBody'),
      testid: TESTIDS.nameBody,
      key: 'name-body',
      onClick: () => {
        onNameBody(body.id)
      },
    },
    // Accepted-layer verbs (installer #21) — the clicked layer + depth were
    // resolved by the caller, so these commit against that layer. Litho-only:
    // offered only where the axis wires them (the no-affordance rule). The owner
    // was blocked here — an accepted silt could only be deleted, not recomposed
    // or split, because Edit/Split existed only on pending ghosts.
    onEditComposition !== undefined && {
      label: t('sections.menu.editComposition'),
      testid: TESTIDS.editComposition,
      key: 'edit-composition',
      onClick: () => {
        onEditComposition()
      },
    },
    onSplitLayer !== undefined && {
      label: t('sections.menu.splitHere'),
      testid: TESTIDS.splitLayer,
      key: 'split-layer',
      onClick: () => {
        onSplitLayer()
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
    // Voeg samen met… (Join) — the reversible ADDITIVE body-identity verb
    // (owner ruling 2026-09-01). "These two ARE the same body". NON-danger; arms
    // rather than commits (SectionPanel owns the pick-the-other-body gesture).
    // Offered only where wired, which keeps it geotech-only (the owner would not
    // use it on litho).
    onJoinBody !== undefined && {
      label: t('sections.menu.joinBody'),
      testid: TESTIDS.joinBody,
      key: 'join-body',
      onClick: () => {
        onJoinBody(body.id)
      },
    },
    // Ontkoppelen (un-join) — one per standing group that involves this body (the
    // undo path for Join). Lifting a group lets the two anchors fall back to
    // whatever ties / geometry connect them; where none do, they split. The label
    // is composed by the caller from the backend's server-resolved display info,
    // so this menu owns no body-resolution map.
    ...(onDisjoinBody !== undefined
      ? (unions ?? []).map(union => ({
          label: t('sections.menu.unjoinBody', { label: union.label }),
          testid: `${TESTIDS.unjoinBody}-${union.unionId}`,
          key: `unjoin-${union.unionId}`,
          onClick: () => {
            onDisjoinBody(union.unionId)
          },
          // Hover preview (D2): highlight the body THIS option refers to, so two
          // same-labelled "Ontkoppelen" items are told apart on the canvas.
          onMouseEnter: () => onUnjoinHover?.(union),
          onMouseLeave: () => onUnjoinHover?.(null),
        }))
      : []),
    // Dissolve — irreversible, so it is danger-styled and divided off. Offered
    // on both axes wherever ``onDissolveBody`` is wired (geotech included, piece B).
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
        // Owner dogfeed 2026-09-01: the literal "Lens · " prefix is gone — the
        // body label stands alone (it is not always a lens, and the word only
        // added noise). The label is the caller's unified body label
        // ("SILT · SF #0"), else the name, else an id prefix.
        (displayLabel ?? body.name ?? body.id.slice(0, 8)) +
        // R2: the geological formation(s) this body falls in, shown as context
        // next to the body label. One formation reads "… · Pleistoceen"; a body
        // crossing two reads "… · Holoceen + Pleistoceen".
        (geoContext ? ` · ${geoContext}` : '')
      }
      ariaLabel={t('sections.menu.body')}
      testid="body-context-menu"
      items={items}
      onClose={() => {
        // Clear any un-join hover preview on dismiss so a highlight can't outlive
        // the menu (leave fires on most closes, but Esc / outside-click may not).
        onUnjoinHover?.(null)
        onClose()
      }}
    />
  )
}

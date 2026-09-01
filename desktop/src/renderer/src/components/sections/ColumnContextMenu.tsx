/**
 * Right-click context menu for an investigation column on the
 * cross-section.
 *
 * Actions:
 *
 *   * "Focus this test" — enters the section's focus mode, hiding
 *     every other column so the user can edit formation boundaries
 *     on the picked test in isolation.
 *   * "Open detail" — opens the test's full chart/borelog detail.
 *   * "Remove from this section" — adds the column's id to the
 *     section's excluded_{cpt,borehole}_ids list. Reversible
 *     (project-local hide, the test stays in the project + on the
 *     map). Per UX conventions no confirmation dialog; the
 *     "N hidden · restore all" footer is the undo path.
 *
 * Thin wrapper over the generic {@link ContextMenu} (#164): positioned
 * ``absolute`` inside SectionPanel's relative container, dismissed on
 * click-outside / Esc.
 */

import ContextMenu, { type ContextMenuItem } from '../ui/ContextMenu'
import { useT } from '../../i18n/translate'

interface Props {
  /** Container-local coordinates where the menu's top-left corner
   * should land. */
  x: number
  y: number
  /** Display name of the column the user right-clicked — shown as a
   * subtitle so the action is unambiguous when columns sit close
   * together. */
  name: string
  /** Fired when the user picks "Focus this test". */
  onFocus: () => void
  /** Fired when the user picks "Open detail" — opens the test's full
   * chart/borelog detail (routes to the Data stage). When omitted
   * (read-only mounts / no detail handler) the item is hidden. */
  onOpenDetail?: () => void
  /** Fired when the user picks "Remove from this section". When
   * omitted (test harness, read-only mounts) the menu item is
   * hidden — the action is only meaningful when the parent owns
   * a PATCH path back to the section row. */
  onRemoveFromSection?: () => void
  /**
   * Clear this test's packing subdivision (geotech axis only; owner ask
   * 2026-08-18). Fires immediately — the rebuild is one pipeline press away,
   * and the toast says which one.
   */
  onClearSubdivision?: () => void
  /** Fired when the user clicks anywhere outside the menu, or
   * presses Esc. */
  onClose: () => void
}

export default function ColumnContextMenu({
  x,
  y,
  name,
  onFocus,
  onOpenDetail,
  onRemoveFromSection,
  onClearSubdivision,
  onClose,
}: Props): JSX.Element {
  // Item labels + the aria-label read the i18n catalogue (owner dogfeed
  // 2026-09-01: the menu stayed English in Dutch mode). English is the default
  // without a provider, so the smoke tests still see the English copy.
  const t = useT()
  const items: (ContextMenuItem | false | undefined)[] = [
    { label: t('sections.menu.focusTest'), onClick: onFocus },
    onOpenDetail && { label: t('sections.menu.openDetail'), onClick: onOpenDetail, topBorder: true },
    onClearSubdivision && {
      label: t('sections.menu.clearSubdivision'),
      onClick: onClearSubdivision,
      danger: true,
      topBorder: true,
    },
    onRemoveFromSection && {
      label: t('sections.menu.removeFromSection'),
      onClick: onRemoveFromSection,
      danger: true,
      topBorder: true,
    },
  ]
  return (
    <ContextMenu
      portal="absolute"
      x={x}
      y={y}
      header={name}
      ariaLabel={t('sections.menu.actionsFor', { name })}
      items={items}
      onClose={onClose}
    />
  )
}

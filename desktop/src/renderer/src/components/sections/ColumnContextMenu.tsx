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
  onClose,
}: Props): JSX.Element {
  const items: (ContextMenuItem | false | undefined)[] = [
    { label: 'Focus this test', onClick: onFocus },
    onOpenDetail && { label: 'Open detail', onClick: onOpenDetail, topBorder: true },
    onRemoveFromSection && {
      label: 'Remove from this section',
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
      ariaLabel={`Actions for ${name}`}
      items={items}
      onClose={onClose}
    />
  )
}

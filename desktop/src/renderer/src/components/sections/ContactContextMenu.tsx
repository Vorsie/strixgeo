/**
 * Portalled context menu for a right-clicked formation contact.
 *
 * This component is extracted from ``ContactsLayer.tsx`` to keep that file
 * focused on the drag state machine.  It has no state of its own — all
 * props are callbacks or display values owned by the parent.
 *
 * Renders via a React portal to ``document.body`` at ``position: fixed``
 * using the viewport coordinates from the original ``onContextMenu`` event,
 * so the menu is never nested inside the section's SVG element.
 */

import ContextMenu from '../ui/ContextMenu'

/**
 * Props for ContactContextMenu.
 *
 * Parameters
 * ----------
 * clientX
 *     Viewport X (clientX from the right-click event). Menu is position:fixed.
 * clientY
 *     Viewport Y (clientY from the right-click event).
 * formationName
 *     Human-readable formation name — shown as the menu subtitle.
 * onEditInGeologyStage
 *     Fired when the user picks "Edit in Geology stage" — only wired for
 *     REFERENCE (geological backdrop) contacts on the litho axis.  When
 *     present, Delete and Pinch-out are suppressed (those belong on the
 *     geological axis).  When absent the item is hidden.
 * onDelete
 *     Fired when the user picks "Delete contact".  When absent the item is
 *     hidden.  The handler must gate the irreversible action via a styled
 *     confirm dialog (DeleteContactConfirmDialog) — ContactContextMenu itself
 *     does not add a second gate.
 * onUnlinkLithoFromGeo
 *     Fired when the user picks "Unlink from geology" — only shown when the
 *     contact is coupled (``parent_geo_contact_id != null``).  Nulls the
 *     coupling without deleting either contact.  When absent the item is
 *     hidden.
 * onLinkLithoToGeo
 *     Fired when the user picks "Link to geology" — only shown when the
 *     contact is NOT coupled (``parent_geo_contact_id == null``).  Establishes
 *     the coupling to the nearest geological contact within snap tolerance.
 *     When absent the item is hidden.
 * onOpenEnd
 *     Fired when the user picks "Open-end layer →/←" — claims an ``open``
 *     body extent toward ``side`` (TIN-free).  When absent the items are hidden.
 * onPinchOut
 *     Fired when the user picks "Pinch out layer →/←" — claims a
 *     ``pinch_out_halfway`` body extent toward ``side``.  When absent the
 *     items are hidden.
 * onClose
 *     Fired on click-outside or Esc — closes the menu.
 */
export interface ContactContextMenuProps {
  clientX: number
  clientY: number
  formationName: string
  onEditInGeologyStage?: () => void
  onDelete?: () => void
  onUnlinkLithoFromGeo?: () => void
  onLinkLithoToGeo?: () => void
  onOpenEnd?: (side: 'left' | 'right') => void
  onPinchOut?: (side: 'left' | 'right') => void
  onClose: () => void
}

/**
 * Small floating context menu for a right-clicked formation contact.
 *
 * Renders via a React portal to ``document.body`` so it is not nested
 * inside the section's SVG element.  Uses ``position: fixed`` with the
 * viewport coordinates from the original ``onContextMenu`` event.
 *
 * Parameters
 * ----------
 * clientX / clientY
 *     Viewport-fixed coordinates from ``e.clientX`` / ``e.clientY``.
 * formationName
 *     Shown as the menu subtitle for unambiguous context.
 * onEditInGeologyStage
 *     Optional — shows the "Edit in Geology stage" item (reference
 *     contacts on the litho axis).  Suppresses Delete + Pinch-out
 *     when present.
 * onDelete
 *     Optional — shows the "Delete contact" item.
 * onPinchOut
 *     Optional — shows the "Pinch out layer →/←" items (claims a
 *     ``pinch_out_halfway`` body extent toward the neighbouring column).
 * onClose
 *     Dismisses the menu on click-outside or Esc.
 *
 * Returns
 * -------
 * JSX.Element
 *     The context menu div.
 */
export default function ContactContextMenu({
  clientX,
  clientY,
  formationName,
  onEditInGeologyStage,
  onDelete,
  onUnlinkLithoFromGeo,
  onLinkLithoToGeo,
  onOpenEnd,
  onPinchOut,
  onClose,
}: ContactContextMenuProps): JSX.Element {
  return (
    <ContextMenu
      portal="fixed"
      x={clientX}
      y={clientY}
      header={formationName}
      ariaLabel={`Actions for ${formationName} contact`}
      testid="contact-context-menu"
      onClose={onClose}
      items={[
        onEditInGeologyStage && {
          label: 'Edit in Geology stage',
          onClick: onEditInGeologyStage,
          testid: 'geo-deep-link-menu-item',
        },
        onOpenEnd && {
          label: 'Open-end layer →',
          onClick: () => onOpenEnd('right'),
          testid: 'open-end-layer-right',
        },
        onOpenEnd && {
          label: 'Open-end layer ←',
          onClick: () => onOpenEnd('left'),
          testid: 'open-end-layer-left',
        },
        onPinchOut && {
          label: 'Pinch out layer →',
          onClick: () => onPinchOut('right'),
          testid: 'pinch-out-layer-right',
        },
        onPinchOut && {
          label: 'Pinch out layer ←',
          onClick: () => onPinchOut('left'),
          testid: 'pinch-out-layer-left',
        },
        onLinkLithoToGeo && {
          label: 'Link to geology',
          onClick: onLinkLithoToGeo,
          testid: 'link-geo-menu-item',
        },
        onUnlinkLithoFromGeo && {
          label: 'Unlink from geology',
          onClick: onUnlinkLithoFromGeo,
          testid: 'unlink-geo-menu-item',
        },
        onDelete && { label: 'Delete contact', onClick: onDelete, danger: true, topBorder: true },
      ]}
    />
  )
}

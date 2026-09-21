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
 *     Fired when the user picks "Edit in Stratigraphy stage" — only wired for
 *     REFERENCE (geological backdrop) contacts on the litho axis.  When
 *     present, Delete is suppressed (those belong on the geological axis).
 *     When absent the item is hidden.
 * onDelete
 *     Fired when the user picks "Delete contact".  When absent the item is
 *     hidden.  The handler must gate the irreversible action via a styled
 *     confirm dialog (DeleteContactConfirmDialog) — ContactContextMenu itself
 *     does not add a second gate.
 * onUnlinkLithoFromGeo
 *     Fired when the user picks "Unlink from stratigraphy" — only shown when the
 *     contact is coupled (``parent_geo_contact_id != null``).  Nulls the
 *     coupling without deleting either contact.  When absent the item is
 *     hidden.
 * onLinkLithoToGeo
 *     Fired when the user picks "Link to geology" — only shown when the
 *     contact is NOT coupled (``parent_geo_contact_id == null``).  Establishes
 *     the coupling to the nearest geological contact within snap tolerance.
 *     When absent the item is hidden.
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
 *     Optional — shows the "Edit in Stratigraphy stage" item (reference
 *     contacts on the litho axis).  Suppresses Delete when present.
 * onDelete
 *     Optional — shows the "Delete contact" item.
 * onUnlinkLithoFromGeo
 *     Optional — shows the "Unlink from stratigraphy" item when the contact
 *     is coupled (``parent_geo_contact_id != null``).
 * onLinkLithoToGeo
 *     Optional — shows the "Link to geology" item when the contact is
 *     NOT coupled (``parent_geo_contact_id == null``).
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
          // Display rename (owner 2026-09-05): the stage reads "Stratigraphy".
          // NOTE: this whole menu hard-codes English labels instead of using
          // t() — a pre-existing i18n gap (the sections.menu.* catalogue keys
          // go unused here). Wiring it through useT is left as a follow-up.
          label: 'Edit in Stratigraphy stage',
          onClick: onEditInGeologyStage,
          testid: 'geo-deep-link-menu-item',
        },
        onLinkLithoToGeo && {
          label: 'Link to stratigraphy',
          onClick: onLinkLithoToGeo,
          testid: 'link-geo-menu-item',
        },
        onUnlinkLithoFromGeo && {
          label: 'Unlink from stratigraphy',
          onClick: onUnlinkLithoFromGeo,
          testid: 'unlink-geo-menu-item',
        },
        onDelete && { label: 'Delete contact', onClick: onDelete, danger: true, topBorder: true },
      ]}
    />
  )
}

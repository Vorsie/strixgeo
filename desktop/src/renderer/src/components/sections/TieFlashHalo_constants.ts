/**
 * Constants for the pending-tie landing pulse.
 *
 * @module components/sections/TieFlashHalo_constants
 */

/**
 * Amber-500 — the same value ``UNAPPROVED_EDGE_COLOR`` and the Ctrl+F column
 * flash use.
 *
 * Kept as a literal rather than a Tailwind class because this renders in SVG,
 * where a class cannot set ``stroke``.
 */
export const TIE_FLASH_COLOR = '#f59e0b'

/** Stroke width in px: fat enough to find on a busy section from across the canvas. */
export const TIE_FLASH_WIDTH_PX = 7

/**
 * Stroke opacity.
 *
 * Low enough that the tie's own 1.4 px dashes stay legible THROUGH the halo —
 * a highlight that hides its subject has not highlighted anything.
 */
export const TIE_FLASH_OPACITY = 0.45

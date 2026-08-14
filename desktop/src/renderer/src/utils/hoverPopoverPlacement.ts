/**
 * Pure placement maths for a cursor-following hover popover.
 *
 * The card wants to sit just off the hovered element so it does not cover it,
 * while never hanging off the panel it lives in. Near the right edge it flips
 * to the other side of the anchor rather than merely sliding, because sliding
 * would park the card ON TOP of what the user is pointing at.
 *
 * Coordinates are container-local pixels: the section SVG carries a
 * ``viewBox`` matched 1:1 to its pixel size, so an SVG position and an
 * ``absolute``-positioned HTML offset inside the same relative container are
 * the same number.
 */

/** Inputs describing the anchor, the card, and the panel it must stay inside. */
export interface PopoverPlacementInput {
  /** Container-local X of the element being hovered. */
  anchorX: number
  /** Container-local Y of the element being hovered. */
  anchorY: number
  /** Rendered card width in px. */
  popoverWidth: number
  /** Rendered card height in px. */
  popoverHeight: number
  /** Panel width in px. */
  containerWidth: number
  /** Panel height in px. */
  containerHeight: number
  /** Gap between the anchor and the card. Defaults to 14 px. */
  offset?: number
  /** Minimum gap between the card and the panel edges. Defaults to 4 px. */
  margin?: number
}

/** Resulting container-local top-left corner for the card. */
export interface PopoverPlacement {
  /** ``left`` style value in px. */
  left: number
  /** ``top`` style value in px. */
  top: number
}

const DEFAULT_OFFSET = 14
const DEFAULT_MARGIN = 4

/**
 * Place a hover card near an anchor without letting it leave the panel.
 *
 * @param input - Anchor position, card size, panel size, and optional spacing.
 * @returns The card's container-local top-left corner.
 */
export function clampPopoverPosition(input: PopoverPlacementInput): PopoverPlacement {
  const {
    anchorX,
    anchorY,
    popoverWidth,
    popoverHeight,
    containerWidth,
    containerHeight,
    offset = DEFAULT_OFFSET,
    margin = DEFAULT_MARGIN,
  } = input

  // Preferred side: right of the anchor. Flip left when the card would spill
  // past the panel's right edge — sliding instead would cover the anchor.
  let left = anchorX + offset
  if (left + popoverWidth > containerWidth - margin) {
    left = anchorX - offset - popoverWidth
  }
  let top = anchorY + offset

  // Final containment. Math.max wins over Math.min so a card larger than the
  // panel pins to the top-left margin rather than to a negative coordinate.
  left = Math.max(margin, Math.min(left, containerWidth - popoverWidth - margin))
  top = Math.max(margin, Math.min(top, containerHeight - popoverHeight - margin))

  return { left, top }
}

// Coach-card placement geometry (spec §Architecture).
//
// Pure: given the spotlighted control's rect, the card's size, and the viewport,
// decide where the card sits — to the right of the control, else below it, else
// docked bottom-right (the fallback when the control is off-screen or crowded).
// Kept out of CoachCard.tsx so the decision is testable without a DOM.

/** A control's screen rectangle (the fields `getBoundingClientRect` gives). */
export interface AnchorRect {
  left: number
  top: number
  right: number
  bottom: number
  width: number
  height: number
}

/** Where the card landed relative to the anchor. */
export type CardPlacement = 'right' | 'below' | 'docked'

/** The resolved card position. */
export interface PlacedCard {
  /** Card left in viewport pixels. */
  left: number
  /** Card top in viewport pixels. */
  top: number
  /** Which rule placed it. */
  placement: CardPlacement
}

/** Viewport-edge margin the card is kept inside (also the dock inset). */
export const DOCK_MARGIN = 24

/** Clamp `value` into `[min, max]` (returns `min` when the range is inverted). */
function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(Math.max(value, min), max)
}

/**
 * Place the coach card next to an anchor, or docked bottom-right.
 *
 * Tries, in order: to the right of the anchor (card top aligned to the anchor,
 * clamped inside the vertical margins), then below the anchor (card left aligned
 * to the anchor, clamped inside the horizontal margins), then docked bottom-right
 * when neither fits. A `null` anchor (control off-screen) docks immediately.
 *
 * Parameters
 * ----------
 * anchor : AnchorRect | null
 *     The spotlighted control's rect, or `null` if it is not on screen.
 * card : { width, height }
 *     The card's measured size.
 * viewport : { width, height }
 *     The window inner size.
 * gap : number, optional
 *     Space between the anchor and the card (default 16).
 *
 * Returns
 * -------
 * PlacedCard
 *     The card's left/top and which rule placed it.
 */
export function placeCoachCard(
  anchor: AnchorRect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
  gap = 16,
): PlacedCard {
  const dockedLeft = viewport.width - card.width - DOCK_MARGIN
  const dockedTop = viewport.height - card.height - DOCK_MARGIN
  const docked: PlacedCard = { left: dockedLeft, top: dockedTop, placement: 'docked' }

  if (anchor === null) return docked

  const maxTop = viewport.height - card.height - DOCK_MARGIN
  const maxLeft = viewport.width - card.width - DOCK_MARGIN

  // Right of the anchor.
  const rightLeft = anchor.right + gap
  if (rightLeft + card.width <= viewport.width - DOCK_MARGIN) {
    return { left: rightLeft, top: clamp(anchor.top, DOCK_MARGIN, maxTop), placement: 'right' }
  }

  // Below the anchor.
  const belowTop = anchor.bottom + gap
  if (belowTop + card.height <= viewport.height - DOCK_MARGIN) {
    return { left: clamp(anchor.left, DOCK_MARGIN, maxLeft), top: belowTop, placement: 'below' }
  }

  return docked
}

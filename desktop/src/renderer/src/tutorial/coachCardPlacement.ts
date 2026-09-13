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

/** A card position in viewport pixels (no placement rule attached). */
export interface CardPosition {
  left: number
  top: number
}

/**
 * Clamp a (dragged) card position so the whole card stays inside the viewport
 * margins — the same `DOCK_MARGIN` inset the computed placement respects.
 *
 * Used for the drag gesture (owner: "I drag it aside and it stays there") so a
 * drop, or a window resize under a drop, can never push the card off screen.
 *
 * Parameters
 * ----------
 * pos : CardPosition
 *     The desired card left/top.
 * card : { width, height }
 *     The card's size.
 * viewport : { width, height }
 *     The window inner size.
 *
 * Returns
 * -------
 * CardPosition
 *     The position clamped into `[DOCK_MARGIN, viewport - card - DOCK_MARGIN]`.
 */
export function clampCardIntoViewport(
  pos: CardPosition,
  card: { width: number; height: number },
  viewport: { width: number; height: number },
): CardPosition {
  return {
    left: clamp(pos.left, DOCK_MARGIN, viewport.width - card.width - DOCK_MARGIN),
    top: clamp(pos.top, DOCK_MARGIN, viewport.height - card.height - DOCK_MARGIN),
  }
}

/** Whether a card at `pos` (size `card`) overlaps the spotlight `rect`. */
function coversSpotlight(
  pos: CardPosition,
  card: { width: number; height: number },
  rect: AnchorRect,
): boolean {
  return (
    pos.left < rect.right &&
    pos.left + card.width > rect.left &&
    pos.top < rect.bottom &&
    pos.top + card.height > rect.top
  )
}

/**
 * Nudge a (dragged) card position off the spotlight it points at (owner: "It
 * never covers the control it points at"). When the drop overlaps the spotlight,
 * snap to the nearest of the four just-outside positions — right of, below, left
 * of, or above the spotlight — each clamped inside the viewport, keeping the drop
 * that already clears the control unchanged.
 *
 * Parameters
 * ----------
 * pos : CardPosition
 *     The dragged card left/top (already viewport-clamped).
 * card : { width, height }
 *     The card's size.
 * spotlight : AnchorRect | null
 *     The spotlighted control's rect, or `null` when nothing is highlighted.
 * viewport : { width, height }
 *     The window inner size.
 * gap : number, optional
 *     Space kept between the spotlight and the card (default 16).
 *
 * Returns
 * -------
 * CardPosition
 *     `pos` when it clears the spotlight, else the nearest non-overlapping spot
 *     (or the viewport-clamped `pos` when no side can fit it).
 */
export function nudgeCardOffSpotlight(
  pos: CardPosition,
  card: { width: number; height: number },
  spotlight: AnchorRect | null,
  viewport: { width: number; height: number },
  gap = 16,
): CardPosition {
  if (spotlight === null || !coversSpotlight(pos, card, spotlight)) return pos

  // Candidate positions just outside each edge of the spotlight, keeping the
  // free axis at the drop so the card slides the shortest way off the control.
  const candidates: CardPosition[] = [
    { left: spotlight.right + gap, top: pos.top }, // right
    { left: pos.left, top: spotlight.bottom + gap }, // below
    { left: spotlight.left - gap - card.width, top: pos.top }, // left
    { left: pos.left, top: spotlight.top - gap - card.height }, // above
  ]

  let best: CardPosition | null = null
  let bestDistanceSquared = Infinity
  for (const raw of candidates) {
    const clamped = clampCardIntoViewport(raw, card, viewport)
    // Clamping can slide a candidate back over the spotlight (e.g. a control
    // hugging an edge) — only accept one that still clears it.
    if (coversSpotlight(clamped, card, spotlight)) continue
    const dx = clamped.left - pos.left
    const dy = clamped.top - pos.top
    const distanceSquared = dx * dx + dy * dy
    if (distanceSquared < bestDistanceSquared) {
      best = clamped
      bestDistanceSquared = distanceSquared
    }
  }

  return best ?? clampCardIntoViewport(pos, card, viewport)
}

// Behaviour tests for placing a hover popover near the cursor.
//
// Owner's words: the popup shows "near the cursor", "is pointer-events:none,
// clamps inside the viewport, and disappears on mouse-leave". Only the
// placement maths lives here — the disappearing is the overlay's mouse-leave.
//
//   HP1  by default the card sits just right of and below what is hovered.
//   HP2  hovering near the right edge flips the card to the LEFT of the anchor
//        so the whole card stays on screen.
//   HP3  hovering near the bottom rides the card up so its bottom edge stays
//        on screen.
//   HP4  a card bigger than the panel pins to the top-left margin rather than
//        hanging off the top or the left.

import { describe, expect, it } from 'vitest'

import { clampPopoverPosition } from './hoverPopoverPlacement'

const CARD = { popoverWidth: 200, popoverHeight: 120 }
const PANEL = { containerWidth: 800, containerHeight: 500 }

describe('clampPopoverPosition — near the cursor, never off the panel', () => {
  it('HP1: the card sits just right of and below the hovered marker', () => {
    const { left, top } = clampPopoverPosition({
      anchorX: 100,
      anchorY: 200,
      ...CARD,
      ...PANEL,
      offset: 14,
    })
    expect(left).toBe(114)
    expect(top).toBe(214)
  })

  it('HP2: near the right edge the card flips to the left of the marker', () => {
    const { left } = clampPopoverPosition({
      anchorX: 780,
      anchorY: 200,
      ...CARD,
      ...PANEL,
      offset: 14,
    })
    // Flipped: right edge of the card lands 14 px left of the anchor.
    expect(left).toBe(780 - 14 - 200)
    // And it is fully inside the panel.
    expect(left).toBeGreaterThanOrEqual(0)
    expect(left + CARD.popoverWidth).toBeLessThanOrEqual(PANEL.containerWidth)
  })

  it('HP3: near the bottom the card rides up so its bottom edge stays inside', () => {
    const { top } = clampPopoverPosition({
      anchorX: 100,
      anchorY: 495,
      ...CARD,
      ...PANEL,
      offset: 14,
      margin: 4,
    })
    expect(top + CARD.popoverHeight).toBeLessThanOrEqual(PANEL.containerHeight - 4)
  })

  it('HP4: a card bigger than the panel pins to the top-left margin', () => {
    const { left, top } = clampPopoverPosition({
      anchorX: 50,
      anchorY: 50,
      popoverWidth: 900,
      popoverHeight: 600,
      ...PANEL,
      offset: 14,
      margin: 4,
    })
    expect(left).toBe(4)
    expect(top).toBe(4)
  })
})

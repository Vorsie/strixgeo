// Red-first pins for the coach-card placement (spec §Architecture: "positioned
// by a small placement function: right of the anchor, else below, else docked
// bottom-right"). Pure geometry — no DOM.

import { describe, expect, it } from 'vitest'

import { DOCK_MARGIN, placeCoachCard, type AnchorRect } from './coachCardPlacement'

const VIEWPORT = { width: 1000, height: 800 }
const CARD = { width: 320, height: 200 }

function rect(left: number, top: number, w: number, h: number): AnchorRect {
  return { left, top, right: left + w, bottom: top + h, width: w, height: h }
}

describe('placeCoachCard', () => {
  it('docks bottom-right when there is no anchor', () => {
    const p = placeCoachCard(null, CARD, VIEWPORT)
    expect(p.placement).toBe('docked')
    expect(p.left).toBe(VIEWPORT.width - CARD.width - DOCK_MARGIN)
    expect(p.top).toBe(VIEWPORT.height - CARD.height - DOCK_MARGIN)
  })

  it('places to the right of the anchor when it fits', () => {
    const p = placeCoachCard(rect(100, 100, 100, 40), CARD, VIEWPORT, 16)
    expect(p.placement).toBe('right')
    expect(p.left).toBe(216) // anchor.right (200) + gap (16)
  })

  it('drops below the anchor when the right edge has no room', () => {
    const p = placeCoachCard(rect(820, 100, 100, 40), CARD, VIEWPORT, 16)
    expect(p.placement).toBe('below')
    expect(p.top).toBe(156) // anchor.bottom (140) + gap (16)
  })

  it('docks bottom-right when neither right nor below fits', () => {
    const p = placeCoachCard(rect(880, 700, 100, 60), CARD, VIEWPORT, 16)
    expect(p.placement).toBe('docked')
  })

  it('keeps the card inside the viewport margins when placing right', () => {
    // A tall anchor near the bottom: placing right must clamp the top so the
    // card does not overflow the bottom margin.
    const p = placeCoachCard(rect(100, 780, 100, 10), CARD, VIEWPORT, 16)
    expect(p.placement).toBe('right')
    expect(p.top).toBeLessThanOrEqual(VIEWPORT.height - CARD.height - DOCK_MARGIN)
    expect(p.top).toBeGreaterThanOrEqual(DOCK_MARGIN)
  })
})

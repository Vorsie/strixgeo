// A tie the engineer has to check must SAY SO on the section.
//
// A re-subdivide can leave an accepted geotech tie attached to a band that is not
// obviously the one it was drawn on. Those ties are carried and flagged rather than
// deleted, because an accepted edge never disappears without the user deleting it
// (owner, 2026-08-02). That promise is only worth something if the flag is visible:
// a warning stored in a column nobody renders is the same as no warning.
//
// The control case is the point of RF2 — asserting only that a flagged tie gets a
// badge would pass just as well if every tie got one.

import { cleanup, fireEvent } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { makeGeotechEdge, renderGeotechAxis } from './__fixtures__/correlationOverlayScene'
import type { LithoContactCorrelationEdge } from '../../api/client'

afterEach(() => cleanup())

/** The amber that means "auto-proposed, pending acceptance" — a different state. */
const PENDING_AMBER = '#f59e0b'

function flagged(id: string, reason: string): LithoContactCorrelationEdge {
  return { ...makeGeotechEdge(id, true), review_reason: reason }
}

describe('CorrelationEdgesOverlay — a tie awaiting confirmation is visible', () => {
  it('RF1 — a flagged tie carries a badge naming why it needs checking', () => {
    const { container } = renderGeotechAxis([flagged('geo-flagged', 'class_changed')])

    const badge = container.querySelector('[data-testid="edge-review-badge-geo-flagged"]')
    expect(badge).not.toBeNull()
    expect(badge!.getAttribute('data-review-reason')).toBe('class_changed')
  })

  it('RF2 — an ordinary accepted tie carries no badge, so the badge means something', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-clean', true)])

    expect(container.querySelector('[data-testid="edge-review-badge-geo-clean"]')).toBeNull()
  })

  it('RF3 — the flag is not colour alone: the badge is a glyph with a readable title', () => {
    const { container } = renderGeotechAxis([flagged('geo-flagged', 'ambiguous_band')])

    const badge = container.querySelector('[data-testid="edge-review-badge-geo-flagged"]')!
    // A screen reader and a colour-blind user both get the meaning without the hue.
    expect(badge.querySelector('title')!.textContent).toMatch(/check/i)
    expect(badge.querySelector('text')!.textContent).toBe('!')
  })

  it('RF4 — a flagged tie still reads as accepted, not as a pending proposal', () => {
    const { container } = renderGeotechAxis([flagged('geo-flagged', 'class_changed')])

    // It was approved and stays approved — demoting it to a proposal would hand it
    // to the next rebuild's dirty-delete pass.
    expect(
      container.querySelector('[data-testid="ribbon-geo-flagged"]')!.getAttribute('data-approved'),
    ).toBe('true')
    const outline = container.querySelector('[data-testid="ribbon-outline-geo-flagged"]')
    expect(outline?.getAttribute('stroke') ?? null).not.toBe(PENDING_AMBER)
  })
})

describe('CorrelationEdgesOverlay — resolving a flagged tie', () => {
  it('RF5 — right-clicking the badge offers Confirm alongside Delete', () => {
    const onRequestConfirmEdgeReview = vi.fn()
    const { container } = renderGeotechAxis([flagged('geo-flagged', 'class_changed')], {
      onRequestDeleteEdge: vi.fn(),
      onRequestConfirmEdgeReview,
    })

    fireEvent.contextMenu(
      container.querySelector('[data-testid="edge-review-badge-geo-flagged"] circle')!,
    )

    const confirm = document.querySelector('[data-testid="edge-context-confirm-review"]')
    expect(confirm).not.toBeNull()
    expect(document.querySelector('[data-testid="edge-context-delete"]')).not.toBeNull()

    fireEvent.click(confirm!)
    expect(onRequestConfirmEdgeReview).toHaveBeenCalledTimes(1)
    expect(onRequestConfirmEdgeReview.mock.calls[0][0].id).toBe('geo-flagged')
  })

  it('RF6 — an unflagged tie’s menu has no Confirm row, so it is never a no-op', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-clean', true)], {
      onRequestDeleteEdge: vi.fn(),
      onRequestConfirmEdgeReview: vi.fn(),
    })

    fireEvent.contextMenu(container.querySelector('[data-testid="edge-hit-geo-clean"]')!)

    expect(document.querySelector('[data-testid="edge-context-delete"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="edge-context-confirm-review"]')).toBeNull()
  })
})

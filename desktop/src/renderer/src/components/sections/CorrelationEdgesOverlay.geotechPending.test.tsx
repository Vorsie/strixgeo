// A geotech tie that is still waiting for review must LOOK unreviewed.
//
// Auto-correlate now proposes geotech ties as unapproved suggestions, so the engineer
// has to be able to tell at a glance which ties on a geotech section he drew and which
// the machine is proposing. On the litho axis that cue is the amber dashed outline; the
// question this file answers is whether that cue is driven by the edge's own
// ``user_approved`` flag or by an axis check somewhere in the render path.
//
// The edges are handed in through ``overlayEdgeSource`` rather than straight to the
// overlay, because on the geotech axis SectionPanel feeds the overlay the SEPARATE
// geotech edge list — routing the test through the real selector keeps the proof honest
// about which list actually reaches the render.

import { cleanup, fireEvent, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  makeGeotechEdge,
  renderGeotechAxis,
  renderGeotechJumpAxis,
} from './__fixtures__/correlationOverlayScene'

afterEach(() => cleanup())

// The amber the section view uses everywhere for "not yet accepted".
const PENDING_AMBER = '#f59e0b'


describe('CorrelationEdgesOverlay — a pending geotech tie reads as pending', () => {
  it('GR1 — an unapproved geotech tie draws the amber dashed outline, not a solid seam', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)])

    const outline = container.querySelector('[data-testid="ribbon-outline-geo-pending"]')
    expect(outline).not.toBeNull()
    expect(outline!.getAttribute('stroke')).toBe(PENDING_AMBER)
    expect(outline!.getAttribute('stroke-dasharray')).toBeTruthy()
    // The solid seam belongs to accepted work only.
    expect(container.querySelector('[data-testid="ribbon-seam-geo-pending"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="ribbon-geo-pending"]')!.getAttribute('data-approved'),
    ).toBe('false')
  })

  it('GR2 — an accepted geotech tie draws the solid seam and no amber outline (control)', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-approved', true)])

    expect(container.querySelector('[data-testid="ribbon-seam-geo-approved"]')).not.toBeNull()
    expect(container.querySelector('[data-testid="ribbon-outline-geo-approved"]')).toBeNull()
    expect(
      container.querySelector('[data-testid="ribbon-geo-approved"]')!.getAttribute('data-approved'),
    ).toBe('true')
  })

  it('GR3 — the geotech axis renders the geotech list, so the flag under test is the geotech edge’s', () => {
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)])

    // The approved litho edge passed alongside must not appear on this axis.
    expect(container.querySelector('[data-testid="ribbon-litho-edge"]')).toBeNull()
  })

  it('GR4 — a PENDING jump tie bends at the column it jumps, like the accepted one does', () => {
    // Pipeline step 2 proposes ties ACROSS columns that carry no packing yet, so a
    // proposal whose endpoints are not neighbours is ordinary here. A correlation
    // surface is straight in (along, elevation); the columns are not placed
    // proportionally to along-metres, so a straight SCREEN segment runs somewhere
    // the surface is not — over the intervening column, at the wrong depth. The
    // accepted seam has bent at each intervening column since 2026-07-10; the
    // proposal's amber outline is the same claim about the same surface and must
    // do the same, or the render says the tie moves when it is accepted.
    const { container } = renderGeotechJumpAxis([makeGeotechEdge('geo-jump', false)])
    const outline = container.querySelector('[data-testid="ribbon-outline-geo-jump"]')
    expect(outline).not.toBeNull()
    const pts = (outline!.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((p) => p.split(',').map(Number) as [number, number])
    const xs = pts.map(([x]) => x)
    // The jumped column M sits at x 150 with width 40 → its inner edges are 130/170.
    expect(xs).toContain(130)
    expect(xs).toContain(170)
    // The bend's Y must interpolate by ALONG-metres (M is at along-fraction
    // 0.2), never by screen position (where M sits at fraction 0.5). With the
    // endpoint ys from the outline itself, the along-interpolated y at M is
    // yA + 0.2·(yB−yA); the screen-interpolated one would be the midpoint.
    // Endpoints = the ring's outermost xs (the ribbon starts at the columns'
    // inner edges, not their centres); first occurrence at each extreme x is
    // the TOP edge (the ring runs the top polyline first).
    const minX = Math.min(...xs)
    const maxX = Math.max(...xs)
    const yA = pts.find(([x]) => x === minX)![1]
    const yB = pts.find(([x]) => x === maxX)![1]
    const yAtM = pts.find(([x]) => x === 130)![1]
    // M sits at along-fraction 0.2 but screen-fraction 0.5: an along-driven
    // bend lands decisively on yA's side of the screen midpoint, a
    // screen-driven bend lands AT the midpoint. Coarse on purpose — exact
    // interpolation anchors differ per segment, the side does not.
    const midY = (yA + yB) / 2
    expect(Math.abs(yAtM - yA)).toBeLessThan(Math.abs(yAtM - midY))
  })

  it('GR5 — an ACCEPTED jump tie bends at the same column (control)', () => {
    const { container } = renderGeotechJumpAxis([makeGeotechEdge('geo-jump', true)])
    const seam = container.querySelector('[data-testid="ribbon-seam-geo-jump"]')
    const xs = (seam!.getAttribute('points') ?? '')
      .trim()
      .split(/\s+/)
      .map((p) => Number(p.split(',')[0]))
    expect(xs).toContain(130)
    expect(xs).toContain(170)
  })

  it('GR6 — a pending geotech tie can be accepted from its own right-click menu', () => {
    // Step 3 has a per-tie half: the engineer keeps the proposals he agrees with
    // one at a time instead of accepting the section wholesale. It must reuse the
    // litho accept path — this pins that the geotech axis OFFERS it at all.
    const onRequestAcceptEdge = vi.fn()
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)], {
      onRequestDeleteEdge: vi.fn(),
      onRequestAcceptEdge,
    })
    fireEvent.contextMenu(container.querySelector('[data-testid="edge-hit-geo-pending"]')!)
    fireEvent.click(screen.getByTestId('edge-context-accept'))
    expect(onRequestAcceptEdge).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'geo-pending' }),
    )
  })

  it('GR7 — an ACCEPTED geotech tie offers no accept item (control)', () => {
    const onRequestAcceptEdge = vi.fn()
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-approved', true)], {
      onRequestDeleteEdge: vi.fn(),
      onRequestAcceptEdge,
    })
    fireEvent.contextMenu(container.querySelector('[data-testid="edge-hit-geo-approved"]')!)
    expect(screen.queryByTestId('edge-context-accept')).toBeNull()
  })

  it('GR8 — the geotech accept row is worded as a TIE, matching the toolbar', () => {
    // The bulk verb is "3 · Accept all ties" and the gate refuses by naming
    // "packing ties". A per-tie row reading "Accept correlation" beside them
    // would look like a different verb on a different object.
    const { container } = renderGeotechAxis([makeGeotechEdge('geo-pending', false)], {
      onRequestDeleteEdge: vi.fn(),
      onRequestAcceptEdge: vi.fn(),
    })
    fireEvent.contextMenu(container.querySelector('[data-testid="edge-hit-geo-pending"]')!)
    expect(screen.getByTestId('edge-context-accept').textContent).toContain('Accept tie')
  })
})

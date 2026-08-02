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

import { cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

import {
  makeGeotechEdge,
  renderGeotechAxis,
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
})

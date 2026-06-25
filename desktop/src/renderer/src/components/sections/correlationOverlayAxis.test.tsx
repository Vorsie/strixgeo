// Behavioral net for the geotech "Correlate packing" overlay wiring
// (Phase 1, 2026-06-25).
//
// SectionPanel is a god-component that cannot be mounted in a unit test, so the
// two axis-aware decisions Phase 1 introduced are pure helpers
// (correlationOverlayAxis.ts) tested directly here. Together they encode:
//
//   - the CorrelationEdgesOverlay now mounts on the GEOTECH axis (it didn't
//     before — that was the bug: bands weren't clickable, you got the pan
//     cursor), in addition to the litho axis;
//   - the overlay reads the SEPARATE geotechCorrelationEdges list on the
//     geotech axis;
//   - THE REGRESSION GUARD: the partition fill stays framed by the litho
//     contactEdges on EVERY axis — the geotech overlay edges never feed the
//     partition (mixing them pinched every litho band to a lens, commit
//     7329738b).
//
// Pinned claims:
//   OA1  Overlay mounts on the litho axis when correlations are shown.
//   OA2  Overlay mounts on the GEOTECH axis when correlate mode is armed
//        (the Phase-1 fix — it did not before).
//   OA3  Overlay does NOT mount on the geological axis.
//   OA4  Overlay does NOT mount when neither shown nor armed.
//   OA5  Overlay edge source on the geotech axis is geotechCorrelationEdges.
//   OA6  Overlay edge source on the litho axis is contactEdges.
//   OA7  REGRESSION GUARD — the partition edge source is contactEdges on the
//        geotech axis (NOT geotechCorrelationEdges).
//   OA8  REGRESSION GUARD — the partition edge source is contactEdges on the
//        litho axis, i.e. axis-independent; overlay vs partition read distinct
//        sources on the geotech axis.

import { describe, expect, it } from 'vitest'

import {
  overlayEdgeSource,
  partitionEdgeSource,
  shouldMountCorrelationOverlay,
} from './correlationOverlayAxis'
import type { LithoContactCorrelationEdge } from '../../api/client'

// Two clearly-distinct edge lists so a test can prove which one a helper read.
const lithoEdge = { id: 'litho-edge-1' } as unknown as LithoContactCorrelationEdge
const geotechEdge = { id: 'geotech-edge-1' } as unknown as LithoContactCorrelationEdge
const lithoEdges: readonly LithoContactCorrelationEdge[] = [lithoEdge]
const geotechEdges: readonly LithoContactCorrelationEdge[] = [geotechEdge]

describe('shouldMountCorrelationOverlay', () => {
  it('OA1 — mounts on the litho axis when correlations are shown', () => {
    expect(shouldMountCorrelationOverlay('lithostratigraphic', true, false)).toBe(true)
  })

  it('OA2 — mounts on the geotech axis when correlate mode is armed (the Phase-1 fix)', () => {
    // Before Phase 1 the gate was axisMode === 'lithostratigraphic' only, so a
    // geotech-axis correlate click fell through to canvas pan. This is the
    // behaviour change.
    expect(shouldMountCorrelationOverlay('geotechnical', false, true)).toBe(true)
    expect(shouldMountCorrelationOverlay('geotechnical', true, false)).toBe(true)
  })

  it('OA3 — never mounts on the geological axis', () => {
    expect(shouldMountCorrelationOverlay('geological', true, true)).toBe(false)
  })

  it('OA4 — does not mount when neither shown nor armed', () => {
    expect(shouldMountCorrelationOverlay('lithostratigraphic', false, false)).toBe(false)
    expect(shouldMountCorrelationOverlay('geotechnical', false, undefined)).toBe(false)
  })
})

describe('overlayEdgeSource — which edges the overlay draws', () => {
  it('OA5 — geotech axis reads the SEPARATE geotechCorrelationEdges list', () => {
    expect(overlayEdgeSource('geotechnical', lithoEdges, geotechEdges)).toBe(geotechEdges)
  })

  it('OA6 — litho axis reads contactEdges', () => {
    expect(overlayEdgeSource('lithostratigraphic', lithoEdges, geotechEdges)).toBe(lithoEdges)
  })

  it('— geotech axis falls back to [] when no geotech edges supplied', () => {
    expect(overlayEdgeSource('geotechnical', lithoEdges, undefined)).toEqual([])
  })
})

describe('partitionEdgeSource — the regression guard (commit 7329738b)', () => {
  it('OA7 — partition reads contactEdges on the geotech axis, NOT the geotech overlay edges', () => {
    // The load-bearing invariant: feeding the sparse geotech edges into the
    // partition pulled the litho connectivity out of the fill and pinched every
    // band to a lens. The partition must stay framed by the litho contactEdges.
    const partitionSource = partitionEdgeSource('geotechnical', lithoEdges)
    expect(partitionSource).toBe(lithoEdges)
    expect(partitionSource).not.toBe(geotechEdges)
  })

  it('OA8 — partition source is axis-independent; overlay vs partition read distinct sources on geotech', () => {
    expect(partitionEdgeSource('lithostratigraphic', lithoEdges)).toBe(lithoEdges)
    // On the geotech axis the overlay and the partition draw from DIFFERENT
    // lists — that separation is the whole point of Phase 1.
    const overlaySource = overlayEdgeSource('geotechnical', lithoEdges, geotechEdges)
    const partition = partitionEdgeSource('geotechnical', lithoEdges)
    expect(overlaySource).not.toBe(partition)
    expect(overlaySource).toBe(geotechEdges)
    expect(partition).toBe(lithoEdges)
  })
})

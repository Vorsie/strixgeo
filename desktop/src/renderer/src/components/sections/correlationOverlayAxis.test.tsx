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
//   - the PARTITION on the geotech axis is framed by the GEOTECH model's own
//     layers + edges (owner ruling 2026-08-13, see below).
//
// Pinned claims:
//   OA1  Overlay mounts on the litho axis when correlations are shown.
//   OA2  Overlay mounts on the GEOTECH axis when correlate mode is armed
//        (the Phase-1 fix — it did not before).
//   OA3  Overlay does NOT mount on the geological axis.
//   OA4  Overlay does NOT mount when neither shown nor armed.
//   OA5  Overlay edge source on the geotech axis is geotechCorrelationEdges.
//   OA6  Overlay edge source on the litho axis is contactEdges.
//   OA7  The geotech axis's PARTITION reads the geotech model's edges + layers.
//   OA8  The litho axis's partition still reads the litho model's edges + layers.
//   OA9  "Show litho fill" on the geotech axis swaps the partition back to the
//        LITHO model — one fill at a time, and it is the litho one by request.

import { describe, expect, it } from 'vitest'

import {
  overlayEdgeSource,
  partitionColorSource,
  partitionEdgeSource,
  partitionLayerSource,
  shouldMountCorrelationOverlay,
} from './correlationOverlayAxis'
import type { LithoContactCorrelationEdge, LithoLayerResponse } from '../../api/client'

// Two clearly-distinct edge lists so a test can prove which one a helper read.
const lithoEdge = { id: 'litho-edge-1' } as unknown as LithoContactCorrelationEdge
const geotechEdge = { id: 'geotech-edge-1' } as unknown as LithoContactCorrelationEdge
const lithoEdges: readonly LithoContactCorrelationEdge[] = [lithoEdge]
const geotechEdges: readonly LithoContactCorrelationEdge[] = [geotechEdge]

// Same for the layer lists the partition columns are assembled from.
const lithoLayers = [{ id: 'litho-layer-1' } as unknown as LithoLayerResponse]
const geotechLayers = [{ id: 'geotech-layer-1' } as unknown as LithoLayerResponse]

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

describe('the geotech axis partitions the GEOTECH model (owner ruling 2026-08-13)', () => {
  // The owner's words: "we don't need to invent the fill bands engine, it is
  // built for the litho stage — we only have more classes." The geotech axis
  // therefore runs the SAME partition engine over the GEOTECH model's own
  // columns and its own approved packing ties — exactly what the 3-D build arm
  // already feeds it — instead of subdividing the litho partition after the
  // fact. These two helpers are where that choice is made, so they are where
  // it is pinned.
  //
  // SUPERSEDES the 2026-06-25 guard (commit 7329738b), which asserted the
  // partition source was axis-INDEPENDENT. That guard existed because the
  // geotech edges were fed to a partition assembled from LITHO layers — a
  // mismatch that pinched every litho band to a lens. Layers and edges now move
  // together, so the mismatch it protected against cannot arise.

  it('OA7 — the geotech axis reads the geotech model’s edges AND layers', () => {
    expect(partitionEdgeSource('geotechnical', lithoEdges, geotechEdges)).toBe(geotechEdges)
    expect(partitionLayerSource('geotechnical', lithoLayers, geotechLayers)).toBe(geotechLayers)
  })

  it('OA8 — the litho axis still reads the litho model’s edges AND layers', () => {
    expect(partitionEdgeSource('lithostratigraphic', lithoEdges, geotechEdges)).toBe(lithoEdges)
    expect(partitionLayerSource('lithostratigraphic', lithoLayers, geotechLayers)).toBe(lithoLayers)
    // The geological axis never mounts the fill overlay, but the helpers must
    // still answer honestly rather than leaking geotech data there.
    expect(partitionEdgeSource('geological', lithoEdges, geotechEdges)).toBe(lithoEdges)
    expect(partitionLayerSource('geological', lithoLayers, geotechLayers)).toBe(lithoLayers)
  })

  it('OA9 — "Show litho fill" swaps the geotech axis back to the litho model', () => {
    expect(partitionEdgeSource('geotechnical', lithoEdges, geotechEdges, true)).toBe(lithoEdges)
    expect(partitionLayerSource('geotechnical', lithoLayers, geotechLayers, true)).toBe(lithoLayers)
  })

  it('— a geotech axis with no geotech data falls back to empty, never to litho data', () => {
    // A section with no packing model must paint NOTHING there; borrowing the
    // litho lists would resurrect the 2026-08-06 "why is there fill?" leak.
    expect(partitionEdgeSource('geotechnical', lithoEdges, undefined)).toEqual([])
    expect(partitionLayerSource('geotechnical', lithoLayers, undefined)).toEqual([])
  })

  it('— overlay ribbons and the partition read the SAME geotech edge list now', () => {
    expect(overlayEdgeSource('geotechnical', lithoEdges, geotechEdges)).toBe(
      partitionEdgeSource('geotechnical', lithoEdges, geotechEdges),
    )
  })
})

describe('partitionColorSource — the fill is coloured by the model it came from', () => {
  const nadColours = new Map([['nad-7', '#111111']])
  const lithoColours = new Map([['litho-sand', '#fbbf24']])

  it('— the geotech axis colours packing bands by NAD class', () => {
    expect(partitionColorSource('geotechnical', nadColours, lithoColours)).toBe(nadColours)
  })

  it('— "Show litho fill" colours the litho partition by LITHOLOGY, not grey', () => {
    // The parent's ``formationColorById`` is keyed by GEOTECH formation id on
    // this axis, so a litho region looked up there resolves to nothing and
    // paints the neutral fallback. Swapping the partition's source model has to
    // swap its palette with it, or the toggle draws a grey section.
    expect(partitionColorSource('geotechnical', nadColours, lithoColours, true)).toBe(lithoColours)
  })

  it('— the litho axis is unaffected (its own map is already the litho one)', () => {
    expect(partitionColorSource('lithostratigraphic', lithoColours, undefined)).toBe(lithoColours)
    expect(partitionColorSource('lithostratigraphic', lithoColours, nadColours, true)).toBe(
      lithoColours,
    )
  })

  it('— with no litho palette supplied the parent map stands (never a crash)', () => {
    expect(partitionColorSource('geotechnical', nadColours, undefined, true)).toBe(nadColours)
  })
})

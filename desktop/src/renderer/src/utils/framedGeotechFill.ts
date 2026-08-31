// The framed geotech fill — the ONE derivation the geotech axis renders, the
// voxel build posts, and the body-identity recompute groups by (owner ruling
// 2026-08-18, "densities on top of lithos"; R6 / debt #278).
//
// Extracted (2026-08-31) as the second consumer of ``buildVoxelRequest``'s
// geotech arm arrived (``buildBodyRecomputePayload``): which masses count as
// ONE body must be decided from the picture the render shows — the hierarchical
// fill on the LITHO FRAME's columns — not re-derived per consumer on a
// different axis. Kept a sibling of ``assembleSectionPartitionFrames`` (in
// ``buildVoxelRequest``) rather than inside it: that file already carries the
// god-component warning (debt #201). ``buildFrameBySectionId`` calls
// ``assembleSectionPartitionFrames`` from that file, so there is a runtime
// import cycle — SAFE because it is function-declaration only (both sides are
// hoisted and neither calls the other at module-eval time).

import type { FenceSectionInput } from './buildProjectFence'
import { assembleSectionPartitionFrames, type SectionPartitionFrame } from './buildVoxelRequest'
import { frameAlignedColumns } from './frameAlignedPartition'
import {
  computeHierarchicalGeotechFill,
  type HierarchicalGeotechFillResult,
} from './geotechHierarchicalFill'
import { computeSectionFillActive } from './partitionEngineSelect'
import type { CorrelationEdge, PartitionColumn, SectionRegion } from './sectionPartition'

/**
 * The section key both the voxel build and the body recompute join a litho
 * frame to its geotech section by — the section id when the caller supplies
 * one, else the line's own endpoints (the same section always projects the
 * same line, and the two models' inputs are assembled from the SAME
 * cross-section rows).
 *
 * Parameters
 * ----------
 * input : FenceSectionInput
 *     The section's fence input.
 *
 * Returns
 * -------
 * string
 *     The join key.
 */
export function sectionFrameKey(input: FenceSectionInput): string {
  return (
    input.sectionId ??
    `${input.section.start_x},${input.section.start_y},${input.section.end_x},${input.section.end_y}`
  )
}

/**
 * Assemble the frame sections and index them by ``sectionFrameKey`` — the map
 * the voxel build and the body recompute both look their per-section litho
 * frame up in. One builder, so the two join their frame identically.
 *
 * Parameters
 * ----------
 * frameSections : readonly FenceSectionInput[] | undefined
 *     The litho frame sections, or ``undefined`` for a litho build (no frame).
 *
 * Returns
 * -------
 * Map<string, SectionPartitionFrame>
 *     Frame key → assembled frame. EMPTY when ``frameSections`` is undefined or
 *     assembles to no fillable section — the callers then fall back to their
 *     own whole-section partition per section.
 */
export function buildFrameBySectionId(
  frameSections: readonly FenceSectionInput[] | undefined,
): Map<string, SectionPartitionFrame> {
  const frameBySectionId = new Map<string, SectionPartitionFrame>()
  if (frameSections !== undefined) {
    for (const frame of assembleSectionPartitionFrames(frameSections, undefined)) {
      frameBySectionId.set(sectionFrameKey(frame.input), frame)
    }
  }
  return frameBySectionId
}

/** One section's framed geotech fill: the litho partition + the fill on it. */
export interface FramedGeotechFill {
  /** The frame's own litho partition — the axis the hierarchical fill runs on. */
  lithoRegions: SectionRegion[]
  /** The hierarchical geotech fill computed on that frame. */
  hierarchical: HierarchicalGeotechFillResult
}

/**
 * Run the hierarchical geotech fill on a litho frame — the SAME computation the
 * geotech axis renders, the voxel build posts, and the body-identity recompute
 * groups by. So those consumers share ONE derivation and can never disagree on
 * which masses are one body.
 *
 * Parameters
 * ----------
 * lithoFrame : SectionPartitionFrame
 *     The section's litho frame (columns + apex overrides + along-metres).
 * geotechColumns : readonly PartitionColumn[]
 *     The geotech model's assembled columns for this section (the packing bands
 *     the model HAS divided; placed on the frame's axis internally so a column
 *     the packing model has not divided contributes an empty stack).
 * geotechEdges : readonly CorrelationEdge[]
 *     The geotech model's approved packing correlation edges for this section.
 * packingClassOf : ReadonlyMap<string, string>, optional
 *     Geotech formation id → canonical class key (``buildPackingClassOf``) — the
 *     mass identity the render welds by. Absent keeps row identity.
 *
 * Returns
 * -------
 * FramedGeotechFill
 *     The frame's litho regions and the hierarchical fill computed on them.
 */
export function computeFramedGeotechFill(
  lithoFrame: SectionPartitionFrame,
  geotechColumns: readonly PartitionColumn[],
  geotechEdges: readonly CorrelationEdge[],
  packingClassOf: ReadonlyMap<string, string> | undefined,
): FramedGeotechFill {
  const lithoRegions = computeSectionFillActive(
    lithoFrame.columns,
    lithoFrame.input.edges,
    lithoFrame.apexOverrides,
    lithoFrame.alongM,
  )
  const hierarchical = computeHierarchicalGeotechFill({
    lithoColumns: lithoFrame.columns,
    lithoEdges: lithoFrame.input.edges,
    lithoRegions,
    geotechColumns: frameAlignedColumns(
      lithoFrame.columns,
      new Map(geotechColumns.map((c) => [c.investigationId, c])),
    ),
    geotechEdges,
    alongM: lithoFrame.alongM,
    // Same class identity as the render — one mass one body (2026-08-21).
    packingClassOf,
  })
  return { lithoRegions, hierarchical }
}

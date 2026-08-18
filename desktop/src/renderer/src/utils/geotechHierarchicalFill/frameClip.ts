/**
 * Clip ONE family's packing partition to that family's own litho regions.
 *
 * Geometry only. Both inputs already belong to the same family, so every face
 * that survives carries a class of the family's own soil BY CONSTRUCTION —
 * there is nothing to re-label, nothing to compare soils about, and no nearest-
 * class heuristic anywhere. That is the whole point of running the engine per
 * family: the confinement is structural, not a repair.
 *
 * Three outcomes per face:
 *
 *  * inside the family's litho cover AND inside one of its packing regions →
 *    KEPT, carrying that region's class, body and layer ids;
 *  * inside the litho cover with no packing region over it → RESIDUAL: this
 *    part of the litho unit has no packing class (nothing was correlated into
 *    it), which the render answers with the litho colour + the "correlate me"
 *    texture — never with an invented class;
 *  * outside the litho cover → DROPPED. Nothing may exceed the frame.
 *
 * @module utils/geotechHierarchicalFill/frameClip
 */

import { overlayFaces, pointInRing } from './frameClipGeometry'
import type { SectionRegion } from '../partitionFill'

/** What one gap's clip produced for one family. */
export interface FrameClipResult {
  /** Faces carrying a packing class (``kind: 'quad'``, disjoint). */
  covered: SectionRegion[]
  /** Faces of the litho cover no packing class reached. */
  residual: SectionRegion[]
}

/**
 * Order regions the way the render stacks them: overlays (lenses) last, so the
 * LAST containing region wins the sample.
 */
function painterOrder(regions: readonly SectionRegion[]): SectionRegion[] {
  return [...regions.filter((r) => r.kind !== 'lens'), ...regions.filter((r) => r.kind === 'lens')]
}

/** The last region of ``paint`` containing the sample, or null. */
function coverAt(
  paint: readonly SectionRegion[],
  fraction: number,
  elevation: number,
): SectionRegion | null {
  let found: SectionRegion | null = null
  for (const region of paint) if (pointInRing(fraction, elevation, region.polygon)) found = region
  return found
}

/**
 * Clip one family's packing regions to its litho regions, inside one gap.
 *
 * @param geotechRegions The family's packing partition for this gap, already in
 *   THIS gap's fraction space (a construct reaching over several frame gaps has
 *   fractions outside [0, 1]; those faces fall outside the frame and drop).
 * @param frameRegions The family's litho regions in this gap.
 * @param gapIndex The frame gap index stamped on every emitted region.
 * @param gapPaint EVERY litho region in this gap, so ownership is resolved in
 *   the render's own z-order — an enclosed lens is an overlay over another
 *   family's matrix, and without this both families claim it. Omit only when
 *   the caller knows the family owns its regions outright (unit scenes).
 * @returns Kept faces and residual faces; together they tile the litho cover.
 */
export function clipFamilyToFrameGap(
  geotechRegions: readonly SectionRegion[],
  frameRegions: readonly SectionRegion[],
  gapIndex: number,
  gapPaint?: readonly SectionRegion[],
): FrameClipResult {
  if (frameRegions.length === 0) return { covered: [], residual: [] }
  // Nothing classified here AND nothing painted over this cover: the whole
  // litho cover is residual, and there is no overlay to compute. Returning the
  // frame regions verbatim keeps the fallback layer's polygons EXACTLY the
  // litho ones in the common un-subdivided case, which is what the "correlate
  // me" texture is drawn over.
  const own = new Set(frameRegions)
  // THE LITHO PARTITION IS NOT DISJOINT: an enclosed lens is an OVERLAY drawn
  // over the matrix it sits in, and the two belong to different families. So a
  // face inside this family's matrix region can be OWNED by another family's
  // lens, and clipping each family to its own regions alone paints that face
  // twice — measured on the owner's Cross-section 1 as 9.3 m² of sand over a
  // clay cover, the ONE wrong-soil bucket left model-wide. Ownership is
  // therefore resolved against the WHOLE gap's paint, in the render's own
  // z-order, and a face this family does not own is dropped here for the
  // family that does to claim.
  const foreignOverlays = (gapPaint ?? []).filter((r) => r.kind === 'lens' && !own.has(r))
  if (geotechRegions.length === 0 && foreignOverlays.length === 0) {
    return { covered: [], residual: [...frameRegions] }
  }

  const framePaint = gapPaint === undefined ? painterOrder(frameRegions) : painterOrder([...gapPaint])
  const geotechPaint = painterOrder(geotechRegions)
  const faces = overlayFaces(
    [
      ...frameRegions.map((r) => r.polygon),
      ...geotechRegions.map((r) => r.polygon),
      ...foreignOverlays.map((r) => r.polygon),
    ],
    `hier-${gapIndex}`,
  )

  const covered: SectionRegion[] = []
  const residual: SectionRegion[] = []
  for (const face of faces) {
    const frame = coverAt(framePaint, face.sample.fraction, face.sample.elevation)
    // Outside the litho cover, or inside a face another family owns.
    if (frame === null || !own.has(frame)) continue
    const geotech = coverAt(geotechPaint, face.sample.fraction, face.sample.elevation)
    if (geotech === null) {
      residual.push({
        gapIndex,
        formationId: frame.formationId,
        bodyId: frame.bodyId,
        kind: 'quad',
        polygon: face.ring,
      })
      continue
    }
    covered.push({
      gapIndex,
      formationId: geotech.formationId,
      bodyId: geotech.bodyId,
      kind: 'quad',
      polygon: face.ring,
      // The layer ids travel: they are the identity every downstream consumer
      // reads (the body recompute's evidence, the 2/1/0 conformance gate's
      // per-band attribution). Dropping them here is how the post-hoc clip made
      // the fill un-auditable.
      ...(geotech.layerIds !== undefined && geotech.layerIds.length > 0
        ? { layerIds: [...geotech.layerIds] }
        : {}),
    })
  }
  return { covered, residual }
}

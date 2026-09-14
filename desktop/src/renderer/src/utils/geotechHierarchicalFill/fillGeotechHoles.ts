/**
 * NO HOLES IN THE MODEL — a geometric safety net over the constructive fill.
 *
 * The owner's absolute (2026-08-21, and again on installer #36's Cross-section 2):
 * *"the litho doesn't have a hole there, so the geotech axis has none either"* —
 * *"no holes in the model remember."*
 *
 * The constructive engine (``fillGap`` and friends) draws the packing bands from
 * the LINES→LOOPS→FILL law. On rare real-data geometry it can leave a litho-covered
 * face unpainted — the installer #36 case was S1's deep SILT unit on CS2: an
 * enclosed litho lens (a ZAND lens carved above it) whose 0-tie-looking band in fact
 * carries a shared-contact base tie, so it emits an ONLAP whose apex lands exactly on
 * the litho unit's own base line; the arrangement then fails to trace the sub-TD
 * onlap wedge and a 19.5 m² triangle goes unpainted directly under a correlation
 * band. The raster coverage gate (60×60 per gap) is blind to it; the geometric hole
 * audit (``geotechHoles.diag``) sees it.
 *
 * This pass runs AFTER the constructive fill + weld and closes any litho-covered face
 * the fill left empty. It does NOT invent a class: it reads the packing band the
 * MODEL already holds at that face's position — the geotech band whose own litho
 * parent unit is the face's litho unit and whose depth window contains the face — and
 * paints the face that band's class. Where no band of the face's litho unit reaches
 * that depth (genuinely un-classed ground), the face becomes a ``lithoFallback``
 * region (the "correlate me" hatch), the same honest state the fill already uses for
 * cover no packing reached. It never overpaints (it fills only faces no region
 * covers), never crosses soils (it matches the litho formation), and is a strict
 * NO-OP on a section the constructive fill already covered — so CS1 (which has no
 * holes) stays byte-identical.
 *
 * This is a robustness layer, not a replacement for the emission rewrite (debt #283):
 * it guarantees the owner's absolute while the constructive engine's sub-TD-onlap
 * arrangement case is fixed at the root.
 *
 * @module utils/geotechHierarchicalFill/fillGeotechHoles
 */

import type { PartitionColumn, SectionRegion } from '../sectionPartition'
import { ringAreaM2 } from '../sectionPartition/regionArea'
import { NEEDLE_WIDTH_M } from './dropNeedleSpurs'
import { overlayFaces, pointInRing } from './frameClipGeometry'

/** Distance from a point to a polygon ring's boundary, in ring units. */
function distanceToRing(
  x: number,
  y: number,
  ring: readonly { fraction: number; elevation: number }[],
): number {
  let best = Infinity
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const dx = b.fraction - a.fraction
    const dy = b.elevation - a.elevation
    const len = dx * dx + dy * dy
    if (len < 1e-18) continue
    let t = ((x - a.fraction) * dx + (y - a.elevation) * dy) / len
    t = Math.max(0, Math.min(1, t))
    best = Math.min(best, Math.hypot(x - (a.fraction + t * dx), y - (a.elevation + t * dy)))
  }
  return best
}

/** Faces below this area (fraction × metres) are snap debris, not ground. */
const DEBRIS_AREA = 1e-6

/**
 * How close to a painted region's boundary still counts as COVERED — shared with
 * ``geotechHoles.diag`` (its ``EDGE_TOL``). A traced face's interior sample can land
 * within float noise of an edge it SHARES with a painted region; a strict
 * point-in-ring then calls plainly-painted ground a hole. The arrangement snaps to a
 * 1 mm grid, so 3 mm is generous at snap scale and far under a real crack. Without it
 * the pass over-fills grazing snap slivers (dev CS1 gap 3 / gap 20 measured this).
 */
const EDGE_TOL = 3e-3

/** A hole the pass closed, and how. */
export interface HoleFillResult {
  /** Faces filled with the packing class the model holds there. */
  classed: SectionRegion[]
  /** Faces no band of the litho unit reached — the "correlate me" hatch. */
  fallback: SectionRegion[]
  /** Total closed area (m²), for the diagnostics line. */
  closedAreaM2: number
}

/**
 * Whether a traced face is thinner than a painted band ever is — snap debris the
 * engine drops rather than paints (shared with ``dropNeedleSpurs`` and the hole
 * audit), measured in true metres so a hairline at a curve junction is not a hole.
 */
function isNeedle(
  ring: readonly { fraction: number; elevation: number }[],
  widthM: number,
): boolean {
  let longestM = 0
  let twiceAreaM = 0
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]
    const b = ring[(i + 1) % ring.length]
    const ax = a.fraction * widthM
    const bx = b.fraction * widthM
    longestM = Math.max(longestM, Math.hypot(bx - ax, b.elevation - a.elevation))
    twiceAreaM += ax * b.elevation - bx * a.elevation
  }
  return longestM > 0 && Math.abs(twiceAreaM) / longestM <= NEEDLE_WIDTH_M
}

/** One geotech band on a column, in elevation, with its class + litho parent. */
interface ColumnBand {
  formationId: string
  layerId: string
  topElev: number
  baseElev: number
  lithoFormationId: string | undefined
}

/**
 * Close every litho-covered face the constructive fill left unpainted.
 *
 * @param lithoRegions The litho frame — the authority on what ground exists.
 * @param painted Every region already painted (classed regions + lithoFallback).
 * @param geotechColumns The frame-aligned packing columns (1:1 with lithoColumns).
 * @param alongM Along-section metres, 1:1 with the columns.
 * @param bandLithoFormation Geotech band ``layerId`` → its litho parent's formation
 *   id, so a hole is filled only from a band of its OWN litho unit.
 * @returns The classed hole-fills, the un-classed fallbacks, and the closed area.
 */
export function fillGeotechHoles(
  lithoRegions: readonly SectionRegion[],
  painted: readonly SectionRegion[],
  geotechColumns: readonly PartitionColumn[],
  alongM: readonly number[],
  bandLithoFormation: ReadonlyMap<string, string | undefined>,
): HoleFillResult {
  const classed: SectionRegion[] = []
  const fallback: SectionRegion[] = []
  let closedAreaM2 = 0

  // Bands per column, in elevation, once.
  const bandsByColumn: ColumnBand[][] = geotechColumns.map((column) =>
    column.units.map((unit) => ({
      formationId: unit.formationId,
      layerId: unit.layerId,
      topElev: column.surfaceElevM - unit.topDepthM,
      baseElev: column.surfaceElevM - unit.baseDepthM,
      lithoFormationId: bandLithoFormation.get(unit.layerId),
    })),
  )

  const byGap = (regions: readonly SectionRegion[], gap: number): SectionRegion[] =>
    regions.filter((r) => r.gapIndex === gap)

  for (let gap = 0; gap + 1 < alongM.length; gap++) {
    const frame = byGap(lithoRegions, gap)
    if (frame.length === 0) continue
    const cover = byGap(painted, gap)
    const widthM = Math.abs(alongM[gap + 1] - alongM[gap])
    if (!(widthM > 0)) continue
    const faces = overlayFaces(
      [...frame.map((r) => r.polygon), ...cover.map((r) => r.polygon)],
      `holes-${gap}`,
    )
    for (const face of faces) {
      const area = ringAreaM2(face.ring, widthM)
      if (area <= DEBRIS_AREA) continue
      if (isNeedle(face.ring, widthM)) continue
      const { fraction, elevation } = face.sample
      // Only ground the litho frame vouches for, that no region already covers.
      const frameRegion = frame.find((r) => pointInRing(fraction, elevation, r.polygon))
      if (frameRegion === undefined) continue
      // COVERED = inside a painted region OR grazing one's boundary within EDGE_TOL,
      // the same definition the geometric hole audit uses — so the pass fills
      // exactly what the audit calls a hole, and never a snap sliver on a shared edge.
      const covered = cover.some(
        (r) =>
          pointInRing(fraction, elevation, r.polygon) ||
          distanceToRing(fraction, elevation, r.polygon) <= EDGE_TOL,
      )
      if (covered) continue

      // The packing band the model holds here: on the NEARER column first, then
      // the far one, of THIS face's own litho unit, whose depth window contains it.
      const nearIsLeft = fraction <= 0.5
      const columns = nearIsLeft ? [gap, gap + 1] : [gap + 1, gap]
      let filled: ColumnBand | undefined
      for (const ci of columns) {
        const bands = bandsByColumn[ci]
        if (bands === undefined) continue
        filled = bands.find(
          (b) =>
            b.lithoFormationId === frameRegion.formationId &&
            elevation <= b.topElev + 1e-6 &&
            elevation >= b.baseElev - 1e-6,
        )
        if (filled !== undefined) break
      }
      const polygon = face.ring.map((p) => ({ fraction: p.fraction, elevation: p.elevation }))
      closedAreaM2 += area
      if (filled !== undefined) {
        classed.push({
          formationId: filled.formationId,
          bodyId: null,
          kind: 'quad',
          polygon,
          gapIndex: gap,
          layerIds: [filled.layerId],
        })
      } else {
        // No band of this litho unit reaches this depth — honest un-classed ground.
        fallback.push({
          formationId: frameRegion.formationId,
          bodyId: null,
          kind: 'quad',
          polygon,
          gapIndex: gap,
          layerIds: frameRegion.layerIds ?? [],
        })
      }
    }
  }
  return { classed, fallback, closedAreaM2 }
}

/**
 * partitionFillV2/sectionGeom.ts — input normalisation for the v2 engine.
 *
 * Converts the public ``computeSectionFillV2`` inputs (the SAME
 * ``PartitionColumn`` / ``CorrelationEdge`` / ``LensApexOverride`` types as v1 —
 * imported, never forked) into a metres×elevation section geometry the arrangement
 * layer consumes:
 *
 *   - drop empty columns;
 *   - close per-column depth gaps + collapse adjacent same-formation runs (the
 *     KEPT v1 normalisation ``closeColumnGaps`` / ``collapseAdjacentSameFormation``
 *     — imported from the READ-ONLY v1 package, not re-implemented);
 *   - precompute each unit's top/base ELEVATION (mTAW) from surface − depth;
 *   - assign each column its REAL along-section x (alongM), falling back to the
 *     column index when no alongM is supplied (tests / uniform gate).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import {
  collapseAdjacentSameFormation,
  type CorrelationEdge,
  type LensApexOverride,
  type PartitionColumn,
  type PartitionUnit,
} from '../partitionFill'
import { closeColumnGaps } from '../partitionFill/columnReduce'

/** One unit with precomputed elevations (mTAW) plus its litho identity. */
export interface UnitGeom {
  layerId: string
  formationId: string
  bodyId: string | null
  /** Higher elevation (top contact). */
  topElev: number
  /** Lower elevation (base contact). */
  baseElev: number
}

/** One column: real along-section x + its gap-free, elevation-space unit stack. */
export interface ColumnGeom {
  investigationId: string
  /** Real along-section position in metres (alongM), or the column index fallback. */
  x: number
  surfaceElevM: number
  units: UnitGeom[]
  /**
   * Enclosed lenses extracted from this column (v1 step-0 semantics): a minority
   * unit whose neighbours above AND below share ONE formation (its matrix). The
   * two enclosing matrix units are merged into a single continuous ``units`` entry
   * (so the matrix band is one face) and the lens is recorded here to be drawn as
   * a closed loop (a HOLE in that band) by curve emission. ``matrixFormationId``
   * is the enclosing lithology — emission only draws the lens into a gap where the
   * facing column carries that matrix at the lens's elevation (a real hole context,
   * else the lens would overlap a genuinely different-litho neighbour).
   */
  enclosedLenses: EnclosedLens[]
}

/** An extracted enclosed lens plus the formation of its enclosing matrix. */
export interface EnclosedLens {
  lens: UnitGeom
  matrixFormationId: string
}

/** The whole normalised section, ready for curve emission. */
export interface SectionInput {
  columns: ColumnGeom[]
  edges: readonly CorrelationEdge[]
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>
}

/**
 * Normalise raw columns + edges into a ``SectionInput``.
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     Raw litho columns (units sorted shallow→deep).
 * edges : readonly CorrelationEdge[]
 *     Approved correlation edges (layer-id pairs, side-aware).
 * lensApexOverrides : optional per-(body, gap) apex overrides.
 * alongM : optional real along-section metres, 1:1 with ``columns`` (including
 *     empties). When present, each surviving column keeps its real x; else the
 *     surviving-column index is used (uniform spacing).
 *
 * Returns
 * -------
 * SectionInput
 *     Normalised geometry, or ``columns: []`` when fewer than two columns survive.
 */
export function buildSectionInput(
  columns: readonly PartitionColumn[],
  edges: readonly CorrelationEdge[] = [],
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>,
  alongM?: readonly number[],
): SectionInput {
  const hasAlong = alongM != null && alongM.length === columns.length
  // Every layerId that participates in ANY approved edge — an enclosed-lens
  // candidate that is correlated is NOT a lens (it bands via its tie), so it must
  // not be extracted/merged away.
  const edgedLayerIds = new Set<string>()
  for (const e of edges) {
    edgedLayerIds.add(e.a)
    edgedLayerIds.add(e.b)
  }
  const geom: ColumnGeom[] = []
  for (let oi = 0; oi < columns.length; oi++) {
    const c = columns[oi]
    if (c.units.length === 0) continue
    // Clone units so v1's in-place normalisers never mutate caller data.
    const units: PartitionUnit[] = c.units.map((u) => ({ ...u }))
    closeColumnGaps(units)
    collapseAdjacentSameFormation(units)
    const stack: UnitGeom[] = units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      bodyId: u.bodyId,
      topElev: c.surfaceElevM - u.topDepthM,
      baseElev: c.surfaceElevM - u.baseDepthM,
    }))
    // Enclosed-lens extraction (matrix merge + lens-as-hole) is DEFERRED: it only
    // yields a true partition when the enclosing matrix band is itself a CLOSED
    // face, which requires the deep-to-deep substrate floor (increment 3). Without
    // it, an untied matrix band has no bottom boundary and the lens-as-hole
    // produces malformed faces. Until then, an enclosed minority flows through the
    // ordinary 0-tied -> lens closing path in ``emitCurves`` (a lens overlay on the
    // matrix band, matching v1). ``extractEnclosedLenses`` is kept, unused, for the
    // increment-3 wiring.
    void extractEnclosedLenses
    const enclosedLenses: EnclosedLens[] = []
    geom.push({
      investigationId: c.investigationId,
      // Real x filled in below once we know the surviving index.
      x: 0,
      surfaceElevM: c.surfaceElevM,
      units: stack,
      enclosedLenses,
    })
  }
  if (geom.length < 2) return { columns: [], edges, lensApexOverrides }

  // Assign x: real alongM of the corresponding original column, else the index.
  let survivor = 0
  for (let oi = 0; oi < columns.length; oi++) {
    if (columns[oi].units.length === 0) continue
    geom[survivor].x = hasAlong ? (alongM as readonly number[])[oi] : survivor
    survivor++
  }
  return { columns: geom, edges, lensApexOverrides }
}

/**
 * Extract enclosed lenses from a column stack, IN PLACE, and return them.
 *
 * A unit at index ``k`` is an enclosed lens when the units immediately above
 * (``k-1``) and below (``k+1``) share the SAME formation (the matrix M) and M is
 * NOT the lens's own formation. The two enclosing matrix units are merged into one
 * continuous unit (its span grows to cover the lens's depth range) so the matrix
 * band is a single face; the lens is returned to be drawn as a closed loop (a HOLE
 * in that band) — v1 enclosed-lens step-0 semantics, but formation-keyed.
 *
 * Repeats until no more enclosed lenses exist (a matrix can enclose several). The
 * shallowest enclosing unit's identity represents the merged matrix.
 *
 * Parameters
 * ----------
 * units : UnitGeom[]
 *     The column's unit stack (shallow->deep). Mutated in place.
 *
 * Returns
 * -------
 * EnclosedLens[]
 *     The extracted lenses (original elevations preserved) + matrix formation.
 */
function extractEnclosedLenses(units: UnitGeom[], edgedLayerIds: ReadonlySet<string>): EnclosedLens[] {
  const lenses: EnclosedLens[] = []
  let changed = true
  while (changed) {
    changed = false
    for (let k = 1; k + 1 < units.length; k++) {
      const above = units[k - 1]
      const below = units[k + 1]
      const lens = units[k]
      if (
        above.formationId === below.formationId &&
        above.formationId !== lens.formationId &&
        above.bodyId === below.bodyId &&
        // A correlated (edged) unit bands via its tie — it is NOT a lens. The LENS
        // must be uncorrelated. The merge keeps ``above``'s identity and splices
        // ``below`` out, so ``below`` must also be un-edged (else its own tie would
        // lose its layerId and its band would vanish — the Cross-section 3 regress).
        // ``above`` keeps its layerId, so it may stay correlated.
        !edgedLayerIds.has(lens.layerId) &&
        !edgedLayerIds.has(below.layerId)
      ) {
        lenses.push({ lens: { ...lens }, matrixFormationId: above.formationId })
        // Merge above+below into one continuous matrix unit spanning the lens.
        above.baseElev = below.baseElev
        units.splice(k, 2) // remove the lens and the (now-merged) below unit
        changed = true
        break
      }
    }
  }
  return lenses
}

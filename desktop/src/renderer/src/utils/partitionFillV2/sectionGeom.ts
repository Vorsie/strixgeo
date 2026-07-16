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

/**
 * Whether to extract enclosed lenses (matrix merge + lens-as-HOLE / concave-notch
 * face) vs. let an enclosed minority flow through the ordinary 0-tied lens closing
 * path.
 *
 * ON (increment-12, 2026-07-14). The single load-bearing prerequisite for the last
 * open defect class (design §4 increment-12 row / §8 increment-11 status): a lone
 * multi-unit interbedded stack's correct fill is own-elevation lenses OVERLAID on a
 * facing band, which a true partition cannot overlay — the facing band must become a
 * matrix ANNULUS with the lens as a HOLE.
 *
 * The increment-3 blocker (mis-shaped even the pure synthetic case + false lens×pinch
 * overlaps on Tie-section 6 / Cross-section 3) was ROOT-CAUSED to a single LABELLING
 * bug, not a geometry bug: the arrangement already traces the v1-correct shapes (a
 * concave notched matrix + the lens triangle, both strictly simple), but ``labelFaces``
 * stole the lens label onto the matrix notch face — its ``face.holes.length === 0``
 * discriminator failed because a NOTCH (the lens riding its own column edge, the pure
 * case) leaves BOTH faces hole-free (adjacent-simple, not nested). ``labelFaces`` now
 * discriminates on boundary composition (``nonLensBoundary`` + ``!spansGap``), so the
 * matrix keeps its own formation and the lens keeps its own. The slicer
 * (``slice.splitAnnulus``) splits a true interior-hole annulus into v1-carve simple
 * pieces (left cap / right cap / above-strip / below-strip) instead of the removed
 * keyhole. Real-data battery holds (holes/overlaps 0/0/0 all 14 sections; CS1 gates
 * 7/7; simplerings green; loneSidePinch 7/7).
 *
 * KEPT as a documented emergency kill-switch: flip to ``false`` to fall back to the
 * ordinary 0-tied lens closing path if a dogfeed regression is ever traced here (the
 * fallback path stays wired and is exercised by the same unit tests).
 */
const ENABLE_ENCLOSED_LENS = true

/**
 * TARGET C (session 9) — the EDGED-ENCLOSING enclosed-minority experiment, GATED OFF after a
 * measured negative.
 *
 * A same-formation-enclosed 0-corr minority whose enclosing BELOW unit is TIED (edged) cannot
 * go through the ordinary ``extractEnclosedLenses`` merge (the merge splices the below unit out
 * of the column, dropping its tie's layerId → its band vanishes). The CS1 g20/g21/g22 ZAND
 * minorities (enclosed by SILT above + SILT below, both tied) are this class.
 *
 * ATTEMPT (this flag ON): record such a minority as an enclosed lens WITHOUT merging (keeping
 * both enclosing units + their ties intact), then emit its lens closing curves. The enclosing
 * SILT already FLOODS the minority's slot full-width (measured: at el 9.05 the whole gap is
 * SILT), so the emitted ZAND lens rides its own column edge as a NOTCH into that SILT flood —
 * a hole=0 shape ``slice.splitAnnulus`` (fires only on holes>0) cannot separate, so the SILT
 * flood face geometrically absorbs it (the documented ``splitAnnulus``-bypass wall, sessions
 * 5/8). MEASURED (session 9, flag ON): holesAbove 0 → 53 (the notch breaks the SILT flood face
 * into an uncovered sliver at every emitted lens). DISQUALIFYING. It CANNOT land hole-free
 * without the merge (blocked by the edged below) or a notch-splitter at holes=0
 * (``intersect.ts``-adjacent, forbidden — the 613-hole trap).
 *
 * DEFAULT OFF: the CS1 g20/g21/g22 ZAND minorities stay ABSENT (the pre-existing residual) —
 * NOT a new defect. Recorded per the prompt's "prove it and record" allowance for a target
 * that genuinely needs different treatment.
 */
const ENABLE_ENCLOSED_LENS_EDGED = false

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

/**
 * Snap threshold (metres) for the top-band anchor: where the first LITHO boundary and
 * the first DATA point diverge by no more than this, the band snaps to the first data
 * point (ruling 5-revised, 2026-07-14 evening). 10 cm per the owner spec.
 */
export const TOP_BAND_SNAP_M = 0.1

/**
 * The TOP-BAND anchor elevation for a column (ruling 5-revised, design §8): the implicit
 * top correlation band follows each test's FIRST LITHO BOUNDARY — i.e. the first (topmost)
 * unit's TOP elevation — NOT the ground surface. The strip between this line and the ground
 * stays EMPTY (no invented lithology above the first data point).
 *
 * Ruling 5-revised also specifies "snapped to the first DATA point when within 10 cm; where
 * they diverge, fall back to the first data point (only where a litho exists at all)". This
 * dataset's extraction (``diag_allsections_input.json``) carries only ``surfaceElevM`` per
 * column and NO separate first-data field, and in it the first DATA point coincides with the
 * first unit's top depth — so first-litho-top IS the band line and the snap is a no-op here.
 * When an input later carries a distinct first-data elevation, pass it as ``firstDataElevM``:
 * if the first litho boundary is within ``TOP_BAND_SNAP_M`` of it, the band snaps to the data
 * point; otherwise it falls back to the first data point (never the ground surface unless the
 * first data starts there). Current callers pass no ``firstDataElevM`` (the extraction has no
 * such field), so the snap is a no-op and the band rides the first-litho boundary.
 *
 * Parameters
 * ----------
 * col : ColumnGeom
 *     A non-empty column (its first unit's top is the band anchor).
 * firstDataElevM : number, optional
 *     The column's first DATA point elevation (mTAW), when the input carries one distinct from
 *     the first litho boundary. Absent in the current extraction.
 *
 * Returns
 * -------
 * number
 *     The top-band anchor elevation (mTAW): the first litho-boundary elevation, snapped to the
 *     first data point within ``TOP_BAND_SNAP_M`` or falling back to it beyond that.
 */
export function firstLithoTopElev(col: ColumnGeom, firstDataElevM?: number): number {
  if (col.units.length === 0) return col.surfaceElevM
  const lithoTop = col.units[0].topElev
  // No distinct first-data field (the current extraction): ride the first litho boundary.
  if (firstDataElevM === undefined) return lithoTop
  // Ruling 5-revised: the band anchors to the first DATA point whether the litho boundary is
  // within TOP_BAND_SNAP_M of it (a snap) or beyond it (a fall-back) — never the ground surface.
  // ``diverged`` is surfaced (not folded away) so a future owner retune of the far case — e.g.
  // "beyond the snap, keep the litho boundary" — is a one-line change here, not a re-derivation.
  const diverged = Math.abs(lithoTop - firstDataElevM) > TOP_BAND_SNAP_M
  void diverged
  return firstDataElevM
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
    // Enclosed-lens extraction (matrix merge + lens-as-hole) — guarded OFF; see the
    // ``ENABLE_ENCLOSED_LENS`` doc for the increment-3 evaluation. STAGE-4 note: the
    // DOMINANT above-TD "pinch-vacancy" holes on the real sections are NOT an
    // enclosed-lens problem — they are uncorrelated same-formation matrix strips
    // that v1 auto-banded (implicit same-formation connect) but v2 (edge-driven,
    // design §2) leaves as LENS pinches, so the vacated space between the pinch
    // apexes is genuinely empty (up to ~48 % of a gap's above-TD envelope on
    // Tie-section 10). Whether that space SHOULD fill (implicit same-formation
    // banding) or STAY empty (owner "correlate-or-gap" model) is a model-semantics
    // decision (Track 2 / owner), not an engine bug this increment resolves.
    const enclosedLenses = ENABLE_ENCLOSED_LENS
      ? extractEnclosedLenses(stack, edgedLayerIds)
      : []
    // TARGET C (session 9, gated OFF): non-destructively record a same-formation-enclosed
    // minority whose merge was blocked by an edged enclosing unit (CS1 g20/g21/g22 ZAND). See
    // ``ENABLE_ENCLOSED_LENS_EDGED`` — measured negative (re-opens holes/overlaps), kept OFF.
    if (ENABLE_ENCLOSED_LENS_EDGED) {
      extractEdgedEnclosedLenses(stack, edgedLayerIds, enclosedLenses)
    }
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
        // NO same-body guard (relaxed 2026-07-15, ruling-8e Milestone-2). The enclosing
        // same-formation units above/below a minority routinely carry DIFFERENT bodyIds
        // (a body split at the minority's own level — CS1 g15 ZAND u3 body 019ea3e1 above,
        // u5 body 019ea42e below); requiring one body kept 14 of the 19 ABSENT minorities
        // out of this proper enclosed-lens-as-HOLE path, dropping them to the interval-level
        // flood where the notch merges into the enclosing same-formation face (design §4
        // "Ruling-8e Milestone 2" — the flood-absorbs-the-lens wall). Geometrically the two
        // same-formation units ARE one continuous band around the minority; the merge keeps
        // the SHALLOWER (``above``) unit's identity for the merged band (the below unit's
        // body is subsumed — an accepted approximation, the alternative being the lens
        // ABSENT). Body resolution is the resolver's job (§7); the geometry of the hole is
        // the engine's, and it must not depend on a body split invisible to the section.
        // A DRAWN apex/freedraw override is still keyed by the lens's own body, unaffected.
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

/**
 * TARGET C (session 9, gated OFF) — record a same-formation-enclosed minority whose ordinary
 * merge was BLOCKED because an enclosing unit is edged, WITHOUT modifying the column stack.
 *
 * ``extractEnclosedLenses`` (above) only merges when neither the lens nor the below unit is
 * edged (the merge splices the below unit out, which would drop its tie). A minority enclosed
 * by an EDGED same-formation band above+below (CS1 g20/g21/g22 ZAND in SILT) is therefore left
 * in the column and rendered ABSENT (swallowed by the enclosing SILT flood). This pass records
 * it as an enclosed lens WITHOUT the merge so ``emitEnclosedLensCurves`` can emit its notch.
 *
 * MEASURED NEGATIVE (kept OFF): without the merge the enclosing SILT is NOT a continuous
 * annulus, so the emitted ZAND notch rides the column edge (holes=0) and the SILT flood face
 * absorbs it (or a double-cover/sliver appears). See ``ENABLE_ENCLOSED_LENS_EDGED``.
 *
 * Parameters
 * ----------
 * units : UnitGeom[]
 *     The column stack AFTER the ordinary extraction (read-only here — NOT mutated).
 * edgedLayerIds : ReadonlySet<string>
 *     Section-wide edged layer ids.
 * lenses : EnclosedLens[]
 *     Accumulator the recorded (un-merged) lenses are pushed to.
 */
function extractEdgedEnclosedLenses(
  units: readonly UnitGeom[],
  edgedLayerIds: ReadonlySet<string>,
  lenses: EnclosedLens[],
): void {
  for (let k = 1; k + 1 < units.length; k++) {
    const above = units[k - 1]
    const below = units[k + 1]
    const lens = units[k]
    if (above.formationId !== below.formationId) continue
    if (above.formationId === lens.formationId) continue
    if (edgedLayerIds.has(lens.layerId)) continue // a tied minority bands via its tie, not a lens
    // Only the case the ordinary pass could NOT handle: the below (or lens) is edged, so the
    // merge would drop a tie. Record it non-destructively.
    if (!edgedLayerIds.has(below.layerId)) continue
    lenses.push({ lens: { ...lens }, matrixFormationId: above.formationId })
  }
}

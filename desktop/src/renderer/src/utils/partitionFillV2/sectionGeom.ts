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
} from '../sectionPartition'
import { closeColumnGaps } from '../sectionPartition/columnReduce'
import { enforceMinimumColumnSeparation } from './columnSeparation'
import { extractPerGapEnclosedLenses } from './edgedEnclosedLens'
import { buildTieContactElevs, interbedContactTied } from './tieContacts'
import { twoSidedTerminationsEnabled } from './tileFlags'

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

/**
 * SESSION-24 EXPERIMENT (flag-ON only, MEASURED): allow ``extractEnclosedLenses`` to merge a
 * same-formation enclosing band around a minority even when the BELOW enclosing unit is EDGED,
 * by KEEPING the edged ``below`` unit's identity (growing it up over the lens) instead of
 * splicing it out. This preserves ``below``'s tie AND makes the annulus continuous, so the
 * interbed becomes a real interior HOLE (``splitAnnulus`` handles it) — the T2/T3 target. Flag-ON
 * only so flag-OFF stays byte-identical. Toggle from the measured result.
 */
function edgedBelowMergeEnabled(): boolean {
  return twoSidedTerminationsEnabled()
}

/** One unit with precomputed elevations (mTAW) plus its litho identity. */
export interface UnitGeom {
  layerId: string
  formationId: string
  bodyId: string | null
  /** Higher elevation (top contact). */
  topElev: number
  /** Lower elevation (base contact). */
  baseElev: number
  /**
   * The raw picked units this MERGED unit was welded from (original elevations, shallow->deep),
   * set by the enclosed-lens walk when it merges the matrix above and below a pulled lens. Absent
   * on an un-merged unit. Read when a merged run is itself pulled as a lens (stacked lenses, owner
   * 2026-09-23) — by the section-wide walk and by the per-gap edged path alike.
   */
  rawPieces?: readonly UnitGeom[]
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
  /**
   * PER-GAP EMISSION RESTRICTION (ruling 8v — "0 ties is ALWAYS a lens", the edged-enclosed
   * minority, design partition-engine-v2.md §4 FINAL-SHAPES / §8 8v). ``undefined`` (the ordinary
   * un-edged enclosed lens) means "emit into BOTH adjacent gaps" — byte-identical to the pre-8v
   * behaviour. A minority that is TIED (edged) toward one neighbour and UN-TIED toward the other —
   * the S22 lower sand: 0 ties toward the shallow left column, a top tie to the right band column —
   * sets this to ONLY the UNTIED adjacent gap indices: the lens flank + its band-contour detour are
   * emitted there (0 ties → a lens by 8v), while the TIED gap keeps its normal band (the flank is
   * suppressed, so the ties + the ``col:lens`` seed close a band by construction). Consumed by
   * ``emitEnclosedLensCurves`` and ``collectEnclosedLensDiamonds``.
   */
  emitGaps?: ReadonlySet<number>
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

/**
 * A picked unit's RAW (pre-normalisation) contact elevations, keyed by its own
 * ``layerId`` and its surviving column index.
 *
 * RULING 8r ("i want the lines before the merge — first fill then merge") — a drawn
 * tie is input LINE ART on the RAW picked unit's contact, never on the merged host.
 * The flag-ON enclosed-lens merge (``extractEnclosedLenses``) may SPLICE a raw picked
 * unit out of the normalised ``ColumnGeom.units`` (e.g. CS1 col21 S5's edged SILT
 * interbed ``dde4``, removed when its enclosed ZAND lens merges the two flanking SILTs
 * into one band). ``resolveTies`` then cannot find that unit's ``layerId`` in the
 * normalised stack and silently DROPS its approved ties. This table preserves the raw
 * contact elevation of EVERY picked unit so a tie endpoint ``(layerId, side)`` is always
 * resolvable at the elevation the owner drew — the tie emits as a curve there regardless
 * of what the pre-merge did to the normalised stack.
 */
export interface RawLayerContact {
  /** The surviving (normalised) column index this raw unit belongs to. */
  colIndex: number
  /** Raw top-contact elevation (mTAW). */
  topElev: number
  /** Raw base-contact elevation (mTAW). */
  baseElev: number
  /**
   * The raw unit's formation — consumed by the IDENTITY augmentation
   * (``fillIdentity.ts``): a region's column-edge span attributes only
   * SAME-formation drilled units, and the enclosed-lens merge may have spliced
   * the unit out of ``ColumnGeom.units`` (or grown a host over it), so the
   * normalised stack cannot answer "what formation was drilled here".
   */
  formationId: string
}

/** The whole normalised section, ready for curve emission. */
export interface SectionInput {
  columns: ColumnGeom[]
  edges: readonly CorrelationEdge[]
  lensApexOverrides?: ReadonlyMap<string, LensApexOverride>
  /**
   * RULING 8r fallback (flag-ON) — every RAW picked unit's own contact elevations,
   * keyed by ``layerId``. ``resolveTies`` consults this when a tie endpoint's layerId is
   * absent from the normalised stack (the enclosed-lens merge spliced it out), so the
   * approved tie still emits at the raw picked contact. Absent flag-OFF (the merge never
   * splices an edged unit there), so flag-OFF resolution is byte-identical.
   */
  rawLayerContacts?: ReadonlyMap<string, RawLayerContact>
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
  // RULING 8a / 8l(b) SESSION-26 (flag-ON only) — TIE-ENDPOINT CONTACT ELEVATIONS per column.
  // A tie sits on a unit's OWN contact (``layerId`` + ``side``), and that contact is PHYSICALLY
  // SHARED with the adjacent unit whose contact coincides (an above unit's base = a below unit's
  // top). Ruling 8a: a tie on the shared contact ties BOTH units sharing that surface — so an
  // enclosed interbed whose OWN top/base rides such a contact is effectively 8a-TIED (corr 1) and
  // must stay a real, un-merged unit (it BANDS emergently with the facing same-litho unit; ruling
  // 8l(b) "enclosed interbeds SPLIT their host into visible pieces for the sweep"), NOT collapse
  // into an enclosed lens. This map records, per ORIGINAL column index, the set of contact
  // elevations (mTAW) that carry a tie endpoint, so ``extractEnclosedLenses`` can skip such an
  // interbed. Only the gap0-class (the col0 SILT whose base rides the ZAND-tops tie) needs this;
  // it does NOT affect col18's TRUE 0-corr middle clay (both contacts interbed-cut, no tie there).
  const tieContactElevByOrigCol = buildTieContactElevs(columns, edges)
  const geom: ColumnGeom[] = []
  // RULING 8r — the raw picked-unit contact table (see ``RawLayerContact``). Captured
  // from every column's stack BEFORE ``extractEnclosedLenses`` mutates it, so a tie into a
  // unit the merge later splices out still resolves at its own drawn contact.
  const rawLayerContacts = new Map<string, RawLayerContact>()
  // Original indices of columns that survive (own units), in order — used to find each
  // column's facing neighbours for the enclosed-lens physical-wrap test (owner fhdh #35).
  const survivorOrig = columns.map((c, i) => ({ i, hasUnits: c.units.length > 0 })).filter((e) => e.hasUnits).map((e) => e.i)
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
    // Record RAW contacts (pre-extraction) keyed by layerId. The surviving column index is
    // ``geom.length`` here because this column is pushed to ``geom`` at the end of the loop
    // body (it survives — ``c.units.length !== 0``). x is assigned to ``geom`` below; a tie
    // reads ``geom[colIndex].x`` at resolution time.
    const survivingColIndex = geom.length
    for (const u of stack) {
      rawLayerContacts.set(u.layerId, {
        colIndex: survivingColIndex,
        topElev: u.topElev,
        baseElev: u.baseElev,
        formationId: u.formationId,
      })
    }
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
    // RULING 8l/8k — INTERBED HOST-SPLIT: the naive "skip the merge under the flag-ON sweep"
    // realisation was MEASURED NEGATIVE (session 22): leaving the enclosing same-formation host as
    // separate pieces + the interbed as a normal interior unit routes the interbed through the
    // sweep's ``emitLens``, which rides the column edge as a holes=0 NOTCH that the enclosing
    // same-formation flood face cannot separate (``slice.splitAnnulus`` fires only on holes>0) —
    // the documented ``splitAnnulus``-bypass wall (sessions 5/8/9). The ONE battery measured +104
    // different-litho overlaps (CS3 22 / CS1 34 / CS2 48) + the CS1 col18 middle-clay rendering as
    // ``band`` (the enclosing KLEI flood absorbs its un-carved notch), NOT the lens 8l wants. The
    // hole-/overlap-free interbed render REQUIRES the ANNULUS (the merge makes the matrix a
    // continuous band so the interbed is a true interior HOLE), which is exactly what
    // ``extractEnclosedLenses`` + ``emitEnclosedLensCurves`` already do. So the merge STAYS ON for
    // both flag states; the host-split for the SWEEP's classification is the multi-day annulus/
    // notch-splitter rebuild the design §4 flags (a 0-corr enclosed minority that lenses via the
    // sweep needs a notch-splitter at holes=0, ``intersect.ts``-adjacent — out of session-22 scope).
    // Recorded (REWRITE_STATE §25) as a characterised wall, threshold/merge NOT toggled off.
    // Tie-endpoint contact elevations for THIS original column (ruling 8a interbed guard). Only
    // consulted under the flag (``edgedBelowMergeEnabled``), so flag-OFF extraction is unchanged.
    const tieElevs = tieContactElevByOrigCol.get(oi) ?? null
    // Facing neighbours (the immediately-adjacent surviving columns) — the enclosed-lens
    // merge only fires when the wrap is physical: the matrix or the lens is present on a
    // facing column at the lens's elevation (owner fhdh #35). Read from the ORIGINAL,
    // un-mutated ``columns`` so an already-processed left neighbour's spliced stack does
    // not skew the test.
    const sPos = survivorOrig.indexOf(oi)
    const facingCols: PartitionColumn[] = []
    for (const nOi of [survivorOrig[sPos - 1], survivorOrig[sPos + 1]]) {
      if (nOi !== undefined) facingCols.push(columns[nOi])
    }
    const facingHasFormation = (formationId: string, baseElev: number, topElev: number): boolean => {
      const eps = 1e-9
      for (const nc of facingCols) {
        for (const u of nc.units) {
          if (u.formationId !== formationId) continue
          const nTop = nc.surfaceElevM - u.topDepthM
          const nBase = nc.surfaceElevM - u.baseDepthM
          if (nTop > baseElev + eps && nBase < topElev - eps) return true
        }
      }
      return false
    }
    const enclosedLenses = ENABLE_ENCLOSED_LENS
      ? extractEnclosedLenses(stack, edgedLayerIds, tieElevs, facingHasFormation)
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
  if (geom.length < 2) return { columns: [], edges, lensApexOverrides, rawLayerContacts }

  // Assign x: real alongM of the corresponding original column, else the index.
  let survivor = 0
  for (let oi = 0; oi < columns.length; oi++) {
    if (columns[oi].units.length === 0) continue
    geom[survivor].x = hasAlong ? (alongM as readonly number[])[oi] : survivor
    survivor++
  }
  enforceMinimumColumnSeparation(geom) // paired CPT+borehole share one along-metre
  // RULING 8v (flag-ON only) — the EDGED same-formation-enclosed minority (the S22 lower sand: 0
  // ties toward the shallow left column → a lens there, a top tie to the right band column → a band
  // there). The section-wide ``extractEnclosedLenses`` above skips it (edged section-wide), so it is
  // absorbed by the enclosing flood. This per-gap pass extracts it as an enclosed lens emitted ONLY
  // into its UN-TIED gap(s); the tied gap keeps its band. Additive: a section with no such minority
  // is byte-identical (the pass finds nothing to extract). See ``edgedEnclosedLens.ts``.
  if (twoSidedTerminationsEnabled()) {
    extractPerGapEnclosedLenses(geom, edges, rawLayerContacts)
  }
  return { columns: geom, edges, lensApexOverrides, rawLayerContacts }
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
 * The merge only fires when the wrap is PHYSICAL (owner ruling 2026-09-13, fhdh #35):
 * either the matrix formation is present on a facing neighbour at the lens's own
 * elevation (a genuine interior hole that reconnects — ruling 8g), OR the lens is the
 * same formation as a facing mass (one body with that run — the zeroTie physical
 * exemption). When neither holds, ``above`` and ``below`` are two isolated zero-tie
 * units and stay separate lenses, with the lens between them its own lens.
 *
 * Repeats until no more enclosed lenses exist (a matrix can enclose several). The
 * shallowest enclosing unit's identity represents the merged matrix.
 *
 * STACKED LENSES (owner 2026-09-23, section "test" GEO-19/100-S1: peat / silt / peat inside
 * clay — *"should be three stacked lensen peat on top of silt on top of peat but now there is
 * overlap?"*). Pulling the silt merges the two peats into one run; when that run is itself
 * pulled as a lens it comes apart again into its RAW picked pieces, each a lens at its own
 * level — never one diamond spanning the silt (whose own diamond then poked out of it and
 * overlapped the clay). The lenses pulled from INSIDE the run (the silt, matrix = peat) are
 * re-parented to the run's matrix (the clay): that is the mass that really wraps the stack.
 *
 * Parameters
 * ----------
 * units : UnitGeom[]
 *     The column's unit stack (shallow->deep). Mutated in place.
 * edgedLayerIds : ReadonlySet<string>
 *     Layer ids participating in any approved edge (a tied unit is not a lens).
 * tieContactElevs : ReadonlySet<number> | null
 *     Tie-endpoint contact elevations for this column (ruling 8a interbed guard).
 * facingHasFormation : (formationId, baseElev, topElev) => boolean
 *     Whether a facing neighbour column carries ``formationId`` overlapping the
 *     elevation range — the physical-wrap test above.
 *
 * Returns
 * -------
 * EnclosedLens[]
 *     The extracted lenses (original elevations preserved) + matrix formation.
 */
function extractEnclosedLenses(
  units: UnitGeom[],
  edgedLayerIds: ReadonlySet<string>,
  tieContactElevs: ReadonlySet<number> | null,
  facingHasFormation: (formationId: string, baseElev: number, topElev: number) => boolean,
): EnclosedLens[] {
  const lenses: EnclosedLens[] = []
  // The raw units a merged unit was welded from ride on the unit itself (``UnitGeom.rawPieces``),
  // so the per-gap edged path can read them too (see the module note on stacked lenses).
  const piecesOf = (u: UnitGeom): UnitGeom[] => (u.rawPieces ? [...u.rawPieces] : [{ ...u }])
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
        // RULING 8a / 8l(b) SESSION-26 (flag-ON only): an interbed whose OWN top or base contact
        // rides a TIE endpoint (its contact is 8a-tied through the shared surface) is corr 1 → it
        // must BAND emergently with the facing same-litho unit, NOT collapse into an enclosed lens.
        // Skip extracting it (it stays a real, un-merged unit the sweep/flood/labelling see; ruling
        // 8l(b) host-split). ``tieContactElevs`` is null flag-OFF → this never fires flag-OFF (the
        // ``&& true`` is a no-op), byte-identical. Distinct from col18's TRUE 0-corr middle clay
        // (both contacts interbed-cut, absent from ``tieContactElevs``) — that still merges/annuli.
        !interbedContactTied(lens, tieContactElevs) &&
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
        (!edgedLayerIds.has(below.layerId) || edgedBelowMergeEnabled()) &&
        // OWNER RULING 2026-09-13 (fhdh #35): "by our rule those clays surrounding the peat
        // should be 2 separate lenses (0 ties is lens left)". This merge welds ``above`` and
        // ``below`` — two DISTINCT litho layers — into ONE continuous matrix (splicing one out),
        // so the render reads as one clay mass wrapping the lens. That wrap is only real when it
        // is PHYSICAL, which is any one of:
        //   * an enclosing end is TIED — the matrix bands across the gap, so it is one continuous
        //     body around the lens (ruling 8g "flows AROUND the lens as a DETOUR and reconnects";
        //     this is the case every CS1 / geotech enclosed lens is, so those stay byte-identical);
        //   * the matrix formation is present on a facing neighbour at the lens's OWN elevation —
        //     a genuine interior HOLE, the same "real hole context" ``emitEnclosedLensCurves``
        //     draws into (a thin sand lens inside continuous clay, ruling 8b);
        //   * the LENS itself is the same formation as a facing mass — it is one body with that
        //     run, the zeroTie PHYSICAL EXEMPTION (his TS3 sand pocket, absorbed into the facing
        //     sand, ruling 2 2026-09-07).
        // When NONE holds — the peat and the two clays around it are tied to nothing and face no
        // same-litho on either neighbour — there is no wrapping matrix: each zero-tie unit is its
        // own lens and the peat between them stays its own lens. Pinned in
        // partitionFillV2.twoZeroTieLenses.test.ts; CS1 golden byte-identical, GEOTECH_210/HIER_COV
        // unmoved.
        (edgedLayerIds.has(above.layerId) ||
          edgedLayerIds.has(below.layerId) ||
          facingHasFormation(above.formationId, lens.baseElev, lens.topElev) ||
          facingHasFormation(lens.formationId, lens.baseElev, lens.topElev))
      ) {
        const matrixFid = above.formationId
        const pieces = lens.rawPieces
        if (pieces) {
          // A merged run comes apart: every lens pulled from inside it (spanning within the run,
          // matrix = the run's formation) now sits in the run's own matrix, and each raw piece of
          // the run is its own lens at its own level.
          for (const el of lenses) {
            if (
              el.matrixFormationId === lens.formationId &&
              el.lens.topElev <= lens.topElev + 1e-6 &&
              el.lens.baseElev >= lens.baseElev - 1e-6
            ) {
              el.matrixFormationId = matrixFid
            }
          }
          for (const piece of pieces) lenses.push({ lens: { ...piece }, matrixFormationId: matrixFid })
        } else {
          lenses.push({ lens: { ...lens }, matrixFormationId: matrixFid })
        }
        // Remember the raw make-up of the unit that survives this merge, BEFORE it is grown.
        const mergedRaw = [...piecesOf(above), ...piecesOf(below)]
        // SESSION-24 EXPERIMENT (flag-ON, MEASURED): when ``below`` is EDGED, the ordinary merge
        // (keep ``above``, splice ``below``) would drop ``below``'s tie layerId → its band vanishes
        // (the guard that historically blocked it). Instead KEEP ``below``'s identity and grow it
        // UP to cover the lens (``below.topElev = above.topElev``), splicing ``above`` — so the
        // annulus is continuous AND ``below``'s tie survives. When ``below`` is un-edged, the
        // original behaviour (keep ``above``) is retained.
        if (edgedLayerIds.has(below.layerId)) {
          // ``below`` edged → keep ``below``'s identity (grow it UP over the lens) and splice
          // ``above``, so ``below``'s tie survives AND the annulus is continuous. (A both-edged
          // case still keeps ``below`` here; ``above``'s tie is subsumed — the fundamental
          // both-edged limit — but it did not fire on any real interbed, so this stays the
          // below-edged single case that produced the CS1 g21 / coherentStack(a) win.)
          below.topElev = above.topElev
          below.rawPieces = mergedRaw
          units.splice(k - 1, 2) // remove ``above`` and the lens; ``below`` (now at k-1) survives
        } else {
          above.baseElev = below.baseElev
          above.rawPieces = mergedRaw
          units.splice(k, 2) // remove the lens and the (now-merged) below unit
        }
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

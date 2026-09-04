/**
 * partitionFillV2/emitCurves.ts — curve emission (design §2, §3 step 1).
 *
 * Turns the litho columns + approved correlation edges into the four families of
 * input curves the planar arrangement traces (design partition-engine-v2.md §2):
 *
 *   1. column-vertical — each investigation's footprint edge, surface → TD, at
 *      its REAL alongM (uniform spacing diverges; memory
 *      ``feedback_partitionfill_needs_alongm``).
 *   2. contact        — a unit top/base along its own column face. In the
 *      metres×elevation arrangement a column has zero width, so a "contact
 *      segment" is emitted as the column-vertical sub-run between two contact
 *      elevations; contact ENDPOINTS become the vertices ties/closings attach to.
 *      (We split the column vertical at every contact elevation by emitting one
 *      curve per unit face, so the arrangement has a vertex at every contact.)
 *   3. tie           — an approved correlation edge spanning a gap, side-aware
 *      (top/base), connecting facing contact endpoints.
 *   4. closing       — synthesized vacancy-closure geometry (``emitIntervals``):
 *      the untied units of each interval between tie-anchored bands TILE it fully,
 *      meeting at a seam, so the space past a pinch/lens apex is CLAIMED (design §4
 *      increment 4 — no above-TD holes). Enclosed minorities pinch to a 0.45 lens
 *      apex inside a continuous matrix; per-body apex overrides / freedraw nodes
 *      REPLACE the synthesized apex.
 *
 * Deep-to-deep substrate bridges (``emitSubstrate``) run before the closings so a
 * bridge-anchored deep unit skips its interval tiling. Below a shallow TD with no
 * bridge the region stays unfilled (owner §8 Q3).
 *
 * Crossing approved ties are a HARD CONFLICT (owner §8 Q4): a pair of
 * geometrically crossing ties in the same gap both drop out of emission and are
 * reported in ``conflicts``; the two units then fall back to the interval tiling.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import {
  applyContactBend,
  bendBandContour,
  bendBandContourConfined,
  collectContactBends,
  type ContactBend,
} from './contactOverride'
import { detectCrossingConflicts, edgeKey, type CrossingConflict } from './crossingConflicts'
import { collectEnclosedLensDiamonds, type Corr0Diamond } from './detourBandContour'
import { emitBottomTieSubstrate } from './emitBottomTieSubstrate'
import { emitEnclosingFlood } from './emitEnclosingFlood'
import { emitEnclosedLensCurves, type LensLabel } from './emitLenses'
import { emitIntervalCurves } from './emitIntervals'
import { type BracketStrip, emitSubstrateBridges } from './emitSubstrate'
import { emitSubTdLenses } from './emitSubTdLenses'
import { emitTerminationSweep } from './emitTerminationSweep'
import { buildTerminationPlans } from './terminationPlan'
import { twoSidedTerminationsEnabled } from './tileFlags'
import { firstLithoTopElev, type ColumnGeom, type SectionInput } from './sectionGeom'
import { type CorrelationEdge } from '../sectionPartition'
import { type InputCurve, type Point } from './types'

/**
 * A tie resolved to concrete geometry across ONE gap: the two facing contact
 * endpoints it connects, side-aware, plus provenance (which unit/side on each
 * column) for later face labelling and closing-curve fallback.
 */
export interface ResolvedTie {
  /** Gap index (left column index in the non-empty column list). */
  gapIndex: number
  /** Endpoint on the LEFT column. */
  left: Point
  /** Endpoint on the RIGHT column. */
  right: Point
  /** Side of the left unit's contact this tie joins. */
  leftSide: 'top' | 'base'
  /** Side of the right unit's contact this tie joins. */
  rightSide: 'top' | 'base'
  /** Left column unit index this tie's left endpoint sits on. */
  leftUnitIndex: number
  /** Right column unit index. */
  rightUnitIndex: number
  /** Stable curve id. */
  id: string
  /**
   * The BENT polyline this tie's curve was emitted as, when a matched-contact free-draw override
   * bent it (``collectContactBends`` → ``applyContactBend``). ``left → apex(…) → right`` in
   * metres×elevation. UNDEFINED on the no-override path (the tie stayed a straight 2-point chord) —
   * so an onlap that laps this tie reads the STRAIGHT ``left``/``right`` endpoints exactly as before
   * (byte-identical). When present, an onlap re-derives its apex ELEVATION as ``pointAt(fraction)``
   * along THIS bent polyline (session 109 — the onlap rides along the bent contact, spec
   * ``freedraw-onlap-lens-edit-model.md`` → "Onlap rides along — SEGMENT-CONFINED"), instead of the
   * straight ``tiedElev → tieRefFarElev`` chord. Populated in ``emitCurves`` at the tie-emission
   * loop, where the same ``applyContactBend`` result is already computed for the curve.
   */
  bentPoints?: readonly Point[]
}

/**
 * A detected crossing-tie conflict: the two approved edges (adjacent ties AND/OR
 * jump-tie bridges) that geometrically cross in a gap (owner §8 Q4). Re-exported
 * from ``crossingConflicts`` — the canonical shape now carries the suspended
 * edges' order-invariant keys (``edgeKeys``) in addition to the historical
 * ``gapIndex`` + ``tieIds`` (backward compatible).
 */
export type TieConflict = CrossingConflict

/** Result of curve emission: the arrangement curves plus detected conflicts. */
export interface EmittedCurves {
  curves: InputCurve[]
  conflicts: TieConflict[]
  /** The ties that survived conflict pruning, per gap — used by labelling. */
  activeTies: ResolvedTie[]
  /**
   * ``lens<n>`` curve id -> the litho identity that curve's traced FACE carries.
   * An enclosed-lens face is bounded by the matrix column-vertical too, so its
   * label must come from here (the lens's own litho), not the matrix.
   */
  lensLabels: Map<string, LensLabel>
  /**
   * Bracketed jump-tie strips (owner 2026-08-18): a face lying between a
   * strip's two lines is the space between two jump ties that bracket one
   * unit per side — a BAND of that unit's formation.
   */
  bracketStrips: BracketStrip[]
  /**
   * Directional bridge-anchor set (``gapIndex|side|ui|contact``) — the jump-tie endpoints
   * scoped to the gap+side the bridge spans toward (ruling 8i(e)). Exposed so the
   * conformance gate + the LENS_AUDIT reproduce the engine's bridge-fed 2/1/0 arithmetic
   * from the SAME source (no drift).
   */
  bridgeGapAnchored: Set<string>
}

/**
 * Emit all four curve families for a whole section.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     Columns (with elevations precomputed) + resolved edge sets + alongM.
 *
 * Returns
 * -------
 * EmittedCurves
 *     ``curves`` for ``buildArrangement``, plus ``conflicts`` and the surviving
 *     ``activeTies`` (for face labelling).
 */
export function emitCurves(section: SectionInput): EmittedCurves {
  const curves: InputCurve[] = []
  emitColumnVerticals(section.columns, curves)
  emitSurfaceCurves(section.columns, curves)

  // ONE crossing-conflict pass over EVERY approved edge — adjacent ties AND
  // jump-tie bridges canonicalised into gap-local segments (owner §8 Q4, design
  // §4 "Band authority" row). Any edge in any crossing is SUSPENDED: dropped from
  // BOTH emission paths (ties + bridges) so its units fall back to 0/1-corr
  // termination. This replaces the old adjacent-only ``pruneCrossingTies``, which
  // let a bridge crossing another bridge / an adjacent tie enter unchecked.
  const { suspended, conflicts } = detectCrossingConflicts(section)
  // The surviving-edge section fed to both emission paths — a suspended edge is
  // absent everywhere (never a tie curve, never a bridge, never a bottom-tie
  // reach). Built once; ``section`` itself is not mutated (pure).
  const survivingSection: SectionInput =
    suspended.size === 0
      ? section
      : {
          ...section,
          edges: (section.edges as readonly CorrelationEdge[]).filter(
            (e) => !suspended.has(edgeKey(e)),
          ),
        }

  const ties = resolveTies(survivingSection)
  // Item A (matched-contact free-draw): a control point on the shared boundary two bands ride BENDS
  // that ONE tie curve (design §8 line 88 — the freedraw curve is inserted into the arrangement, so
  // both incident faces re-trace around it). Computed per gap from the SAME ties + overrides the
  // enclosing flood uses (deterministic → the tie curve and its coincident ``bandc`` contour bend
  // identically). Empty when no override targets a shared contact → the tie is emitted straight
  // (byte-identical no-override path).
  const contactBendsByGap = new Map<number, ContactBend[]>()
  if (survivingSection.lensApexOverrides && survivingSection.lensApexOverrides.size > 0) {
    for (let gi = 0; gi + 1 < survivingSection.columns.length; gi++) {
      const bends = collectContactBends(gi, survivingSection.columns[gi], survivingSection.columns[gi + 1], ties, survivingSection.lensApexOverrides)
      if (bends.length > 0) contactBendsByGap.set(gi, bends)
    }
  }
  for (const t of ties) {
    const gapBends = contactBendsByGap.get(t.gapIndex)
    // FLUSH bends (heterogeneous === false) are keyed to the shared tie contact's own elevations, so
    // ``applyContactBend`` bends the tie CURVE here (both faces re-trace — byte-identical pre-§112).
    // HETEROGENEOUS bends are keyed to the UPPER band's OWN base contour, NOT this tie's elevations,
    // so they never match here → the tie curve stays STRAIGHT (the matrix-top tie HOLDS; §112).
    const flushBends = gapBends ? gapBends.filter((b) => !b.heterogeneous) : undefined
    const bent = flushBends ? applyContactBend([t.left, t.right], t.left.y, t.right.y, flushBends) : [t.left, t.right]
    // Session 109 — carry the BENT polyline onto the tie so an onlap that laps this tie can ride
    // its bend (``emitOnlap`` re-derives its apex elevation as ``pointAt(fraction)`` along it). Only
    // when the bend actually inserted an interior vertex (``bent.length > 2``); a straight 2-point
    // result leaves ``bentPoints`` undefined so the onlap reads the straight endpoints byte-identically.
    if (bent.length > 2) t.bentPoints = bent
    // §112 HETEROGENEOUS onlap ride: when a heterogeneous bend's matched-tie elevations equal THIS
    // tie's (it is the matrix-top tie the onlap laps), attach the bent CLAY-BASE polyline to the
    // tie's ``bentPoints`` WITHOUT bending the tie curve. The onlap then rides the clay base (its top
    // laps that line, base pinned to the matrix top) while the matrix-top tie curve stays straight.
    let heteroTiePoints: Point[] | null = null
    if (gapBends) {
      for (const b of gapBends) {
        if (!b.heterogeneous || b.tieLeftElev == null || b.tieRightElev == null) continue
        if (Math.abs(b.tieLeftElev - t.left.y) > CONTOUR_MATCH_EPS || Math.abs(b.tieRightElev - t.right.y) > CONTOUR_MATCH_EPS) continue
        // §113 FLUSH-SIDE CONFINEMENT: a flush-side grab confines the clay-base bend to the flush
        // segment (the onlap's pinch is a WALL), so the onlap-side segment keeps its base geometry and
        // the onlap — which reads ``bentPoints`` at its own pinch fraction — does not ride. On the
        // onlap's side of the pinch (``wallFraction`` null) the whole-gap ride stands (§112 unchanged).
        const clayBase =
          b.wallFraction != null && b.wallElev != null
            ? bendBandContourConfined(
                [{ x: t.left.x, y: b.leftElev }, { x: t.right.x, y: b.rightElev }],
                b.fraction,
                b.elevation,
                b.wallFraction,
                b.wallElev,
              )
            : bendBandContour(
                [{ x: t.left.x, y: b.leftElev }, { x: t.right.x, y: b.rightElev }],
                b.fraction,
                b.elevation,
              )
        if (clayBase.length > 2) t.bentPoints = clayBase
        const SNAP = 0.001
        const collinearAt = (frac: number): Point => ({
          x: t.left.x + frac * (t.right.x - t.left.x),
          y: t.left.y + frac * (t.right.y - t.left.y),
        })
        if (b.wallFraction != null && b.wallElev != null) {
          // §113 CONFINED (flush-side). On the FLUSH segment [column .. wall] there is NO onlap and the
          // clay base IS the matrix top (a plain shared contact there — clay base 5.21 == matrix top
          // 5.21 on the flush column). So the matrix top FOLLOWS the clay base on the flush segment
          // (both bend together — matrix grows/shrinks as the shared contact moves), then HOLDS on the
          // onlap segment [wall .. column] where the onlap laps it. Confine-bend the tie curve through
          // the SAME apex + wall as the clay base, pinning the wall at the onlap's current apex so the
          // onlap-side matrix top is byte-identical and the onlap does not move. This makes the flush
          // side a clean two-band contact and keeps the onlap a WALL.
          heteroTiePoints = bendBandContourConfined(
            [t.left, t.right],
            b.fraction,
            b.elevation,
            b.wallFraction,
            b.wallElev,
          )
        } else {
          // §112 onlap-side ride: the matrix top HOLDS straight; expose a collinear vertex at the apex
          // so the partition carries a boundary vertex where the clay-base bandc bends (the matrix is
          // geometrically unchanged — the vertex elevation is the tie interpolated there).
          const apex = collinearAt(b.fraction)
          if (Math.abs(apex.x - t.left.x) > SNAP && Math.abs(apex.x - t.right.x) > SNAP) {
            heteroTiePoints = [t.left, apex, t.right]
          }
        }
      }
    }
    curves.push({
      id: t.id,
      kind: 'tie',
      points: heteroTiePoints ?? bent,
    })
  }

  // Deep-to-deep substrate bridges: jump ties (non-adjacent correlation edges)
  // become bridge curves through the intervening columns so the sub-shallow-TD
  // region traces as ordinary faces (design §4; owner §8 Q3). Emitted BEFORE the
  // closings so the closing pass can skip a deep anchor unit whose contacts a
  // bridge already carries (else it pinches to a lens apex into the gap). Consumes
  // only surviving edges (a suspended bridge is dropped here too — Q4).
  const bridgeAnchored = new Set<string>()
  // Directional bridge anchoring (ruling 8i(e)): the same jump-tie endpoints, keyed by the
  // gap+side the bridge spans TOWARD, so the sweep's corr arithmetic reads a bridge-near
  // contact tied (→ corr 1 → onlap) only in the span direction. Pass-through columns the
  // bridge crosses without anchoring stay untied (their units lens).
  const bridgeGapAnchored = new Set<string>()
  // Bracketed jump-tie pairs (owner 2026-08-18): the strip between two bridges
  // that bracket one unit per side is a BAND of that unit's formation.
  const bracketStrips: BracketStrip[] = []
  emitSubstrateBridges(survivingSection, curves, bridgeAnchored, bridgeGapAnchored, bracketStrips)

  // The shared ``lensLabels`` map: created BEFORE the interval closures so a lone-side
  // pinch's flood-wedge curves (emitLonePinch) can register their bracket-matrix label
  // here, then consumed by ``labelFaces`` (design §4 finding A). Enclosed-lens and
  // substrate curves append to the same map below.
  const lensLabels = new Map<string, LensLabel>()

  // THE HOIST (session 15) — WIRED when the cut-over flag is ON (``twoSidedTerminationsEnabled``).
  // In the owner's paint-bucket order (given line art → GENERATED ties → fill): the UNCONDITIONAL
  // termination sweep (``emitTerminationSweep``, 0→lens / 1→onlap per gap/side/unit) draws every
  // lens/onlap FIRST, then the fill-only enclosing flood (``emitEnclosingFlood``, owner 8f "fill
  // the void with the dominant lithology") closes the enclosing faces behind them so the sweep's
  // terminations carve holes/detours BY CONSTRUCTION. The seam engine (``emitIntervalCurves``)
  // is BYPASSED when the flag is on; its in-file cut-over branch and the dead tileGap /
  // tileCoherentStack modules were deleted in session 36. ``emitSubTdLenses`` + ``emitEnclosedLensCurves``
  // (the proven column-merge carriers) STILL run below — the sweep DEFERS to them for the sub-TD
  // and enclosed-minority cases (it never double-emits: the sub-TD deferral skips sub-TD units,
  // and ``emitEnclosedLensCurves`` handles the same-formation-enclosed minorities the sweep's
  // ``isMinority`` gate also targets — but those units were already MERGED out of the column by
  // ``sectionGeom.extractEnclosedLenses``, so the sweep's ``isMinority`` never sees them).
  // Flag OFF: the seam-based ``emitIntervalCurves`` runs, byte-identical to the session-13 baseline.
  // THE TERMINATION PLAN (session 41, ruling 8p) — the single provenance-carrying authority the
  // emission consumes instead of re-deriving corr/tie/geometry/apex per subsystem. Built HERE, once,
  // AFTER the substrate bridges (so ``bridgeGapAnchored`` is populated) from the SAME classifier +
  // geometry context the sweep used inline. ``jumpTies`` resolves the non-adjacent bridge edges into
  // ``ResolvedTie`` provenance so a sub-TD/bridge corr-1 plan carries a real ``{kind:'resolved'}``
  // tieRef (F5 — "corr=1 with TieRef=null cannot satisfy follow-the-actual-tie"). Only built on the
  // flag-ON path (the seam path is untouched); flag-OFF stays byte-identical (plans = []).
  const twoSided = twoSidedTerminationsEnabled()
  const jumpTies = twoSided ? resolveJumpTies(survivingSection) : []
  const plans = twoSided ? buildTerminationPlans(survivingSection, ties, jumpTies, bridgeGapAnchored) : []
  if (twoSided) {
    // RULING 8s STAGE B: collect every corr-0 lens diamond the sweep + the enclosed-lens emitter
    // draw, so ``emitEnclosingFlood`` can DETOUR a crossing ``bandc`` band-base contour around them
    // (the band wraps the lens as a hole instead of the S50 crush — "0.45 stands, matrix detours").
    // The sweep records its interior lenses as it emits them (exact apex). Enclosed-lens diamonds
    // are computed here from the SAME ``enclosedLensDiamond`` call ``emitEnclosedLensCurves`` makes
    // (which runs AFTER the flood), so the flood sees them without a reorder.
    const corr0Diamonds: Corr0Diamond[] = []
    emitTerminationSweep(survivingSection, ties, bridgeAnchored, bridgeGapAnchored, lensLabels, curves, plans, corr0Diamonds)
    collectEnclosedLensDiamonds(survivingSection, ties, corr0Diamonds)
    emitEnclosingFlood(survivingSection, ties, bridgeAnchored, lensLabels, curves, corr0Diamonds, bridgeGapAnchored)
    // S41.c (ruling 8p / finding F1): the asymmetric ``emitRuledBands`` pass is DELETED. It
    // invented same-formation band contours from formation-OVERLAP authority (a unit's own
    // contact ↔ HALF a facing same-formation run), NOT from the two actual bracket ties bounding
    // the unit-side — so at CS1 gap2 (B6↔B4) it drew a KLEI band whose base contour (L2-base 3.67
    // ↔ R1-base 7.13) rode diagonally ACROSS the SILT band, and collapsed the real SILT base tie
    // (L 5.023 ↔ R 7.509) to a point. Under the plan architecture a ruled band exists ONLY where
    // the two REAL bracket contacts authorise it: the matched-pair band's own top/base contours,
    // which ``emitEnclosingFlood`` already emits from ``collectGapBands`` (the symmetric tie
    // geometry). The ABSENT protection §25 kept the pass for is subsumed by the 8j merge +
    // that symmetric flood emission — measured: lensAudit MISSING stays 0 and the conformance
    // ratchet is unmoved with the pass gone (no corr-2 band member flips to absent).
  } else {
    // Vacancy closure (design §4 increment 4): the untied units of each interval
    // between tie-anchored bands TILE it fully (opposing pinches meeting at a seam),
    // so the vacated space past a pinch/lens apex is CLAIMED — no above-TD holes.
    emitIntervalCurves(survivingSection, ties, bridgeAnchored, lensLabels, curves)
  }

  // Ruling 8s: the enclosed-lens reach is 0.45 unless a gap TIE crosses its diamond (the sole
  // collision shortener). Pass the resolved gap ties so ``enclosedLensReach`` can run the
  // tie-cross test (flag-ON); flag-OFF ignores them and keeps the original cap byte-identical.
  emitEnclosedLensCurves(survivingSection, curves, lensLabels, ties)

  // Deep-to-deep FLAT-FLOOR substrate (design §4 increment-6): where a bottom-tie
  // bracket reaches below a shallow column's TD, flatten the deepest band's base to
  // that flat floor (v1 ``computeBottomTieLine`` + ``isDeepestBridge``). This fills
  // the triangular sub-TD void the sloping TD line left (CS1 gap-0/gap-21). A strip
  // with no bracket stays empty (owner §8 Q3 — ``tieElev`` null). Substrate curves
  // carry an explicit bottom-tie label in ``lensLabels`` so the sub-TD wedge is
  // stamped with the tie formation, not the shallow column's deepest unit.
  emitBottomTieSubstrate(survivingSection, curves, lensLabels)

  // SUB-TD per-side hugging lenses (owner ruling 2026-07-16 night: "0 correlations, left
  // or right = lens to the same side, INCLUDING sub-TD"). A 0-corr unit entirely below the
  // FACING column's TD is swept by the deep-to-deep substrate above; it must still hug its
  // column with a lens. Emitted AFTER the substrate so the lens closing carves a HOLE in the
  // continuous substrate band by construction (the col3 interbed-lens proof) — the substrate
  // floor/curtain/bridge curves are untouched (owner §8 Q3 / ruling 6 preserved). Guarded so
  // a lens only fires where the flooding substrate DIFFERS from the unit (no same-formation
  // annulus — the session-9/12 sub-TD wall).
  emitSubTdLenses(survivingSection, ties, bridgeAnchored, bridgeGapAnchored, lensLabels, curves, plans)

  return { curves, conflicts, activeTies: ties, lensLabels, bridgeGapAnchored, bracketStrips }
}

/**
 * Emit one ``column-vertical`` curve per unit face on every column: the column
 * line from the unit's top elevation to its base elevation. Splitting per unit
 * guarantees an arrangement vertex at every contact elevation (where ties /
 * closing curves attach). The stack is gap-free (normalised upstream), so the
 * per-unit verticals tile the whole column surface→TD.
 *
 * RULING 8r / STEP 4.1 — THE COLUMN-VERTICAL ID SPLIT (flag-ON only). When
 * ``sectionGeom.extractEnclosedLenses`` merged an enclosed interbed's matrix
 * above+below into one continuous band (so the interbed became an interior HOLE),
 * the merged host unit's ``[topElev..baseElev]`` span COVERS the lens elevations.
 * Emitting one ``col<ci>:u<ui>`` curve over that whole span makes the lens face's
 * only column edge the enclosing MATRIX — the seed classifier then reads the matrix
 * litho, not the interbed's (the ``merged-minority`` artifact, §48b/§49).
 *
 * The FIX is an IDENTITY split, not a geometry split: the arrangement already cuts
 * the host vertical at the lens contacts (the lens flank curves attach vertices
 * there), so the traced FACES are byte-identical. We only change which curve id the
 * lens sub-segment CARRIES: emit the host pieces ABOVE and BELOW the lens as
 * ``col<ci>:u<ui>`` (unchanged) and emit the lens interval itself as
 * ``col<ci>:lens<j>`` — a seed vocabulary the classifier resolves to the RAW lens
 * unit's own ``formationId`` (``seedClassifier.formationOfRef``). Stacked lenses
 * inside one host produce multiple lens sub-segments; the host pieces between them
 * keep the host id. Holes/overlaps are untouched BY CONSTRUCTION (the DCEL unions
 * coincident-segment curve ids, and no host id is emitted over a lens interval, so
 * that segment carries ONLY its ``col:lens`` id).
 *
 * Flag-OFF: emits exactly today's one curve per unit, byte-identical (no lens
 * intervals consulted — the seam path never reads ``col:lens`` ids).
 */
function emitColumnVerticals(columns: readonly ColumnGeom[], out: InputCurve[]): void {
  const idSplit = twoSidedTerminationsEnabled()
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    // Flag-ON: the enclosed-lens intervals on THIS column, each mapped to its index in
    // ``col.enclosedLenses`` (the ``col:lens<j>`` seed vocabulary resolves by that index).
    //
    const lensCuts: { elLo: number; elHi: number; j: number }[] = idSplit
      ? col.enclosedLenses.map((el, j) => ({
          elLo: Math.min(el.lens.topElev, el.lens.baseElev),
          elHi: Math.max(el.lens.topElev, el.lens.baseElev),
          j,
        }))
      : []
    for (let ui = 0; ui < col.units.length; ui++) {
      const u = col.units[ui]
      // Ruling 5-REVISED (2026-07-14 evening): the FIRST unit's column vertical returns to
      // its own DRILLED top (``u.topElev``), NOT the ground surface. The owner rejected the
      // surface extension on round-2 dogfeed ("that quad is made up") — the strip between the
      // top-band line and the ground stays EMPTY, no invented lithology above the first data
      // point. The top-band polyline (``emitSurfaceCurves`` → ``firstLithoTopElev``) rides this
      // first-litho boundary; ties/bands anchor at the drilled contact unchanged.
      const uHi = Math.max(u.topElev, u.baseElev)
      const uLo = Math.min(u.topElev, u.baseElev)
      // Lens intervals that fall INSIDE this unit's span (a merged host covering them). Only a
      // matrix band ever contains a lens interval; a non-host unit finds none and emits one curve.
      const inside = lensCuts
        .filter((c) => c.elLo > uLo - LENS_CUT_EPS && c.elHi < uHi + LENS_CUT_EPS && c.elHi - c.elLo > LENS_CUT_EPS)
        .sort((a, b) => b.elHi - a.elHi) // shallow (higher elev) first for top→base emission
      if (inside.length === 0) {
        out.push({
          id: `col${ci}:u${ui}`,
          kind: 'column-vertical',
          points: [
            { x: col.x, y: u.topElev },
            { x: col.x, y: u.baseElev },
          ],
        })
        continue
      }
      // The host is split into host pieces + lens pieces, walking top→base. ``cursor`` is the
      // current top elevation; each lens interval closes the host piece above it (host id), emits
      // the lens interval (``col:lens`` id), and advances the cursor to the lens base.
      const pushSeg = (yTop: number, yBase: number, id: string): void => {
        if (yTop - yBase <= LENS_CUT_EPS) return // degenerate (host piece collapses at a contact)
        out.push({ id, kind: 'column-vertical', points: [{ x: col.x, y: yTop }, { x: col.x, y: yBase }] })
      }
      let cursor = uHi
      for (const cut of inside) {
        pushSeg(cursor, cut.elHi, `col${ci}:u${ui}`) // host piece above the lens
        pushSeg(cut.elHi, cut.elLo, `col${ci}:lens${cut.j}`) // the lens interval — its OWN litho seed
        cursor = cut.elLo
      }
      pushSeg(cursor, uLo, `col${ci}:u${ui}`) // host piece below the deepest lens
    }
  }
}

/**
 * Elevation tolerance (metres) for the enclosed-lens interval split — matches the 1 mm arrangement
 * snap grid (``SNAP_GRID_M``). Below this a "piece" is a vertex touch, not a real sub-segment.
 */
const LENS_CUT_EPS = 0.001

/**
 * Elevation match epsilon (metres) for pairing a §112 heterogeneous bend to the matrix-top tie it
 * must attach its clay-base ride polyline to (the 1 mm arrangement snap grid). The tie's own curve is
 * left unbent; only its ``bentPoints`` (read solely by the riding onlap) takes the clay-base line.
 */
const CONTOUR_MATCH_EPS = 0.001

/**
 * Emit the TOP-BAND curve spanning each gap — from the left column's first-litho-top
 * elevation to the right column's (ruling 5-revised; ``firstLithoTopElev``). This is the
 * band-authority top polyline: it rides each column's FIRST LITHO BOUNDARY, not the ground
 * surface, so the strip between it and the ground stays EMPTY. It still encloses the top of
 * every gap so a unit that pinches out at/near the top-band leaves a CLOSED vacancy face
 * (the rising matrix) instead of an open, untraced region above the shallowest tie. The
 * FLOOR is deliberately NOT emitted: the sub-TD void below a shallow column stays open
 * (unfilled) until the deep-to-deep substrate bridges.
 */
function emitSurfaceCurves(columns: readonly ColumnGeom[], out: InputCurve[]): void {
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    out.push({
      id: `surface:${gi}`,
      kind: 'closing',
      points: [
        { x: left.x, y: firstLithoTopElev(left) },
        { x: right.x, y: firstLithoTopElev(right) },
      ],
    })
  }
}

/**
 * Resolve every JUMP tie (a correlation edge spanning ≥ 2 columns) into ``ResolvedTie``
 * records the termination PLAN consumes (ruling 8p — a sub-TD/bridge corr-1 must follow the
 * RESOLVED bridge tie, never "corr=1 with TieRef=null"). Distinct from ``resolveTies`` (which
 * emits only adjacent-gap tie CURVES); this produces the plan's provenance objects, ONE per
 * anchored end, keyed to the gap+side the bridge spans TOWARD — the SAME directional convention
 * ``emitSubstrateBridges`` uses to populate ``bridgeGapAnchored``:
 *   - the LO anchor is tied looking RIGHT into gap ``loCi`` (side ``left``);
 *   - the HI anchor is tied looking LEFT into gap ``hiCi - 1`` (side ``right``).
 *
 * Each record's NEAR endpoint (on ``side``) sits on the anchored column's tied contact; the FAR
 * endpoint is the bridge line interpolated at the facing column's x. ``findBridgeTie`` (the plan
 * resolver) matches a record by its near unit/contact — directly, or via the derived-base rule
 * (a top anchor on unit k+1 shares unit k's base). The plan then carries a ``{kind:'resolved'}``
 * ref, so the F5 sub-TD onlap follows the real bridge line rather than a null ref.
 */
export function resolveJumpTies(section: SectionInput): ResolvedTie[] {
  const { columns } = section
  const out: ResolvedTie[] = []
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }
  let seq = 0
  for (const e of section.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue // endpoint not in this section
    if (Math.abs(la.ci - lb.ci) < 2) continue // adjacent (or same) → an ordinary tie, not a bridge
    const loLoc = la.ci < lb.ci ? la : lb
    const hiLoc = la.ci < lb.ci ? lb : la
    const loSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const hiSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const loU = columns[loLoc.ci].units[loLoc.ui]
    const hiU = columns[hiLoc.ci].units[hiLoc.ui]
    const loX = columns[loLoc.ci].x
    const hiX = columns[hiLoc.ci].x
    const loElev = loSide === 'top' ? loU.topElev : loU.baseElev
    const hiElev = hiSide === 'top' ? hiU.topElev : hiU.baseElev
    if (Math.abs(hiX - loX) < 1e-9) continue
    // The straight bridge line in metres×elevation; sample it at the immediately-facing column of
    // each anchor's own gap so the plan's far endpoint sits on the real bridge geometry.
    const elevAt = (x: number): number => loElev + ((x - loX) / (hiX - loX)) * (hiElev - loElev)
    // LO anchor: looks RIGHT into gap ``loLoc.ci`` (its own column is the gap's LEFT column). The
    // FAR (right) endpoint is the bridge line at the next column's x.
    const loFacingX = columns[loLoc.ci + 1]?.x ?? hiX
    out.push({
      gapIndex: loLoc.ci,
      left: { x: loX, y: loElev },
      right: { x: loFacingX, y: elevAt(loFacingX) },
      leftSide: loSide,
      rightSide: 'top',
      leftUnitIndex: loLoc.ui,
      rightUnitIndex: -1,
      id: `jump${seq}lo:${loLoc.ci}-${hiLoc.ci}`,
    })
    // HI anchor: looks LEFT into gap ``hiLoc.ci - 1`` (its own column is that gap's RIGHT column).
    // The FAR (left) endpoint is the bridge line at the previous column's x.
    const hiFacingX = columns[hiLoc.ci - 1]?.x ?? loX
    out.push({
      gapIndex: hiLoc.ci - 1,
      left: { x: hiFacingX, y: elevAt(hiFacingX) },
      right: { x: hiX, y: hiElev },
      leftSide: 'top',
      rightSide: hiSide,
      leftUnitIndex: -1,
      rightUnitIndex: hiLoc.ui,
      id: `jump${seq}hi:${loLoc.ci}-${hiLoc.ci}`,
    })
    seq++
  }
  return out
}

/**
 * Resolve every approved edge that straddles an adjacent gap to concrete tie
 * geometry (endpoint on each facing column). Only ADJACENT-column ties are
 * emitted as curves — a jump tie across a data void has no facing pair of
 * columns and is left for increment 3's substrate bridges.
 *
 * A tie's endpoint elevation depends on the side (``top`` → the unit's top
 * contact; ``base`` → the unit's base contact).
 */
/**
 * A resolved tie endpoint: the surviving column index, that column's contact
 * elevations (top/base) and the unit index. ``ui = -1`` marks a RAW-only endpoint
 * (ruling 8r) — the picked unit was spliced out of the normalised stack by the
 * enclosed-lens merge, so its contact comes from ``rawLayerContacts`` and there is no
 * normalised unit index. A ``-1`` index is harmless to the downstream band/corr
 * consumers, which all guard ``units[ui]`` against ``undefined`` (``collectGapBands``
 * ``if (!lu || !ru) continue``), so a spliced-out unit's tie emits as pure line art
 * that splits the arrangement faces WITHOUT re-mapping onto or reshaping a surviving
 * unit's band structure.
 */
interface TieEndpoint {
  ci: number
  ui: number
  topElev: number
  baseElev: number
}

export function resolveTies(section: SectionInput): ResolvedTie[] {
  const { columns, rawLayerContacts } = section
  const out: ResolvedTie[] = []
  // layerId → {colIndex, unitIndex} for the NORMALISED stack.
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  for (let ci = 0; ci < columns.length; ci++) {
    for (let ui = 0; ui < columns[ci].units.length; ui++) {
      layerLoc.set(columns[ci].units[ui].layerId, { ci, ui })
    }
  }

  // Resolve an edge endpoint to its column + contact elevations. Normalised stack
  // first (the common case); on a miss, RULING 8r's raw fallback so a tie into a
  // merged-away picked unit still resolves at the elevation the owner drew.
  const resolveEndpoint = (layerId: string): TieEndpoint | null => {
    const loc = layerLoc.get(layerId)
    if (loc) {
      const u = columns[loc.ci].units[loc.ui]
      return { ci: loc.ci, ui: loc.ui, topElev: u.topElev, baseElev: u.baseElev }
    }
    // RULING 8r — the picked unit was spliced out of the normalised stack (the
    // enclosed-lens merge). Emit its tie at its RAW picked contact; ``ui = -1``.
    const raw = rawLayerContacts?.get(layerId)
    if (raw) return { ci: raw.colIndex, ui: -1, topElev: raw.topElev, baseElev: raw.baseElev }
    return null
  }

  let tieSeq = 0
  for (const e of section.edges) {
    const la = resolveEndpoint(e.a)
    const lb = resolveEndpoint(e.b)
    if (!la || !lb) continue // endpoint not in this section
    // Only adjacent columns form a tie curve; non-adjacent = jump tie (incr 3).
    if (Math.abs(la.ci - lb.ci) !== 1) continue
    const leftLoc = la.ci < lb.ci ? la : lb
    const rightLoc = la.ci < lb.ci ? lb : la
    const leftSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const rightSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    out.push({
      gapIndex: leftLoc.ci,
      left: {
        x: columns[leftLoc.ci].x,
        y: leftSide === 'top' ? leftLoc.topElev : leftLoc.baseElev,
      },
      right: {
        x: columns[rightLoc.ci].x,
        y: rightSide === 'top' ? rightLoc.topElev : rightLoc.baseElev,
      },
      leftSide,
      rightSide,
      leftUnitIndex: leftLoc.ui,
      rightUnitIndex: rightLoc.ui,
      id: `tie${tieSeq++}:${leftLoc.ci}`,
    })
  }
  return out
}

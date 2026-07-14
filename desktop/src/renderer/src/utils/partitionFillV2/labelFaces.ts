/**
 * partitionFillV2/labelFaces.ts — face labelling (design §3 step 4, §2).
 *
 * Each traced arrangement face is a partition cell in metres×elevation space. This
 * module stamps it with:
 *
 *   - ``formationId`` — from the column units whose contact (column-vertical)
 *     segments bound the face (design §3: "formation comes from the column units
 *     whose contact segments bound the face").
 *   - ``bodyId`` — from the same bounding units' layer rows (never invented; body
 *     resolution stays the backend's job, design §3).
 *   - ``kind`` — BAND / ONLAP / LENS by BOUNDARY COMPOSITION (design §2), not tie
 *     counting: a boundary that runs tie->tie (or exits the section) -> BAND; one
 *     tied side + one synthesized closing -> ONLAP; no ties, closed via own
 *     contacts + closing curves -> LENS.
 *
 * The bounding column-vertical curve ids are ``col<ci>:u<ui>`` (see
 * ``emitCurves.emitColumnVerticals``); tie curve ids start ``tie``; closing curve
 * ids start ``close``. That id vocabulary is the labelling signal.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type LensLabel } from './emitLenses'
import { type ColumnGeom } from './sectionGeom'
import { type Face } from './types'

/** BAND / ONLAP / LENS classification of a face. */
export type FaceClass = 'band' | 'onlap' | 'lens'

/** A face with its litho label + classification. */
export interface LabelledFace {
  face: Face
  formationId: string
  bodyId: string | null
  klass: FaceClass
  /** The bounding column-vertical unit refs (colIndex, unitIndex). */
  units: { ci: number; ui: number }[]
}

const COL_RE = /^col(\d+):u(\d+)$/

/**
 * Label every face of the arrangement.
 *
 * Parameters
 * ----------
 * faces : readonly Face[]
 *     Traced arrangement faces (metres×elevation).
 * columns : readonly ColumnGeom[]
 *     The normalised columns, so a ``col<ci>:u<ui>`` id resolves to a unit.
 *
 * Returns
 * -------
 * LabelledFace[]
 *     One entry per face that resolves to a litho unit; faces bounded by NO column
 *     vertical (should not occur for a valid partition) are dropped.
 */
export function labelFaces(
  faces: readonly Face[],
  columns: readonly ColumnGeom[],
  lensLabels?: ReadonlyMap<string, LensLabel>,
): LabelledFace[] {
  const out: LabelledFace[] = []
  for (const face of faces) {
    const units: { ci: number; ui: number }[] = []
    let nTie = 0
    let nClose = 0
    let nLensCurves = 0
    // Any synthesized boundary curve that is NOT an enclosed-lens curve. An enclosed
    // lens's OWN triangle face is bounded ONLY by lens curves + its single emitting
    // column vertical; the enclosing MATRIX face (a concave notch touching the same
    // lens curves where the notch bites the column edge) is ALSO bounded by the
    // surface / close / floor / tie curves. This flag is what tells the lens triangle
    // (the small own-elevation face) from the matrix notch that shares its lens ids —
    // the ``face.holes.length === 0`` test alone cannot, because a NOTCH (lens riding
    // the matrix column edge, the pure-case shape) leaves BOTH faces hole-free
    // (adjacent-simple, not nested). See design §4 increment-12 row.
    let nonLensBoundary = false
    let lensLabel: LensLabel | undefined
    let substrateLabel: LensLabel | undefined
    let floodLabel: LensLabel | undefined
    for (const id of face.boundingCurveIds) {
      const m = COL_RE.exec(id)
      if (m) {
        units.push({ ci: Number(m[1]), ui: Number(m[2]) })
      } else if (id.startsWith('flood')) {
        // A lone-side FLOOD-closure curve (emitLonePinch): the vacated wedge beyond a
        // pinch apex, bounded only by these curves + the interval brackets + the
        // pinch's own ``close`` curves (never a full facing column vertical — the wedge
        // triangles are corner->conv->apex). Its label carries the bracket/facing
        // matrix formation, so the wedge reads as a BAND. Same trick as the sub-TD
        // substrate wedge (btfloor/btcurtain) — a face with no column vertical is
        // stamped from the flood label below.
        const l = lensLabels?.get(id)
        if (l) floodLabel = l
        nonLensBoundary = true
        nTie++
      } else if (id.startsWith('btfloor') || id.startsWith('btcurtain')) {
        // A deep-to-deep flat-floor SUBSTRATE curve (emitBottomTieSubstrate): its
        // label carries the bottom-tie formation. The sub-TD wedge below every
        // column TD is bounded only by these curves (no column vertical reaches
        // there), so it is labelled from here as a BAND (the tie fill is authoritative).
        const l = lensLabels?.get(id)
        if (l) substrateLabel = l
        nonLensBoundary = true
        nTie++
      } else if (id.startsWith('tie') || id.startsWith('bridge')) {
        // A ``bridge`` is a deep-to-deep substrate jump tie (emitSubstrate) — it
        // anchors the face the same way an ordinary tie does, so it counts toward
        // BAND classification.
        nonLensBoundary = true
        nTie++
      } else if (id.startsWith('close')) {
        nonLensBoundary = true
        nClose++
      } else if (id.startsWith('lens')) {
        // A synthesized enclosed-lens curve (emitLenses / emitEnclosedLensCurves). It
        // appears on TWO faces: the lens's OWN triangle (bounded ONLY by lens curves +
        // its single emitting column vertical) AND the enclosing MATRIX face that the
        // lens bites into (a concave notch when the lens rides the matrix column edge —
        // the pure case — or a true annulus HOLE ring when the lens floats interior to a
        // gap-spanning band). Only the lens's own triangle wins the lens label; the
        // discriminator is ``nonLensBoundary`` (the matrix face always also carries a
        // surface/close/floor/tie curve) + ``!spansGap`` (the matrix notch spans the gap),
        // computed after the loop. See design §4 increment-12 row.
        const l = lensLabels?.get(id)
        if (l) lensLabel = l
        nLensCurves++
        nClose++
      }
    }

    // The enclosed lens's OWN face: it carries a lens label, its ENTIRE synthesized
    // boundary is lens curves (``!nonLensBoundary`` — no surface / close / floor / tie
    // curve), and it does NOT span the gap (it rides a single column, apex mid-gap).
    // The enclosing matrix face shares the SAME lens curve ids (where the lens bites its
    // edge) but is disqualified on both counts — it always carries the surface / floor /
    // close boundary and spans the gap. This replaces the old ``face.holes.length === 0``
    // test, which mislabelled the matrix NOTCH as the lens (a notch leaves both faces
    // hole-free — adjacent-simple, not nested; see the loop comment + design §4 incr-12).
    const spansGap = new Set(units.map((u) => u.ci)).size >= 2
    if (lensLabel && !nonLensBoundary && nLensCurves > 0 && !spansGap) {
      out.push({ face, formationId: lensLabel.formationId, bodyId: lensLabel.bodyId, klass: 'lens', units })
      continue
    }
    // A sub-TD substrate wedge is bounded only by flat-floor + curtain curves — no
    // column vertical reaches below TD, so ``units`` is empty. Stamp it from the
    // bottom-tie label as an authoritative BAND (quad). A face that ALSO has a column
    // vertical is real drilled data — the column label wins (handled below), so the
    // substrate label only applies when there is no column vertical.
    if (substrateLabel && units.length === 0) {
      out.push({ face, formationId: substrateLabel.formationId, bodyId: substrateLabel.bodyId, klass: 'band', units })
      continue
    }
    // A lone-side flood wedge is bounded only by flood/close/bracket curves (its
    // corner->conv->apex triangles never carry a full facing column vertical), so
    // ``units`` is empty. Stamp it from the flood (bracket-matrix) label as a BAND — the
    // facing matrix claiming the width past a pinch apex (finding A). As with the
    // substrate label, a wedge face that ALSO has a real column vertical is drilled data;
    // the column label wins (handled below).
    if (floodLabel && units.length === 0) {
      out.push({ face, formationId: floodLabel.formationId, bodyId: floodLabel.bodyId, klass: 'band', units })
      continue
    }
    if (units.length === 0) continue // no column vertical bounds this cell — skip.

    const { formationId, bodyId } = resolveLabel(units, columns)
    // A face bounded by column verticals on TWO OR MORE distinct columns SPANS the gap
    // — design §2's "exits the section as a column vertical on both sides -> BAND". This
    // catches a geometric same-formation band (a continuous matrix laterally enclosing an
    // untied lens, e.g. clay between two sands) that carries no explicit tie, which the
    // tie-count classifier alone reads as LENS (v1 ``emitInterval`` connects a single
    // same-formation unit per side as a band quad). A lens/onlap face touches only its
    // OWN column vertical, so it is unaffected. (``spansGap`` is computed above.)
    const klass = spansGap ? 'band' : classifyFace(nTie, nClose)
    out.push({ face, formationId, bodyId, klass, units })
  }
  return out
}

/**
 * Resolve the formation + body for a face from its bounding units. The formation
 * is the one shared by the bounding units; if they disagree (a boundary shared
 * with a neighbour of a different formation), pick the formation of the majority,
 * ties broken by the smallest (ci, ui) for determinism. Body is taken from the
 * first bounding unit of the winning formation.
 */
function resolveLabel(
  units: readonly { ci: number; ui: number }[],
  columns: readonly ColumnGeom[],
): { formationId: string; bodyId: string | null } {
  const counts = new Map<string, number>()
  for (const { ci, ui } of units) {
    const u = columns[ci]?.units[ui]
    if (!u) continue
    counts.set(u.formationId, (counts.get(u.formationId) ?? 0) + 1)
  }
  let bestFormation = ''
  let bestCount = -1
  for (const [f, c] of counts) {
    if (c > bestCount || (c === bestCount && f < bestFormation)) {
      bestFormation = f
      bestCount = c
    }
  }
  // Body from the first (smallest ci,ui) bounding unit that has the winning
  // formation — deterministic, and matches the region's dominant lithology.
  const ordered = [...units].sort((a, b) => a.ci - b.ci || a.ui - b.ui)
  let bodyId: string | null = null
  for (const { ci, ui } of ordered) {
    const u = columns[ci]?.units[ui]
    if (u && u.formationId === bestFormation) {
      bodyId = u.bodyId
      break
    }
  }
  return { formationId: bestFormation, bodyId }
}

/**
 * Classify a face by boundary composition (design §2):
 *
 *  - no synthesized closing curve on the boundary -> BAND (the boundary runs
 *    tie->tie across the gap, or exits at the section edge as a column vertical
 *    on both sides).
 *  - at least one tie AND at least one closing -> ONLAP (one tied side, closes via
 *    a synthesized bracket-riding curve).
 *  - only closing curves, no ties -> LENS (closed via own contacts + closings).
 */
function classifyFace(nTie: number, nClose: number): FaceClass {
  if (nClose === 0) return 'band'
  if (nTie > 0) return 'onlap'
  return 'lens'
}

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
    let lensLabel: LensLabel | undefined
    let substrateLabel: LensLabel | undefined
    for (const id of face.boundingCurveIds) {
      const m = COL_RE.exec(id)
      if (m) {
        units.push({ ci: Number(m[1]), ui: Number(m[2]) })
      } else if (id.startsWith('btfloor') || id.startsWith('btcurtain')) {
        // A deep-to-deep flat-floor SUBSTRATE curve (emitBottomTieSubstrate): its
        // label carries the bottom-tie formation. The sub-TD wedge below every
        // column TD is bounded only by these curves (no column vertical reaches
        // there), so it is labelled from here as a BAND (the tie fill is authoritative).
        const l = lensLabels?.get(id)
        if (l) substrateLabel = l
        nTie++
      } else if (id.startsWith('tie') || id.startsWith('bridge')) {
        // A ``bridge`` is a deep-to-deep substrate jump tie (emitSubstrate) — it
        // anchors the face the same way an ordinary tie does, so it counts toward
        // BAND classification.
        nTie++
      } else if (id.startsWith('close')) {
        nClose++
      } else if (id.startsWith('lens')) {
        // A synthesized enclosed-lens curve. It appears on TWO faces: the lens
        // face's OUTER ring (a hole-free triangle) AND the enclosing matrix
        // annulus's HOLE ring (which ``faces.ts`` folds into the annulus's
        // boundingCurveIds). Only the hole-free face is the lens (guarded below by
        // ``face.holes.length === 0``); the annulus keeps its matrix label.
        const l = lensLabels?.get(id)
        if (l) lensLabel = l
        nClose++
      }
    }

    // A face WITH holes is the enclosing matrix annulus, never the lens — the lens
    // label leaked in via the shared hole-ring curve id. Ignore it there.
    if (lensLabel && face.holes.length === 0) {
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
    if (units.length === 0) continue // no column vertical bounds this cell — skip.

    const { formationId, bodyId } = resolveLabel(units, columns)
    const klass = classifyFace(nTie, nClose)
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

/**
 * partitionFillV2/emitLenses.ts — closing curves for ENCLOSED lenses (design §2
 * "the uncorrelated same-lithology unit enclosed in its own lithology: still a
 * closed loop, still a face").
 *
 * An enclosed lens (extracted in ``sectionGeom.extractEnclosedLenses``) sits
 * inside a merged, continuous matrix band. Its two closing curves (top->apex and
 * apex->base), together with the matrix column-vertical segment over the lens's
 * [base..top] range, form a CLOSED loop — a hole in the matrix band traced as its
 * own face. The lens pinches into the gap on WHICHEVER side has room; we emit it
 * into BOTH adjacent gaps (left lens in the gap to its right, right lens in the gap
 * to its left) so its 3D-consistent shape shows on both, matching v1.
 *
 * Per-body apex overrides / freedraw nodes REPLACE the synthesized apex (design
 * §4) — same key as the onlap/lens closings in ``emitCurves``.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { LENS_PINCH_FRACTION } from '../partitionFill'
import { type ColumnGeom, type EnclosedLens, type SectionInput, type UnitGeom } from './sectionGeom'
import { type InputCurve, type Point } from './types'

/**
 * Emit closing curves for every enclosed lens on every column, into each adjacent
 * gap. Appends to ``out``.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     Normalised section (columns carry ``enclosedLenses``).
 * out : InputCurve[]
 *     Curve accumulator.
 */
/** Litho identity for a synthesized lens curve id (for face labelling). */
export interface LensLabel {
  formationId: string
  bodyId: string | null
}

/**
 * Emit lens closing curves and record, in ``labels``, the formation/body each
 * synthesized lens curve id carries — so the traced lens FACE is labelled by the
 * LENS's litho, not the matrix column-vertical that also bounds it.
 */
export function emitEnclosedLensCurves(
  section: SectionInput,
  out: InputCurve[],
  labels: Map<string, LensLabel>,
): void {
  const { columns } = section
  let seq = 0
  const nextId = (): string => `lens${seq++}`
  for (let ci = 0; ci < columns.length; ci++) {
    const col = columns[ci]
    if (col.enclosedLenses.length === 0) continue
    // Into the gap to the RIGHT (this column is the gap's LEFT column).
    if (ci + 1 < columns.length) {
      const gw = columns[ci + 1].x - col.x
      for (const el of col.enclosedLenses)
        if (facingCarriesMatrix(columns[ci + 1], el))
          emitOne(el.lens, col, ci, 'left', gw, section, nextId, out, labels)
    }
    // Into the gap to the LEFT (this column is the gap's RIGHT column).
    if (ci - 1 >= 0) {
      const gw = col.x - columns[ci - 1].x
      for (const el of col.enclosedLenses)
        if (facingCarriesMatrix(columns[ci - 1], el))
          emitOne(el.lens, col, ci - 1, 'right', gw, section, nextId, out, labels)
    }
  }
}

/**
 * Whether the facing column carries the lens's enclosing MATRIX formation at the
 * lens's elevation range. Only then is the lens a real hole in a continuous matrix
 * band across the gap; otherwise drawing it would overlap a genuinely different
 * neighbour (the lens×pinch overlap class). Requires the facing matrix unit to
 * vertically overlap the lens's [base..top].
 */
function facingCarriesMatrix(facing: ColumnGeom, el: EnclosedLens): boolean {
  const { lens, matrixFormationId } = el
  for (const u of facing.units) {
    if (u.formationId !== matrixFormationId) continue
    // Vertical overlap between the facing matrix unit and the lens span.
    if (u.topElev > lens.baseElev && lens.topElev > u.baseElev) return true
  }
  return false
}

/** Emit one enclosed lens's closing curves into one gap, recording its label. */
function emitOne(
  lens: UnitGeom,
  col: ColumnGeom,
  gapIndex: number,
  side: 'left' | 'right',
  gapWidth: number,
  section: SectionInput,
  nextId: () => string,
  out: InputCurve[],
  labels: Map<string, LensLabel>,
): void {
  const colX = col.x
  const dir = side === 'left' ? 1 : -1
  const topPt: Point = { x: colX, y: lens.topElev }
  const basePt: Point = { x: colX, y: lens.baseElev }
  const label: LensLabel = { formationId: lens.formationId, bodyId: lens.bodyId }
  const push = (points: Point[]): void => {
    const id = nextId()
    labels.set(id, label)
    out.push({ id, kind: 'closing', points })
  }

  const ov = lookupOverride(section, lens, gapIndex)
  if (ov?.freedraw) {
    const toPt = (n: { fraction: number; elevation: number }): Point => ({
      x: colX + dir * gapLocalToDist(n.fraction, side, gapWidth),
      y: n.elevation,
    })
    const upper = [...ov.freedraw.upper].sort((a, b) => a.fraction - b.fraction).map(toPt)
    const lower = [...ov.freedraw.lower].sort((a, b) => b.fraction - a.fraction).map(toPt)
    push([topPt, ...upper, ...lower, basePt])
    return
  }
  const apexFrac = ov?.fraction ?? (side === 'left' ? LENS_PINCH_FRACTION : 1 - LENS_PINCH_FRACTION)
  const apexElev = ov?.elevation ?? (lens.topElev + lens.baseElev) / 2
  const apex: Point = { x: colX + dir * gapLocalToDist(apexFrac, side, gapWidth), y: apexElev }
  push([topPt, apex])
  push([apex, basePt])
}

/** Gap-local fraction (0=left col, 1=right col) -> distance from the emitting column. */
function gapLocalToDist(fraction: number, side: 'left' | 'right', gapWidth: number): number {
  return side === 'left' ? fraction * gapWidth : (1 - fraction) * gapWidth
}

interface OverrideShape {
  fraction?: number
  elevation?: number
  freedraw?: {
    upper: { fraction: number; elevation: number }[]
    lower: { fraction: number; elevation: number }[]
  }
}

/** Look up a per-(body, gap) apex / freedraw override for an enclosed lens. */
function lookupOverride(
  section: SectionInput,
  lens: UnitGeom,
  gapIndex: number,
): OverrideShape | undefined {
  if (!section.lensApexOverrides || lens.bodyId == null) return undefined
  const ov = section.lensApexOverrides.get(`${lens.bodyId}@${gapIndex}`)
  if (!ov) return undefined
  if (ov.upper?.length || ov.lower?.length) {
    return { freedraw: { upper: ov.upper ?? [], lower: ov.lower ?? [] } }
  }
  return { fraction: ov.fraction, elevation: ov.elevation }
}

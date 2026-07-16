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

import { lensReachFraction } from './lensReach'
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
        if (shouldEmitLens(col, columns[ci + 1], el))
          emitOne(el.lens, col, ci, 'left', gw, section, nextId, out, labels)
    }
    // Into the gap to the LEFT (this column is the gap's RIGHT column).
    if (ci - 1 >= 0) {
      const gw = col.x - columns[ci - 1].x
      for (const el of col.enclosedLenses)
        if (shouldEmitLens(col, columns[ci - 1], el))
          emitOne(el.lens, col, ci - 1, 'right', gw, section, nextId, out, labels)
    }
  }
}

/**
 * Whether to emit an enclosed lens into the gap facing ``facing`` (ruling 8h phases 1-2 —
 * every 0-corr enclosed minority ALWAYS gets its lens; ruling 8g — a lens is a DETOUR in the
 * enclosing band's contour, never a wall, so the enclosing band flows around it).
 *
 * An enclosed lens in ``col.enclosedLenses`` is enclosed by ONE continuous MATRIX formation on
 * its OWN column (``extractEnclosedLenses`` merged the above+below matrix into a single band
 * spanning the lens's elevation). So the lens is a real HOLE in that own-column matrix band
 * regardless of what the facing column carries: the 8b-capped lens hugs its own column, and the
 * arrangement carves it out of the own-column matrix band (which the merge made continuous
 * across the lens).
 *
 * TWO emission cases, both hole-safe:
 *   (1) the FACING column carries the matrix at the lens elevation (``facingCarriesMatrix``) —
 *       the matrix bands FULL-WIDTH across the gap and the lens is an interior hole (the
 *       original, un-edged case: CS1 col0 ZAND-in-SILT).
 *   (2) the facing carries a DIFFERENT lithology (CS1 col3 SILT-in-ZAND facing KLEI) — the
 *       own-column matrix still renders full-width in the gap (a same-formation band from the
 *       merge), so an 8b-capped lens hugging the own column is a hole in THAT band, on the own
 *       side, where the facing's different lithology has tapered away. Ruling 8h makes this
 *       emission UNCONDITIONAL: the interbed must not vanish just because the facing differs.
 *
 * The 8b reach cap (``lensReach``) keeps the lens hugging its own column (apex ≤ 2×thickness),
 * so it never crosses into the facing's different-lithology territory — overlap-free by the
 * cap, not by suppressing the lens.
 */
function shouldEmitLens(col: ColumnGeom, facing: ColumnGeom, el: EnclosedLens): boolean {
  void col
  void facing
  // Ruling 8h phases 1-2: emit unconditionally. The 8b cap + own-column matrix continuity make
  // it hole-safe; the prior ``facingCarriesMatrix`` gate wrongly dropped an interbed whose
  // facing carries a different lithology (CS1 col3 SILT-in-ZAND), leaving it ABSENT.
  void el
  return true
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
  // Ruling 8b (design partition-engine-v2.md §8): the DEFAULT 0-corr reach is capped to
  // ~2× the unit's own thickness in real metres (``lensReachFraction`` = min(0.45, 2t/gap)),
  // expressed here as a gap-local fraction from the emitting column (left→cap, right→1-cap).
  // A USER apex override (``ov.fraction``, and the freedraw branch above) is NEVER capped —
  // the drawn apex takes precedence even when it reaches deeper than the auto cap.
  const capFrac = lensReachFraction(lens.topElev - lens.baseElev, gapWidth)
  const defaultFrac = side === 'left' ? capFrac : 1 - capFrac
  const apexFrac = ov?.fraction ?? defaultFrac
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

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

import { type ResolvedTie } from './emitCurves'
import { enclosedLensReach, type ReachTie } from './lensReach'
import { type ColumnGeom, type EnclosedLens, type SectionInput, type UnitGeom } from './sectionGeom'
import { segmentDegenerate } from './snap'
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
  ties: readonly ResolvedTie[] = [],
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
      const gapTies = ties.filter((t) => t.gapIndex === ci)
      for (const el of col.enclosedLenses)
        if (shouldEmitLens(col, columns[ci + 1], el))
          emitOne(el.lens, col, columns[ci + 1], ci, 'left', gw, section, gapTies, nextId, out, labels)
    }
    // Into the gap to the LEFT (this column is the gap's RIGHT column).
    if (ci - 1 >= 0) {
      const gw = col.x - columns[ci - 1].x
      const gapTies = ties.filter((t) => t.gapIndex === ci - 1)
      for (const el of col.enclosedLenses)
        if (shouldEmitLens(col, columns[ci - 1], el))
          emitOne(el.lens, col, columns[ci - 1], ci - 1, 'right', gw, section, gapTies, nextId, out, labels)
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
  facing: ColumnGeom,
  gapIndex: number,
  side: 'left' | 'right',
  gapWidth: number,
  section: SectionInput,
  gapTies: readonly ReachTie[],
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
  // Ruling 8s (design partition-engine-v2.md §8, owner 2026-07-19, "0.45 stands, matrix detours"):
  // the DEFAULT 0-corr reach is 0.45 and STAYS 0.45 even when the facing carries a THIRD lithology
  // and the wedge opens into surrounding fill — the enclosing region detours AROUND the wedge (its
  // lines split the surrounding region → fill-between-the-lines makes overlap impossible by
  // construction). The facing-differs cap is DELETED; the SOLE shortener is a gap TIE crossing the
  // diamond (``enclosedLensReach`` delegates to ``interiorLensReachToTies``). An overlap that
  // survives (CS1 gap5 ZAND×SILT) is a region-construction defect ridden on the pinned holes-diag
  // ratchet, not a reason to re-cap. Flag-OFF keeps the original ``min(0.45, 2t/gap)`` cap
  // byte-identical (no tie scan). A USER apex override is NEVER capped.
  const lensMid = (lens.topElev + lens.baseElev) / 2
  const facingX = facing.x
  const capFrac = enclosedLensReach(
    lens.topElev - lens.baseElev,
    colX,
    facingX,
    lensMid,
    lens.topElev,
    lens.baseElev,
    gapTies,
  )
  const defaultFrac = side === 'left' ? capFrac : 1 - capFrac
  const apexFrac = ov?.fraction ?? defaultFrac
  const apexElev = ov?.elevation ?? (lens.topElev + lens.baseElev) / 2
  const apex: Point = { x: colX + dir * gapLocalToDist(apexFrac, side, gapWidth), y: apexElev }
  // TARGET-2 degenerate-flank guard (session 10): in a sub-snap-width gap (CS1 col21/col22 gap21,
  // 0.17 m) the apex snaps onto the column, collapsing a flank to zero extent in BOTH axes (the
  // ``close72`` elev-8.92-to-8.92 class). Emit NEITHER flank so the loop is never left half-open
  // and no output curve is degenerate — the enclosed lens degenerates to nothing in a sub-snap
  // gap (acceptable no-op; the enclosing matrix band simply covers the slot, holes/overlaps 0).
  if (segmentDegenerate(topPt, apex) || segmentDegenerate(apex, basePt)) return
  push([topPt, apex])
  push([apex, basePt])
}

/**
 * The enclosing-matrix formation of an enclosed lens, read from the lens's OWN column: the units
 * immediately ABOVE (base ≈ lens top) and BELOW (top ≈ lens base) the lens. Returns their formation
 * when BOTH agree (a genuine same-formation wrap — the merged band the lens is a hole in), else
 * ``null`` (no single enclosing matrix — treat any different facing as a collision). Structural
 * neighbour read only — NOT the F3 ``lensEnclosure`` walk (which skips sibling minorities); this is
 * the direct adjacency sufficient for the 8b-rev "is the facing the matrix or a competitor" test.
 */
export function enclosingMatrixFid(col: ColumnGeom, lens: UnitGeom): string | null {
  const EPS = 1e-3
  // The enclosed-lens extraction MERGES the matrix above+below into one continuous band spanning
  // the lens's elevation, so the lens's own contacts no longer bound distinct neighbour units. The
  // enclosing matrix is the band that CONTAINS the lens's top AND base elevations (a hair inside,
  // to land in the band even when the band contact coincides with the lens contact). When one band
  // contains both → that is the wrap. Fall back to the exact-contact neighbours for the un-merged
  // case (a lens the extraction left in place, its top/base ON a neighbour contact).
  const contains = (elev: number): string | null => {
    for (const u of col.units) {
      if (u.topElev >= elev - EPS && elev >= u.baseElev + EPS) return u.formationId
    }
    return null
  }
  const midAbove = contains(lens.topElev + EPS * 2)
  const midBelow = contains(lens.baseElev - EPS * 2)
  if (midAbove !== null && midAbove === midBelow) return midAbove
  // Un-merged fallback: exact-contact neighbours (a lens sitting ON its neighbours' contacts).
  let aboveFid: string | null = null
  let belowFid: string | null = null
  for (const u of col.units) {
    if (Math.abs(u.baseElev - lens.topElev) <= EPS) aboveFid = u.formationId
    if (Math.abs(u.topElev - lens.baseElev) <= EPS) belowFid = u.formationId
  }
  return aboveFid !== null && aboveFid === belowFid ? aboveFid : null
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

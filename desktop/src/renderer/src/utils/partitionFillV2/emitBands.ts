/**
 * partitionFillV2/emitBands.ts — matched-pair BAND boundaries (design
 * partition-engine-v2.md §4 increment-7 "band-first tiling").
 *
 * A matched-pair band is v1's ``matchColumns`` band signal expressed in v2: two
 * facing units of the SAME formation joined by an ADJACENT top-top or base-base
 * correlation tie. In v1 such a pair is emitted as a full-width band QUAD from its
 * top interface down to each column's own base (``emit.ts`` matched-pair loop), and
 * the interval tiler runs only on the UNMATCHED remainder — the band is
 * authoritative BY CONSTRUCTION.
 *
 * v2 pre-increment-7 only closed a band face when BOTH its contacts were ties
 * (``tiedContacts`` "fully banded"). A top-tie band whose BASE is each unit's own
 * (untied) contact left the band's base OPEN in the arrangement, so a facing untied
 * unit's lone-side fill leaked up into the band's interior — the cs1bandauthority
 * defect (CS1 gaps 11/13).
 *
 * This module traces each matched-pair band's TOP and BASE contour as closing
 * curves (``bandtop`` / ``bandbase``), so the band face closes by construction, and
 * exposes the per-column banded elevation spans so the interval tiler can EXCLUDE
 * them — a lone-side fill then extends to the band boundary, never through it.
 *
 * The contour curve ids start ``bandc`` — a prefix ``labelFaces`` counts as NEITHER
 * a tie nor a closing, so the band face (bounded by its tie + column verticals +
 * these contours) still classifies as BAND, and an adjacent untied fill face that
 * merely abuts a contour is not mis-promoted to onlap.
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { type ResolvedTie } from './emitCurves'
import { type IntervalUnit } from './emitIntervalLenses'
import { type ColumnGeom } from './sectionGeom'
import { type InputCurve } from './types'

/** Small epsilon in metres for elevation comparisons before the 1 mm snap. */
const ELEV_EPS = 1e-6

/**
 * A matched-pair band across one gap: the two facing units of the same formation
 * joined by an adjacent tie, with each side's own [top..base] elevation span. The
 * band's TOP contour is (leftTop, rightTop); its BASE contour is (leftBase,
 * rightBase). One or both contours may already be a tie curve (a top-tie band's top
 * is the tie); the missing contour is what this module contributes to the
 * arrangement so the band face closes.
 */
export interface GapBand {
  gapIndex: number
  /** Left column unit index of the band member. */
  leftUnitIndex: number
  /** Right column unit index. */
  rightUnitIndex: number
  leftTop: number
  leftBase: number
  rightTop: number
  rightBase: number
  formationId: string
}

/**
 * Collect the matched-pair bands for a gap from its active ties.
 *
 * A tie is a band signal when it is same-side on both ends (top-top or base-base)
 * and the two units share a formation — v1 ``pairScore`` scores an edge between
 * same-litho units as a band. (A mixed top-base tie is an onlap/substrate anchor,
 * not a symmetric band, so it is excluded here.) The band's span is each unit's OWN
 * [topElev..baseElev].
 *
 * Parameters
 * ----------
 * gapIndex : number
 *     The gap (left column index).
 * left, right : ColumnGeom
 *     The two columns.
 * activeTies : readonly ResolvedTie[]
 *     Ties that survived crossing-conflict pruning.
 *
 * Returns
 * -------
 * GapBand[]
 *     The matched-pair bands in this gap (deduplicated by unit-pair).
 */
export function collectGapBands(
  gapIndex: number,
  left: ColumnGeom,
  right: ColumnGeom,
  activeTies: readonly ResolvedTie[],
): GapBand[] {
  const bands: GapBand[] = []
  const seen = new Set<string>()
  for (const t of activeTies) {
    if (t.gapIndex !== gapIndex) continue
    // A symmetric band tie joins the SAME side on both ends (top-top or base-base).
    if (t.leftSide !== t.rightSide) continue
    const lu = left.units[t.leftUnitIndex]
    const ru = right.units[t.rightUnitIndex]
    if (!lu || !ru) continue
    if (lu.formationId !== ru.formationId) continue
    const key = `${t.leftUnitIndex}|${t.rightUnitIndex}`
    if (seen.has(key)) continue
    seen.add(key)
    bands.push({
      gapIndex,
      leftUnitIndex: t.leftUnitIndex,
      rightUnitIndex: t.rightUnitIndex,
      leftTop: lu.topElev,
      leftBase: lu.baseElev,
      rightTop: ru.topElev,
      rightBase: ru.baseElev,
      formationId: lu.formationId,
    })
  }
  return bands
}

/**
 * Emit each band's TOP and BASE contour as a closing curve so the band face is a
 * closed loop in the arrangement (the interval tiler's fill cannot cross it). The
 * contour from (left.x, leftElev) to (right.x, rightElev) is a straight line across
 * the gap — the same shape v1's band quad uses for its top / base.
 *
 * A contour that coincides with a tie curve is still emitted (a duplicate segment is
 * harmless — the DCEL merges coincident edges); emitting both contours keeps the
 * band self-contained regardless of which contact happens to carry the tie.
 *
 * Parameters
 * ----------
 * bands : readonly GapBand[]
 *     The gap's matched-pair bands.
 * left, right : ColumnGeom
 *     The two columns (for their x positions).
 * nextId : () => string
 *     Curve-id allocator (``band<n>`` ids).
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function emitBandContours(
  bands: readonly GapBand[],
  left: ColumnGeom,
  right: ColumnGeom,
  nextId: () => string,
  out: InputCurve[],
): void {
  for (const b of bands) {
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [
        { x: left.x, y: b.leftTop },
        { x: right.x, y: b.rightTop },
      ],
    })
    out.push({
      id: nextId(),
      kind: 'closing',
      points: [
        { x: left.x, y: b.leftBase },
        { x: right.x, y: b.rightBase },
      ],
    })
  }
}

/**
 * Emit one band contour (top or base) as a closing curve, clamped to the portion
 * ABOVE the shallow TD.
 *
 * The contour is a straight line from (leftX, leftElev) to (rightX, rightElev). Only
 * the part above ``shallowTD`` is emitted: the sub-TD zone is owned by the deep-to-
 * deep substrate, and a band contour duplicated there splits the deep band into
 * overlapping slivers (the sandbody GAP-14/15/16 regress). A contour entirely at or
 * below the shallow TD is skipped; a contour straddling it is clipped to the crossing
 * point so the above-TD portion still closes the band face against the fill.
 *
 * Parameters
 * ----------
 * leftX, rightX : number
 *     The gap's column x positions.
 * leftElev, rightElev : number
 *     The contour's elevation on each column.
 * shallowTD : number
 *     The higher of the two columns' TD elevations (the fill floor).
 * nextId : () => string
 *     Band-contour id allocator (``bandc<n>``).
 * out : InputCurve[]
 *     Curve accumulator.
 */
export function emitBandContourCurve(
  leftX: number,
  rightX: number,
  leftElev: number,
  rightElev: number,
  shallowTD: number,
  nextId: () => string,
  out: InputCurve[],
): void {
  let lx = leftX
  let ly = leftElev
  let rx = rightX
  let ry = rightElev
  const lBelow = ly <= shallowTD + ELEV_EPS
  const rBelow = ry <= shallowTD + ELEV_EPS
  if (lBelow && rBelow) return // wholly sub-TD — substrate owns it
  if (lBelow || rBelow) {
    // Clip to the shallowTD crossing so only the above-TD portion is emitted.
    const t = (shallowTD - ly) / (ry - ly) // fraction along the line to the crossing
    const cx = lx + t * (rx - lx)
    if (lBelow) {
      lx = cx
      ly = shallowTD
    } else {
      rx = cx
      ry = shallowTD
    }
  }
  if (Math.abs(rx - lx) < 1e-9) return
  out.push({ id: nextId(), kind: 'closing', points: [{ x: lx, y: ly }, { x: rx, y: ry }] })
}

/**
 * The untied units of one column whose span overlaps the interval [topElev,
 * baseElev], top->down. A unit is "in the interval" if its own span intersects it;
 * it is UNTIED when it is neither fully banded (both contacts tied) nor a
 * matched-pair band member. Its span is CLAMPED to the interval AND to the portion
 * OUTSIDE every matched-pair band this column carries — so a lone-side fill stops at
 * the band boundary rather than tiling through the band's interior rows (the
 * band-first invariant).
 *
 * Parameters
 * ----------
 * col : ColumnGeom
 *     The column whose units are collected.
 * flags : { top; base }[]
 *     Per-unit tie flags (from ``tiedContacts``).
 * banded : ReadonlySet<number>
 *     Unit indices that are a matched-pair band member (excluded wholesale). The
 *     band's own top/base contour curve + the interval brackets confine any facing
 *     fill; no per-unit span subtraction is needed here.
 * topElev, baseElev : number
 *     The interval boundaries on this column.
 *
 * Returns
 * -------
 * IntervalUnit[]
 *     The tileable untied units clamped to the interval.
 */
export function untiedUnitsInInterval(
  col: ColumnGeom,
  flags: { top: boolean; base: boolean }[],
  banded: ReadonlySet<number>,
  topElev: number,
  baseElev: number,
): IntervalUnit[] {
  const out: IntervalUnit[] = []
  for (let ui = 0; ui < col.units.length; ui++) {
    const u = col.units[ui]
    // Fully banded (both contacts tied) OR a matched-pair band member → carried by
    // the tie / band contours, never tiled. A matched-pair member may be band-tied on
    // only ONE contact (its top-tie), yet it still occupies a full-width band; the
    // band-first rule excludes it so a facing untied unit cannot overrun it.
    if ((flags[ui].top && flags[ui].base) || banded.has(ui)) continue
    // Overlap of the unit's span with the interval.
    const spanTop = Math.min(u.topElev, topElev)
    const spanBase = Math.max(u.baseElev, baseElev)
    if (spanTop - spanBase <= ELEV_EPS) continue // no overlap
    out.push({ unit: u, topElev: spanTop, baseElev: spanBase })
  }
  return out
}

/**
 * partitionFillV2/emitBottomTieSubstrate.ts — deep-to-deep flat-floor substrate
 * (design partition-engine-v2.md §4, increment-6 row "Substrate WITHOUT explicit
 * ties").
 *
 * v1 fills the sub-shallow-TD wedge down to a FLAT bottom-tie floor: its
 * ``computeBottomTieLine`` brackets the nearest deep anchor on each side of a
 * shallow run and, for the DEEPEST band, flattens its base to that floor (the
 * ``isDeepestBridge`` rule in ``sectionResolve.computeSpanningBands`` — the deeper
 * of a gap's two bottom-tie values, ``Math.min(baseL, baseR)``). Without it the
 * deep band's base slopes between the two columns' TDs (or follows the sloping
 * bridge line) and leaves a triangular void above the flat floor (the CS1
 * gap-0/gap-21/gap-22 sub-TD voids the ported ``cs1void`` gate flags).
 *
 * v2 expresses the SAME semantics as arrangement curves. Per gap where a bottom-tie
 * floor sits below the deepest fill, emit
 *   - a FLOOR curve (horizontal at the flat floor across the gap), and
 *   - a CURTAIN curve on each column, a vertical from that column's DEEPEST ANCHOR
 *     down to the floor.
 * A column's "deepest anchor" is the LOWER of its own TD and the deepest deep-to-deep
 * BRIDGE line passing through it (emitSubstrate). Starting the curtain at the bridge
 * line — not the shallow TD — is load-bearing: an intervening shallow column of a
 * bridged run has the bridge band filling its deep space, so the curtain there is a
 * short segment BELOW that band (bridge base → floor). Starting at the shallow TD
 * instead would slice the multi-gap bridge band and mis-label it (the GAP-20/21/22
 * regression).
 *
 * Both curves carry DEDICATED ids (``btfloor`` / ``btcurtain``) with an explicit
 * bottom-tie formation LABEL in ``labels`` (the ``emitLenses`` pattern): the sub-TD
 * wedge is bounded only by substrate curves, so ``labelFaces`` stamps it from this
 * label — the bottom-tie formation (v1 carries the DEEPER endpoint's identity).
 *
 * Owner §8 Q3: a strip with NO bottom-tie bracket (no base-tie segment reaching it)
 * gets ``tieElev = null`` and stays EMPTY — no floor, no curtain. The flat-extension
 * of the bottom-tie line propagates OUTWARD only from the covered span (v1
 * ``computeBottomTieLine`` flat-extension), matching v1.
 *
 * PLAIN 2/1/0 UNDER A SHALLOW TEST'S BOTTOM TIE (owner 2026-09-23, re-stated 2026-10-04 on section
 * "test"). A gap whose shallow column's TD is tied to a contact of the deep column above the deep
 * column's own TD (the shallow test's BOTTOM tie, ``shallowBottomTied``) declares the shallow column
 * the boundary: the deep units below the tie onlap it or lens at their own level, and the rest under
 * the shallow TD is the no-data void. The flat floor + curtain would close that void into a face and
 * paint it with the bottom-tie formation (*"why is sub td filled below the drilling?"*, GEO-08/119-B15
 * -> GEO-08/118-S15, a floor flat-extended from S14<->S15's base tie; *"bottom sand at S3 should just
 * onlap the blue tie to the left"*, GEO-08/118-S8 -> GEO-19/100-S3, a floor from S3<->S2's base tie
 * under S8). So such a gap gets NO floor and no curtain — unless a column BEYOND the shallow one reads
 * the strip between the shallow anchor and the floor (``terminationRun``): then the deep-to-deep
 * substrate legitimately carries the level under the shallow test (the standing exception).
 *
 * Pure module — no React, no Date.now / Math.random, no I/O.
 */

import { terminationRun } from './emitContinuation'
import { type LensLabel } from './emitLenses'
import { type ColumnGeom, type SectionInput } from './sectionGeom'
import { type InputCurve } from './types'
import { computeBottomTieLine, type CorrelationEdge, type PartitionColumn } from '../sectionPartition'

/** A contact this deep the arrangement already anchors — a 1 mm tolerance floor. */
const ELEV_EPS = 1e-3

/**
 * Emit flat-floor + curtain substrate curves for every gap whose bottom-tie floor
 * lies below the deepest fill. Appends curves to ``out`` and records each
 * substrate-curve id's bottom-tie label in ``labels``.
 *
 * Parameters
 * ----------
 * section : SectionInput
 *     The normalised section (columns carry elevations + x; edges are raw).
 * out : InputCurve[]
 *     Curve accumulator (appended to).
 * labels : Map<string, LensLabel>
 *     Substrate-curve id -> the bottom-tie formation/body its face carries. Shares
 *     the ``lensLabels`` map ``labelFaces`` consumes.
 */
export function emitBottomTieSubstrate(
  section: SectionInput,
  out: InputCurve[],
  labels: Map<string, LensLabel>,
): void {
  const { columns } = section
  if (columns.length < 2) return

  // Reconstruct the PartitionColumn shape ``computeBottomTieLine`` expects (surface +
  // per-unit depth). The normalised ``ColumnGeom`` carries elevations, so depth = surface − elev.
  const asPartitionColumns: PartitionColumn[] = columns.map((c) => ({
    investigationId: c.investigationId,
    surfaceElevM: c.surfaceElevM,
    units: c.units.map((u) => ({
      layerId: u.layerId,
      formationId: u.formationId,
      bodyId: u.bodyId,
      topDepthM: c.surfaceElevM - u.topElev,
      baseDepthM: c.surfaceElevM - u.baseElev,
    })),
  }))
  const baseTiePairs = (section.edges as readonly CorrelationEdge[])
    .filter((e) => e.aSide === 'base' && e.bSide === 'base')
    .map((e) => ({ a: e.a, b: e.b }))
  const { tieElev, formationId, bodyId } = computeBottomTieLine(asPartitionColumns, baseTiePairs)

  // Per column, the deepest (lowest) elevation any deep-to-deep bridge line passes
  // through — the base of the deep band a bridge carries across that column. The
  // curtain starts at ``min(TD, deepestBridge)`` so it stays BELOW a bridge band on
  // an intervening column (never slicing it).
  const deepestAnchor = deepestAnchorPerColumn(section)

  let seq = 0
  for (let gi = 0; gi + 1 < columns.length; gi++) {
    const left = columns[gi]
    const right = columns[gi + 1]
    const lTie = tieElev[gi]
    const rTie = tieElev[gi + 1]
    // Owner §8 Q3: no bracket on either side → the strip stays empty.
    if (lTie == null && rTie == null) continue
    // Flat floor = the deeper (lower elevation) of the two bottom-tie values, matching
    // v1's ``Math.min(baseL, baseR)`` deepest-bridge flattening. The bottom-tie
    // formation/body is the DEEPER side's identity (v1 carries the deeper endpoint).
    const useLeft = (lTie ?? Infinity) <= (rTie ?? Infinity)
    const tieFloor = Math.min(lTie ?? rTie!, rTie ?? lTie!)
    const fid = (useLeft ? formationId[gi] : formationId[gi + 1]) ?? formationId[gi] ?? formationId[gi + 1]
    const bid = (useLeft ? bodyId[gi] : bodyId[gi + 1]) ?? bodyId[gi] ?? bodyId[gi + 1]
    if (fid == null) continue

    const leftAnchor = Math.min(deepestBase(left), deepestAnchor[gi] ?? Infinity)
    const rightAnchor = Math.min(deepestBase(right), deepestAnchor[gi + 1] ?? Infinity)
    // The flat floor must lie at or below EVERY deep anchor bounding this gap, else a
    // sloping bridge line that dips below the tie floor at one column would CROSS the
    // floor curve and split the substrate face, leaving a sliver void above it (the
    // CS1 gap-7/gap-19 residual). Take the deeper of the bottom-tie floor and the two
    // columns' deepest anchors (the bridge reach), so the floor is a clean lower bound.
    const floorElev = Math.min(tieFloor, leftAnchor, rightAnchor)
    // Nothing to fill if both columns already anchor at/below the floor.
    if (leftAnchor <= floorElev + ELEV_EPS && rightAnchor <= floorElev + ELEV_EPS) continue
    // Plain 2/1/0 under a shallow test's bottom tie: the void stays empty unless a column beyond
    // the shallow one reads it (see the module docstring).
    if (bottomTieVoid(section, gi, leftAnchor, rightAnchor, floorElev)) continue

    const label: LensLabel = { formationId: fid, bodyId: bid }
    const floorId = `btfloor${seq}:${gi}`
    labels.set(floorId, label)
    out.push({
      id: floorId,
      kind: 'closing',
      points: [
        { x: left.x, y: floorElev },
        { x: right.x, y: floorElev },
      ],
    })
    emitCurtain(left, leftAnchor, floorElev, seq, 'L', label, labels, out)
    emitCurtain(right, rightAnchor, floorElev, seq, 'R', label, labels, out)
    seq++
  }
}

/**
 * Per-column deepest elevation any deep-to-deep BRIDGE line reaches at that column.
 * A jump tie (edge spanning ≥ 2 columns) draws a straight line in along-metres ×
 * elevation from the lo anchor's contact to the hi anchor's; we sample it at every
 * intervening column x and keep the lowest per column. ``Infinity`` where no bridge
 * reaches (the ``min(TD, …)`` at the call site then falls back to the column TD).
 */
function deepestAnchorPerColumn(section: SectionInput): number[] {
  const { columns } = section
  const deepest = new Array<number>(columns.length).fill(Infinity)
  const layerLoc = new Map<string, { ci: number; ui: number }>()
  columns.forEach((c, ci) => c.units.forEach((u, ui) => layerLoc.set(u.layerId, { ci, ui })))
  for (const e of section.edges) {
    const la = layerLoc.get(e.a)
    const lb = layerLoc.get(e.b)
    if (!la || !lb) continue
    if (Math.abs(la.ci - lb.ci) < 2) continue // adjacent — not a bridge
    const loLoc = la.ci < lb.ci ? la : lb
    const hiLoc = la.ci < lb.ci ? lb : la
    const loSide = (la.ci < lb.ci ? e.aSide : e.bSide) ?? 'top'
    const hiSide = (la.ci < lb.ci ? e.bSide : e.aSide) ?? 'top'
    const loU = columns[loLoc.ci].units[loLoc.ui]
    const hiU = columns[hiLoc.ci].units[hiLoc.ui]
    const loX = columns[loLoc.ci].x
    const hiX = columns[hiLoc.ci].x
    if (Math.abs(hiX - loX) < 1e-9) continue
    const loElev = loSide === 'top' ? loU.topElev : loU.baseElev
    const hiElev = hiSide === 'top' ? hiU.topElev : hiU.baseElev
    for (let ci = loLoc.ci; ci <= hiLoc.ci; ci++) {
      const t = (columns[ci].x - loX) / (hiX - loX)
      const elev = loElev + t * (hiElev - loElev)
      if (elev < deepest[ci]) deepest[ci] = elev
    }
  }
  return deepest
}

/**
 * Whether gap ``gi`` is a shallow test's bottom-tie void the floor must leave empty: the shallower
 * column's TD carries a tie to a contact of the deeper column that lies ABOVE the deeper column's own
 * TD (the ruling's bottom tie — a base<->base tie between the two TDs is this pass's own bracket, not
 * a bottom tie), the deeper column has a unit entirely below the shallow column's anchor (a unit the
 * floor would otherwise claim), and no column beyond the shallow one reads the strip between the
 * shallow column's anchor and the floor.
 */
function bottomTieVoid(
  section: SectionInput,
  gi: number,
  leftAnchor: number,
  rightAnchor: number,
  floorElev: number,
): boolean {
  const { columns } = section
  const leftTd = deepestBase(columns[gi])
  const rightTd = deepestBase(columns[gi + 1])
  if (Math.abs(leftTd - rightTd) <= ELEV_EPS) return false
  const shallowIdx = leftTd > rightTd ? gi : gi + 1
  const deepIdx = shallowIdx === gi ? gi + 1 : gi
  const shallow = columns[shallowIdx]
  const deep = columns[deepIdx]
  const shallowTd = Math.max(leftTd, rightTd)
  const deepTd = Math.min(leftTd, rightTd)
  const contactElev = (col: ColumnGeom, layerId: string, side: 'top' | 'base' | undefined): number | null => {
    const u = col.units.find((x) => x.layerId === layerId)
    if (!u) return null
    return (side ?? 'top') === 'top' ? u.topElev : u.baseElev
  }
  const bottomTied = section.edges.some((e) => {
    const sa = contactElev(shallow, e.a, e.aSide)
    const db = contactElev(deep, e.b, e.bSide)
    const sb = contactElev(shallow, e.b, e.bSide)
    const da = contactElev(deep, e.a, e.aSide)
    const pairs: [number | null, number | null][] = [[sa, db], [sb, da]]
    return pairs.some(
      ([s, d]) => s != null && d != null && Math.abs(s - shallowTd) <= ELEV_EPS && d > deepTd + ELEV_EPS,
    )
  })
  if (!bottomTied) return false
  const shallowAnchor = shallowIdx === gi ? leftAnchor : rightAnchor
  if (shallowAnchor <= floorElev + ELEV_EPS) return false
  // Only where the floor would CLAIM a unit of its own: a deep-column unit lying entirely below the
  // shallow anchor terminates by its own ties (onlap / lens), never by the floor. A deep unit that
  // merely straddles the anchor is the band the deep column carries across, and the floor keeps
  // squaring off its base (dev CS1 gaps 8 and 22 under their bridge bands, frozen in the golden).
  if (!deep.units.some((u) => u.topElev <= shallowAnchor + ELEV_EPS)) return false
  const dir = shallowIdx < deepIdx ? -1 : 1
  return !terminationRun(columns, deepIdx, dir, shallowAnchor, floorElev).reads
}

/** The deepest (lowest-elevation) base of a column — its TD. */
function deepestBase(col: ColumnGeom): number {
  let min = Infinity
  for (const u of col.units) if (u.baseElev < min) min = u.baseElev
  return min
}

/**
 * Emit a dedicated curtain curve from a column's deepest anchor down to the flat
 * floor, recording its bottom-tie label. No-op when the anchor is at/below the floor.
 */
function emitCurtain(
  col: ColumnGeom,
  anchorElev: number,
  floorElev: number,
  seq: number,
  side: 'L' | 'R',
  label: LensLabel,
  labels: Map<string, LensLabel>,
  out: InputCurve[],
): void {
  if (anchorElev <= floorElev + ELEV_EPS) return
  const id = `btcurtain${seq}${side}`
  labels.set(id, label)
  out.push({
    id,
    kind: 'closing',
    points: [
      { x: col.x, y: anchorElev },
      { x: col.x, y: floorElev },
    ],
  })
}

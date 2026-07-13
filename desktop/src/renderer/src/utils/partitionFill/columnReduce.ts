// partitionFill/columnReduce.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { classifyTermination, isSyntheticLayer, type Correlated, type TieSets } from './matcher'
import { EPS, type ExtractedLens, type PartitionColumn, type PartitionUnit, type PinchUnit } from './types'

/**
 * Snap each unit's base to the next unit's top, in place, so the column is
 * gap-free and overlap-free before tiling.
 *
 * The accepted litho layers feeding a column can carry a depth GAP (a
 * rejected/collapsed segment whose ``depth_base`` no longer meets the next
 * unit's ``depth_top``). The litho bands hide this by rendering
 * contact→next-contact; the partition fill must do the same or it shows a HOLE
 * (dogfeed 2026-06-08). Units must already be sorted by ``topDepthM``.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units, sorted shallow→deep. Mutated in place (the deepest
 *     unit keeps its own base — the column floor).
 */
export function closeColumnGaps(units: PartitionUnit[]): void {
  for (let i = 0; i < units.length - 1; i++) {
    units[i].baseDepthM = units[i + 1].topDepthM
  }
}

/**
 * Merge runs of adjacent same-``formationId`` units into one (lithology is the
 * fill primitive — a stack of same-lithology beds is one matrix band, regardless
 * of how the resolver split it into bodies). Without this, when one column's
 * matrix is one unit and the other's is split into N (different ``bodyId``s, or
 * exposed by removing an interbedded lens), the matcher orphans the surplus
 * pieces into spurious pinches. Keeps the shallowest unit's ``bodyId`` as the
 * run's representative. Mutates in place.
 *
 * The merge is gated on ``bodyId`` AS WELL AS ``formationId`` — only adjacent
 * units that share BOTH merge. WHY (spec §9 body-split, the S6 case): when
 * ``reduceColumn`` pulls an intervening lens, two NON-ADJACENT occurrences of the
 * same lithology that are DISTINCT bodies (e.g. a 0.3 m shallow ZAND sliver,
 * body A, and the thick deep ZAND, body B, separated by a pulled SILT/KLEI) would
 * otherwise become adjacent and merge into one body — erasing the deep-sand-top
 * surface a correlation tie needs to attach to. Gating on ``bodyId`` keeps them
 * distinct. ``null === null`` is true, so two uncorrelated (null-body)
 * same-lithology matrix layers still collapse (intended); only genuinely
 * different bodies of the same lithology are kept separate.
 */
export function collapseAdjacentSameFormation(units: PartitionUnit[]): void {
  for (let i = units.length - 2; i >= 0; i--) {
    if (
      units[i].formationId === units[i + 1].formationId &&
      units[i].bodyId === units[i + 1].bodyId
    ) {
      units[i].baseDepthM = units[i + 1].baseDepthM
      units.splice(i + 1, 1)
    }
  }
}

/**
 * Compute the bottom-tie line: a per-column elevation array derived from
 * base-tie correlation edges (edges where both aSide and bSide are 'base').
 *
 * Each edge resolves to a segment between two column endpoints; at each
 * column index the value is the DEEPEST (lowest elevation = most negative)
 * interpolated value across all segments that span that column (the lower
 * envelope). Formation and body identity come from the deeper endpoint of the
 * winning segment. Columns not covered by any segment receive ``null`` except
 * at the outer edges, where a flat extension propagates the nearest covered
 * column's value outward (the substrate continues past the section ends).
 *
 * Parameters
 * ----------
 * columns : readonly PartitionColumn[]
 *     The section's columns in order, index 0..n-1. May be empty.
 * baseTieEdges : readonly { a: string; b: string }[]
 *     Layer-id pairs that represent base-tie edges. Each layerId is resolved
 *     by scanning ``columns[*].units`` for ``unit.layerId === id``. If either
 *     endpoint is not found the edge is skipped.
 *
 * Returns
 * -------
 * { tieElev, formationId, bodyId }
 *     Three parallel arrays of length ``columns.length``.
 *     ``tieElev[k]`` is the lower-envelope base elevation (mTAW) at column k,
 *     or ``null`` if no segment covers k (after flat extension is applied).
 *     ``formationId[k]`` / ``bodyId[k]`` are from the segment that produced
 *     the minimum elevation at k, or ``null`` when ``tieElev[k]`` is null.
 */
export function computeBottomTieLine(
  columns: readonly PartitionColumn[],
  baseTieEdges: readonly { a: string; b: string }[],
): { tieElev: (number | null)[]; formationId: (string | null)[]; bodyId: (string | null)[] } {
  const n = columns.length
  if (n === 0) return { tieElev: [], formationId: [], bodyId: [] }

  // Build a map from layerId → { colIndex, baseElev, formationId, bodyId }.
  interface LayerInfo {
    colIndex: number
    baseElev: number
    formationId: string
    bodyId: string | null
  }
  const layerMap = new Map<string, LayerInfo>()
  for (let ci = 0; ci < n; ci++) {
    const col = columns[ci]
    for (const unit of col.units) {
      layerMap.set(unit.layerId, {
        colIndex: ci,
        baseElev: col.surfaceElevM - unit.baseDepthM,
        formationId: unit.formationId,
        bodyId: unit.bodyId,
      })
    }
  }

  // Resolved segment: [loCol, hiCol] span + per-column interpolation function.
  interface Segment {
    loCol: number
    hiCol: number
    loElev: number
    hiElev: number
    /** formationId / bodyId of the DEEPER (lower elevation) endpoint. */
    formationId: string
    bodyId: string | null
  }
  const segments: Segment[] = []
  for (const edge of baseTieEdges) {
    const a = layerMap.get(edge.a)
    const b = layerMap.get(edge.b)
    if (a === undefined || b === undefined) continue
    // Order endpoints by column index.
    const [lo, hi] = a.colIndex <= b.colIndex ? [a, b] : [b, a]
    // Carry identity from the DEEPER (lower elevation) endpoint.
    const deeper = lo.baseElev <= hi.baseElev ? lo : hi
    segments.push({
      loCol: lo.colIndex,
      hiCol: hi.colIndex,
      loElev: lo.baseElev,
      hiElev: hi.baseElev,
      formationId: deeper.formationId,
      bodyId: deeper.bodyId,
    })
  }

  // Initialise result arrays with null.
  const tieElev: (number | null)[] = Array(n).fill(null)
  const formationId: (string | null)[] = Array(n).fill(null)
  const bodyId: (string | null)[] = Array(n).fill(null)

  // For each column covered by at least one segment, take the minimum elevation
  // (lower envelope). Ties → first segment wins (deterministic).
  for (const seg of segments) {
    if (seg.loCol === seg.hiCol) {
      // Degenerate single-column segment — just the endpoint value.
      const k = seg.loCol
      if (tieElev[k] === null || seg.loElev < tieElev[k]!) {
        tieElev[k] = seg.loElev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
      continue
    }
    const span = seg.hiCol - seg.loCol
    for (let k = seg.loCol; k <= seg.hiCol; k++) {
      const t = (k - seg.loCol) / span
      const elev = seg.loElev + t * (seg.hiElev - seg.loElev)
      if (tieElev[k] === null || elev < tieElev[k]!) {
        tieElev[k] = elev
        formationId[k] = seg.formationId
        bodyId[k] = seg.bodyId
      }
    }
  }

  // Flat extension: find the leftmost and rightmost covered column indices.
  let firstCovered = -1
  let lastCovered = -1
  for (let k = 0; k < n; k++) {
    if (tieElev[k] !== null) {
      if (firstCovered === -1) firstCovered = k
      lastCovered = k
    }
  }
  if (firstCovered === -1) {
    // No segments resolved at all — all remain null.
    return { tieElev, formationId, bodyId }
  }
  // Propagate leftward from firstCovered.
  for (let k = 0; k < firstCovered; k++) {
    tieElev[k] = tieElev[firstCovered]
    formationId[k] = formationId[firstCovered]
    bodyId[k] = bodyId[firstCovered]
  }
  // Propagate rightward from lastCovered.
  for (let k = lastCovered + 1; k < n; k++) {
    tieElev[k] = tieElev[lastCovered]
    formationId[k] = formationId[lastCovered]
    bodyId[k] = bodyId[lastCovered]
  }

  return { tieElev, formationId, bodyId }
}

/**
 * A column's total depth for partition purposes — its deepest accepted-layer
 * base (the single source of truth for the reach guard: a facing neighbour can
 * only pinch out a unit whose depth it actually reached). Units are sorted
 * shallow→deep, but reduce over all bases so it is robust to any ordering.
 *
 * Parameters
 * ----------
 * units : readonly PartitionUnit[]
 *     The column's units.
 *
 * Returns
 * -------
 * number
 *     ``max(baseDepthM)``, or ``-Infinity`` for an empty stack.
 */
export function columnTotalDepth(units: readonly { baseDepthM: number }[]): number {
  return units.reduce((m, u) => Math.max(m, u.baseDepthM), -Infinity)
}

/**
 * A column as a band/lens DECISION sees it: just its total depth (the reach
 * threshold) and the set of layer ids a correlation edge can land on.
 *
 * Used to thread the WHOLE-SECTION neighbour context into ``emitGap`` so the
 * floor-interval carry-through can defer past too-shallow data-void columns to
 * the nearest REACHING neighbour, exactly like the interior ``reduceColumn``
 * reach guard (owner directive 2026-06-16).
 */
export interface SideColumn {
  /** ``max(baseDepthM)`` — the deepest the column logged. */
  td: number
  /** Every ``layerId`` on the column (a correlation-edge target). */
  layerIds: ReadonlySet<string>
}

/**
 * True iff a neighbour at total depth ``neighbourTD`` REACHES a unit whose top
 * is at ``unitTopDepth``. The single source of truth for the reach threshold so
 * every band/lens site agrees (``reduceColumn``'s interior guard, the
 * interval-minority guard, and the floor-interval carry-through).
 *
 * STRICT-TOP semantics (the safe default, 2026-06-16): a neighbour reaches a
 * unit when it logged at least to the unit's TOP. A neighbour shallower than the
 * unit's top is a DATA VOID at that depth — it cannot witness a pinch-out, so
 * the missing correlation toward it is not a geological termination.
 *
 * Parameters
 * ----------
 * neighbourTD : number
 *     The neighbour's total depth (``max(baseDepthM)``).
 * unitTopDepth : number
 *     The unit's top depth below its own surface.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` when the neighbour reaches the unit's depth.
 */
export function neighbourReaches(neighbourTD: number, unitTopDepth: number): boolean {
  return neighbourTD >= unitTopDepth - EPS
}

/**
 * The UNIFIED band-vs-lens decision for ONE side of a unit (owner directive
 * 2026-06-16: "lithos and correlations are the base truth; band/lens follows
 * correlation; 0 correlations = a lens").
 *
 * Walk ``sideColumns`` (the columns on this side, NEAREST-FIRST), skipping every
 * one too shallow to reach the unit (a DATA VOID is not a pinch-out — defer past
 * it). At the first REACHING neighbour, the unit:
 *
 *   - **BANDS** that side iff an approved correlation edge connects the unit's
 *     ``layerId`` to any layer on that reaching neighbour (lithology continues);
 *   - does NOT band (returns ``false``) iff it is NOT correlated to that reaching
 *     neighbour — a GENUINE PINCH-OUT (a lens / boundary pinch: the neighbour saw
 *     that depth and logs a different, uncorrelated lithology there).
 *
 * If NO column on this side reaches the unit (everything that way is too shallow
 * or there is no column at all), there is no observed evidence either way — this
 * function ALSO returns ``false``, but the meaning is different: a DATA VOID, not
 * a pinch-out.
 *
 * SCOPE: this rule is applied by the floor walk (the ``isFloor`` interval) only,
 * NOT for interior intervals (those are shaped by ``reduceColumn`` /
 * ``extractIntervalMinorities`` per facing neighbour). Here it sees the whole side
 * so it can defer past a shallow void to the next reaching column (the jump-edge
 * band).
 *
 * ⚠ ``false`` IS AMBIGUOUS BY DESIGN — it collapses two distinct sub-cases that
 * the floor walk MUST distinguish itself:
 *   - **reaching-but-uncorrelated** → a GENUINE PINCH (lens / boundary pinch);
 *   - **no-reaching-neighbour** (data void) → a SIDEWAYS continuation (the unit
 *     continues FLAT at its own elevation under the shallow neighbour; spec §5
 *     rule 1).
 * The caller therefore follows a ``false`` with the explicit
 * ``pinchSideColumns.some((c) => neighbourReaches(c.td, ...))`` check: SOME
 * reaching column → pinch; NONE → sideways. ``true`` is unambiguous (band).
 *
 * Parameters
 * ----------
 * unitLayerId : string
 *     The unit's ``litho_layer.id`` (the correlation-edge endpoint).
 * unitTopDepth : number
 *     The unit's top depth below its own surface (the reach threshold).
 * sideColumns : readonly SideColumn[]
 *     The columns on this side of the unit, NEAREST-FIRST.
 * correlated : Correlated
 *     Approved-edge lookup between two ``layerId``s.
 *
 * Returns
 * -------
 * boolean
 *     ``true`` → BAND this side. ``false`` → does NOT band — EITHER a genuine
 *     pinch (a reaching neighbour is uncorrelated) OR a sideways continuation (no
 *     reaching neighbour); the caller disambiguates via a reach check.
 */
export function bandsTowardSide(
  unitLayerId: string,
  unitTopDepth: number,
  sideColumns: readonly SideColumn[],
  correlated: Correlated,
): boolean {
  for (const c of sideColumns) {
    if (!neighbourReaches(c.td, unitTopDepth)) continue // data void — defer past it
    // First reaching neighbour decides: correlated → band, else → genuine pinch.
    for (const v of c.layerIds) if (correlated(unitLayerId, v)) return true
    return false // reaching neighbour, uncorrelated → GENUINE PINCH (caller's reach check confirms)
  }
  return false // no reaching neighbour on this side → SIDEWAYS (caller's reach check: data void)
}

/**
 * Per-gap column reduction: pull the LENS units (those with 0 correlated
 * bounding contacts toward the facing neighbour — see ``classifyTermination``),
 * leaving the bands + onlaps for ``emitGap`` to shape.
 *
 * Owner model (2026-06-09) — a unit's shape toward a neighbour is set purely by
 * how many of its two bounding contacts are correlated to it (2 band / 1 onlap /
 * 0 lens). Only the 0-contact lenses are removed here: pulling a lens lets the
 * SAME-lithology matrix above + below it merge so it connects continuously
 * across the gap via its OUTER correlated boundaries (the lens overlays it). The
 * matrix's INTERNAL boundary (the lens contact) is uncorrelated by construction;
 * its outer boundaries carry the band.
 *
 * Called PER GAP against the SINGLE facing neighbour (its layer ids), so a unit
 * can be a lens toward one neighbour and a band/onlap toward the other.
 *
 * REACH GUARD (a data void is not a pinch-out — owner directive 2026-06-16): a
 * unit is pulled as a lens ONLY when the facing neighbour REACHES its depth
 * (``neighbourTD >= unit.topDepthM``, the STRICT-TOP threshold). When the
 * neighbour is too SHALLOW to reach the unit (``neighbourTD < unit.topDepthM``),
 * the lack of correlation is a DATA VOID, not a geological pinch-out — the unit
 * is KEPT so it bands toward the next REACHING neighbour via its existing
 * correlation (the L↔R jump edge ``emitGap``/``matchColumns`` already carries).
 * This is the INTERIOR straddled version of the floor-interval carry-through.
 *
 * Parameters
 * ----------
 * units : PartitionUnit[]
 *     The column's units (mutated in place — lenses removed, matrix merged).
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column (for the contact-correlation count).
 * correlated : Correlated
 *     Edge lookup (approved correlation between two ``layerId``s).
 * neighbourTD : number
 *     The facing neighbour's total depth for partition purposes — its deepest
 *     accepted-layer base (``max(baseDepthM)`` over the neighbour's units). A unit
 *     whose ``topDepthM`` is deeper than this lies in the neighbour's no-data zone
 *     and is NOT pulled as a lens (the reach guard).
 *
 * Returns
 * -------
 * ExtractedLens[]
 *     The pinched-out lenses, in removal order.
 */
export function reduceColumn(
  units: PartitionUnit[],
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
  neighbourTD: number,
  baseTied?: Correlated,
  allEdgedLayerIds?: ReadonlySet<string>,
  mixedTiedLayerIds?: ReadonlySet<string>,
): ExtractedLens[] {
  const lenses: ExtractedLens[] = []
  // A pulled lens records its ORIGINAL extent, not the live (possibly flood-
  // mutated) depths: when a thin interbed is pulled, the thicker neighbour floods
  // UP into its space (``below.topDepthM = u.topDepthM`` below); if THAT neighbour
  // is later pulled as a lens too, its live top is the flooded value, so two lens
  // triangles on the same column would overlap. Snapshot the entry depths by
  // layerId and emit those.
  const origTop = new Map(units.map((u) => [u.layerId, u.topDepthM]))
  const origBase = new Map(units.map((u) => [u.layerId, u.baseDepthM]))
  const thick = (x: PartitionUnit): number => x.baseDepthM - x.topDepthM
  // Precompute which layer ids are correlated / base-tied to any neighbour (perf):
  // classifyTermination does a Set lookup instead of re-scanning neighbourLayerIds.
  // Splices only remove units / mutate depths, never add new layer ids, so the
  // sets stay valid across while-loop iterations.
  const correlatedToNeighbour = new Set<string>()
  for (const u of units) {
    for (const v of neighbourLayerIds) {
      if (correlated(u.layerId, v)) {
        correlatedToNeighbour.add(u.layerId)
        break
      }
    }
  }
  const baseTiedToNeighbour = new Set<string>()
  if (baseTied !== undefined) {
    for (const u of units) {
      for (const v of neighbourLayerIds) {
        if (baseTied(u.layerId, v)) {
          baseTiedToNeighbour.add(u.layerId)
          break
        }
      }
    }
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 1; i < units.length - 1; i++) {
      // A mixed-tied unit (top↔base edge) is an explicit continuity declaration —
      // never pinch it out as a lens; let it survive to the floor walk that raises
      // it to the tied contact (GAP-18 clay-on-sand fix).
      if (mixedTiedLayerIds?.has(units[i].layerId)) continue
      // An INTERIOR unit pinches out as a LENS toward this neighbour iff NEITHER
      // of its two bounding contacts is correlated (the owner's 0-contact rule).
      // Bands (2 contacts) and onlaps (1) are kept and shaped by emitGap. Pulling
      // the lens lets the SAME-lithology matrix above + below it merge and connect
      // continuously (a silt lens in sand → the sand stays one band via its OUTER
      // correlated boundaries, the silt overlays). The matrix's INTERNAL boundary
      // (the lens contact) is uncorrelated; its outer boundaries carry the band.
      if (
        classifyTermination(
          units,
          i,
          neighbourLayerIds,
          correlated,
          correlatedToNeighbour,
          baseTiedToNeighbour.size > 0 ? baseTiedToNeighbour : undefined,
        ) !== 'lens'
      )
        continue
      // Reach guard: a too-shallow neighbour cannot pinch out a unit it never
      // reached. If the neighbour does not reach the unit's TOP, the missing
      // correlation is a DATA VOID — keep the unit (it bands toward the next
      // reaching neighbour via its jump edge, or the floor-interval carry-through
      // makes the final band-vs-lens call), do not evict it as a lens here.
      if (!neighbourReaches(neighbourTD, units[i].topDepthM)) continue
      const u = units[i]
      const above = units[i - 1]
      const below = units[i + 1]
      lenses.push({
        bodyId: u.bodyId,
        formationId: u.formationId,
        depthTopM: origTop.get(u.layerId) ?? u.topDepthM,
        depthBaseM: origBase.get(u.layerId) ?? u.baseDepthM,
      })
      if (
        above.formationId === below.formationId &&
        !neighbourReaches(neighbourTD, below.topDepthM) &&
        !(allEdgedLayerIds?.has(below.layerId) ?? false)
      ) {
        // The lower same-formation unit is ENTIRELY in the facing side's data void
        // (neighbourTD < below.topDepthM) AND has no jump edge to any other column.
        // Merging above+below would bridge two separate occurrences of the same
        // lithology across a void whose stratigraphy is unresolved, creating an
        // artificial straddle unit. Keep them separate: absorb only the vacated
        // lens space, let the floor-interval carry-through decide the lower unit's
        // shape via its own (sideways-default) path.
        above.baseDepthM = u.baseDepthM // absorb only the vacated space
        units.splice(i, 1) // remove u; keep below
      } else if (
        above.formationId === below.formationId &&
        // Merge into ONE continuous band ONLY if the lithology actually bands
        // ACROSS to the neighbour — a bounding contact of the enclosing matrix
        // is correlated (a silt lens inside a sand that CONTINUES on the other
        // column). If NEITHER bracket correlates, the two same-lithology beds do
        // NOT continue across (the neighbour has a different lithology at that
        // elevation): they are DISTINCT bodies that each pinch/lens on their own
        // — fusing them was the dogfeed 2026-07-07 bug where S5B's two ZAND beds
        // (a SILT between, neither correlated to S11's silt) merged into one big
        // sand lens instead of reading as two.
        (correlatedToNeighbour.has(above.layerId) ||
          correlatedToNeighbour.has(below.layerId) ||
          baseTiedToNeighbour.has(above.layerId) ||
          baseTiedToNeighbour.has(below.layerId))
      ) {
        above.baseDepthM = below.baseDepthM // same matrix both sides → merge so it connects continuously
        units.splice(i, 2) // remove u + below (below folded into above)
      } else {
        // Between two DIFFERENT bands (different formation, OR same lithology
        // that does not band across) → the thicker neighbour floods over the
        // vacated space (closes the gap); the bed pinches out as a lens, and the
        // two brackets stay separate (each terminates on its own).
        if (thick(above) >= thick(below)) above.baseDepthM = u.baseDepthM
        else below.topDepthM = u.topDepthM
        units.splice(i, 1)
      }
      changed = true
      break // restart after a merge
    }
  }
  return lenses
}

/** A minority unit pulled from an interval, classified by its pinch-out kind. */
export interface ExtractedMinority {
  unit: PinchUnit
  /**
   * ``lens``  — enclosed by the matrix above AND below (0 correlated contacts);
   *             horizontal apex at its own elevation.
   * ``onlap`` — touches exactly ONE bracket tie-line (1 correlated contact);
   *             laps against that bracket, tip on the bracket interface.
   */
  kind: 'lens' | 'onlap'
  /** For an onlap: which bracket it laps against (``top`` → laps up). */
  edge?: 'top' | 'base'
}

/**
 * Extract minority units from ONE interval's left + right unit stacks,
 * classifying each as a lens or an onlap, and reducing each column to its
 * connecting matrix.
 *
 * Interval-scoped companion to ``extractEnclosedLenses`` (the global ``bodyId``
 * pre-pass). Within an interval bracketed by matched bands, the "matrix" is the
 * lithology present on BOTH columns' interval stacks. A minority unit is:
 *
 *   - a **lens** when, on its own column, the units immediately above AND below
 *     it share the SAME lithology M, M ≠ the unit's own lithology, and M is the
 *     matrix (present on the OTHER column's interval stack). 0 correlated
 *     bounding contacts.
 *   - an **onlap** when it is the TOP unit of the stack (its top is the top
 *     bracket tie-line) and the unit BELOW it is the matrix M — or the mirror at
 *     the bottom. 1 correlated bounding contact (the bracket it touches).
 *
 * Each extracted unit is removed and the matrix it was embedded in is grown to
 * fill its place, so the matrix reduces to one contiguous unit per column and
 * then connects across as a band via ``emitInterval``'s same-formation
 * single-unit-per-side case.
 *
 * Keying the connectivity guard on the OTHER column's INTERVAL stack (not the
 * whole column) is what distinguishes a lens-in-matrix (silt inside sand →
 * extract) from a matrix-between-brackets (sand between two clay BANDS → the
 * enclosing clay is a bracket, absent from the other column's interval, so the
 * sand is NOT extracted and stays the matrix). The same guard makes onlap
 * extraction fire only when the matrix actually connects across — a one-sided
 * interval (empty other column) keeps its existing boundary-pinch behaviour.
 *
 * REACH GUARD (a data void is not a pinch-out — owner directive 2026-06-16):
 * an interior lens is extracted only when the OTHER column actually REACHES the
 * minority's depth (``otherTD >= u.ownTopDepth``). When the other column is too
 * SHALLOW to have logged anything at the minority's depth, its lithology is a
 * DATA VOID — the apparent "matrix above + below + present on the other column"
 * is an artefact of the other column ending shallow, NOT a real lateral matrix,
 * so the minority is KEPT (it carries through as a band via the floor path or
 * bands toward a reaching neighbour). This mirrors the ``reduceColumn`` guard
 * for the interior-straddle case that survives into ``emitGap``.
 *
 * Parameters
 * ----------
 * leftStack, rightStack : PinchUnit[]
 *     The interval's unmatched units per column, sorted shallow→deep. Both are
 *     mutated in place (minorities removed, matrix grown).
 * aboveLith, belowLith : string | null
 *     The top / base bracket lithology (matched band above / below the
 *     interval), or ``null`` at the surface / floor (no bracket → no onlap).
 * leftTD, rightTD : number
 *     The FULL facing-column total depths (deepest accepted base) — the reach
 *     guard for each side reads the OTHER column's TD (side ``left`` → ``rightTD``).
 *
 * Returns
 * -------
 * ExtractedMinority[]
 *     The extracted minorities, in removal order.
 */
export function extractIntervalMinorities(
  leftStack: PinchUnit[],
  rightStack: PinchUnit[],
  aboveLith: string | null,
  belowLith: string | null,
  leftTD: number,
  rightTD: number,
  mixedTiedLayerIds?: ReadonlySet<string>,
  leftTies?: TieSets,
  rightTies?: TieSets,
): ExtractedMinority[] {
  return runIntervalExtraction(
    leftStack,
    rightStack,
    aboveLith,
    belowLith,
    leftTD,
    rightTD,
    mixedTiedLayerIds,
    leftTies,
    rightTies,
  )
}

/** Worker for ``extractIntervalMinorities`` — one extraction pass. */
export function runIntervalExtraction(
  leftStack: PinchUnit[],
  rightStack: PinchUnit[],
  aboveLith: string | null,
  belowLith: string | null,
  leftTD: number,
  rightTD: number,
  mixedTiedLayerIds?: ReadonlySet<string>,
  leftTies?: TieSets,
  rightTies?: TieSets,
): ExtractedMinority[] {
  const out: ExtractedMinority[] = []
  const sides: Array<['left' | 'right', PinchUnit[], PinchUnit[], number, TieSets | undefined]> = [
    // The reach guard reads the OTHER column's TD (side 'left' → rightTD).
    ['left', leftStack, rightStack, rightTD, leftTies],
    ['right', rightStack, leftStack, leftTD, rightTies],
  ]
  for (const [side, stack, other, otherTD, ties] of sides) {
    // `other` is read-only within this side's loop (only `stack` is spliced),
    // so the formation set is invariant across while-iterations — build it once
    // per side instead of every pass (perf: hot-loop allocation).
    const otherFormations = new Set(other.map((u) => u.formationId))
    // Tie-count gesture (owner 2/1/0, locked 2026-07-07): with tie sets
    // available, a unit UNtied on the bracketing contact terminates as a LENS
    // at its own elevation; a tied one ONLAPS that bracket. Without tie sets
    // (legacy callers: reduceColumn-era paths, substrate anchors), keep the
    // structural onlap default so their geometry is unchanged.
    const kindFor = (u: PinchUnit, edge: 'top' | 'base'): 'onlap' | 'lens' => {
      if (ties === undefined) return 'onlap'
      return (edge === 'top' ? ties.top.has(u.layerId) : ties.base.has(u.layerId))
        ? 'onlap'
        : 'lens'
    }
    // Synthetic bridge / projection units are matrix carriers — never gesture
    // candidates (a bridge extracted as a lens anchored a wedge at a column
    // with NO data there — the GAP7 deep-zone dogfeed artifact).
    const isCandidate = (u: PinchUnit): boolean =>
      ties === undefined || !isSyntheticLayer(u.layerId)
    let changed = true
    while (changed) {
      changed = false

      // (1) Interior lens — enclosed by the same matrix above AND below.
      for (let i = 1; i < stack.length - 1; i++) {
        const u = stack[i]
        const above = stack[i - 1]
        const below = stack[i + 1]
        // A mixed-tied unit is an explicit continuity declaration — never extract
        // it; it must reach the floor walk that raises it to the tied contact.
        if (mixedTiedLayerIds?.has(u.layerId)) continue
        if (!isCandidate(u)) continue
        if (above.formationId !== below.formationId) continue
        const m = above.formationId
        if (m === u.formationId) continue
        if (!otherFormations.has(m)) continue
        // Reach guard: only a column that actually reaches the minority's depth
        // can pinch it out. If the other column is too shallow to have logged
        // anything at u's top, the apparent enclosing matrix is a DATA VOID, not
        // a lateral matrix — keep u (it carries through / bands), do not extract.
        if (!neighbourReaches(otherTD, u.ownTopDepth)) continue
        out.push({ unit: { ...u }, kind: 'lens' })
        stack.splice(i - 1, 3, {
          bodyId: above.bodyId,
          formationId: m,
          layerId: above.layerId, // merged matrix inherits the above unit's correlatable id
          side,
          ownTopDepth: above.ownTopDepth,
          ownBaseDepth: below.ownBaseDepth,
        })
        changed = true
        break // restart after a merge
      }
      if (changed) continue

      // (2) Onlap-top — the topmost unit touches the top bracket, matrix below.
      if (aboveLith !== null && stack.length >= 2) {
        const u = stack[0]
        const below = stack[1]
        const m = below.formationId
        // Tie count decides the gesture: top contact tied → ONLAP on that
        // bracket (the below-unit grows up behind the overlay); untied →
        // LENS at its own elevation with NO growth — the vacated span
        // belongs to the interval matrix (flood/closing fill), never to a
        // different-formation neighbour (the S8 sand absorbed the silt's
        // span and wedged over BOTH levels — dogfeed 2026-07-07).
        const kind = kindFor(u, 'top')
        // Full-observation reach guard, per gesture. A LENS (untied) needs the
        // facing column to reach the unit's BASE — a straddle unit (top
        // observed, base in the void) continues sideways per the 2026-06-16
        // directive (gap-17's spurious 11 m VEEN onlap was this class). An
        // ONLAP is TIED on its TOP contact, so the facing column demonstrably
        // reached that tied contact; the base tapering into the void below the
        // shallow neighbour's TD is fine (onlap_one_corr: a top-tied PEAT whose
        // base sits below the neighbour's TD still laps up onto its tied top
        // bracket — guarding on its BASE wrongly banded it).
        const reachDepth = kind === 'onlap' ? u.ownTopDepth : u.ownBaseDepth
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          isCandidate(u) &&
          m !== u.formationId &&
          otherFormations.has(m) &&
          neighbourReaches(otherTD, reachDepth)
        ) {
          out.push(
            kind === 'onlap' ? { unit: { ...u }, kind, edge: 'top' } : { unit: { ...u }, kind },
          )
          if (kind === 'onlap') {
            below.ownTopDepth = u.ownTopDepth // matrix grows up to the bracket
            stack.splice(0, 1)
          } else {
            // LENS: replace the unit with a MATRIX-formation placeholder of the
            // same span. The interval walk then emits its usual tiling geometry
            // (identical polygons, matrix colour) behind the lens overlay, and
            // the carve cuts the lens out — the owner's "clay behind the
            // lenses" picture with tiling preserved BY CONSTRUCTION. (A bare
            // removal left holes; an interval-wide flood double-covered fill
            // triangles — SEC3.)
            stack.splice(0, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          }
          changed = true
          continue
        }
      }

      // (3) Onlap-base — the bottommost unit touches the base bracket, matrix above.
      //
      // The interval BASE is the matched band below (a correlated pair — that is
      // what bounds the interval), so this bottom unit's BASE contact sits on a
      // correlated contact: it is genuinely 1-tie → an ONLAP that laps DOWN onto
      // the band (owner's 2/1/0 model). This holds regardless of whether the
      // unit ABOVE (``m``) also bands across the gap. When ``m`` IS on the other
      // column it grows down as a connected matrix; when it is NOT, ``m`` itself
      // is a minority that pinches out as a boundary pinch on the next pass (its
      // grown extent tapers to the surface/floor apex). Requiring ``m`` on the
      // other column (the old ``otherFormations.has(m)`` guard) wrongly dropped
      // this onlap for a stack of uncorrelated units above a correlated band
      // (e.g. S8's sand+silt over the KLEI band): the silt then fell through to
      // ``emitOneSidedPinch`` and shared the surface apex, RISING into the sand
      // above it — the "onlap + lens double gesture" dogfeed bug (2026-07-07).
      if (belowLith !== null && stack.length >= 2) {
        const last = stack.length - 1
        const u = stack[last]
        const above = stack[last - 1]
        const m = above.formationId
        // Reach guard (same rule as the interior-lens branch): only a facing
        // column that actually observed the unit's depth may terminate it. A
        // too-shallow neighbour is a DATA VOID — the unit continues sideways
        // (gap-17 dogfeed: a thin VEEN below the facing column's TD was
        // extracted as an 11 m onlap down to the far interval base).
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          isCandidate(u) &&
          m !== u.formationId &&
          // Full-observation guard — see the onlap-top branch.
          neighbourReaches(otherTD, u.ownBaseDepth)
        ) {
          // Tie count decides the gesture — see the onlap-top branch's comment.
          const kind = kindFor(u, 'base')
          out.push(
            kind === 'onlap' ? { unit: { ...u }, kind, edge: 'base' } : { unit: { ...u }, kind },
          )
          if (kind === 'onlap') {
            above.ownBaseDepth = u.ownBaseDepth // matrix grows down to the bracket
            stack.splice(last, 1)
          } else {
            // LENS: matrix placeholder — see the onlap-top branch.
            stack.splice(last, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          }
          changed = true
          continue
        }
      }

      // (4) Lone remaining CANDIDATE — the side's stack has reduced to exactly
      // one real (non-placeholder) unit, the rest already matrix placeholders
      // from earlier lens extractions. A 0-tie unit here is a LENS at its own
      // elevation (owner 2/1/0); the placeholder floods behind it and the carve
      // cuts the lens out. This catches the TOP unit at a SURFACE interval
      // (aboveLith === null → onlap-top can't fire): S8's SAND after its SILT
      // was pulled left [sand, silt-placeholder] — length 2, so the old
      // ``stack.length === 1`` guard missed it and the sand fell through to a
      // mid-gap pinch (gap-7 dogfeed 2026-07-07). Restricted to a ONE-SIDED
      // interval (other stack empty) so opposing-pinch geometry is untouched.
      // Tie-set callers only — legacy paths keep the pinch machinery.
      const candidateIdxs: number[] = []
      for (let ci = 0; ci < stack.length; ci++) if (isCandidate(stack[ci])) candidateIdxs.push(ci)
      if (
        ties !== undefined &&
        candidateIdxs.length === 1 &&
        other.length === 0 &&
        (aboveLith !== null || belowLith !== null)
      ) {
        const ci = candidateIdxs[0]
        const u = stack[ci]
        if (
          !mixedTiedLayerIds?.has(u.layerId) &&
          !ties.top.has(u.layerId) &&
          !ties.base.has(u.layerId) &&
          // Full-observation guard — see the onlap-top branch.
          neighbourReaches(otherTD, u.ownBaseDepth)
        ) {
          out.push({ unit: { ...u }, kind: 'lens' })
          // LENS: matrix placeholder — see the onlap-top branch.
          stack.splice(ci, 1, {
              layerId: `flood:${u.layerId}`,
              formationId: (belowLith ?? aboveLith)!,
              bodyId: null,
              side: u.side,
              ownTopDepth: u.ownTopDepth,
              ownBaseDepth: u.ownBaseDepth,
            })
          changed = true
          continue
        }
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------

// sectionPartition/matcher.ts — extracted verbatim from partitionFill.ts
// (debt #201 round 2). See index.ts for the module-level doc.
import { EPS, type PartitionUnit } from './types'

// Section-wide lithology-aware matcher
// ---------------------------------------------------------------------------

/** A unit prepared for cross-column matching, elevations precomputed (mTAW). */
export interface MatchUnit {
  formationId: string
  /** ``litho_layer.id`` — what correlation edges reference (the band signal). */
  layerId: string
  /** Higher elevation — the unit's top. */
  topElev: number
  /** Lower elevation — the unit's base. */
  baseElev: number
  /**
   * Set to ``true`` for units injected by ``injectVirtualUnits`` (i.e. flat
   * continuations below a shallow column's TD).  Virtual units must NEVER form a
   * matched pair — they carry no real correlation and their elevation ranges
   * exactly mirror the deep column's real units, so a geometric-overlap score
   * would create spurious bands that overlap with the floor-interval pinch emit.
   */
  virtual?: true
}

/** True iff an approved correlation edge directly connects layers ``a`` and ``b``. */
export type Correlated = (a: string, b: string) => boolean

/**
 * Per-unit USER-tie lookup toward one facing column (owner 2/1/0 model):
 * ``top`` / ``base`` hold the layer ids whose top / base contact the engineer
 * explicitly tied to that neighbour. Built by ``emitGap``'s ``buildTieSets``;
 * synthetic bridge edges never contribute.
 */
export interface TieSets {
  top: ReadonlySet<string>
  base: ReadonlySet<string>
}

/**
 * True for engine-injected units that carry the matrix across data voids —
 * bridge-injection copies (``'bridge:a:b:k'``) and borehole projections
 * (``'geo-proj:'``). They are never USER declarations: they neither count as
 * ties nor terminate with their own gesture.
 */
export const isSyntheticLayer = (layerId: string): boolean =>
  layerId.startsWith('bridge:') ||
  layerId.startsWith('geo-proj:') ||
  layerId.startsWith('flood:') ||
  // 'gapfill:' units are formation-correct synthetic fillers injected between
  // bridge units below a shallow column's TD (see the gap-fill pre-pass). They
  // carry a synthetic top-tie so the band machinery treats them as band/onlap;
  // the 2/1/0 tie-gesture extraction MUST NOT pull them as lenses (doing so put
  // a spurious clay lens in S8's deep substrate — dogfeed 2026-07-07).
  layerId.startsWith('gapfill:')

/**
 * How a unit terminates toward ONE neighbour, derived from its bounding-contact
 * correlations (owner's model, 2026-06-09):
 *
 *   ``band``  — BOTH bounding contacts correlated → spans the gap as a quad.
 *   ``onlap`` — exactly ONE contact correlated → laps against the correlated
 *               tie-line, the other boundary pinching to meet it at the midpoint.
 *   ``lens``  — NEITHER contact correlated → both boundaries converge to a point
 *               at the midpoint (a pinch-out into the void).
 */
export type ContactTermination = 'band' | 'onlap' | 'lens'

/**
 * Classify a unit's termination toward a single neighbour column.
 *
 * A unit is bounded by a TOP contact and a BASE contact. A contact correlates to
 * the neighbour iff an approved edge connects the relevant layer to any layer on
 * that neighbour:
 *
 *   - **top** contact  ⟺ an edge on THIS unit's ``layerId`` (a layer's id keys
 *     the contact at its top — see ``LithoContactCorrelationEdge``).  Only
 *     top-keyed edges (``aSide`` / ``bSide`` = ``'top'`` or omitted) contribute
 *     here — a base-tie must NOT make the top contact appear correlated.
 *   - **base** contact ⟺ (a) an edge on the layer immediately BELOW (its top
 *     contact IS this unit's base), OR (b) a bottom-tie edge on THIS unit's own
 *     ``layerId`` (``aSide='base'`` / ``bSide='base'``), when provided via
 *     ``baseTiedToNeighbour``.  The deepest unit has no unit below; the bottom-tie
 *     is the only way its base can correlate.  With top + base both correlated,
 *     the deepest unit reaches count 2 → ``band``.
 *
 * The count (0/1/2) maps directly to lens/onlap/band. This is per-SIDE: pass the
 * facing neighbour's layer ids, so the same unit can band toward one neighbour
 * and pinch toward the other.
 *
 * Parameters
 * ----------
 * units : readonly PartitionUnit[]
 *     The unit's column, sorted shallow→deep.
 * index : int
 *     The unit's position in ``units``.
 * neighbourLayerIds : ReadonlySet<string>
 *     Every ``layerId`` on the facing neighbour column.
 * correlated : Correlated
 *     Top-keyed edge lookup (non-base-tie edges only).
 * correlatedToNeighbour : ReadonlySet<string>, optional
 *     Precomputed set of this column's layer ids that have a top-keyed edge to
 *     any neighbour layer (hot-loop optimisation in ``reduceColumn``).
 * baseTiedToNeighbour : ReadonlySet<string>, optional
 *     Precomputed set of this column's layer ids that have a bottom-tie edge to
 *     any neighbour layer.  When provided, a base-tie on the current unit's own
 *     ``layerId`` counts as a correlated base contact.
 *
 * Returns
 * -------
 * ContactTermination
 *     ``band`` (2 contacts), ``onlap`` (1), or ``lens`` (0).
 */
export function classifyTermination(
  units: readonly PartitionUnit[],
  index: number,
  neighbourLayerIds: ReadonlySet<string>,
  correlated: Correlated,
  correlatedToNeighbour?: ReadonlySet<string>,
  baseTiedToNeighbour?: ReadonlySet<string>,
): ContactTermination {
  // When the caller precomputed which layer ids are correlated to any neighbour
  // (a hot-loop optimisation — see reduceColumn), this is a Set lookup; else we
  // fall back to scanning neighbourLayerIds. Same result either way.
  const contactCorrelated = correlatedToNeighbour
    ? (layerId: string): boolean => correlatedToNeighbour.has(layerId)
    : (layerId: string): boolean => {
        for (const v of neighbourLayerIds) if (correlated(layerId, v)) return true
        return false
      }
  const below = units[index + 1]
  const topCorr = contactCorrelated(units[index].layerId)
  // Base contact is correlated when:
  //   (a) the layer-below's top is top-keyed correlated to the neighbour (existing), OR
  //   (b) THIS unit's own layerId has a bottom-tie to the neighbour (new).
  // Case (b) is the only path for the deepest unit (below === undefined).
  const baseTiedSelf =
    baseTiedToNeighbour !== undefined && baseTiedToNeighbour.has(units[index].layerId)
  const baseCorr = (below !== undefined && contactCorrelated(below.layerId)) || baseTiedSelf
  const count = (topCorr ? 1 : 0) + (baseCorr ? 1 : 0)
  return count === 2 ? 'band' : count === 1 ? 'onlap' : 'lens'
}

/**
 * Score a candidate cross-column pairing — edges first, geometry as the fallback.
 *
 * Lithology must agree (never pair across lithology). An explicit correlation
 * edge between the two layers is the authoritative BAND signal — it connects them
 * at ANY elevation (a correlated bed that dips between columns, e.g. the peat).
 * Geometric overlap (no edge) is the LAST-resort fill tier for the matrix:
 *
 *   same litho + edge + overlap   → 4   (explicit correlation, aligned)
 *   same litho + edge             → 3   (explicit correlation — a dipping correlated bed)
 *   same litho + overlap (no edge) → 1  (geometry — matrix coverage fill only)
 *   otherwise                     → 0   (no match → pinches out)
 *
 * ``body_id`` is deliberately NOT used — it is the resolver's over-lumped
 * transitive closure (one body spanning several lithologies/beds), which falsely
 * banded uncorrelated beds. Only the direct edges are trusted.
 *
 * ``baseTied`` is the separate predicate for bottom-tie edges (``aSide='base'`` +
 * ``bSide='base'``). When present, a base-tied pair with no top-edge still scores
 * as an explicit edge (3 or 4) so the deepest base-tied units band. The two
 * predicates are kept separate so a base-tie never makes the unit's top contact
 * appear correlated (which would affect ``classifyTermination``'s ``topCorr``
 * check in ``reduceColumn``).
 *
 * Parameters
 * ----------
 * l, r : MatchUnit
 *     The two candidate units.
 * correlated : Correlated
 *     Top-keyed edge lookup (non-base-tie edges only).
 * baseTied : Correlated, optional
 *     Base-tie edge lookup (``aSide='base'`` and ``bSide='base'`` edges only).
 *
 * Returns
 * -------
 * number
 *     0 (no match), 1 (geometry only), 3 (edge, no overlap), or 4 (edge + overlap).
 */
export function pairScore(
  l: MatchUnit,
  r: MatchUnit,
  correlated: Correlated,
  baseTied?: Correlated,
): number {
  // Virtual units (injected below a shallow column's TD by injectVirtualUnits)
  // must never form a matched pair.  Their elevation ranges mirror the real deep
  // units exactly, so a geometry-only overlap score would produce spurious band
  // quads that overlap with the floor-interval pinch emit for those same units.
  if (l.virtual || r.virtual) return 0
  if (l.formationId !== r.formationId) return 0
  const overlap = l.topElev > r.baseElev + EPS && r.topElev > l.baseElev + EPS
  const edge = correlated(l.layerId, r.layerId) || (baseTied?.(l.layerId, r.layerId) ?? false)
  if (edge && overlap) return 4
  if (edge) return 3
  if (overlap) return 1
  return 0
}

/**
 * Monotonic (order-preserving) cross-column matching — edge-correlated pairs
 * band, with geometric overlap as the fallback fill tier. A weighted
 * longest-common-subsequence over ``pairScore`` that maximises total confidence,
 * so explicit correlations win and the uncorrelated matrix still connects by
 * overlap; never pairs across lithology.
 *
 * Parameters
 * ----------
 * left, right : MatchUnit[]
 *     The two columns' units, sorted shallow→deep.
 * correlated : Correlated
 *     Top-keyed edge lookup (approved non-base-tie correlations).
 * baseTied : Correlated, optional
 *     Base-tie edge lookup (``aSide='base'`` and ``bSide='base'`` edges only).
 *     When present, base-tied pairs receive the same score as top-keyed pairs,
 *     so the deepest base-tied units match and band. Kept separate from
 *     ``correlated`` so a base-tie does not affect ``topCorr`` in
 *     ``classifyTermination``.
 *
 * Returns
 * -------
 * Array<[number, number]>
 *     Matched (leftIndex, rightIndex) pairs in ascending order.
 */
export function matchColumns(
  left: MatchUnit[],
  right: MatchUnit[],
  correlated: Correlated,
  baseTied?: Correlated,
): Array<[number, number]> {
  const n = left.length
  const m = right.length
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0))
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const s = pairScore(left[i - 1], right[j - 1], correlated, baseTied)
      let best = Math.max(dp[i - 1][j], dp[i][j - 1])
      if (s > 0) best = Math.max(best, dp[i - 1][j - 1] + s)
      dp[i][j] = best
    }
  }
  const pairs: Array<[number, number]> = []
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    const s = pairScore(left[i - 1], right[j - 1], correlated, baseTied)
    if (s > 0 && dp[i][j] === dp[i - 1][j - 1] + s) {
      pairs.push([i - 1, j - 1])
      i--
      j--
    } else if (dp[i - 1][j] >= dp[i][j - 1]) {
      i--
    } else {
      j--
    }
  }
  pairs.reverse()
  return pairs
}

// ---------------------------------------------------------------------------
